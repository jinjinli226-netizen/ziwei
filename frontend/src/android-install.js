export const PUBLIC_ORIGIN = 'https://qzelynth.top';
export const INSTALL_URL = `${PUBLIC_ORIGIN}/android-install`;
export const CONTROL_URL = PUBLIC_ORIGIN;

const DOWNLOAD_PREFIX = '/downloads/android/';
const INDEX_URL = `${PUBLIC_ORIGIN}${DOWNLOAD_PREFIX}index.json`;
const ROLES = ['agent', 'updater'];
const safeWorkspace = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value) ? value : '';

export function installPageHref(workspace) {
  const slug = safeWorkspace(workspace);
  return slug ? `${INSTALL_URL}?workspace=${encodeURIComponent(slug)}` : INSTALL_URL;
}

export function managementHref(workspace) {
  return `${PUBLIC_ORIGIN}/${safeWorkspace(workspace) || 'phone_ai'}/ziwei-connect`;
}

export function formatPackageSize(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return '大小待确认';
  if (bytes < 1024) return `${bytes} B`;
  const divisor = bytes < 1024 * 1024 ? 1024 : 1024 * 1024;
  const size = Math.round(bytes / divisor * 10) / 10;
  return `${size} ${divisor === 1024 ? 'KB' : 'MB'}`;
}

export function detectInstallPlatform(userAgent = '') {
  const value = String(userAgent || '');
  if (/Windows Phone|BlackBerry|BB10|KaiOS|webOS|Symbian/i.test(value)) return 'unsupported';
  if (/iPhone|iPad|iPod/i.test(value) || (/Macintosh/i.test(value) && /Mobile/i.test(value))) return 'ios';
  // Chrome may freeze newer Android versions to "Android 10; K". The UA
  // identifies the platform, while the page states the Android 11+ requirement.
  if (/Android/i.test(value)) return 'android';
  if (/Windows NT|Macintosh|X11|CrOS|Linux/i.test(value)) return 'desktop';
  return 'unsupported';
}

// Validate the original spelling before URL resolution: URL() normalizes dot
// segments, backslashes and encoded traversal before callers can inspect them.
function artifactHref(value, extension) {
  if (typeof value !== 'string') throw new Error('下载地址未通过安全校验，请联系管理员。');
  const path = value.startsWith(`${PUBLIC_ORIGIN}/`) ? value.slice(PUBLIC_ORIGIN.length) : value;
  if (!path.startsWith(DOWNLOAD_PREFIX) || /[\\%?#\s]/.test(path)) {
    throw new Error('下载地址未通过安全校验，请联系管理员。');
  }
  const segments = path.slice(DOWNLOAD_PREFIX.length).split('/');
  if (!segments.length || segments.some(segment => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment))
    || !segments.at(-1).endsWith(`.${extension}`)) {
    throw new Error('下载地址未通过安全校验，请联系管理员。');
  }
  const url = new URL(path, PUBLIC_ORIGIN);
  if (url.origin !== PUBLIC_ORIGIN || url.pathname !== path || url.username || url.password || url.search || url.hash) {
    throw new Error('下载地址未通过安全校验，请联系管理员。');
  }
  return url.href;
}

function requestOptions(signal, method = 'GET') {
  return { method, credentials: 'omit', cache: 'no-store', redirect: 'error', signal };
}

async function fetchResponse(fetchImpl, url, signal, label, method = 'GET') {
  let response;
  try { response = await fetchImpl(url, requestOptions(signal, method)); }
  catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error(`${label}加载失败，请检查网络后重试。`);
  }
  if (!response?.ok) throw new Error(`${label}加载失败（HTTP ${response?.status || '未知'}），请重试。`);
  return response;
}

async function fetchJson(fetchImpl, url, signal, label) {
  const response = await fetchResponse(fetchImpl, url, signal, label);
  try { return await response.json(); }
  catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error(`${label}不是有效 JSON，请重试或联系管理员。`);
  }
}

function assertRelease(value) {
  if (!value || !Number.isSafeInteger(value.versionCode) || value.versionCode < 1
    || typeof value.versionName !== 'string' || !value.versionName.trim() || value.versionName.length > 80
    || /[\u0000-\u001f\u007f]/.test(value.versionName)) {
    throw new Error('发布索引中的版本信息无效，请联系管理员。');
  }
}

function assertSame(indexed, published, label) {
  if (indexed !== undefined && indexed !== published) throw new Error(`发布索引与版本清单的${label}不一致，请联系管理员。`);
}

async function packageBytes(pkg, href, fetchImpl, signal) {
  if (pkg.bytes !== undefined && pkg.bytes !== null) {
    if (!Number.isSafeInteger(pkg.bytes) || pkg.bytes <= 0) throw new Error('版本清单中的安装包大小无效，请联系管理员。');
    return pkg.bytes;
  }
  const response = await fetchResponse(fetchImpl, href, signal, '安装包大小', 'HEAD');
  const header = response.headers.get('content-length');
  const value = header && /^\d+$/.test(header) ? Number(header) : null;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export async function loadLatestAndroidRelease({ fetchImpl = globalThis.fetch, signal } = {}) {
  const index = await fetchJson(fetchImpl, INDEX_URL, signal, '发布索引');
  if (index?.schemaVersion !== 1 || !Array.isArray(index.releases)) throw new Error('发布索引格式无效，请联系管理员。');
  if (!index.releases.length) return null;
  index.releases.forEach(assertRelease);
  const release = [...index.releases].sort((left, right) => right.versionCode - left.versionCode)[0];
  const manifestHref = artifactHref(release.manifest, 'json');
  const manifest = await fetchJson(fetchImpl, manifestHref, signal, '版本清单');
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.packages)) throw new Error('版本清单格式无效，请联系管理员。');
  assertSame(release.buildType, manifest.buildType, '构建类型');
  const packages = {};
  for (const pkg of manifest.packages) {
    if (!pkg || !ROLES.includes(pkg.role)) continue;
    if (packages[pkg.role]) throw new Error('版本清单中的安装包角色重复，请联系管理员。');
    assertSame(release.versionCode, pkg.versionCode, '版本号');
    assertSame(release.versionName, pkg.versionName, '版本名称');
    if (typeof pkg.file !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.apk$/.test(pkg.file)) {
      throw new Error('安装包下载地址未通过安全校验，请联系管理员。');
    }
    if (typeof pkg.packageName !== 'string' || !/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/.test(pkg.packageName)) {
      throw new Error('版本清单中的安装包标识无效，请联系管理员。');
    }
    const href = artifactHref(new URL(pkg.file, manifestHref).href, 'apk');
    if (pkg.path !== undefined) assertSame(artifactHref(pkg.path, 'apk'), href, '安装包下载路径');
    const indexed = release.packages?.[pkg.role];
    if (indexed) {
      assertSame(indexed.file, pkg.file, '安装包文件名');
      assertSame(indexed.packageName, pkg.packageName, '安装包标识');
      assertSame(indexed.sha256, pkg.sha256, '安装包校验值');
      assertSame(indexed.signerSha256, pkg.signerSha256, '签名校验值');
      if (indexed.path !== undefined) assertSame(artifactHref(indexed.path, 'apk'), href, '安装包下载路径');
    }
    packages[pkg.role] = { href, bytes: await packageBytes(pkg, href, fetchImpl, signal), packageName: pkg.packageName, file: pkg.file };
  }
  return { versionName: release.versionName, versionCode: release.versionCode, buildType: release.buildType || manifest.buildType || '', packages };
}
