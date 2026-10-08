import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PUBLIC_ORIGIN, INSTALL_URL, CONTROL_URL, installPageHref, managementHref,
  formatPackageSize, detectInstallPlatform, loadLatestAndroidRelease,
} from '../frontend/src/android-install.js';

const indexUrl = `${PUBLIC_ORIGIN}/downloads/android/index.json`;
const hash = 'a'.repeat(64);
const signer = 'b'.repeat(64);
function release(versionCode = 15, versionName = '0.4.4') {
  const directory = `/downloads/android/v${versionName}-code${versionCode}`;
  return {
    versionName, versionCode, buildType: 'debug', manifest: `${directory}/manifest.json`,
    packages: Object.fromEntries(['agent', 'updater'].map(role => [role, {
      packageName: `com.ziwei.device.${role}`, file: `ziwei-${role}-debug.apk`,
      path: `${directory}/ziwei-${role}-debug.apk`, sha256: hash, signerSha256: signer,
    }])),
  };
}
function manifest(item = release(), roles = ['agent', 'updater']) {
  return { schemaVersion: 1, builtAt: '2026-09-24T17:40:46Z', buildType: item.buildType, deviceVerified: false,
    packages: roles.map(role => ({ role, packageName: item.packages[role].packageName,
      file: item.packages[role].file, versionCode: item.versionCode, versionName: item.versionName,
      bytes: role === 'agent' ? 815470 : 815474, sha256: hash, signerSha256: signer,
    })),
  };
}
function source(releases = [release()], manifests = {}, override) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (override) { const response = await override(url, options); if (response) return response; }
    if (url === indexUrl) return Response.json({ schemaVersion: 1, updatedAt: '2026-09-24T17:41:00Z', releases });
    const item = releases.find(value => `${PUBLIC_ORIGIN}${value.manifest}` === url || value.manifest === url);
    if (!item) throw new Error(`Unexpected request: ${url}`);
    return Response.json(manifests[item.versionCode] ?? manifest(item));
  };
  return { calls, fetchImpl };
}

test('installation and control links stay on the canonical public origin', () => {
  assert.equal(PUBLIC_ORIGIN, 'https://qzelynth.top');
  assert.equal(INSTALL_URL, `${PUBLIC_ORIGIN}/android-install`);
  assert.equal(CONTROL_URL, PUBLIC_ORIGIN);
  assert.equal(installPageHref('phone_ai'), `${INSTALL_URL}?workspace=phone_ai`);
  assert.equal(managementHref('my-team'), `${PUBLIC_ORIGIN}/my-team/ziwei-connect`);
  for (const slug of ['', null, '../admin', 'x/y', 'https://evil.example', 'x?token=secret', 'x%2fy', ' x ', 'x'.repeat(200)]) {
    assert.equal(installPageHref(slug), INSTALL_URL);
    assert.equal(managementHref(slug), `${PUBLIC_ORIGIN}/phone_ai/ziwei-connect`);
  }
});

test('package size formatting makes absent or invalid size explicit', () => {
  assert.equal(formatPackageSize(815470), '796.4 KB');
  assert.equal(formatPackageSize(2 * 1024 * 1024), '2 MB');
  assert.equal(formatPackageSize(512), '512 B');
  for (const value of [undefined, null, 0, -1, '815470', NaN]) assert.equal(formatPackageSize(value), '大小待确认');
});

test('platform detection distinguishes Android, iOS, desktop and unsupported phones', () => {
  assert.equal(detectInstallPlatform('Mozilla/5.0 (Linux; Android 11; vivo) AppleWebKit/537.36 Mobile'), 'android');
  assert.equal(detectInstallPlatform('Mozilla/5.0 (Linux; Android 15) Mobile'), 'android');
  assert.equal(detectInstallPlatform('Mozilla/5.0 (Linux; Android 10) Mobile'), 'android');
  assert.equal(detectInstallPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'ios');
  assert.equal(detectInstallPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Mobile/15E148'), 'ios');
  assert.equal(detectInstallPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'desktop');
  assert.equal(detectInstallPlatform('Mozilla/5.0 (X11; Linux x86_64)'), 'desktop');
  for (const ua of ['', 'unknown', 'Windows Phone 10.0; Android 6.0', 'KaiOS']) {
    assert.equal(detectInstallPlatform(ua), 'unsupported');
  }
});

test('reduced Chrome Android UA retains downloads instead of imposing an unreliable OS version gate', () => {
  assert.equal(detectInstallPlatform('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Mobile Safari/537.36'), 'android');
});

test('loads the current index and manifest with two real APK hrefs and manifest sizes', async () => {
  const fixture = source();
  const signal = new AbortController().signal;
  const result = await loadLatestAndroidRelease({ fetchImpl: fixture.fetchImpl, signal });
  assert.equal(result.versionCode, 15);
  assert.equal(result.versionName, '0.4.4');
  assert.equal(result.buildType, 'debug');
  assert.deepEqual(Object.keys(result.packages).sort(), ['agent', 'updater']);
  assert.equal(result.packages.agent.href, `${PUBLIC_ORIGIN}/downloads/android/v0.4.4-code15/ziwei-agent-debug.apk`);
  assert.equal(result.packages.agent.bytes, 815470);
  assert.equal(result.packages.updater.bytes, 815474);
  assert.equal(result.packages.agent.packageName, 'com.ziwei.device.agent');
  assert.equal(result.packages.agent.file, 'ziwei-agent-debug.apk');
  assert.equal(fixture.calls.length, 2, 'does not download APK bodies or HEAD when manifest supplies sizes');
  for (const { options } of fixture.calls) {
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.equal(options.signal, signal);
  }
});

test('latest selection uses numeric versionCode and re-reads after a release changes', async () => {
  const old = release(9, '0.3.6');
  const latest = release(16, '0.4.5');
  const unordered = source([old, latest, release()]);
  assert.equal((await loadLatestAndroidRelease({ fetchImpl: unordered.fetchImpl })).versionCode, 16);
  assert.equal((await loadLatestAndroidRelease({ fetchImpl: source([release()]).fetchImpl })).versionCode, 15);
  assert.equal((await loadLatestAndroidRelease({ fetchImpl: source([latest, release()]).fetchImpl })).versionName, '0.4.5');
});

test('an empty index returns no release without requesting a manifest', async () => {
  const fixture = source([]);
  assert.equal(await loadLatestAndroidRelease({ fetchImpl: fixture.fetchImpl }), null);
  assert.equal(fixture.calls.length, 1);
});

test('the latest empty manifest returns an empty release instead of an older APK', async () => {
  const latest = release(16, '0.4.5');
  const fixture = source([release(), latest], { 16: manifest(latest, []) });
  const result = await loadLatestAndroidRelease({ fetchImpl: fixture.fetchImpl });
  assert.equal(result.versionCode, 16);
  assert.deepEqual(result.packages, {});
  assert.equal(fixture.calls.length, 2);
});

test('a missing role stays missing so the page can show that application as unavailable', async () => {
  const fixture = source([release()], { 15: manifest(release(), ['agent']) });
  const result = await loadLatestAndroidRelease({ fetchImpl: fixture.fetchImpl });
  assert.ok(result.packages.agent);
  assert.equal(result.packages.updater, undefined);
});

test('uses HEAD for a missing package size without downloading the APK', async () => {
  const data = manifest();
  delete data.packages[0].bytes;
  const fixture = source([release()], { 15: data }, (url, options) => options.method === 'HEAD'
    ? new Response(null, { headers: { 'content-length': '815470' } }) : undefined);
  const result = await loadLatestAndroidRelease({ fetchImpl: fixture.fetchImpl });
  assert.equal(result.packages.agent.bytes, 815470);
  const heads = fixture.calls.filter(call => call.options.method === 'HEAD');
  assert.equal(heads.length, 1);
  assert.match(heads[0].url, /\.apk$/);
  assert.equal(heads[0].options.credentials, 'omit');
  assert.equal(heads[0].options.cache, 'no-store');
});

test('index and manifest HTTP or JSON failures report readable errors and preserve aborts', async () => {
  await assert.rejects(loadLatestAndroidRelease({ fetchImpl: async () => new Response('', { status: 503 }) }), /发布索引.*503/);
  await assert.rejects(loadLatestAndroidRelease({ fetchImpl: async () => new Response('<html>error</html>') }), /发布索引.*JSON/);
  await assert.rejects(loadLatestAndroidRelease({ fetchImpl: source([release()], {}, url => url !== indexUrl ? new Response('', { status: 404 }) : undefined).fetchImpl }), /版本清单.*404/);
  const failure = new Error('network unreachable');
  await assert.rejects(loadLatestAndroidRelease({ fetchImpl: async () => { throw failure; } }), /发布索引.*网络/);
  const abort = new DOMException('Cancelled', 'AbortError');
  await assert.rejects(loadLatestAndroidRelease({ fetchImpl: async () => { throw abort; } }), error => error === abort);
});

test('malformed index and manifest schemas fail rather than inventing a release', async () => {
  for (const data of [{}, { schemaVersion: 2, releases: [] }, { schemaVersion: 1, releases: {} }]) {
    await assert.rejects(loadLatestAndroidRelease({ fetchImpl: async () => Response.json(data) }), /发布索引.*格式/);
  }
  const malformed = release(); malformed.versionCode = '15';
  await assert.rejects(loadLatestAndroidRelease({ fetchImpl: source([malformed]).fetchImpl }), /发布索引.*版本/);
  for (const data of [{}, { schemaVersion: 2, packages: [] }, { schemaVersion: 1, packages: {} }]) {
    await assert.rejects(loadLatestAndroidRelease({ fetchImpl: source([release()], { 15: data }).fetchImpl }), /版本清单.*格式/);
  }
});

test('index and manifest version, identity, integrity or build mismatches are rejected', async () => {
  const variations = [
    value => { value.packages[0].versionCode = 16; },
    value => { value.packages[0].versionName = '0.4.5'; },
    value => { value.packages[0].packageName = 'com.other.app'; },
    value => { value.packages[0].sha256 = 'c'.repeat(64); },
    value => { value.packages[0].signerSha256 = 'c'.repeat(64); },
    value => { value.buildType = 'release'; },
    value => { value.packages.push({ ...value.packages[0] }); },
  ];
  for (const alter of variations) {
    const data = manifest(); alter(data);
    await assert.rejects(loadLatestAndroidRelease({ fetchImpl: source([release()], { 15: data }).fetchImpl }), /不一致|重复/);
  }
});

test('a manifest file change cannot silently replace the indexed APK', async () => {
  const data = manifest(); data.packages[0].file = 'other-agent.apk';
  await assert.rejects(loadLatestAndroidRelease({ fetchImpl: source([release()], { 15: data }).fetchImpl }), /不一致/);
});

test('rejects unsafe manifest URLs before fetching them', async () => {
  const paths = [
    'http://qzelynth.top/downloads/android/v15/manifest.json',
    'https://other.example/downloads/android/v15/manifest.json',
    'https://qzelynth.top@evil.example/downloads/android/v15/manifest.json',
    'https://user:password@qzelynth.top/downloads/android/v15/manifest.json',
    'https://127.0.0.1/downloads/android/v15/manifest.json',
    '//qzelynth.top/downloads/android/v15/manifest.json',
    '/downloads/android/../private/manifest.json', '/downloads/android/v15/../../manifest.json',
    '/downloads/android/%2e%2e/private/manifest.json', '/downloads/android/v15/%252e%252e/manifest.json',
    '/downloads/android/v15%2fprivate/manifest.json', '/downloads/android/v15\\manifest.json',
    '/downloads/android//manifest.json', '/downloads/android/v15/manifest.json?token=secret',
    '/downloads/android/v15/manifest.json#fragment', '/api/manifest.json',
  ];
  for (const path of paths) {
    const item = release(); item.manifest = path;
    const fixture = source([item]);
    await assert.rejects(loadLatestAndroidRelease({ fetchImpl: fixture.fetchImpl }), /下载地址.*安全/);
    assert.equal(fixture.calls.length, 1, path);
  }
});

test('rejects unsafe or mismatched indexed APK paths without requesting APK content', async () => {
  for (const path of ['https://evil.example/a.apk', '/downloads/android/../a.apk', '/downloads/android/v15/a.apk?token=x', '/downloads/android/%2e%2e/a.apk', '/downloads/android/v15/different.apk']) {
    const item = release(); item.packages.agent.path = path;
    const fixture = source([item]);
    await assert.rejects(loadLatestAndroidRelease({ fetchImpl: fixture.fetchImpl }), /安全|不一致/);
    assert.equal(fixture.calls.some(call => call.url.endsWith('.apk')), false);
  }
});

test('rejects dangerous manifest filenames rather than resolving traversal or alternate origins', async () => {
  for (const file of ['../a.apk', '/downloads/android/a.apk', 'https://evil.example/a.apk', 'a%2f.apk', 'a.apk?x=y', 'a.apk#x', 'a\\b.apk']) {
    const data = manifest(); data.packages[0].file = file;
    await assert.rejects(loadLatestAndroidRelease({ fetchImpl: source([release()], { 15: data }).fetchImpl }), /安全/);
  }
});

test('same-origin absolute canonical artifact URLs are supported', async () => {
  const item = release(); item.manifest = `${PUBLIC_ORIGIN}${item.manifest}`;
  item.packages.agent.path = `${PUBLIC_ORIGIN}${item.packages.agent.path}`;
  const fixture = source([item]);
  assert.equal((await loadLatestAndroidRelease({ fetchImpl: fixture.fetchImpl })).packages.agent.bytes, 815470);
});
