import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationPresence } from '../web/notification-presence.js';

function fixture() {
  let time = 1000, visible = true;
  const calls = [], state = { phase: 'ready', page: 'chat', user: { user_id: 'user-one' }, workspace: { id: 'ws-one', slug: 'one' }, conversation: { id: 'chat-one' } };
  const presence = createNotificationPresence({ state, native: { setForeground: id => calls.push(id) }, now: () => time, visible: () => visible });
  return { presence, state, calls, advance: ms => { time += ms; }, visible: value => { visible = value; } };
}

test('only the visible current chat is renewed before the server presence expires', () => {
  const f = fixture(); f.presence.sync(); f.presence.sync(); assert.deepEqual(f.calls, ['chat-one']);
  f.advance(19999); f.presence.sync(); assert.equal(f.calls.length, 1);
  f.advance(1); f.presence.sync(); assert.deepEqual(f.calls, ['chat-one', 'chat-one']);
  f.state.conversation.id = 'chat-two'; f.presence.sync(); assert.equal(f.calls.at(-1), 'chat-two');
  f.state.page = 'home'; f.presence.sync(); f.presence.sync(); assert.deepEqual(f.calls, ['chat-one', 'chat-one', 'chat-two', '']);
});

test('background, overlays, logout and dispose clear suppression without sending business or read receipts', () => {
  const f = fixture(); f.presence.sync(); f.visible(false); f.presence.sync(); assert.equal(f.calls.at(-1), '');
  f.visible(true);
  for (const overlay of ['imagePreview', 'forward', 'forwardDetail', 'chatFind']) {
    f.presence.sync(); assert.equal(f.calls.at(-1), 'chat-one'); f.state[overlay] = {}; f.presence.sync(); assert.equal(f.calls.at(-1), ''); delete f.state[overlay];
  }
  f.presence.sync(); f.state.phase = 'login'; f.presence.sync(); assert.equal(f.calls.at(-1), '');
  f.state.phase = 'ready'; f.presence.sync(); f.presence.pause(); assert.equal(f.calls.at(-1), '');
  f.presence.sync(); f.presence.dispose(); const count = f.calls.length; assert.equal(f.calls.at(-1), '');
  f.presence.sync(); assert.equal(f.calls.length, count);
});

test('scope changes renew independently and missing or rejecting native support cannot break chat', () => {
  const f = fixture(); f.presence.sync(); f.state.user.user_id = 'user-two'; f.presence.sync(); assert.equal(f.calls.length, 2);
  f.state.workspace.id = 'replacement'; f.presence.sync(); assert.equal(f.calls.length, 3);
  const plain = createNotificationPresence({ state: f.state }); assert.doesNotThrow(() => { plain.sync(); plain.pause(); plain.dispose(); });
  const broken = createNotificationPresence({ state: f.state, native: { setForeground: () => { throw new Error('bridge unavailable'); } } });
  assert.doesNotThrow(() => { broken.sync(); broken.pause(); broken.dispose(); });
});
