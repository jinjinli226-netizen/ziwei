#!/usr/bin/env node

/**
 * Read-only evidence collector for 紫薇·互联.
 * It never creates a command, changes control ownership, or touches the phone.
 * Remote use requires the same Cookie/Authorization configuration as the
 * terminal-console MCP bridge; credentials are read from environment only and
 * are never written to the evidence file.
 */
import { writeFile } from 'node:fs/promises';

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback;
}

const configuredBase = option('--api', process.env.ZIWEI_CONNECT_API_BASE || process.env.ZIWEI_CONTROL_API || 'http://127.0.0.1:5191/api').replace(/\/$/, '');
const apiUrl = new URL(configuredBase);
const apiBase = configuredBase.replace(/\/$/, '');
const outputPath = option('--output', '');
const cookie = process.env.ZIWEI_CONNECT_COOKIE || process.env.ZIWEI_CONTROL_COOKIE || '';
const authorization = process.env.ZIWEI_CONNECT_AUTH || process.env.ZIWEI_CONTROL_AUTH || '';
const headers = {
  accept: 'application/json',
  ...(authorization ? { authorization } : {}),
  ...(cookie ? { cookie, origin: apiUrl.origin } : {}),
};

async function get(path) {
  let response;
  try {
    response = await fetch(`${apiBase}${path}`, { headers, signal: AbortSignal.timeout(10000) });
  } catch (error) {
    throw new Error(`GET ${path} 不可达：${error?.message || String(error)}`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GET ${path} 返回 HTTP ${response.status}`);
  return payload;
}

function nodeEvidence(node) {
  return {
    role: node?.role || null,
    status: node?.status || null,
    versionCode: node?.versionCode ?? null,
    versionName: node?.versionName ?? null,
    lastSeen: node?.lastSeen || node?.lastHeartbeat || null,
    health: node?.health || null,
  };
}

function snapshotEvidence(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  return {
    mime: snapshot.mime || snapshot.mimeType || null,
    width: snapshot.width ?? null,
    height: snapshot.height ?? null,
    capturedAt: snapshot.capturedAt || null,
    available: Boolean(snapshot.data || snapshot.base64 || snapshot.content),
  };
}

async function inspectDevice(item) {
  const id = item?.id;
  const encoded = encodeURIComponent(id);
  let detail = null;
  let snapshot = null;
  const errors = [];
  try { detail = await get(`/android-devices/${encoded}/status`); } catch (error) { errors.push(error.message); }
  try { snapshot = await get(`/android-devices/${encoded}/snapshot`); } catch (error) { errors.push(error.message); }
  const device = detail?.device || {};
  const nodes = Array.isArray(item?.nodes) ? item.nodes : (Array.isArray(device.nodes) ? device.nodes : []);
  const commands = Array.isArray(device.commands) ? device.commands : (Array.isArray(item?.commands) ? item.commands : []);
  return {
    id,
    alias: item?.alias || device.alias || null,
    online: item?.online === true || nodes.some(node => node?.status === 'online'),
    control: item?.control || device.control || null,
    nodes: nodes.map(nodeEvidence),
    commands: commands.map(command => ({ id: command.id || null, action: command.action || null, status: command.status || null, error: command.error || null, createdAt: command.createdAt || null, resolvedAt: command.resolvedAt || null })),
    snapshot: snapshotEvidence(snapshot?.snapshot || snapshot),
    errors,
  };
}

const observedAt = new Date().toISOString();
const evidence = { readonly: true, observedAt, apiBase: `${apiUrl.origin}${apiUrl.pathname.replace(/\/$/, '')}`, health: null, diagnostics: null, devices: [], error: null };
try {
  evidence.health = await get('/health');
  const list = await get('/android-devices?summary=1');
  evidence.devices = await Promise.all((Array.isArray(list.devices) ? list.devices : []).map(inspectDevice));
  const terminal = await get('/terminal-console');
  evidence.diagnostics = terminal.diagnostics || null;
} catch (error) {
  evidence.error = error.message;
}

const text = `${JSON.stringify(evidence, null, 2)}\n`;
if (outputPath) await writeFile(outputPath, text, 'utf8');
process.stdout.write(text);
process.exitCode = evidence.error ? 1 : 0;
