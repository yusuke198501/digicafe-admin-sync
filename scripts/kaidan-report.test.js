import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKaidanMetrics } from './kaidan-report.js';

const date = { iso: '2026-10-11', display: '2026/10/11', label: '10/11' };

test('reads the selected day from a date-oriented male registration table', () => {
  const html = `<table>
    <tr><th>日付</th><th>男性登録数</th><th>男性年認完了数</th></tr>
    <tr><td>2026/10/10</td><td>18</td><td>12</td></tr>
    <tr><td>2026/10/11(日)</td><td>23</td><td>17</td></tr>
  </table>`;
  assert.deepEqual(parseKaidanMetrics(html, date), { registrations: 23, ageVerifications: 17 });
});

test('reads the single-day summary after the page has been filtered to the target day', () => {
  const html = `<table>
    <tr><th>男性登録数</th><th>男性年確完了数</th></tr>
    <tr><td>31</td><td>22</td></tr>
  </table>`;
  assert.deepEqual(parseKaidanMetrics(html, date), { registrations: 31, ageVerifications: 22 });
});

test('reads vertically stacked metrics in date-column summary tables', () => {
  const html = `<table class="table table-bordered table-striped">
    <tr><td>項目</td><td>合計</td><td>2026-10-10</td><td>2026-10-11</td></tr>
    <tr>
      <td>合計</td>
      <td><div>アクセス(unique)</div><div>男性登録数</div><div>女性登録数</div><div>男性年認完了数</div><div>女性年認完了数</div></td>
      
      <td><div>1,000</div><div>114</div><div>72</div><div>80</div><div>67</div></td>
      <td><div>0</div><div>40</div><div>6</div><div>21</div><div>2</div></td>
    </tr>
  </table>`;
  assert.deepEqual(parseKaidanMetrics(html, date), { registrations: 40, ageVerifications: 21 });
});

test('supports metric label/value rows and treats a dash as zero', () => {
  const html = `<table>
    <tr><th>男性登録数</th><td>7</td></tr>
    <tr><th>男性年認完了数</th><td>-</td></tr>
  </table>`;
  assert.deepEqual(parseKaidanMetrics(html, date), { registrations: 7, ageVerifications: 0 });
});

test('rejects a multi-day result if the requested date cannot be identified', () => {
  const html = `<table>
    <tr><th>日付</th><th>登録数</th><th>年確完了数</th></tr>
    <tr><td>2026/10/10</td><td>18</td><td>12</td></tr>
    <tr><td>2026/10/12</td><td>23</td><td>17</td></tr>
  </table>`;
  assert.throws(() => parseKaidanMetrics(html, date), /特定できません/);
});

test('rejects a report that does not expose both required metrics', () => {
  assert.throws(() => parseKaidanMetrics('<table><tr><td>登録数</td><td>10</td></tr></table>', date), /特定できません/);
});
