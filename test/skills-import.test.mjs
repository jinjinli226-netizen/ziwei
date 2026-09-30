import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRepository } from '../backend/repository.mjs';
import { createApp } from '../backend/app.mjs';
import zlib from 'node:zlib';

const validSkill = `---
name: 周报整理
description: 把任务整理成周报
version: 1.2.3
category: productivity
tags:
  - team
  - report
---

# 周报整理

读取本周任务，输出一份可审阅的周报。`;

function makeZip(name, content, method = 8) {
  const nameBuffer = Buffer.from(name);
  const source = Buffer.from(content);
  const packed = method === 8 ? zlib.deflateRawSync(source) : source;
  const local = Buffer.alloc(30 + nameBuffer.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method === 8 ? 8 : 0, 6);
  local.writeUInt16LE(method, 8); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(source.length, 22);
  local.writeUInt16LE(nameBuffer.length, 26); nameBuffer.copy(local, 30);
  const central = Buffer.alloc(46 + nameBuffer.length);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method === 8 ? 8 : 0, 8);
  central.writeUInt16LE(method, 10); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(source.length, 24); central.writeUInt16LE(nameBuffer.length, 28); nameBuffer.copy(central, 46);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(local.length + packed.length, 16);
  return Buffer.concat([local, packed, central, eocd]).toString('base64');
}

test('imports and validates SKILL.md metadata with hash and version', async () => {
  const repo = createRepository({ memory: true });
  const imported = await repo.importSkill('test-111', { content: validSkill });
  assert.equal(imported.validation_status, 'valid');
  assert.equal(imported.version, '1.2.3');
  assert.equal(imported.category, 'productivity');
  assert.deepEqual(imported.tags, ['team', 'report']);
  assert.match(imported.content_hash, /^[a-f0-9]{64}$/);
  assert.equal(imported.source_type, 'local');
  assert.equal(repo.listSkills('test-111', { scope: 'team' }).some(skill => skill.id === imported.id), true);
  const duplicate = await repo.importSkill('test-111', { content: validSkill });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.id, imported.id);
  const installed = repo.setSkillInstalled(imported.id, true);
  assert.equal(installed.installed, true);
});

test('keeps invalid imports visible with an actionable validation error', async () => {
  const repo = createRepository({ memory: true });
  const invalid = await repo.importSkill('test-111', { content: '---\nversion: nope\n---\n正文' });
  assert.equal(invalid.validation_status, 'invalid');
  assert.match(invalid.validation_error, /技能名称|version/);
  assert.throws(() => repo.setSkillInstalled(invalid.id, true), /技能校验失败/);
});

test('skills import API accepts uploaded content and returns validation fields', async () => {
  const app = createApp({ memory: true });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/workspaces/test-111/skills/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: validSkill, sourceType: 'local' })
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.validation_status, 'valid');
    assert.equal(payload.source_type, 'local');
    assert.match(payload.content_hash, /^[a-f0-9]{64}$/);
  } finally { server.close(); }
});

test('imports SKILL.md from an HTTP URL', async () => {
  const source = createServer((_req, res) => { res.setHeader('content-type', 'text/markdown'); res.end(validSkill); });
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
  const repo = createRepository({ memory: true });
  try {
    const url = `http://127.0.0.1:${source.address().port}/SKILL.md`;
    const imported = await repo.importSkill('test-111', { url, sourceType: 'url' });
    assert.equal(imported.source_type, 'url');
    assert.equal(imported.source_url, url);
    assert.equal(imported.validation_status, 'valid');
  } finally { source.close(); }
});

test('extracts and validates SKILL.md from a deflated ZIP package', async () => {
  const repo = createRepository({ memory: true });
  const imported = await repo.importSkill('test-111', { archive: makeZip('my-skill/SKILL.md', validSkill), sourceType: 'zip' });
  assert.equal(imported.source_type, 'zip');
  assert.equal(imported.validation_status, 'valid');
  assert.equal(imported.source_path, 'my-skill/SKILL.md');
});

test('rejects ZIP packages without SKILL.md with actionable error', async () => {
  const repo = createRepository({ memory: true });
  await assert.rejects(() => repo.importSkill('test-111', { archive: makeZip('README.md', '# no skill'), sourceType: 'zip' }), /必须包含 SKILL\.md/);
});

test('skills import API accepts a base64 ZIP and exposes workstation sources', async () => {
  const app = createApp({ memory: true });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const importedResponse = await fetch(`${base}/api/workspaces/test-111/skills/import`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ archive: makeZip('nested/SKILL.md', validSkill), sourceType: 'zip' })
    });
    assert.equal(importedResponse.status, 201);
    assert.equal((await importedResponse.json()).source_type, 'zip');
    const sourcesResponse = await fetch(`${base}/api/workspaces/test-111/skill-sources`);
    assert.equal(sourcesResponse.status, 200);
    assert.ok(Array.isArray((await sourcesResponse.json()).sources));
  } finally { server.close(); }
});

test('copies a skill from an online workstation source with provenance', async () => {
  const repo = createRepository({ memory: true });
  repo.db.prepare("UPDATE devices SET status='online',last_seen=?,bridge_status='online' WHERE id='device-ziwei-user'").run(new Date().toISOString());
  const sources = repo.listSkillSources('test-111');
  assert.equal(sources.some(source => source.device_id === 'device-ziwei-user' && source.copy_supported), true);
  const copied = await repo.copySkill('test-111', { content: validSkill, sourceDeviceId:'device-ziwei-user', sourcePath:'~/.codex/skills/weekly/SKILL.md' });
  assert.equal(copied.source_type, 'workstation');
  assert.equal(copied.source_device_id, 'device-ziwei-user');
  assert.equal(copied.source_path, '~/.codex/skills/weekly/SKILL.md');
});

test('workstation copy reports an offline source instead of creating a skill', async () => {
  const repo = createRepository({ memory: true });
  await assert.rejects(() => repo.copySkill('test-111', { content: validSkill, deviceId: 'device-ziwei-user' }), /当前不在线/);
});
