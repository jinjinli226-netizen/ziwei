import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {nativeActionDigest} from '../backend/preservation-native-databases.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
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
  const inspect = {captureUTC: '2026-10-11T17:10:33.527386+00:00', config: {finalPath: configPath, workspace, deviceId, apiBase: origin}, logs: [{path: logPaths[0], finalPath: logPaths[0], bytes: Buffer.byteLength(serialize(first)),lastAt:first.at(-1).at}, {path: path.join(logDir, 'daemon.log'), finalPath: path.join(logDir, 'daemon.log'), lastAt: second[3].at, bytes:Buffer.byteLength(serialize(second.slice(0,4)))}], actionStates: [{path: sourcePath, finalPath: sourcePath}]};
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
