import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {nativeActionDigest} from '../backend/preservation-native-databases.mjs';
import {createLegacySourceInterpreter, isLegacySourceInterpreter} from '../backend/preservation-legacy-source.mjs';
import {scanNativeFiles} from '../backend/preservation-native-evidence.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const protocolPaths = ['src/management-bootstrap.mjs', 'daemon/ziwei_user.mjs', 'src/daemon.mjs', 'src/daemon-action-scheduler.mjs', 'src/local-action.mjs', 'src/runtime-adapters.mjs'];
function archiveFixture() {
  const members = new Map(protocolPaths.map(name => [name, Buffer.from(`// approved isolated ACK-before-dispatch fixture: ${name}\r\n`)]));
  members.set('package.json', Buffer.from('{"name":"isolated-legacy-fixture"}'));
  members.set('scripts/ziwei-user.mjs', Buffer.from('#!/usr/bin/env node\r\n// fixture\r\n'));
  for (const name of ['backend/a2a-auth.mjs', 'scripts/ziwei-cli.mjs', 'scripts/start-ziwei-user.mjs', 'scripts/ziwei-mcp.mjs', 'scripts/ziwei-terminal-mcp.mjs', 'scripts/client-lifecycle.mjs', 'scripts/client-maintenance-helper.mjs', 'scripts/client-update.mjs', 'scripts/client-update-worker.mjs']) members.set(name, Buffer.from(`// fixture ${name}\r\n`));
  for (let i = 0; i < 13; i++) members.set(`src/fixture-${i}.mjs`, Buffer.from(`// fixture ${i}\r\n`));
  const blocks = [];
  for (const [name, bytes] of members) {
    const header = Buffer.alloc(512); header.write(`package/${name}`, 0); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136); header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257); header.write('00', 263);
    header.write([...header].reduce((n, byte) => n + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  const bytes = gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
  const build = createHash('sha256');
  for (const name of [...members.keys()].sort()) {let content = members.get(name); if (name === 'scripts/ziwei-user.mjs') content = Buffer.from(content.toString().replace(/^(#![^\r\n]*)\r\n/, '$1\n')); build.update(name); build.update('\0'); build.update(content); build.update('\0');}
  return {bytes, policy: {expectedSha256: sha(bytes), expectedBytes: bytes.length, memberManifest: [...members].map(([name, content]) => ({path: name, bytes: content.length, sha256: sha(content)})), protocolSha256: Object.fromEntries(protocolPaths.map(name => [name, sha(members.get(name).toString().replace(/\r\n/g, '\n'))])), expectedInstalledBuild: build.digest('hex')}};
}
export function legacyFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-legacy-source-'));
  t.after(() => {assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith('ziwei-legacy-source-')); fs.rmSync(root, {recursive: true, force: true});});
  const runtime = path.join(root, 'runtime'), logDir = path.join(root, 'logs'); fs.mkdirSync(runtime); fs.mkdirSync(logDir);
  const configPath = path.join(root, 'config.json'), origin = 'http://127.0.0.1:6387', workspace = 'history-fixture', workspaceId = 'ws-fixture', deviceId = 'device-fixture';
  const config = {workspace, deviceId, apiBase: origin}; const configBytes = JSON.stringify(config); fs.writeFileSync(configPath, configBytes);
  const action = {id: 'subject-fixture', workspace_id: workspaceId, type: 'conversation.execute', status: 'expired', acked_at: '2026-10-11T14:26:40.455Z', completed_at: '2026-10-11T14:42:41.671Z', created_at: '2026-10-11T14:26:36.151Z', updated_at: null, payload_json: JSON.stringify({deviceId}), result_json: '', dedupe_key: 'subject-dedupe'};
  const history = {key: 'older-dedupe', result: {actionId: 'older-action', status: 'succeeded', completedAt: 1, result: {output: 'retained'}}};
  const historicalCache = {version: 1, updatedAt: '2026-10-11T13:10:59.907Z', completed: [history]}, historicalBytes = JSON.stringify(historicalCache);
  const state = {version: 2, updatedAt: '2026-10-12T07:15:51.863Z', completed: [{...history, legacy: true}], started: []};
  const archive = archiveFixture();
  const generation = {pid: 51880, createdAt: '2026-10-10T10:40:39.884Z', installedBuild: archive.policy.expectedInstalledBuild, workspace, deviceId, configSha256: sha(configBytes), root, executable: process.execPath, configPath, runtimeDir: runtime, logDir, commandSha256: sha('approved isolated command')};
  const row = (at, event, extra = {}) => ({at, pid: generation.pid, event, service: 'ziwei_user', workspace, ...extra});
  const failure = row('2026-10-11T14:26:41.906Z', 'a2a_action_failed', {actionId: action.id, error: 'The operation was aborted due to timeout'});
  const first = [row('2026-10-10T10:40:42.458Z', 'started'), row('2026-10-11T14:26:30.000Z', 'heartbeat')];
  const second = [row('2026-10-11T14:26:30.006Z', 'heartbeat'), row('2026-10-11T14:26:38.000Z', 'a2a_poll', {pending: 1, ok: true}), failure, row('2026-10-11T17:10:31.994Z', 'a2a_poll', {pending: 0, ok: true}), row('2026-10-11T20:00:21.171Z', 'exited')];
  const serialize = rows => rows.map(record => JSON.stringify(record) + '\n').join('');
  const logPaths = [path.join(logDir, 'daemon.log.1791728790000'), path.join(logDir, 'daemon.log.1791748821171')];
  const sourcePath = path.join(runtime, 'action-state.json');
  const context = {captureUTC: '2026-10-11T17:10:33.538432+00:00', sameActionRecords: [failure], nearbyRecords: [second[1], failure, second[3]]};
  const inspect = {captureUTC: '2026-10-11T17:10:33.527386+00:00', config: {finalPath: configPath, workspace, deviceId, apiBase: origin}, logs: [{path: logPaths[0], finalPath: logPaths[0], bytes: Buffer.byteLength(serialize(first))}, {path: path.join(logDir, 'daemon.log'), finalPath: path.join(logDir, 'daemon.log'), lastAt: second[3].at, bytes:Buffer.byteLength(serialize(second.slice(0,4)))}], actionStates: [{path: sourcePath, finalPath: sourcePath}]};
  const snapshot = {captureUTC: '2026-10-11T17:10:33.773674+00:00', config: {path: configPath, finalPath: configPath, sha256: generation.configSha256, workspace, deviceId, apiBase: origin, sharedBindings: []}, health: {pid: generation.pid, clientBuild: generation.installedBuild, workspace, deviceId, lifecycle: {root, configPath, configSha256: generation.configSha256, startedAt: '2026-10-10T10:40:39.986Z'}}, nativeProcess: {pid: generation.pid, executable: generation.executable, creationDate: '/Date(1791628839884)/', commandSha256: generation.commandSha256}, installedBuild: generation.installedBuild, actionStates: [{path: sourcePath, finalPath: sourcePath, sha256: sha(historicalBytes), bytes: Buffer.byteLength(historicalBytes)}]};
  const descriptors = {};
  for (const [role, bytes, source] of [['archive', archive.bytes, path.join(root, 'source.tgz')], ['context', JSON.stringify(context), path.join(root, 'context.json')], ['inspect', JSON.stringify(inspect), path.join(root, 'inspect.json')], ['snapshot', JSON.stringify(snapshot), path.join(root, 'snapshot.json')], ['cache', JSON.stringify(state), sourcePath], ['loggerStart', serialize(first), logPaths[0]], ['loggerEnd', serialize(second), logPaths[1]]]) {
    const file = path.join(root, `${role}.bin`); fs.writeFileSync(file, bytes); descriptors[role] = {path: file, sourcePath: source, sha256: sha(bytes), bytes: Buffer.byteLength(bytes)};
  }
  const authorization = {schemaVersion: 1, kind: 'ziwei-approved-legacy-source-v1', hostId: 'windows-fixture', origin, workspace, workspaceId, deviceId, generation, subject: {actionId: action.id, actionDigest: nativeActionDigest(action), payloadSha256: sha(action.payload_json), resultSha256: sha(''), dedupeKeySha256: sha(action.dedupe_key), failureErrorSha256: sha(failure.error), fields: Object.fromEntries(['workspace_id', 'type', 'status', 'acked_at', 'completed_at', 'created_at', 'updated_at'].map(key => [key, action[key]]))}, historicalCache: {updatedAt: historicalCache.updatedAt, completedCount: 1, sha256: sha(historicalBytes), bytes: Buffer.byteLength(historicalBytes)}, archivePolicy: archive.policy, artifacts: descriptors};
  const connection = {runtimeDir: runtime, workspace, deviceId, apiBase: origin};
  const request = {schemaVersion: 1, domain: 'ziwei-production-request-v1', kind: 'collect', operationId: 'fixture-operation', specHash: 'a'.repeat(64), challenge: 'b'.repeat(32), freezeDigest: 'c'.repeat(64), targetOrigins: [origin], binding: {hostId: authorization.hostId, workspaceIds: [workspaceId], deviceIds: [deviceId], clients: [{runtimeDir: runtime, root, configPath, configSha256: generation.configSha256, installedRole: 'v2', originalInstance: {pid: 12132, createdAt: '2026-10-12T10:19:53.290Z'}}]}, actionProjection: {tables: {workspaces: {rows: [{id: workspaceId, slug: workspace}]}, a2a_actions: {rows: [action]}, employees: {rows: []}}}};
  const requestBinding = Object.fromEntries(["operationId", "specHash", "freezeDigest", "challenge"].map(key => [key, request[key]]));
  // Independent fixture producer observes every member of this exact native
  // log directory. Real historical sources need their own reviewed producer;
  // the capture JSON itself cannot select this verifier.
  fs.writeFileSync(logPaths[0], serialize(first));
  fs.writeFileSync(path.join(logDir, 'daemon.log'), serialize(second.slice(0,4)));
  const verifyLoggerCoverage = coverage => {
    const entries = fs.readdirSync(logDir).map(name => ({path:path.join(logDir,name),bytes:fs.statSync(path.join(logDir,name)).size})).sort((a,b)=>a.path.localeCompare(b.path));
    return coverage.kind === 'legacy-logger-coverage-v1' && coverage.logDir === logDir && JSON.stringify(coverage.capture.entries) === JSON.stringify(entries);
  };
  return {root, authorization, request, requestBinding, connection, state, action, history, descriptors, first, second, verifyLoggerCoverage};
}

test('approved code capability independently binds old source/history and one unexecuted action while current generation differs', t => {
  const f = legacyFixture(t), interpreter = createLegacySourceInterpreter({authorization: f.authorization, requestBinding: f.requestBinding, verifyLoggerCoverage: f.verifyLoggerCoverage});
  assert.equal(isLegacySourceInterpreter(interpreter), true); assert.equal(isLegacySourceInterpreter({...interpreter}), false);
  const history = interpreter.connectionProof({productionRequest: f.request, connection: f.connection, state: f.state});
  assert.equal(history.workspaceId, f.authorization.workspaceId); assert.equal(history.recordDigests.length, 1);
  const original = structuredClone(f.action), proof = interpreter.neverDispatchedProof({productionRequest: f.request, connection: f.connection, action: f.action, state: f.state});
  assert.equal(proof.kind, 'legacy-never-dispatched-v1'); assert.equal(proof.verified, true); assert.equal(proof.conclusion, 'never-dispatched');
  assert.equal(proof.actionDigest, nativeActionDigest(f.action)); assert.equal(proof.challenge, f.request.challenge);
  assert.equal(Object.hasOwn(proof, 'processExit'), false); assert.equal(Object.hasOwn(proof, 'treeConfirmed'), false); assert.equal(Object.hasOwn(proof, 'namespaceComplete'), false);
  assert.deepEqual(f.action, original);
});
for (const field of ['hostId', 'workspaceId', 'deviceId']) test(`legacy capability refuses changed ${field}`, t => {
  const f = legacyFixture(t), interpreter = createLegacySourceInterpreter({authorization: f.authorization, requestBinding: f.requestBinding, verifyLoggerCoverage: f.verifyLoggerCoverage});
  if (field === 'hostId') f.request.binding.hostId = 'other'; else if (field === 'workspaceId') f.request.binding.workspaceIds = ['other']; else f.connection.deviceId = 'other';
  assert.throws(() => interpreter.neverDispatchedProof({productionRequest: f.request, connection: f.connection, action: f.action, state: f.state}));
});
for (const change of [row => {row.id = 'other';}, row => {row.payload_json += ' ';}, row => {row.result_json = null;}, row => {row.status = 'acked';}, row => {row.dedupe_key = 'other';}]) test('one subject proof refuses raw action changes', t => {
  const f = legacyFixture(t), interpreter = createLegacySourceInterpreter({authorization: f.authorization, requestBinding: f.requestBinding, verifyLoggerCoverage: f.verifyLoggerCoverage}); change(f.action);
  assert.throws(() => interpreter.neverDispatchedProof({productionRequest: f.request, connection: f.connection, action: f.action, state: f.state}));
});
for (const change of [state => {state.completed[0].result.completedAt++;}, state => {state.started.push({key: 'subject-dedupe', actionId: 'subject-fixture', identity: {}, startedAt: 1});}, state => {state.completed.push({key: 'subject-dedupe', legacy: true, result: {actionId: 'subject-fixture', status: 'succeeded', completedAt: 2}});}, state => {state.completed.push({key: 'corrupt', result: null});}, state => {state.completed[0].result.result.executionState = 'unknown';}]) test('history anchor and complete current cache reject mismatch, started, present dedupe and mixed unknown', t => {
  const f = legacyFixture(t), interpreter = createLegacySourceInterpreter({authorization: f.authorization, requestBinding: f.requestBinding, verifyLoggerCoverage: f.verifyLoggerCoverage}); change(f.state);
  assert.throws(() => interpreter.neverDispatchedProof({productionRequest: f.request, connection: f.connection, action: f.action, state: f.state}));
});
for (const role of ['archive', 'context', 'inspect', 'snapshot', 'cache', 'loggerStart', 'loggerEnd']) test(`missing or changed ${role} bytes cannot inherit eligibility flags`, t => {
  const f = legacyFixture(t), interpreter = createLegacySourceInterpreter({authorization: f.authorization, requestBinding: f.requestBinding, verifyLoggerCoverage: f.verifyLoggerCoverage});
  fs.appendFileSync(f.descriptors[role].path, ' ');
  assert.throws(() => interpreter.neverDispatchedProof({productionRequest: f.request, connection: f.connection, action: f.action, state: f.state}));
});
test('new logger started event or another boot is rejected even with independently updated byte pin', t => {
  for (const extra of [{...legacyFixture(t).second[2], event: 'action.started'}, {pid: 51880, at: '2026-10-11T14:26:42.000Z', event: 'started', workspace: 'history-fixture'}]) {
    const f = legacyFixture(t); const rows = [...f.second]; rows.splice(3, 0, {...extra, actionId: f.action.id});
    const bytes = rows.map(row => JSON.stringify(row) + '\n').join(''); fs.writeFileSync(f.descriptors.loggerEnd.path, bytes); Object.assign(f.authorization.artifacts.loggerEnd, {sha256: sha(bytes), bytes: Buffer.byteLength(bytes)});
    const interpreter = createLegacySourceInterpreter({authorization: f.authorization, requestBinding: f.requestBinding, verifyLoggerCoverage: f.verifyLoggerCoverage});
    assert.throws(() => interpreter.neverDispatchedProof({productionRequest: f.request, connection: f.connection, action: f.action, state: f.state}));
  }
});

test('formal scanner requires independent code capability and archive history remains valid at current V2 root', t => {
  const f = legacyFixture(t); fs.writeFileSync(path.join(f.connection.runtimeDir, 'action-state.json'), JSON.stringify(f.state));
  const newRoot=path.join(f.root,'new-v2-root');fs.mkdirSync(path.join(newRoot,'src'),{recursive:true});fs.writeFileSync(path.join(newRoot,'src','daemon.mjs'),'// actual isolated V2 marker, different from approved old protocol');f.request.binding.clients[0].root=newRoot;
  const old = {id: f.history.result.actionId, workspace_id: f.authorization.workspaceId, status: 'succeeded', acked_at: '2026-10-11T12:00:00Z', type: 'directory.inspect', payload_json: JSON.stringify({deviceId: f.connection.deviceId}), result_json: JSON.stringify(f.history.result.result), dedupe_key: f.history.key};
  f.request.actionProjection.tables.a2a_actions.rows.push(old);
  const options = {connections: [f.connection], actions: [old, f.action], productionRequest: f.request};
  const interpreter = createLegacySourceInterpreter({authorization: f.authorization, requestBinding: f.requestBinding, verifyLoggerCoverage: f.verifyLoggerCoverage});
  assert.equal(scanNativeFiles({...options, legacySource: interpreter}).safe, false, 'wire fields do not select interpreter');
  assert.throws(() => scanNativeFiles(options, {legacySource: {...interpreter}}), {code: 'LEGACY_SOURCE_CAPABILITY_INVALID'});
  const evidence = scanNativeFiles(options, {legacySource: interpreter});
  assert.equal(evidence.safe, true, JSON.stringify(evidence.issues));
  assert.equal(evidence.legacyHistoryProofs.length, 1); assert.equal(evidence.originalActionProofs.length, 2);
  assert.equal(evidence.originalActionProofs[1].kind, 'legacy-never-dispatched-v1');
  assert.equal(evidence.files.some(row => row.path === f.descriptors.loggerEnd.path), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.connection.runtimeDir, 'action-state.json'))), f.state);
  const extra = {key: 'unanchored-history', legacy: true, result: {actionId: 'unanchored-action', status: 'succeeded', completedAt: 2, result: {output: 'other'}}};
  f.state.completed.push(extra); fs.writeFileSync(path.join(f.connection.runtimeDir, 'action-state.json'), JSON.stringify(f.state));
  const other = {...old, id: extra.result.actionId, dedupe_key: extra.key, result_json: JSON.stringify(extra.result.result)};
  assert.equal(scanNativeFiles({...options, actions: [...options.actions, other]}, {legacySource: interpreter}).safe, false, 'new legacy marker cannot inherit approved prefix');
});

for(const field of ['operationId','specHash','freezeDigest','challenge'])test(`legacy capability rejects changed ${field} outside independently supplied request binding`,t=>{
  const f=legacyFixture(t),cap=createLegacySourceInterpreter({authorization:f.authorization,requestBinding:f.requestBinding,verifyLoggerCoverage:f.verifyLoggerCoverage});
  f.request[field]=field==='operationId'?'other-operation':'d'.repeat(64);
  assert.throws(()=>cap.neverDispatchedProof({productionRequest:f.request,connection:f.connection,action:f.action,state:f.state}));
});
test('historical audit reads only approved artifacts and cannot mint a current source or action proof',t=>{
  const f=legacyFixture(t);fs.unlinkSync(f.authorization.generation.configPath);
  const cap=createLegacySourceInterpreter({authorization:f.authorization,requestBinding:f.requestBinding,verifyLoggerCoverage:f.verifyLoggerCoverage}),audit=cap.auditHistoricalSource();
  assert.equal(audit.recordCount,1);assert.equal(audit.scope,'historical-source-only');assert.equal(audit.currentConfigVerified,false);assert.equal(audit.namespaceComplete,null);
  assert.equal(Object.hasOwn(audit,'verified'),false);assert.equal(Object.hasOwn(audit,'originalActionProofs'),false);
  assert.throws(()=>cap.neverDispatchedProof({productionRequest:f.request,connection:f.connection,action:f.action,state:f.state}));
});
test('native reader redirected final path is rejected even when configuration bytes and hash match',t=>{
  const f=legacyFixture(t),readBytes=file=>{const stat=fs.lstatSync(file);return{bytes:fs.readFileSync(file),identity:{dev:String(stat.dev),ino:String(stat.ino)},nativeFinalPath:path.join(f.root,'redirected',path.basename(file))};};
  const cap=createLegacySourceInterpreter({authorization:f.authorization,requestBinding:f.requestBinding,readBytes,verifyLoggerCoverage:f.verifyLoggerCoverage});
  assert.throws(()=>cap.connectionProof({productionRequest:f.request,connection:f.connection,state:f.state}));
});
test('native event timestamp does not reorder mandatory append history',t=>{
  const f=legacyFixture(t),rows=[...f.second];rows.splice(4,0,{...rows[3],at:'2026-10-11T17:10:31.633Z',event:'action.progress',actionId:'other-action'});
  const bytes=rows.map(row=>JSON.stringify(row)+'\n').join('');fs.writeFileSync(f.descriptors.loggerEnd.path,bytes);Object.assign(f.authorization.artifacts.loggerEnd,{sha256:sha(bytes),bytes:Buffer.byteLength(bytes)});
  const cap=createLegacySourceInterpreter({authorization:f.authorization,requestBinding:f.requestBinding,verifyLoggerCoverage:f.verifyLoggerCoverage});
  assert.equal(cap.neverDispatchedProof({productionRequest:f.request,connection:f.connection,action:f.action,state:f.state}).verified,true);
});
test('a target started on another PID remains unknown despite matching old boot failure',t=>{
  const f=legacyFixture(t),rows=[...f.second];rows.splice(4,0,{...rows[3],at:'2026-10-11T17:10:32.000Z',event:'action.started',pid:60000,actionId:f.action.id});
  const bytes=rows.map(row=>JSON.stringify(row)+'\n').join('');fs.writeFileSync(f.descriptors.loggerEnd.path,bytes);Object.assign(f.authorization.artifacts.loggerEnd,{sha256:sha(bytes),bytes:Buffer.byteLength(bytes)});
  const cap=createLegacySourceInterpreter({authorization:f.authorization,requestBinding:f.requestBinding,verifyLoggerCoverage:f.verifyLoggerCoverage});
  assert.throws(()=>cap.neverDispatchedProof({productionRequest:f.request,connection:f.connection,action:f.action,state:f.state}));
});

function replaceCapture(f, change) {
  const capture = JSON.parse(fs.readFileSync(f.descriptors.inspect.path));
  change(capture);
  const bytes = Buffer.from(JSON.stringify(capture));
  fs.writeFileSync(f.descriptors.inspect.path, bytes);
  Object.assign(f.authorization.artifacts.inspect, {sha256: sha(bytes), bytes: bytes.length});
}
test('omitting a captured middle rotation cannot prove never-dispatched even with endpoints six milliseconds apart', t => {
  const f = legacyFixture(t);
  const middlePath = path.join(f.authorization.generation.logDir, 'daemon.log.1791728790003');
  const middle = {...f.first.at(-1), at: '2026-10-11T14:26:30.003Z', event: 'action.started', actionId: f.action.id};
  const bytes = Buffer.from(JSON.stringify(middle) + '\n');
  fs.writeFileSync(middlePath, bytes);
  replaceCapture(f, capture => capture.logs.splice(1, 0, {path: middlePath, finalPath: middlePath, bytes: bytes.length, lastAt: middle.at}));
  assert.equal(Date.parse(f.second[0].at) - Date.parse(f.first.at(-1).at), 6);
  const cap = createLegacySourceInterpreter({authorization: f.authorization, requestBinding: f.requestBinding, verifyLoggerCoverage: f.verifyLoggerCoverage});
  assert.throws(() => cap.neverDispatchedProof({productionRequest: f.request, connection: f.connection, action: f.action, state: f.state}), {code: 'LEGACY_SOURCE_UNPROVEN'});
});
for (const [label, change] of [
  ['duplicate rotation', capture => capture.logs.push({...capture.logs[0]})],
  ['duplicate active log', capture => capture.logs.push({...capture.logs[1]})],
  ['unknown captured file', capture => capture.logs.push({path: '/unknown/daemon.log.1', finalPath: '/unknown/daemon.log.1', bytes: 1})],
  ['truncated capture inventory', capture => {delete capture.logs[0];}],
]) test(`legacy logger coverage refuses ${label}`, t => {
  const f = legacyFixture(t); replaceCapture(f, change);
  assert.throws(() => createLegacySourceInterpreter({authorization: f.authorization, requestBinding: f.requestBinding, verifyLoggerCoverage: f.verifyLoggerCoverage}).auditHistoricalSource(), {code: 'LEGACY_SOURCE_UNPROVEN'});
});
test('legacy logger chain refuses a successor rotation that predates the capture', t => {
  const f = legacyFixture(t);
  f.authorization.artifacts.loggerEnd.sourcePath = path.join(f.authorization.generation.logDir, 'daemon.log.1791728790004');
  assert.throws(() => createLegacySourceInterpreter({authorization: f.authorization, requestBinding: f.requestBinding, verifyLoggerCoverage: f.verifyLoggerCoverage}).auditHistoricalSource(), {code: 'LEGACY_SOURCE_UNPROVEN'});
});
test('original capture bytes without an independently reviewed complete inventory cannot mint an action proof', t => {
  const f = legacyFixture(t), cap = createLegacySourceInterpreter({authorization:f.authorization,requestBinding:f.requestBinding});
  assert.equal(cap.auditHistoricalSource().recordCount, 1);
  assert.equal(cap.auditHistoricalSource().loggerCoverageComplete, false);
  f.request.loggerCoverageComplete = true;
  f.authorization.loggerCoverageComplete = true;
  assert.throws(() => cap.neverDispatchedProof({productionRequest:f.request,connection:f.connection,action:f.action,state:f.state}), {code:'LEGACY_SOURCE_UNPROVEN'});
});
test('an unlisted native middle rotation is rejected by the independent fixture inventory producer', t => {
  const f = legacyFixture(t), middlePath = path.join(f.authorization.generation.logDir, 'daemon.log.1791728790003');
  fs.writeFileSync(middlePath, JSON.stringify({...f.first.at(-1),at:'2026-10-11T14:26:30.003Z',event:'action.started',actionId:f.action.id})+'\n');
  const cap=createLegacySourceInterpreter({authorization:f.authorization,requestBinding:f.requestBinding,verifyLoggerCoverage:f.verifyLoggerCoverage});
  assert.throws(()=>cap.neverDispatchedProof({productionRequest:f.request,connection:f.connection,action:f.action,state:f.state}), {code:'LEGACY_SOURCE_UNPROVEN'});
});
for(const result of [false,undefined,{},Promise.resolve(true)])test('only exact synchronous code approval can qualify logger coverage',t=>{
  const f=legacyFixture(t),cap=createLegacySourceInterpreter({authorization:f.authorization,requestBinding:f.requestBinding,verifyLoggerCoverage:()=>result});
  assert.throws(()=>cap.neverDispatchedProof({productionRequest:f.request,connection:f.connection,action:f.action,state:f.state}),{code:'LEGACY_SOURCE_UNPROVEN'});
});
test('a producer error after a partial capture cannot qualify the logger inventory', t => {
  const f=legacyFixture(t);replaceCapture(f,capture=>{capture.error={type:'OSError',message:'isolated read refused'};});
  const cap=createLegacySourceInterpreter({authorization:f.authorization,requestBinding:f.requestBinding,verifyLoggerCoverage:f.verifyLoggerCoverage});
  assert.throws(()=>cap.neverDispatchedProof({productionRequest:f.request,connection:f.connection,action:f.action,state:f.state}),{code:'LEGACY_SOURCE_UNPROVEN'});
});
