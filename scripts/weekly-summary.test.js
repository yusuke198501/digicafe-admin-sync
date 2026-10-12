import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklySummaryWrites } from './weekly-summary.js';

function makeSheet(legacy = false, preserveFormula = true) {
  const values = Array.from({ length: 40 }, () => Array(52).fill(''));
  const days = [
    ['10/5(月)', 94], ['10/6(火)', 97], ['10/7(水)', 91], ['10/8(木)', 95],
    ['10/9(金)', 84], ['10/10(土)', 91], ['10/11(日)', 80], ['10/12(月)', 81],
  ];
  days.forEach(([label, hours], index) => {
    const row = index * 4;
    values[row][0] = label;
    values[row][1] = 'DC';
    values[row + 2][35] = hours;
  });
  values[28][16] = legacy ? '週目標' : '７日間目標';
  values[28][19] = legacy ? '週結果' : '７日間結果';
  (legacy ? ['月', '火', '水', '木', '金', '土', '日']
    : ['７日前', '６日前', '５日前', '４日前', '３日前', '２日前', '昨日'])
    .forEach((label, index) => { values[28][22 + index] = label; });
  values[29][15] = '売上';
  values[30][15] = 'KPI';
  values[31][15] = '時間数';
  if (preserveFormula) values[31][16] = '=Q31/25';
  return values;
}

const sourceRows = [
  ['10/5(月)', '1,043,000', '980,900', '', '', '', '', '', '', '2,180', '2,187'],
  ['10/6(火)', '1,043,000', '1,343,840', '', '', '', '', '', '', '2,180', '2,802'],
  ['10/7(水)', '1,043,000', '1,106,250', '', '', '', '', '', '', '1,910', '2,459'],
  ['10/8(木)', '1,043,000', '1,351,290', '', '', '', '', '', '', '2,030', '3,041'],
  ['10/9(金)', '1,043,000', '1,363,320', '', '', '', '', '', '', '1,990', '2,363'],
  ['10/10(土)', '1,043,000', '1,301,301', '', '', '', '', '', '', '2,060', '2,388'],
  ['10/11(日)', '1,086,000', '1,027,520', '', '', '', '', '', '', '2,180', '2,301'],
];

function writeValue(result, cell) {
  return result.writes.find((write) => write.range === `'目標＆振分'!${cell}`)?.values[0][0];
}

test('Monday includes the prior seven days and preserves the time-target formula', () => {
  const result = buildWeeklySummaryWrites({ sourceRows, targetValues: makeSheet(), reportDate: '2026-10-12', sheetName: '目標＆振分' });
  assert.deepEqual(result.summary, {
    salesGoal: 7_344_000, salesResult: 8_474_421, kpiGoal: 14_530,
    kpiResult: 17_541, hoursGoal: 581.2, hoursResult: 632, days: 7,
  });
  assert.equal(writeValue(result, 'Q30'), 7_344_000);
  assert.equal(writeValue(result, 'T30'), 8_474_421);
  assert.equal(writeValue(result, 'Q31'), 14_530);
  assert.equal(writeValue(result, 'T31'), 17_541);
  assert.equal(writeValue(result, 'T32'), 632);
  assert.equal(writeValue(result, 'W30'), '⬤');
  assert.equal(writeValue(result, 'AC30'), '⬤');
  assert.equal(writeValue(result, 'AC31'), '◯');
  assert.equal(writeValue(result, 'AC32'), '⬤');
  assert.equal(result.writes.some((write) => write.range.endsWith('Q32')), false);
});

test('converts legacy week headers to rolling seven-day labels', () => {
  const result = buildWeeklySummaryWrites({ sourceRows, targetValues: makeSheet(true), reportDate: '2026-10-12', sheetName: '目標＆振分' });
  assert.equal(writeValue(result, 'Q29'), '７日間目標');
  assert.equal(writeValue(result, 'T29'), '７日間結果');
  assert.deepEqual(result.writes.find((write) => write.range.endsWith('W29:AC29')).values[0],
    ['７日前', '６日前', '５日前', '４日前', '３日前', '２日前', '昨日']);
});

test('adds the time-target formula only when its cell is blank', () => {
  const result = buildWeeklySummaryWrites({ sourceRows, targetValues: makeSheet(false, false), reportDate: '2026-10-12', sheetName: '目標＆振分' });
  assert.equal(writeValue(result, 'Q32'), '=Q31/25');
});

test('does not partially write when one of the seven source days is missing', () => {
  const result = buildWeeklySummaryWrites({ sourceRows: sourceRows.slice(0, 6), targetValues: makeSheet(), reportDate: '2026-10-12', sheetName: '目標＆振分' });
  assert.deepEqual(result.writes, []);
  assert.match(result.skipped, /10\/11/);
});
