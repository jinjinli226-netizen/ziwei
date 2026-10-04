import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../backend/repository.mjs';

const unavailableDiscovery = () => ({
  bridge: { name: 'ziwei_user', version: '9.9.9', status: 'available' },
  agents: {
    Claude: { version: null, binary: null, status: 'unavailable' },
    Codex: { version: null, binary: null, status: 'unavailable' },
    Gemini: { version: null, binary: null, status: 'unavailable' },
    Hermes: { version: null, binary: null, status: 'unavailable' }
  }
});

test('a fresh workspace starts disconnected until ziwei_user sends a heartbeat', () => {
  const repo = createRepository({ memory: true, discoverLocalVersions: unavailableDiscovery });
  const device = repo.listDevices('test-111').find(item => item.id === 'device-ziwei-user');
  assert.equal(device.status, 'offline');
  assert.equal(device.healthy, false);
  assert.equal(device.last_seen, null);
  assert.equal(repo.getSummary('test-111').counts.runtimes, 0);
});

test('ziwei_user heartbeat marks only its own device online', () => {
  const repo = createRepository({ memory: true, discoverLocalVersions: unavailableDiscovery });
  const heartbeat = repo.heartbeatDevice('test-111', {
    agentId: 'ziwei_user',
    deviceId: 'device-ziwei-user',
    version: '0.1.0',
    bridgeVersion: '0.1.0',
    pid: 1234
  });
  assert.equal(heartbeat.id, 'device-ziwei-user');
  assert.equal(heartbeat.status, 'online');
  assert.equal(heartbeat.healthy, true);
  assert.equal(repo.getSummary('test-111').counts.runtimes, 4);
});

test('one generic daemon reports all four installed Agent runtimes together', () => {
  const repo = createRepository({ memory: true, discoverLocalVersions: unavailableDiscovery });
  repo.heartbeatDevice('test-111', {
    agentId: 'ziwei_user',
    deviceId: 'device-ziwei-user',
    runtimes: {
      Claude: { version: '1.0.0', status: 'available' },
      Codex: { version: '2.0.0', status: 'available' },
      Gemini: { version: '3.0.0', status: 'available' },
      Hermes: { version: '4.0.0', status: 'available', profiles: [{ name: 'default' }] }
    }
  });
  const runtimes = repo.listRuntimes('test-111');
  assert.deepEqual(runtimes.map(item => item.name), ['Claude', 'Codex', 'Gemini', 'Hermes']);
  assert.equal(runtimes.every(item => item.status === 'online'), true);
  assert.deepEqual(runtimes.map(item => item.cli_version), ['1.0.0', '2.0.0', '3.0.0', '4.0.0']);
});

test('stale and future heartbeat timestamps are offline', () => {
  const repo = createRepository({ memory: true });
  const old = new Date(Date.now() - 60_000).toISOString();
  repo.db.prepare("UPDATE devices SET status='online',last_seen=?,bridge_status='online' WHERE id='device-ziwei-user'").run(old);
  assert.equal(repo.listDevices('test-111').find(item => item.id === 'device-ziwei-user').status, 'offline');

  const future = new Date(Date.now() + 60_000).toISOString();
  repo.db.prepare("UPDATE devices SET status='online',last_seen=?,bridge_status='online' WHERE id='device-ziwei-user'").run(future);
  const device = repo.listDevices('test-111').find(item => item.id === 'device-ziwei-user');
  assert.equal(device.status, 'offline');
  assert.equal(device.healthy, false);
  assert.equal(device.heartbeat_age_ms, null);
});

test('an explicit new device id is never rebound to the seeded device', () => {
  const repo = createRepository({ memory: true });
  const heartbeat = repo.heartbeatDevice('test-111', {
    agentId: 'ziwei_user',
    deviceId: 'device-second-pc',
    version: '0.1.0',
    bridgeVersion: '0.1.0'
  });
  assert.equal(heartbeat.id, 'device-second-pc');
  assert.equal(repo.listDevices('test-111').find(item => item.id === 'device-second-pc').status, 'online');
  assert.equal(repo.listDevices('test-111').find(item => item.id === 'device-ziwei-user').status, 'offline');
});

test('agent cli versions come only from agent discovery, never the bridge version or catalog version', () => {
  const repo = createRepository({ memory: true, discoverLocalVersions: unavailableDiscovery });
  repo.heartbeatDevice('test-111', { agentId: 'ziwei_user', bridgeVersion: '9.9.9', version: '9.9.9' });
  const hermes = repo.listRuntimes('test-111').find(item => item.name === 'Hermes');
  assert.equal(hermes.cli_version, null);
  assert.equal(hermes.bridge_version, '9.9.9');
  assert.notEqual(hermes.cli_version, hermes.bridge_version);
});
