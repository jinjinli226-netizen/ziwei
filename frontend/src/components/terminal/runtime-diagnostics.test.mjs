import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDiagnosticTime, runtimeDiagnosticsView } from './runtime-diagnostics.js';

const node = runtime => ({ status: 'online', lastSeen: '2026-10-16T03:00:00.000Z', health: { runtime } });
const values = view => Object.fromEntries(view.statuses.map(item => [item.label, item.value]));

test('legacy and malformed runtime diagnostics stay unreported', () => {
  for (const runtime of [undefined, null, false, [], 'not an object', {}]) {
    assert.equal(runtimeDiagnosticsView(node(runtime)).reported, false);
  }
  assert.equal(runtimeDiagnosticsView(undefined).recordedAt, '时间未上报');
});

test('each runtime boolean distinguishes reported false from missing or malformed values', () => {
  const view = runtimeDiagnosticsView(node({ foreground: false, notificationsEnabled: false, backgroundRestricted: false, batteryOptimizationIgnored: false, powerSaveMode: false, deviceIdleMode: false }));
  assert.deepEqual(values(view), { '前台服务': '未运行', '通知': '未允许', '后台限制': '未受限', '电池优化': '未豁免', '系统省电': '未开启', '设备休眠': '未休眠' });
  const partial = runtimeDiagnosticsView(node({ foreground: true, notificationsEnabled: 'false', backgroundRestricted: null }));
  assert.equal(values(partial)['前台服务'], '运行中');
  for (const key of ['通知', '后台限制', '电池优化', '系统省电', '设备休眠']) assert.equal(values(partial)[key], '未上报');
});

test('offline and interrupted connections label the historical record without claiming it is current', () => {
  const reported = node({ manufacturer: 'OnePlus', model: 'fixture', androidRelease: '14', sdkInt: 34 });
  const view = runtimeDiagnosticsView({ ...reported, status: 'offline' });
  assert.equal(view.source, '离线前记录'); assert.notEqual(view.recordedAt, '时间未上报');
  assert.equal(view.model, 'OnePlus fixture'); assert.equal(view.android, 'Android 14 · API 34');
  assert.match(runtimeDiagnosticsView(reported, { syncInterrupted: true }).source, /上次上报记录.*待确认/);
});

test('exit history uses the newest system timestamp and stays bounded to six actual records', () => {
  const exits = Array.from({ length: 10 }, (_, i) => ({ timestamp: 1700000000000 + i, reason: i === 9 ? 6 : 3, updateRelated: i === 9 }));
  const view = runtimeDiagnosticsView(node({ exitHistoryAvailable: true, recentExits: [null, ...exits] }));
  assert.equal(view.latestExit.reason, '应用无响应 ANR'); assert.equal(view.latestExit.at, exits[9].timestamp);
  assert.equal(view.latestExit.updateNote, '与应用更新时间接近'); assert.equal(view.earlierExits.length, 5);
  assert.equal(view.earlierExits[4].at, exits[4].timestamp);
});

test('missing, unavailable and empty exit histories remain separate facts', () => {
  assert.equal(runtimeDiagnosticsView(node({ exitHistoryAvailable: false })).historyStatus, '系统退出记录暂不可用');
  assert.equal(runtimeDiagnosticsView(node({ exitHistoryAvailable: true, recentExits: [] })).historyStatus, '系统暂无退出记录');
  assert.equal(runtimeDiagnosticsView(node({ exitHistoryAvailable: true })).historyStatus, '系统退出记录未上报');
  const unknown = runtimeDiagnosticsView(node({ recentExits: [{ timestamp: 1700000000000, reason: 999 }] })).latestExit;
  assert.equal(unknown.reason, '未识别的系统原因（999）'); assert.doesNotMatch(unknown.reason, /厂商|OEM|后台限制/);
});

test('invalid timestamp values cannot throw or become fabricated epoch dates', () => {
  const hostile = { valueOf() { throw new Error('must not coerce object'); } };
  for (const value of [null, undefined, 0, '', 'bad', '0', Infinity, NaN, 8640000000000001, {}, hostile, Symbol('timestamp'), 1n]) assert.equal(formatDiagnosticTime(value), '时间未上报');
  const view = runtimeDiagnosticsView({ status: 'offline', lastSeen: hostile, health: { runtime: { recentExits: [{ timestamp: hostile, reason: 0 }] } } });
  assert.equal(view.recordedAt, '时间未上报'); assert.equal(view.latestExit.time, '时间未上报'); assert.equal(view.latestExit.reason, '系统未说明原因');
});
