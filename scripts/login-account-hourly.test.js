import test from 'node:test';
import assert from 'node:assert/strict';
import { cumulativeLoginAccountMetrics } from './login-account-hourly.js';

const rows = [
  ['', '全体', '全体', '全体', '全体', '全体', '全体', '全体', '別アカウント'],
  ['やり取り送信', 'やり取り受信', '個別送信', '個別受信', '同報配信キャラ数', '同報配信', '同報受信'],
  ['8時', '0', '5', '7', '3', '1', '0', '2', '別データ'],
  ['9時', '0', '11', '13', '17', '1', '0', '4', '別データ'],
];

test('sums account-level individual sends and receives up to, but excluding, the report hour', () => {
  assert.deepEqual(cumulativeLoginAccountMetrics(rows, 9), {
    ufReceive: 10,
    individualSend: 7,
    individualReceive: 3,
  });
});

test('includes the prior hour while excluding the report-hour row', () => {
  assert.deepEqual(cumulativeLoginAccountMetrics(rows, 10), {
    ufReceive: 42,
    individualSend: 20,
    individualReceive: 20,
  });
});
