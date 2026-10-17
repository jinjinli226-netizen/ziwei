import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatPreferences, CHAT_PREFERENCE_LIMITS } from '../web/chat-preferences.js';

const scope = (accountId = 'account', workspaceId = 'workspace') => ({ accountId, workspaceId });
function memoryStorage() {
  const values = new Map();
  return { values, getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}
const reload = storage => createChatPreferences({ storage });

test('text drafts and canonical pins survive a new instance without storing attachments or history', () => {
  const storage = memoryStorage(), prefs = reload(storage), local = scope();
  assert.deepEqual(prefs.status(local), { ok: true, persisted: true, error: '' });
  assert.equal(prefs.saveDraft(local, 'employee', ' 尚未发送\n完整文字 😀 ').ok, true);
  assert.equal(prefs.togglePin(local, 'canonical-conversation').pinned, true);
  const fresh = reload(storage);
  assert.equal(fresh.getDraft(local, 'employee'), ' 尚未发送\n完整文字 😀 ');
  assert.deepEqual(fresh.draftPreviews(local), { employee: ' 尚未发送\n完整文字 😀 ' });
  assert.deepEqual(fresh.pinnedIds(local), ['canonical-conversation']);
  const value = JSON.parse([...storage.values.values()][0]);
  assert.deepEqual(Object.keys(value).sort(), ['accountId', 'version', 'workspaces']);
  assert.deepEqual(value.workspaces, [['workspace', { drafts: [['employee', ' 尚未发送\n完整文字 😀 ']], pinnedIds: ['canonical-conversation'] }]]);
});

test('account, workspace and employee identifiers cannot collide through delimiters', () => {
  const storage = memoryStorage(), prefs = reload(storage);
  const entries = [
    [scope('a:b', 'c'), 'd', 'one'], [scope('a', 'b:c'), 'd', 'two'],
    [scope('a', 'b'), 'c:d', 'three'], [scope('a', 'b:c:d'), 'e', 'four'],
    [scope('["a"]', '工作:区'), '__proto__', 'five'],
  ];
  for (const [local, employee, text] of entries) assert.equal(prefs.saveDraft(local, employee, text).ok, true);
  const fresh = reload(storage);
  for (const [local, employee, text] of entries) assert.equal(fresh.getDraft(local, employee), text);
  assert.equal(Object.getPrototypeOf(fresh.draftPreviews(entries[4][0])), Object.prototype);
  assert.equal(Object.hasOwn(fresh.draftPreviews(entries[4][0]), '__proto__'), true);
  assert.equal(fresh.getDraft(scope('other', 'b:c'), 'd'), '');
});

test('reading empty or invalid scopes does not write, create rows or throw', () => {
  const storage = memoryStorage(), prefs = reload(storage);
  const badScopes = [undefined, null, {}, scope('', 'workspace'), scope('account', ''), scope(1, 'workspace'), { get accountId() { throw new Error('invalid scope'); } }];
  for (const local of badScopes) {
    assert.equal(prefs.getDraft(local, 'employee'), '');
    assert.deepEqual(prefs.draftPreviews(local), {});
    assert.deepEqual(prefs.pinnedIds(local), []);
    assert.equal(prefs.status(local).ok, false);
    assert.equal(prefs.saveDraft(local, 'employee', 'text').accepted, false);
  }
  assert.equal(prefs.getDraft(scope(), 'employee'), '');
  assert.equal(storage.values.size, 0);
});

test('draft and pin read results are copies and prototype-like IDs stay ordinary data', () => {
  const storage = memoryStorage(), prefs = reload(storage), local = scope();
  prefs.saveDraft(local, 'constructor', 'original'); prefs.togglePin(local, '__proto__');
  const drafts = prefs.draftPreviews(local), pins = prefs.pinnedIds(local);
  drafts.constructor = 'changed'; drafts.extra = 'injected'; pins.length = 0;
  assert.equal(prefs.getDraft(local, 'constructor'), 'original');
  assert.equal(prefs.getDraft(local, 'extra'), '');
  assert.deepEqual(prefs.pinnedIds(local), ['__proto__']);
});

test('empty text explicitly removes a draft while whitespace is preserved', () => {
  const storage = memoryStorage(), prefs = reload(storage), local = scope();
  prefs.saveDraft(local, 'employee', '   ');
  assert.equal(reload(storage).getDraft(local, 'employee'), '   ');
  prefs.saveDraft(local, 'employee', '');
  assert.equal(reload(storage).getDraft(local, 'employee'), '');
  assert.deepEqual(JSON.parse([...storage.values.values()][0]).workspaces, []);
});

test('the full 50000-code-unit composer limit is preserved without truncation', () => {
  const storage = memoryStorage(), prefs = reload(storage), local = scope();
  const text = '中'.repeat(49998) + '😀';
  assert.equal(text.length, CHAT_PREFERENCE_LIMITS.draftLength);
  assert.equal(prefs.saveDraft(local, 'employee', text).ok, true);
  assert.equal(reload(storage).getDraft(local, 'employee'), text);
  assert.equal(prefs.saveDraft(local, 'employee', text + 'a').accepted, false);
  assert.equal(prefs.getDraft(local, 'employee'), text);
  assert.equal(reload(storage).getDraft(local, 'employee'), text);
});

test('invalid text and identifiers cannot serialize objects, images or arbitrary values', () => {
  const storage = memoryStorage(), prefs = reload(storage), local = scope();
  for (const text of [undefined, null, 12, ['text'], { content: 'image-base64' }]) assert.equal(prefs.saveDraft(local, 'employee', text).accepted, false);
  for (const id of ['', ' space ', 12, {}, 'x'.repeat(513)]) {
    assert.equal(prefs.saveDraft(local, id, 'text').accepted, false);
    assert.equal(prefs.togglePin(local, id).accepted, false);
  }
  assert.equal(storage.values.size, 0);
});

test('storage quota failure keeps an edit in memory, reports failure and can recover', () => {
  const storage = memoryStorage(), local = scope(), prefs = reload(storage);
  prefs.saveDraft(local, 'employee', 'persisted');
  const set = storage.setItem; storage.setItem = () => { throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); };
  const failed = prefs.saveDraft(local, 'employee', 'new unsent text');
  assert.equal(failed.ok, false); assert.equal(failed.persisted, false); assert.equal(failed.accepted, true); assert.match(failed.error, /仅在本次使用/);
  assert.equal(prefs.getDraft(local, 'employee'), 'new unsent text');
  assert.equal(reload(storage).getDraft(local, 'employee'), 'persisted');
  assert.equal(prefs.status(local).persisted, false);
  storage.setItem = set;
  assert.equal(prefs.saveDraft(local, 'employee', 'new unsent text').persisted, true);
  assert.equal(reload(storage).getDraft(local, 'employee'), 'new unsent text');
  assert.equal(prefs.status(local).error, '');
});

test('pin quota failure reports the live in-memory selection without claiming persistence', () => {
  const storage = memoryStorage(), prefs = reload(storage), local = scope();
  storage.setItem = () => { throw new Error('quota'); };
  const failed = prefs.togglePin(local, 'conversation');
  assert.deepEqual({ ok: failed.ok, persisted: failed.persisted, accepted: failed.accepted, pinned: failed.pinned }, { ok: false, persisted: false, accepted: true, pinned: true });
  failed.pinnedIds.push('injected');
  assert.deepEqual(prefs.pinnedIds(local), ['conversation']);
  assert.deepEqual(reload(storage).pinnedIds(local), []);
});

test('no storage supports usable temporary drafts and pins with an explicit failure status', () => {
  const prefs = createChatPreferences({ storage: null }), local = scope();
  assert.equal(prefs.status(local).ok, false);
  const draft = prefs.saveDraft(local, 'employee', 'temporary');
  assert.equal(draft.ok, false); assert.equal(draft.persisted, false); assert.equal(draft.accepted, true);
  assert.equal(prefs.getDraft(local, 'employee'), 'temporary');
  assert.equal(prefs.togglePin(local, 'conversation').pinned, true);
  assert.equal(prefs.clearAccount(local.accountId).persisted, false);
  assert.equal(prefs.getDraft(local, 'employee'), '');
  assert.deepEqual(prefs.pinnedIds(local), []);
});

test('broken getItem never throws or overwrites unreadable stored drafts', () => {
  const storage = memoryStorage(), local = scope();
  reload(storage).saveDraft(local, 'employee', 'original');
  const before = new Map(storage.values), get = storage.getItem;
  storage.getItem = () => { throw new Error('blocked storage'); };
  const prefs = reload(storage);
  assert.equal(prefs.getDraft(local, 'employee'), ''); assert.match(prefs.status(local).error, /无法读取/);
  assert.equal(prefs.saveDraft(local, 'employee', 'temporary').ok, false);
  assert.equal(prefs.getDraft(local, 'employee'), 'temporary');
  assert.deepEqual(storage.values, before);
  storage.getItem = get;
  assert.equal(reload(storage).getDraft(local, 'employee'), 'original');
});

test('an adapter that cannot read must not overwrite an unknown previous record', () => {
  let writes = 0;
  const prefs = createChatPreferences({ storage: { setItem() { writes++; }, removeItem() {} } }), local = scope();
  assert.equal(prefs.saveDraft(local, 'employee', 'temporary').persisted, false);
  assert.equal(prefs.getDraft(local, 'employee'), 'temporary');
  assert.equal(writes, 0);
});

test('corrupt records are identified, left untouched and recover only after explicit cleanup', () => {
  const storage = memoryStorage(), local = scope();
  reload(storage).saveDraft(local, 'employee', 'original');
  const key = [...storage.values.keys()][0];
  const corruptValues = ['{bad json', 'null', '[]', JSON.stringify({ version: 2, accountId: local.accountId, workspaces: [] }),
    JSON.stringify({ version: 1, accountId: 'different-account', workspaces: [] }),
    JSON.stringify({ version: 1, accountId: local.accountId, workspaces: [['workspace', { drafts: [['employee', 2]], pinnedIds: [] }]] }),
    JSON.stringify({ version: 1, accountId: local.accountId, workspaces: [['workspace', { drafts: [], pinnedIds: ['duplicate', 'duplicate'] }]] }),
    JSON.stringify({ version: 1, accountId: local.accountId, workspaces: [], token: 'must-not-be-loaded' }),
  ];
  for (const raw of corruptValues) {
    storage.values.set(key, raw);
    const prefs = reload(storage);
    assert.equal(prefs.getDraft(local, 'employee'), ''); assert.match(prefs.status(local).error, /数据损坏/);
    assert.equal(prefs.saveDraft(local, 'employee', 'temporary').persisted, false);
    assert.equal(prefs.getDraft(local, 'employee'), 'temporary'); assert.equal(storage.values.get(key), raw);
    assert.equal(prefs.clearAccount(local.accountId).ok, true);
    assert.equal(prefs.saveDraft(local, 'employee', 'clean new text').ok, true);
    assert.equal(reload(storage).getDraft(local, 'employee'), 'clean new text');
  }
});

test('oversized persisted records are rejected before being accepted as local preferences', () => {
  const storage = memoryStorage(), local = scope();
  reload(storage).saveDraft(local, 'employee', 'seed');
  const key = [...storage.values.keys()][0], raw = ' '.repeat(CHAT_PREFERENCE_LIMITS.bytes + 1);
  storage.values.set(key, raw);
  const prefs = reload(storage);
  assert.equal(prefs.status(local).ok, false);
  assert.equal(prefs.saveDraft(local, 'employee', 'temporary').persisted, false);
  assert.equal(storage.values.get(key), raw);
});

test('draft count is bounded across workspaces without silently evicting any draft', () => {
  const storage = memoryStorage(), prefs = reload(storage);
  for (let index = 0; index < CHAT_PREFERENCE_LIMITS.drafts; index++) assert.equal(prefs.saveDraft(scope('account', index % 2 ? 'one' : 'two'), `employee-${index}`, `draft ${index}`).ok, true);
  const before = new Map(storage.values), failed = prefs.saveDraft(scope('account', 'three'), 'overflow', 'not accepted');
  assert.equal(failed.accepted, false); assert.match(failed.error, /容量上限/); assert.deepEqual(storage.values, before);
  assert.equal(prefs.getDraft(scope('account', 'three'), 'overflow'), '');
  for (let index = 0; index < CHAT_PREFERENCE_LIMITS.drafts; index++) assert.equal(prefs.getDraft(scope('account', index % 2 ? 'one' : 'two'), `employee-${index}`), `draft ${index}`);
  prefs.saveDraft(scope('account', 'two'), 'employee-0', '');
  assert.equal(prefs.saveDraft(scope('account', 'three'), 'overflow', 'now accepted').ok, true);
});

test('UTF-8 byte capacity is bounded across workspaces and does not truncate old drafts', () => {
  const storage = memoryStorage(), prefs = reload(storage), text = '中'.repeat(40000);
  let accepted = 0, failed;
  for (let index = 0; index < 25; index++) {
    const saved = prefs.saveDraft(scope('account', index % 2 ? 'one' : 'two'), `employee-${index}`, text);
    if (!saved.accepted) { failed = saved; break; }
    accepted++;
  }
  assert(accepted > 1 && accepted < 25); assert.equal(failed.ok, false); assert.match(failed.error, /容量上限/);
  assert(Buffer.byteLength([...storage.values.values()][0], 'utf8') <= CHAT_PREFERENCE_LIMITS.bytes);
  const fresh = reload(storage);
  for (let index = 0; index < accepted; index++) assert.equal(fresh.getDraft(scope('account', index % 2 ? 'one' : 'two'), `employee-${index}`), text);
  assert.equal(fresh.getDraft(scope('account', accepted % 2 ? 'one' : 'two'), `employee-${accepted}`), '');
});

test('pins are bounded across workspaces and unpinning restores capacity', () => {
  const storage = memoryStorage(), prefs = reload(storage);
  for (let index = 0; index < CHAT_PREFERENCE_LIMITS.pins; index++) assert.equal(prefs.togglePin(scope('account', index % 2 ? 'one' : 'two'), `conversation-${index}`).pinned, true);
  const failed = prefs.togglePin(scope('account', 'three'), 'overflow');
  assert.equal(failed.accepted, false); assert.equal(failed.pinned, false); assert.match(failed.error, /容量上限/);
  assert.equal(prefs.togglePin(scope('account', 'two'), 'conversation-0').pinned, false);
  assert.equal(prefs.togglePin(scope('account', 'three'), 'overflow').ok, true);
});

test('empty workspaces are removed and the workspace bound never evicts existing data', () => {
  const storage = memoryStorage(), prefs = reload(storage);
  for (let index = 0; index < CHAT_PREFERENCE_LIMITS.workspaces; index++) assert.equal(prefs.saveDraft(scope('account', `workspace-${index}`), 'employee', 'text').ok, true);
  assert.equal(prefs.saveDraft(scope('account', 'overflow'), 'employee', 'text').accepted, false);
  prefs.saveDraft(scope('account', 'workspace-0'), 'employee', '');
  assert.equal(prefs.saveDraft(scope('account', 'overflow'), 'employee', 'text').ok, true);
  assert.equal(reload(storage).getDraft(scope('account', 'workspace-1'), 'employee'), 'text');
});

test('clearAccount removes all its workspaces and preserves other accounts and unrelated storage', () => {
  const storage = memoryStorage(), prefs = reload(storage);
  for (const local of [scope('account', 'one'), scope('account', 'two'), scope('other', 'one')]) { prefs.saveDraft(local, 'employee', local.accountId); prefs.togglePin(local, 'conversation'); }
  storage.setItem('unrelated-report', 'kept');
  assert.equal(prefs.clearAccount('account').ok, true);
  for (const local of [scope('account', 'one'), scope('account', 'two')]) { assert.equal(prefs.getDraft(local, 'employee'), ''); assert.deepEqual(prefs.pinnedIds(local), []); assert.equal(reload(storage).getDraft(local, 'employee'), ''); }
  assert.equal(reload(storage).getDraft(scope('other', 'one'), 'employee'), 'other');
  assert.deepEqual(reload(storage).pinnedIds(scope('other', 'one')), ['conversation']);
  assert.equal(storage.getItem('unrelated-report'), 'kept');
});

test('clear failure clears live memory, reports disk failure and never touches another account', () => {
  const storage = memoryStorage(), prefs = reload(storage);
  prefs.saveDraft(scope(), 'employee', 'original'); prefs.saveDraft(scope('other'), 'employee', 'kept');
  storage.removeItem = () => { throw new Error('blocked'); };
  const cleared = prefs.clearAccount('account');
  assert.equal(cleared.ok, false); assert.equal(cleared.persisted, false); assert.match(cleared.error, /无法清理/);
  assert.equal(prefs.getDraft(scope(), 'employee'), '');
  assert.equal(prefs.getDraft(scope('other'), 'employee'), 'kept');
  assert.equal(reload(storage).getDraft(scope(), 'employee'), 'original', 'failed physical removal must not be described as durable cleanup');
});

test('session expiry needs no clearing: a different account never receives the former draft', () => {
  const storage = memoryStorage(), prefs = reload(storage);
  prefs.saveDraft(scope('original'), 'employee', 'recover after relogin');
  assert.equal(prefs.getDraft(scope('different'), 'employee'), '');
  assert.equal(reload(storage).getDraft(scope('original'), 'employee'), 'recover after relogin');
});
