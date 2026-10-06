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
  const lookups = [];
  const lookupImpl = async (hostname, options) => {
    lookups.push({ hostname, options });
    if (hostname === 'safe.test') return [{ address: '198.51.100.7', family: 4 }];
    if (hostname === 'redirect.test') return [{ address: '203.0.113.8', family: 4 }];
    if (hostname === 'private.test') return [{ address: '127.0.0.1', family: 4 }];
    throw new Error(`unexpected test hostname: ${hostname}`);
  };
  const fetches = [];
  const fakeFetch = async (url) => {
    fetches.push(url.hostname);
    if (url.hostname === 'safe.test') {
      return new Response(null, {
        status: 302,
        headers: new Headers({ location: 'http://redirect.test/step-1' }),
      });
    }
    assert.equal(url.hostname, 'redirect.test');
    return new Response(null, {
      status: 302,
      headers: new Headers({ location: 'http://private.test/private' }),
    });
  };

  await assert.rejects(
    () => fetchSafeUrl('https://safe.test/start', { fetchImpl: fakeFetch, lookupImpl }),
    /受保护网络/,
  );
  assert.deepEqual(lookups, [
    { hostname: 'safe.test', options: { all: true, verbatim: true } },
    { hostname: 'redirect.test', options: { all: true, verbatim: true } },
    { hostname: 'private.test', options: { all: true, verbatim: true } },
  ]);
  assert.deepEqual(fetches, ['safe.test', 'redirect.test']);
});
