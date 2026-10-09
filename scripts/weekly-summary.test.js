import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklySummaryWrites } from './weekly-summary.js';

function makeSheet() {
  const values = Array.from({ length: 24 }, () => Array(52).fill(''));
  const days = [
    ['10/5(月)', 94], ['10/6(火)', 97], ['10/7(水)', 91], ['10/8(木)', 95],
  ];
  days.forEach(([label, hours], index) => {
    const row = index * 4;
    values[row][0] = label;
    values[row][1] = 'DC';
    values[row + 2][35] = hours;
  });
  const header = 16;
  values[header][0] = '10/9(金)';
  values[header][1] = 'DC';
  values[header][16] = '週目標';
  values[header][19] = '週結果';
  ['月', '火', '水', '木', '金', '土', '日'].forEach((day, index) => {
    values[header][22 + index] = day;
  });
  values[header + 1][15] = '売上';
  values[header + 2][15] = 'KPI';
  values[header + 3][15] = '時間数';
  values[header + 3][16] = '=Q19/25'; // existing weekly time target formula must be preserved
  return values;
}

const sourceRows = [
  ['10/5(月)', '1,043,000', '980,900', '', '', '', '', '', '', '2,180', '2,187'],
  ['10/6(火)', '1,043,000', '1,343,840', '', '', '', '', '', '', '2,180', '2,802'],
  ['10/7(水)', '1,043,000', '1,106,250', '', '', '', '', '', '', '1,910', '2,459'],
  ['10/8(木)', '1,043,000', '1,351,290', '', '', '', '', '', '', '2,030', '3,041'],
];

test('sums Monday through yesterday and writes narrowly-scoped weekly values and circles', () => {
  const result = buildWeeklySummaryWrites({
    sourceRows,
    targetValues: makeSheet(),
    reportDate: '2026-10-09',
    sheetName: '目標＆振分',
  });

  assert.deepEqual(result.summary, {
    salesGoal: 4_172_000,
    salesResult: 4_782_280,
    kpiGoal: 8_300,
    kpiResult: 10_489,
    hoursGoal: 332,
    hoursResult: 377,
    days: 4,
  });
  assert.deepEqual(result.writes.slice(-5), [
    { range: "'目標＆振分'!Q18", values: [[4_172_000]] },
    { range: "'目標＆振分'!T18", values: [[4_782_280]] },
    { range: "'目標＆振分'!Q19", values: [[8_300]] },
    { range: "'目標＆振分'!T19", values: [[10_489]] },
    { range: "'目標＆振分'!T20", values: [[377]] },
  ]);
  assert.equal(result.writes.find((write) => write.range.endsWith('W18')).values[0][0], '⬤');
  assert.equal(result.writes.find((write) => write.range.endsWith('W19')).values[0][0], '◯');
  assert.equal(result.writes.some((write) => write.range.endsWith('Q20')), false);
});

test('skips Monday because there are no completed days yet', () => {
  const result = buildWeeklySummaryWrites({ sourceRows, targetValues: makeSheet(), reportDate: '2026-10-12', sheetName: '目標＆振分' });
  assert.deepEqual(result.writes, []);
  assert.match(result.skipped, /Monday/);
});

test('does not write when the source week is incomplete', () => {
  const result = buildWeeklySummaryWrites({
    sourceRows: sourceRows.slice(0, 3),
    targetValues: makeSheet(),
    reportDate: '2026-10-09',
    sheetName: '目標＆振分',
  });
  assert.deepEqual(result.writes, []);
  assert.match(result.skipped, /10\/8/);
});
