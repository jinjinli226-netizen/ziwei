import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {createApp} from '../backend/app.mjs';
import {createRepository} from '../backend/repository.mjs';
import {FROZEN_VERSIONS, digest} from '../backend/version-preservation.mjs';
import {digestProduction, signProductionEnvelope} from '../backend/production-preservation.mjs';
import {createApiIdentityRequest, verifyApiIdentityProof} from '../backend/preservation-source-namespace.mjs';

const route = '/internal/preservation/identity';
const environmentKey = 'ZIWEI_PRODUCTION_IDENTITY_CONFIG';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value);

async function fixture(t) {
  const previousEnvironment = process.env[environmentKey];
  delete process.env[environmentKey];
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'ziwei-api-identity-')));
  const servers = [];
  let repo;
  t.after(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    repo?.db.close();
    assert.ok(path.basename(root).startsWith('ziwei-api-identity-'));
    assert.equal(path.dirname(root), fs.realpathSync.native(os.tmpdir()));
    fs.rmSync(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 50});
    if (previousEnvironment === undefined) delete process.env[environmentKey];
    else process.env[environmentKey] = previousEnvironment;
  });
  const databaseFile = path.join(root, 'repository.sqlite');
  repo = createRepository({filename: databaseFile, envEncryptionKey: 'isolated-api-route-encryption-key', objectStoreDir: path.join(root, 'objects')});
  const databaseId = crypto.randomUUID(), operationId = 'api_route_fixture';
  // Only the existing fixture repository connection owns this file. No second
  // SQLite connection or production adapter is created for the identity route.
  repo.db.exec('CREATE TABLE production_preservation_identity(singleton INTEGER PRIMARY KEY, database_id TEXT NOT NULL, file_identity_json TEXT NOT NULL)');
  const stat = fs.lstatSync(databaseFile, {bigint: true});
  const databaseIdentity = {path: databaseFile, canonicalPath: databaseFile, identity: {dev: String(stat.dev), ino: String(stat.ino)}, databaseId};
  repo.db.prepare('INSERT INTO production_preservation_identity VALUES(1,?,?)').run(databaseId, JSON.stringify(databaseIdentity));
  repo.preservation.begin({operationId, versions: FROZEN_VERSIONS});
  await repo.preservation.seal({operationId});
  const freeze = repo.db.prepare('SELECT * FROM version_preservation WHERE singleton=1').get();
  const controlIdentity = {state: freeze.state, operationId: freeze.operation_id, intentDigest: digest(freeze.intent_json), snapshotDigest: digest(freeze.snapshot_json), versionsDigest: digest(freeze.versions_json)};
  const keyRef = path.join(root, 'fixture.key'), foreignKeyRef = path.join(root, 'foreign.key');
  fs.writeFileSync(keyRef, crypto.randomBytes(32), {mode: 0o600});
  fs.writeFileSync(foreignKeyRef, crypto.randomBytes(32), {mode: 0o600});
  const sources = [{path: 'backend/server.mjs', sha256: 'd'.repeat(64)}];
  const targetRoot = path.join(root, 'v2'), originalRoot = path.join(root, 'v1');
  fs.mkdirSync(targetRoot); fs.mkdirSync(originalRoot);
  const target = {root: targetRoot, entryPath: path.join(targetRoot, 'backend', 'server.mjs'), manifestSha256: 'c'.repeat(64), buildDigest: hash(JSON.stringify(sources))};
  const original = {
    root: originalRoot, entryPath: path.join(originalRoot, 'backend', 'server.mjs'), role: 'v1', buildDigest: 'a'.repeat(64), serviceManager: 'fixture',
    originalInstance: {pid: 999999999, createdAt: '2026-10-01T00:00:00.000Z', nonceDigest: 'b'.repeat(64)},
    installTargets: {v2: target, 'v1-compat': {...target, root: path.join(root, 'compat'), entryPath: path.join(root, 'compat', 'backend', 'server.mjs')}}
  };
  const binding = {hostId: 'api_fixture_host', deviceIds: [], workspaceIds: ['ws_fixture'], clients: [], apiInstances: [original], nativeSourceRefs: []};
  const trust = {
    schemaVersion: 1, algorithm: 'hmac-sha256',
    hosts: [
      {hostId: binding.hostId, keyId: 'fixture_key', keyRef, bindingDigest: digestProduction(binding)},
      {hostId: 'foreign_fixture_host', keyId: 'foreign_key', keyRef: foreignKeyRef, bindingDigest: '9'.repeat(64)}
    ],
    approvedSpecs: [{operationId, specHash: 'e'.repeat(64)}], backupHostId: binding.hostId
  };
  const issuedAt = new Date().toISOString();
  const request = {
    domain: 'ziwei-production-request-v1', schemaVersion: 1, kind: 'collect', command: 'restore', collector: 'ziwei-production-source-v1',
    challenge: crypto.randomUUID(), issuedAt, expiresAt: new Date(Date.parse(issuedAt) + 60000).toISOString(), operationId, specHash: 'e'.repeat(64),
    databaseIdentity, freezeDigest: 'f'.repeat(64), binding, actionProjection: {tables: {a2a_actions: {rows: []}}}, gatewayInbox: [], homes: [], priorEvidenceDigest: null,
    targetOrigins: ['https://fixture.invalid'], controlIdentity,
    installed: {productRole: 'v2', candidateCommit: 'a'.repeat(40), databaseId, apiBuildDigest: target.buildDigest, clientBuild: 'a'.repeat(64), apiContents: sources, clientContents: [],
      targets: [{kind: 'api', bindingDigest: digestProduction(original), productRole: 'v2', ...target, targetDigest: digestProduction(target)}]}
  };
  const configuration = {schemaVersion: 1, hostId: binding.hostId, trust}, configFile = path.join(root, 'identity.json');
  fs.writeFileSync(configFile, JSON.stringify(configuration), {mode: 0o600});
  const calls = {bootstrap: 0, connection: []};
  const bootstrap = {root: target.root, entryPath: target.entryPath, descriptor: {productRole: 'v2'}, sources};
  const connectionIdentity = {canonicalPath: databaseFile, identity: {...databaseIdentity.identity}};
  // Synthetic native observations are explicit code IO, not Linux FD/process
  // qualification. The actual handler, signer, SQLite connection and HTTP path run.
  const productionIdentityIo = {
    readBootstrap() {calls.bootstrap++; return bootstrap;},
    readDatabaseConnectionIdentity(filename) {
      calls.connection.push(filename);
      assert.equal(fs.realpathSync.native(filename), databaseFile);
      return connectionIdentity;
    }
  };
  const options = {
    repository: repo, filename: path.join(root, 'must-not-open.sqlite'), requireAuth: true, requireDeviceAuth: true, enableScheduler: false,
    managementMcpSecret: 'isolated-api-route-management-secret', phoneMcpSecret: 'isolated-api-route-phone-secret',
    ziweiConnectApiBase: 'http://127.0.0.1:1/api', publicApiBase: 'http://127.0.0.1:1', objectStoreDir: path.join(root, 'objects')
  };
  const signedRequest = () => createApiIdentityRequest({sourceRequest: signProductionEnvelope({hostId: binding.hostId, trust, payload: request}), trust, target: request.installed.targets[0]});
  const resign = (payload, hostId = binding.hostId) => signProductionEnvelope({hostId, trust, payload});
  const start = async (configurationOptions = {privatePreservationIdentity: {hostId: binding.hostId, trust}}, io = productionIdentityIo) => {
    const app = createApp({...options, ...configurationOptions}, {productionIdentityIo: io});
    assert.equal(app.locals.repo, repo);
    assert.equal(app.locals.repo.db, repo.db);
    assert.equal(fs.existsSync(options.filename), false, 'identity mounting must reuse the supplied repository database');
    const server = http.createServer(app);
    servers.push(server);
    await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
    const call = (body, {method = 'POST', pathname = route} = {}) => new Promise((resolve, reject) => {
      const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const outgoing = http.request({host: '127.0.0.1', port: server.address().port, path: pathname, method,
        headers: bytes ? {'content-type': 'application/json', 'content-length': bytes.length} : {}}, incoming => {
        const chunks = [];
        incoming.on('data', chunk => chunks.push(chunk));
        incoming.on('error', reject);
        incoming.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body; try {body = JSON.parse(text);} catch {body = text;}
          resolve({status: incoming.statusCode, headers: incoming.headers, body});
        });
      });
      outgoing.on('error', reject); outgoing.end(bytes);
    });
    return {app, call};
  };
  const snapshot = () => ({
    changes: repo.db.prepare('SELECT total_changes() AS count').get().count,
    files: Object.fromEntries([databaseFile, databaseFile + '-wal', databaseFile + '-journal', configFile].map(file => [file, fs.existsSync(file) ? hash(fs.readFileSync(file)) : null]))
  });
  return {root, repo, options, request, binding, trust, target, configFile, configuration, calls, bootstrap, connectionIdentity, productionIdentityIo, signedRequest, resign, start, snapshot};
}

for (const mode of ['inline', 'file', 'environment']) {
  test(`private API route signs same-repository restore identity through ${mode} configuration without writes`, async t => {
    const f = await fixture(t);
    if (mode === 'environment') process.env[environmentKey] = f.configFile;
    const configuration = mode === 'inline' ? {privatePreservationIdentity: {hostId: f.binding.hostId, trust: f.trust}}
      : mode === 'file' ? {privatePreservationIdentityConfigPath: f.configFile} : {};
    const {call} = await f.start(configuration), before = f.snapshot();
    assert.equal(f.calls.bootstrap, 1); assert.equal(f.calls.connection.length, 1);
    const first = await call(f.signedRequest());
    assert.equal(first.status, 200); assert.equal(first.headers['cache-control'], 'no-store');
    const proof = verifyApiIdentityProof({envelope: first.body, trust: f.trust, request: f.request, target: f.request.installed.targets[0], process: {pid: process.pid}});
    assert.equal(proof.root, f.target.root); assert.equal(proof.databaseIdentity.databaseId, f.request.databaseIdentity.databaseId);
    assert.equal(proof.fenceState, 'sealed'); assert.equal(proof.productRole, 'v2'); assert.match(proof.nonceDigest, /^[a-f0-9]{64}$/);
    f.request.challenge = crypto.randomUUID();
    const next = await call(f.signedRequest());
    assert.equal(next.status, 200); assert.equal(next.body.payload.challenge, f.request.challenge);
    assert.equal(next.body.payload.nonceDigest, proof.nonceDigest); assert.equal(next.body.payload.startedAt, proof.startedAt);
    assert.equal(f.calls.bootstrap, 1); assert.equal(f.calls.connection.length, 3, 'original connection identity is checked on every signed request');
    assert.deepEqual(f.snapshot(), before);
    assert.equal((await call(undefined, {method: 'GET'})).status, 404, 'private proof is POST only');
    const health = await call(undefined, {method: 'GET', pathname: '/healthz'});
    assert.equal(health.status, 200); assert.deepEqual(Object.keys(health.body).sort(), ['cli', 'ok', 'service', 'time']);
    assert.equal(health.body.service, 'ziwei-api'); assert.equal(health.body.ok, true);
    assert.deepEqual(f.snapshot(), before);
  });
}

test('unconfigured app never constructs native identity handler and keeps POST absent and health public', async t => {
  const f = await fixture(t);
  const forbiddenIo = {readBootstrap() {assert.fail('unconfigured route must not inspect bootstrap');}, readDatabaseConnectionIdentity() {assert.fail('unconfigured route must not inspect native handles');}};
  const {call} = await f.start({}, forbiddenIo), before = f.snapshot();
  assert.equal((await call(f.signedRequest())).status, 404);
  assert.equal((await call(undefined, {method: 'GET'})).status, 404);
  const health = await call(undefined, {method: 'GET', pathname: '/healthz'});
  assert.equal(health.status, 200); assert.deepEqual(Object.keys(health.body).sort(), ['cli', 'ok', 'service', 'time']);
  assert.deepEqual(f.snapshot(), before); assert.equal(f.calls.bootstrap, 0); assert.deepEqual(f.calls.connection, []);
});

test('private API HTTP refuses mismatched signed authority, expectations and freshness without disclosing or writing', async t => {
  const f = await fixture(t), {call} = await f.start(), good = f.signedRequest();
  const mutations = {
    HMAC: signed => {signed.signature = '0'.repeat(64); return signed;},
    host: signed => f.resign(signed.payload, 'foreign_fixture_host'),
    spec: signed => {signed.payload.specHash = '0'.repeat(64); return f.resign(signed.payload);},
    operation: signed => {signed.payload.operationId = 'unapproved_operation'; return f.resign(signed.payload);},
    target: signed => {signed.payload.target.root = path.join(f.root, 'different-target'); return f.resign(signed.payload);},
    'target digest': signed => {signed.payload.target.targetDigest = '0'.repeat(64); return f.resign(signed.payload);},
    database: signed => {signed.payload.databaseIdentity.databaseId = crypto.randomUUID(); return f.resign(signed.payload);},
    fence: signed => {signed.payload.controlIdentity.snapshotDigest = '0'.repeat(64); return f.resign(signed.payload);},
    expired: signed => {signed.payload.issuedAt = new Date(Date.now() - 120000).toISOString(); signed.payload.expiresAt = new Date(Date.parse(signed.payload.issuedAt) + 60000).toISOString(); return f.resign(signed.payload);},
    'wire callback selection': signed => {signed.payload.productionIdentityIo = {readBootstrap: 'return true'}; return f.resign(signed.payload);}
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async () => {
    const before = f.snapshot(), response = await call(mutate(copy(good)));
    assert.equal(response.status, 403); assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.body, {code: 'SOURCE_API_IDENTITY_REFUSED'}); assert.deepEqual(f.snapshot(), before);
  });
  assert.equal((await call(good)).status, 200, 'refusal does not consume or rewrite the original sealed state');
});

test('private API HTTP reads the current fence and cannot attest a subsequently restored repository', async t => {
  const f = await fixture(t), {call} = await f.start(), signed = f.signedRequest();
  assert.equal((await call(signed)).status, 200);
  f.repo.preservation.restore({operationId: f.request.operationId});
  const before = f.snapshot(), response = await call(signed);
  assert.equal(response.status, 403); assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.body, {code: 'SOURCE_API_IDENTITY_REFUSED'}); assert.deepEqual(f.snapshot(), before);
});

test('private API HTTP refuses changed connection identity while retaining the boot source snapshot', async t => {
  const f = await fixture(t), {call} = await f.start(), signed = f.signedRequest();
  f.bootstrap.root = path.join(f.root, 'mutated-bootstrap');
  const accepted = await call(signed);
  assert.equal(accepted.status, 200); assert.equal(accepted.body.payload.root, f.target.root);
  f.connectionIdentity.identity.ino = '0';
  const before = f.snapshot(), refused = await call(signed);
  assert.equal(refused.status, 403); assert.equal(refused.headers['cache-control'], 'no-store');
  assert.deepEqual(refused.body, {code: 'SOURCE_API_IDENTITY_REFUSED'}); assert.deepEqual(f.snapshot(), before);
});

test('invalid private identity configuration fails before creating another DB or exposing configuration content', async t => {
  const f = await fixture(t), sentinel = 'FIXTURE_PRIVATE_CONFIGURATION_MUST_NOT_APPEAR';
  const malformed = path.join(f.root, 'malformed.json'), invalid = path.join(f.root, 'invalid.json');
  fs.writeFileSync(malformed, '{"private":"' + sentinel + '"');
  fs.writeFileSync(invalid, JSON.stringify({...f.configuration, schemaVersion: 2, private: sentinel}));
  const variants = {
    missing: {privatePreservationIdentityConfigPath: path.join(f.root, 'missing.json')},
    directory: {privatePreservationIdentityConfigPath: f.root},
    relative: {privatePreservationIdentityConfigPath: 'fixture-not-an-absolute-path.json'},
    malformed: {privatePreservationIdentityConfigPath: malformed},
    schema: {privatePreservationIdentityConfigPath: invalid},
    'unknown inline fields': {privatePreservationIdentity: {hostId: f.binding.hostId, trust: f.trust, factory: sentinel}},
    'missing host': {privatePreservationIdentity: {trust: f.trust}},
    'non-object trust': {privatePreservationIdentity: {hostId: f.binding.hostId, trust: sentinel}},
    ambiguous: {privatePreservationIdentity: {hostId: f.binding.hostId, trust: f.trust}, privatePreservationIdentityConfigPath: f.configFile}
  };
  const logs = [];
  for (const method of ['log', 'warn', 'error']) t.mock.method(console, method, (...values) => logs.push(values.map(String).join(' ')));
  for (const [name, configuration] of Object.entries(variants)) await t.test(name, () => {
    const before = f.snapshot();
    assert.throws(() => createApp({...f.options, ...configuration}, {productionIdentityIo: f.productionIdentityIo}), error => {
      assert.equal(error.code, 'SOURCE_API_CONFIGURATION');
      assert.equal(error.message, 'Private preservation identity configuration is invalid');
      assert.equal(error.message.includes(sentinel), false); return true;
    });
    assert.equal(f.calls.bootstrap, 0); assert.equal(fs.existsSync(f.options.filename), false); assert.deepEqual(f.snapshot(), before);
  });
  await t.test('unreadable configuration', () => {
    const before = f.snapshot(), readFileSync = fs.readFileSync;
    const denied = t.mock.method(fs, 'readFileSync', (file, ...args) => {
      if (file === f.configFile) throw Object.assign(new Error(sentinel), {code: 'EACCES'});
      return readFileSync(file, ...args);
    });
    try {
      assert.throws(() => createApp({...f.options, privatePreservationIdentityConfigPath: f.configFile}, {productionIdentityIo: f.productionIdentityIo}),
        {code: 'SOURCE_API_CONFIGURATION', message: 'Private preservation identity configuration is invalid'});
    } finally {denied.mock.restore();}
    assert.equal(f.calls.bootstrap, 0); assert.equal(fs.existsSync(f.options.filename), false); assert.deepEqual(f.snapshot(), before);
  });
  assert.equal(logs.some(line => line.includes(sentinel)), false);
});
