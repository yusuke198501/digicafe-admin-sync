import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPaymentHost, paymentTarget, paymentWrite } from './sync-payment-points.js';
test('only UF-0049 may collect payment data', () => {
  assert.doesNotThrow(() => assertPaymentHost('UF-0049'));
  for (const host of ['UF-0042', '', undefined]) assert.throws(() => assertPaymentHost(host));
});
test('writes W only at the exact snapshot timestamp, including a previous-day final', () => {
  const rows = [['2026-11-12 23:59:59'], ['2026-11-13 09:30:16']];
  const target = paymentTarget(rows, '2026-11-12 23:59:59', '2026-11-13');
  assert.deepEqual(paymentWrite(target, 23240), { range: "'シート8'!W2", values: [[23240]] });
  assert.equal(paymentTarget(rows, '', '2026-11-13').row, 3);
  assert.throws(() => paymentTarget(rows, '', '2026-11-14'));
});
test('missing/duplicate rows, invalid points, or a zero replacing a positive value fail closed', () => {
  const stamp = '2026-11-13 09:30:16';
  assert.throws(() => paymentTarget([], stamp));
  assert.throws(() => paymentTarget([[stamp], [stamp]], stamp));
  for (const n of [-1, undefined, NaN, 1.5]) assert.throws(() => paymentWrite({ row: 2 }, n));
  assert.throws(() => paymentWrite({ row: 2, previous: 100 }, 0));
  assert.equal(paymentWrite({ row: 2, previous: 0 }, 0).values[0][0], 0);
});
