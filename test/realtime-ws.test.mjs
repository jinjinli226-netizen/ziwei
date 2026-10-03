import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { attachRealtimeWebSocket, createApp } from '../backend/app.mjs';

test('notification WebSocket exposes ready and ping/pong in memory mode', async () => {
  const app = createApp({ memory: true, enableScheduler: false });
  const server = app.listen(0);
  const wss = attachRealtimeWebSocket(server, app);
  await new Promise(resolve => server.once('listening', resolve));
  const port = server.address().port;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/workspaces/test-111/notifications/ws`);
  const messages = [];
  socket.on('message', value => messages.push(JSON.parse(String(value))));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket did not become ready')), 2000);
      socket.on('message', value => {
        const message = JSON.parse(String(value));
        if (message.type === 'ready') { clearTimeout(timer); resolve(); }
      });
      socket.on('error', reject);
    });
    socket.send(JSON.stringify({ type: 'ping' }));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket did not answer ping')), 2000);
      const check = () => {
        if (messages.some(message => message.type === 'pong')) { clearInterval(interval); clearTimeout(timer); resolve(); }
      };
      const interval = setInterval(check, 10);
      socket.once('error', error => { clearInterval(interval); clearTimeout(timer); reject(error); });
    });
    assert.ok(messages.some(message => message.type === 'ready' && message.workspace === 'test-111'));
    assert.ok(messages.some(message => message.type === 'pong'));
  } finally {
    socket.close();
    await new Promise(resolve => socket.once('close', resolve));
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
});
