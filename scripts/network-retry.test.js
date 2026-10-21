import test from 'node:test';
import assert from 'node:assert/strict';
import { networkRetry } from './network-retry.js';

test('TLS connection reset retries and then succeeds with safe labels', async () => {
  let calls = 0;
  const logs = [], delays = [];
  const result = await networkRetry('mailnum_uf', async () => {
    if (++calls < 3) throw Object.assign(new Error('secret URL/password'), { code: 'ECONNRESET' });
    return { status: 200, data: 42 };
  }, { sleep: async (ms) => delays.push(ms), log: (s) => logs.push(s) });
  assert.equal(result.data, 42);
  assert.deepEqual(delays, [2000, 4000]);
  assert.ok(logs.every((s) => s.includes('mailnum_uf') && !s.includes('secret')));
});

test('fetch nested cause and timeouts are retryable; exhaustion is sanitized', async () => {
  for (const error of [
    Object.assign(new TypeError('fetch failed secret'), { cause: { code: 'ECONNRESET' } }),
    Object.assign(new Error('secret'), { name: 'TimeoutError' }),
  ]) {
    let calls = 0;
    await assert.rejects(networkRetry('GitHub API', async () => { calls++; throw error; },
      { sleep: async () => {}, log: () => {} }), /\[GitHub API\] failed after 4 attempt\(s\): (ECONNRESET|network failure)$/);
    assert.equal(calls, 4);
  }
});

test('429 and 5xx retry even with validateStatus accepting all responses', async () => {
  for (const status of [429, 500, 503]) {
    let calls = 0;
    const result = await networkRetry('report', async () => ({ status: ++calls === 1 ? status : 200 }),
      { sleep: async () => {}, log: () => {} });
    assert.equal(result.status, 200);
    assert.equal(calls, 2);
  }
});

test('authentication, certificate and parsing failures are not retried', async () => {
  for (const error of [{ response: { status: 401 } }, { code: 'CERT_HAS_EXPIRED' }, new Error('missing table')]) {
    let calls = 0;
    await assert.rejects(networkRetry('report', async () => { calls++; throw error; }));
    assert.equal(calls, 1);
  }
});

test('write stage labels network failures without replaying writes', async () => {
  let calls = 0;
  await assert.rejects(networkRetry('Google Sheets: read/write report', async () => {
    calls++; throw Object.assign(new Error('secret'), { code: 'ECONNRESET' });
  }, { attempts: 1 }), /Google Sheets: read\/write report.*ECONNRESET/);
  assert.equal(calls, 1);
});
