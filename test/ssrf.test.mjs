import test from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedIp, validateSafeUrl, fetchSafeUrl } from '../backend/ssrf.mjs';

test('SSRF guard blocks loopback, private, link-local and metadata addresses', () => {
  for (const address of ['127.0.0.1', '10.0.0.8', '172.16.0.2', '192.168.1.4', '169.254.169.254', '100.100.100.200', '::1', 'fc00::1', 'fe80::1', '2001:db8::1']) {
    assert.equal(isBlockedIp(address), true, address);
    const host = address.includes(':') ? `[${address}]` : address;
    assert.throws(() => validateSafeUrl(`http://${host}/hook`), /阻止/);
  }
  for (const address of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a00:1', '::ffff:c0a8:1', '::ffff:a9fe:a9fe']) {
    assert.equal(isBlockedIp(address), true, address);
    assert.throws(() => validateSafeUrl(`http://[${address}]/hook`), /阻止/);
  }
});

test('SSRF guard validates every redirect target', async () => {
  const headers = new Headers({ location: 'http://127.0.0.1/private' });
  const fakeFetch = async () => new Response(null, { status: 302, headers });
  await assert.rejects(() => fetchSafeUrl('https://example.com/start', { fetchImpl: fakeFetch }), /阻止/);
});
