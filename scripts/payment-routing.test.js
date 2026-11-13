import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('./sync-sheet8.js', import.meta.url), 'utf8');
test('external mode never invokes the hosted payment collector', async () => {
  const expression = source.match(/  const paymentPromise = ([^\r\n]+);/)[1];
  let calls = 0;
  const result = await vm.runInNewContext(expression, { process: { env: { PAYMENT_POINTS_EXTERNAL: 'true' } }, metricOrZero() { calls++; throw Error(); } });
  assert.equal(JSON.stringify(result), '[0]');
  assert.equal(calls, 0);
});
test('snapshot output uses a real newline for the exact payment timestamp', () => {
  const code = source.split('\n').find(line => line.includes('appendFileSync(process.env.GITHUB_OUTPUT'));
  let recorded;
  vm.runInNewContext(code, { process: { env: { GITHUB_OUTPUT: 'output' } }, timestamp: '2026-11-13 09:30:16', appendFileSync: (_, value) => { recorded = value; } });
  assert.equal(recorded, 'snapshot_timestamp=2026-11-13 09:30:16\n');
});
test('the cloud job does not receive admin credentials and dispatch stays outside its concurrency', () => {
  const cloud = readFileSync(new URL('../.github/workflows/sheet8-snapshot.yml', import.meta.url), 'utf8');
  const remote = readFileSync(new URL('../.github/workflows/payment-points-sync.yml', import.meta.url), 'utf8');
  assert.ok(!cloud.includes('ADMIN_DIGICAFE_'));
  assert.match(cloud, /PAYMENT_POINTS_EXTERNAL: 'true'/);
  assert.match(cloud, /steps\.snapshot\.outputs\.snapshot_timestamp/);
  assert.match(cloud, /vars\.PAYMENT_RUNNER_ENABLED/);
  assert.match(remote, /runs-on: \[self-hosted, Windows, X64, UF-0049\]/);
  assert.match(remote, /group: payment-points-uf0049/);
  assert.match(remote, /ADMIN_DIGICAFE_USERNAME/);
});
