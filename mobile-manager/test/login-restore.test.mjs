import test from 'node:test';
import assert from 'node:assert/strict';
import { createController } from '../web/controller.js';
import { initialState } from '../web/model.js';

function fixture(t, overrides = {}) {
  const state = initialState(), values = new Map(), calls = { login: 0, auth: 0 };
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const api = {
    identityMode: 'oidc',
    getIdentityStatus: async () => ({ available: true, mode: 'oidc', configured: true, authenticated: true }),
    authMe: async () => { calls.auth++; return { user_id: 'existing-user' }; },
    workspaces: async () => ({ workspaces: [{ slug: 'existing-workspace', workspace_id: 'workspace-id', role: 'owner' }] }),
    employees: async () => ({ employees: [] }), bots: async () => ({ bots: [] }), tasks: async () => ({ tasks: [] }), devices: async () => ({ devices: [] }),
    chats: async () => ({ chats: [], unreadCount: 0 }),
    login: async () => { calls.login++; }, logout: async () => ({}), ...overrides,
  };
  const controller = createController({ state, api, storage });
  t.after(() => controller.dispose());
  return { state, api, calls, controller };
}

test('native cold boot restores the saved identity without requesting a new login', async t => {
  const f = fixture(t);
  await f.controller.boot();
  assert.equal(f.state.phase, 'ready'); assert.equal(f.state.user.user_id, 'existing-user'); assert.equal(f.calls.login, 0);
});

test('a failed native restore keeps its identity and retries API reads without opening a login flow', async t => {
  let offline = true;
  const f = fixture(t, { authMe: async () => { if (offline) throw new Error('连接失败'); return { user_id: 'existing-user' }; } });
  await f.controller.boot();
  assert.equal(f.state.phase, 'login'); assert.equal(f.state.identity.authenticated, true); assert.equal(f.state.identityRestore, true);
  assert.match(f.state.notice, /保留.*登录/);
  offline = false; await f.controller.actions['identity-restore']();
  assert.equal(f.state.phase, 'ready'); assert.equal(f.state.identityRestore, false); assert.equal(f.calls.login, 0);
});

test('resuming after a temporary restore failure automatically rechecks the saved identity', async t => {
  const handlers = new Map(), previousAdd = globalThis.addEventListener, previousRemove = globalThis.removeEventListener;
  globalThis.addEventListener = (name, callback) => handlers.set(name, callback);
  globalThis.removeEventListener = name => handlers.delete(name);
  t.after(() => { globalThis.addEventListener = previousAdd; globalThis.removeEventListener = previousRemove; });
  let offline = true;
  const f = fixture(t, { authMe: async () => { if (offline) throw new Error('暂时离线'); return { user_id: 'existing-user' }; } });
  await f.controller.boot(); offline = false; handlers.get('ziwei:resume')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.phase, 'ready'); assert.equal(f.calls.login, 0);
});

test('an explicit expired identity cannot restore or automatically submit login credentials', async t => {
  const f = fixture(t, { authMe: async () => { throw Object.assign(new Error('expired'), { status: 401 }); } });
  await f.controller.boot();
  assert.equal(f.state.phase, 'login'); assert.equal(f.state.identityRestore, false);
  await f.controller.actions['identity-restore'](); assert.equal(f.calls.login, 0);
});

test('a retained-login button still restores after a stale unified-login click instead of replacing the session', async t => {
  let offline = true;
  const f = fixture(t, { authMe: async () => { if (offline) throw new Error('暂时离线'); return { user_id: 'existing-user' }; } });
  await f.controller.boot(); offline = false; await f.controller.actions['unified-login']();
  assert.equal(f.state.phase, 'ready'); assert.equal(f.calls.login, 0);
});

test('logout during a restore prevents its late principal from restoring the old account', async t => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const f = fixture(t, { authMe: () => pending });
  const restoring = f.controller.boot(); await new Promise(done => setImmediate(done));
  await f.controller.actions.logout(); resolve({ user_id: 'existing-user' }); await restoring;
  assert.equal(f.state.phase, 'login'); assert.equal(f.state.user, null); assert.equal(f.state.identityRestore, false);
});
