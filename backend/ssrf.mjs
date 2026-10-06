import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_REDIRECTS = 5;

function ipv4Parts(value) {
  const parts = String(value).split('.').map(Number);
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

function ipv6ToBigInt(value) {
  let text = String(value).toLowerCase();
  if (text.startsWith('::ffff:')) {
    const mapped = ipv4Parts(text.slice(7));
    if (mapped) return BigInt(mapped[0] * 2 ** 24 + mapped[1] * 2 ** 16 + mapped[2] * 2 ** 8 + mapped[3]);
  }
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    const mapped = ipv4Parts(text.slice(lastColon + 1));
    if (mapped) text = `${text.slice(0, lastColon + 1)}${((mapped[0] << 8) | mapped[1]).toString(16)}:${((mapped[2] << 8) | mapped[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  if (left.some(part => !/^[0-9a-f]{1,4}$/.test(part)) || right.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  return groups.reduce((result, group) => (result << 16n) | BigInt(parseInt(group, 16)), 0n);
}

export function isBlockedIp(address) {
  const normalized = String(address || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    const mapped = ipv4Parts(normalized.slice(7));
    if (mapped) return isBlockedIp(mapped.join('.'));
  }
  if (net.isIPv4(normalized)) {
    const parts = ipv4Parts(normalized);
    return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] === 169 && parts[1] === 254
      || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31
      || parts[0] === 192 && parts[1] === 168
      || parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127
      || parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)
      || parts[0] >= 224
      || (parts[0] === 169 && parts[1] === 254)
      || normalized === '169.254.169.254' || normalized === '100.100.100.200';
  }
  if (!net.isIPv6(normalized)) return false;
  const value = ipv6ToBigInt(normalized);
  if (value === null) return true;
  // URL canonicalizes IPv4-mapped IPv6 literals such as
  // [::ffff:127.0.0.1] to hexadecimal form ([::ffff:7f00:1]). Detect the
  // 80-bit zero + 16-bit ffff prefix after parsing so those literals inherit
  // the IPv4 private/loopback checks below.
  if ((value >> 32n) === 0xffffn) {
    const mapped = Number(value & 0xffffffffn);
    return isBlockedIp(`${mapped >>> 24}.${(mapped >>> 16) & 0xff}.${(mapped >>> 8) & 0xff}.${mapped & 0xff}`);
  }
  const first = Number(value >> 120n);
  const second = Number((value >> 112n) & 0xffn);
  return value === 0n || value === 1n || first === 0xff || (first & 0xfe) === 0xfc || (first === 0xfe && (second & 0xc0) === 0x80)
    || (value >> 32n) === 0n || (value >> 96n) === 0x20010db8n; // ::/96, link-local and documentation ranges
}

export function validateSafeUrl(value, { allowLocal = false } = {}) {
  let parsed;
  try { parsed = new URL(String(value || '').trim()); } catch { throw new Error('URL 无效'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('URL 只支持不带凭据的 HTTP 或 HTTPS 地址');
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    if (!allowLocal) throw new Error('URL 目标地址被安全策略阻止');
  }
  if (!allowLocal && isBlockedIp(hostname)) throw new Error('URL 目标地址被安全策略阻止');
  return parsed;
}

async function assertResolvable(parsed, { allowLocal = false } = {}) {
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIP(hostname)) {
    if (!allowLocal && isBlockedIp(hostname)) throw new Error('URL 目标地址被安全策略阻止');
    return;
  }
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error('URL 域名无法解析');
  if (!allowLocal && records.some(record => isBlockedIp(record.address))) throw new Error('URL 目标地址解析到受保护网络');
}

export async function fetchSafeUrl(value, { allowLocal = false, fetchImpl = globalThis.fetch, signal, maxRedirects = MAX_REDIRECTS, ...options } = {}) {
  let current = validateSafeUrl(value, { allowLocal });
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    await assertResolvable(current, { allowLocal });
    const response = await fetchImpl(current, { ...options, redirect: 'manual', signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers?.get?.('location');
    if (!location) throw new Error('URL 重定向缺少 Location');
    if (redirects === maxRedirects) throw new Error('URL 重定向次数过多');
    current = validateSafeUrl(new URL(location, current), { allowLocal });
  }
  throw new Error('URL 重定向失败');
}
