import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectLocalDaemonMaintenanceFiles, scanNativeFiles} from '../backend/preservation-native-evidence.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const legacy = {key: 'retained-dedupe', result: {actionId: 'retained-action', status: 'succeeded', completedAt: 1, result: {output: 'old-history'}}};
const identity = {workspace: 'isolated-workspace', deviceId: 'isolated-device'};
const modern = {key: 'new-action', identity, result: {actionId: 'new-action', status: 'succeeded', completedAt: 2, result: {output: 'new-history'}}};
const started = {key: modern.key, actionId: modern.result.actionId, identity, startedAt: 1};
function fixture(t, state) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-local-maintenance-'));
  t.after(() => {assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith('ziwei-local-maintenance-')); fs.rmSync(root, {recursive: true, force: true});});
  const file = path.join(root, 'action-state.json'); fs.writeFileSync(file, JSON.stringify(state));
  return {root, file, connection: {...identity, apiBase: 'http://127.0.0.1:6387', runtimeDir: root}};
}
function inspect(f) {
  const before = fs.readFileSync(f.file); const result = inspectLocalDaemonMaintenanceFiles({connections: [f.connection]});
  assert.deepEqual(fs.readFileSync(f.file), before);
  assert.equal(Object.hasOwn(result, 'originalActionProofs'), false); assert.equal(Object.hasOwn(result, 'legacyHistoryProofs'), false); assert.equal(Object.hasOwn(result, 'namespaceComplete'), false);
  return result;
}
for (const state of [
  {version: 1, completed: [legacy]},
  {version: 1, updatedAt: '2026-10-12T00:00:00.000Z', completed: [legacy]},
  {version: 2, started: [started], completed: [{...legacy, legacy: true}, modern]}
]) test(`local retained history permits only current main stop, formal mode cannot be selected by JSON (${state.version}/${!!state.updatedAt})`, t => {
  const f = fixture(t, state); assert.equal(inspect(f).safe, true);
  for (const extra of [{}, {local: true, mode: 'local', localMaintenance: true}, {productionRequest: {mode: 'local', local: true}}]) {
    assert.equal(scanNativeFiles({connections: [f.connection], ...extra}).safe, false);
  }
});

const badStates = {
  'V1 with hidden started field': {version: 1, completed: [legacy], started: [started]},
  'invalid V1 date': {version: 1, updatedAt: 'invalid', completed: [legacy]},
  'mixed corrupt completion': {version: 2, started: [], completed: [{...legacy, legacy: true}, {key: 'bad', result: null}]},
  'unpaired modern completion': {version: 2, started: [], completed: [{...legacy, legacy: true}, modern]},
  'unfinished started': {version: 2, started: [{...started, nativeRuntime: true}], completed: [{...legacy, legacy: true}]},
  'stop confirmed without result': {version: 2, started: [{...started, quarantine: {stopConfirmed: true}}], completed: [{...legacy, legacy: true}]},
  'wrong current identity': {version: 2, started: [{...started, identity: {...identity, deviceId: 'other'}}], completed: [{...legacy, legacy: true}, modern]},
  'duplicate legacy action id': {version: 1, completed: [legacy, {...legacy, key: 'other-key'}]},
  'missing old completion time': {version: 1, completed: [{...legacy, result: {...legacy.result, completedAt: undefined}}]}
};
for (const [name, state] of Object.entries(badStates)) test(`local stop refuses ${name} without rewriting history`, t => {assert.equal(inspect(fixture(t, state)).safe, false);});
for (const result of [
  {executionState: 'uncertain'}, {execution_state: 'pending'}, {retainEvidence: true},
  {processExit: {}}, {processExit: null}, {processExit: {treeConfirmed: false, activeProcesses: 0}},
  {nativeOperation: {resource: 'gateway', data: {residentWorker: {rootPid: 1}}}}
]) test(`local history never converts explicit unknown evidence into absent legacy fields (${JSON.stringify(result)})`, t => {
  assert.equal(inspect(fixture(t, {version: 1, completed: [{...legacy, result: {...legacy.result, result}}]})).safe, false);
  assert.equal(inspect(fixture(t, {version: 2, started: [started], completed: [{...legacy, legacy: true}, {...modern, result: {...modern.result, result}}]})).safe, false);
});

function delivery(f, overrides) {
  const directory = path.join(f.root, 'action-delivery'); fs.mkdirSync(directory, {recursive: true});
  const action = {id: 'delivery-action', type: 'directory.inspect', payload: {deviceId: identity.deviceId}};
  const deliveryIdentity = {apiBase: f.connection.apiBase, ...identity};
  const binding = hash(JSON.stringify({id: action.id, type: action.type, agent: 'ziwei_user', workspace: identity.workspace, device: identity.deviceId, employee: null, conversation: null, message: null, dedupe: null}));
  const filename = hash(JSON.stringify(action.id));
  const actionBytes = JSON.stringify({identity: deliveryIdentity, binding, action});
  const resultBytes = JSON.stringify({status: 'succeeded', result: {}, receiptOnly: true});
  const record = {version: 2, identity: deliveryIdentity, binding, action, state: 'confirmed', events: [], serverStatus: 'succeeded', confirmedAt: '2026-10-12T00:00:00.000Z', ...overrides};
  if (record.state !== 'confirmed' || record.retainEvidence) {
    for (const [kind, bytes] of [['action', actionBytes], ['result', resultBytes]]) {
      fs.writeFileSync(path.join(directory, `${filename}.${kind}.json`), bytes); record[`${kind}Digest`] = hash(bytes);
    }
  }
  fs.writeFileSync(path.join(directory, `${filename}.json`), JSON.stringify(record)); return directory;
}
for (const overrides of [{state: 'awaiting_ack'}, {state: 'acked'}, {state: 'result_pending'}, {state: 'blocked'}, {retainEvidence: true}, {events: [{event: 'unconfirmed'}]}]) {
  test(`local delivery retains refusal for ${JSON.stringify(overrides)}`, t => {
    const f = fixture(t, {version: 1, completed: [legacy]}), directory = delivery(f, overrides);
    const before = fs.readdirSync(directory).map(name => [name, hash(fs.readFileSync(path.join(directory, name)))]);
    assert.equal(inspect(f).safe, false);
    assert.deepEqual(fs.readdirSync(directory).map(name => [name, hash(fs.readFileSync(path.join(directory, name)))]), before);
  });
}
for (const name of ['orphan.action.json', 'orphan.tmp']) test(`local disk scan sees ${name} beyond in-memory delivery counts`, t => {
  const f = fixture(t, {version: 1, completed: [legacy]}), directory = delivery(f, {});
  assert.equal(inspect(f).safe, true); const file = path.join(directory, name); fs.writeFileSync(file, 'retained');
  assert.equal(inspect(f).safe, false); assert.equal(fs.readFileSync(file, 'utf8'), 'retained');
});
