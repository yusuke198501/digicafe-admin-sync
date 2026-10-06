import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGrossSales } from './gross-sales-report.js';

const date = { iso: '2026-10-06', display: '2026/10/06' };

test('reads グロス売上 from a dated table column', () => {
  const html = '<table><tr><th>日付</th><th>グロス売上</th></tr><tr><td>2026/10/06</td><td>1,234,567</td></tr></table>';
  assert.equal(parseGrossSales(html, date), 1234567);
});

test('reads a row-oriented metric when the filtered report labels the value', () => {
  const html = '<table><tr><th>項目</th><th>数値</th></tr><tr><td>グロス売上</td><td>98,765円</td></tr></table>';
  assert.equal(parseGrossSales(html, date), 98765);
});

test('reads 売上 under the グロス group in the status/pt table', () => {
  const html = '<table><tr><th colspan="2">グロス</th><th colspan="2">有料男性</th></tr><tr><th>日時</th><th>売上</th><th>売上</th><th>課金者数</th></tr><tr><td>2026-10-06</td><td>650,660</td><td>649,330</td><td>129</td></tr></table>';
  assert.equal(parseGrossSales(html, date), 650660);
});

test('does not use a different date from a multi-day table', () => {
  const html = '<table><tr><th>日付</th><th>グロス売上</th></tr><tr><td>2026/10/05</td><td>111</td></tr></table>';
  assert.throws(() => parseGrossSales(html, date), /グロス売上.*見つかりません/);
});

test('rejects conflicting gross sales values', () => {
  const html = '<table><tr><th>日付</th><th>グロス売上</th></tr><tr><td>2026/10/06</td><td>100</td></tr><tr><td>グロス売上</td><td>200</td></tr></table>';
  assert.throws(() => parseGrossSales(html, date), /一意に決まりません/);
});
