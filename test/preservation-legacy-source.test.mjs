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
export {legacyFixture} from '../test-support/preservation-legacy-source-fixture.mjs';
import {legacyFixture} from '../test-support/preservation-legacy-source-fixture.mjs';

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
test('captured rotation endpoint must match the strictly parsed original bytes', t => {
  const f=legacyFixture(t);replaceCapture(f,capture=>{capture.logs[0].lastAt='2026-10-11T14:26:30.003Z';});
  const cap=createLegacySourceInterpreter({authorization:f.authorization,requestBinding:f.requestBinding,verifyLoggerCoverage:f.verifyLoggerCoverage});
  assert.throws(()=>cap.neverDispatchedProof({productionRequest:f.request,connection:f.connection,action:f.action,state:f.state}),{code:'LEGACY_SOURCE_UNPROVEN'});
});
