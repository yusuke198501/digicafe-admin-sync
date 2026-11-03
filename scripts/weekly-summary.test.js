import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklySummaryWrites, loadWeeklySummarySources } from './weekly-summary.js';

function makeSheet(legacy = false, preserveFormula = true) {
  const values = Array.from({ length: 40 }, () => Array(52).fill(''));
  const days = [
    ['10/5(月)', 94], ['10/6(火)', 97], ['10/7(水)', 91], ['10/8(木)', 95],
    ['10/9(金)', 84], ['10/10(土)', 91], ['10/11(日)', 80], ['10/12(月)', 81],
    ['10/13(火)', 82],
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

const originalRows = [
  ['10/5(月)', '1,043,000', '980,900', '', '', '', '', '', '', '2,180', '2,187'],
  ['10/6(火)', '1,043,000', '1,343,840', '', '', '', '', '', '', '2,180', '2,802'],
  ['10/7(水)', '1,043,000', '1,106,250', '', '', '', '', '', '', '1,910', '2,459'],
  ['10/8(木)', '1,043,000', '1,351,290', '', '', '', '', '', '', '2,030', '3,041'],
  ['10/9(金)', '1,043,000', '1,363,320', '', '', '', '', '', '', '1,990', '2,363'],
  ['10/10(土)', '1,043,000', '1,301,301', '', '', '', '', '', '', '2,060', '2,388'],
  ['10/11(日)', '1,086,000', '1,027,520', '', '', '', '', '', '', '2,180', '2,301'],
  ['10/12(月)', '1,086,000', '1,100,000', '', '', '', '', '', '', '2,180', '2,500'],
];
const sourceRows = [
  ...originalRows,
  ...Array.from({ length: 42 - originalRows.length }, () => []),
  ...originalRows.map(row => [row[0], row[1], '', '', '', '', '', '', '', row[9], '']),
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

test('adds the numeric time target only when its cell is blank', () => {
  const result = buildWeeklySummaryWrites({ sourceRows, targetValues: makeSheet(false, false), reportDate: '2026-10-12', sheetName: '目標＆振分' });
  assert.equal(writeValue(result, 'Q32'), 581.2);
});

test('does not partially write when one of the seven source days is missing', () => {
  const incomplete = sourceRows.map((row,index) => index === 6 ? [] : row);
  const result = buildWeeklySummaryWrites({ sourceRows: incomplete, targetValues: makeSheet(), reportDate: '2026-10-12', sheetName: '目標＆振分' });
  assert.deepEqual(result.writes, []);
  assert.match(result.skipped, /10\/11/);
});

test('revised B/J goals from row 43+ drive totals and daily wins; C/K stay in original table', () => {
  const revised = sourceRows.map(row => [...row]);
  revised[42][1] = 900000;
  revised[42][9] = 2200;
  revised[42][2] = 999999999; // Must not replace original sales result.
  revised[42][10] = 999999999; // Must not replace original KPI result.
  const result = buildWeeklySummaryWrites({sourceRows:revised,targetValues:makeSheet(),reportDate:'2026-10-12',sheetName:'目標＆振分'});
  assert.equal(result.summary.salesGoal,7201000);
  assert.equal(result.summary.kpiGoal,14550);
  assert.equal(result.summary.salesResult,8474421);
  assert.equal(result.summary.kpiResult,17541);
  assert.equal(writeValue(result,'W30'),'◯');
  assert.equal(writeValue(result,'W31'),'⬤');
});

test('missing revised goals do not silently fall back to original targets', () => {
  const revised = sourceRows.map(row => [...row]);
  revised[42][9] = '';
  const result = buildWeeklySummaryWrites({sourceRows:revised,targetValues:makeSheet(),reportDate:'2026-10-12',sheetName:'目標＆振分'});
  assert.deepEqual(result.writes,[]);
  assert.match(result.skipped,/Revised targets/);
});

test('initializes a blank seven-day summary in the next DC block', () => {
  const targetValues = makeSheet();
  const result = buildWeeklySummaryWrites({ sourceRows, targetValues, reportDate: '2026-10-13', sheetName: '目標＆振分' });
  assert.equal(writeValue(result, 'P34'), '売上');
  assert.equal(writeValue(result, 'P35'), 'KPI');
  assert.equal(writeValue(result, 'P36'), '時間数');
  assert.equal(writeValue(result, 'Q33'), '７日間目標');
  assert.equal(writeValue(result, 'T33'), '７日間結果');
  assert.equal(writeValue(result, 'Q36'), result.summary.kpiGoal / 25);
  assert.equal(result.summary.days, 7);
});

test('refuses to overwrite an occupied new summary area', () => {
  const targetValues = makeSheet();
  targetValues[32][22] = 'other content';
  const result = buildWeeklySummaryWrites({ sourceRows, targetValues, reportDate: '2026-10-13', sheetName: '目標＆振分' });
  assert.deepEqual(result.writes, []);
  assert.match(result.skipped, /occupied/);
});

function monthRows(month, days, sales, kpi) {
  const rows = Array.from({length:80}, () => []);
  rows[0] = [`26年${month}月`];
  days.forEach((day, index) => {
    rows[index + 4] = [`${month}/${day}`, 999999, sales, '', '', '', '', '', '', 999999, kpi];
    rows[index + 42] = [`${month}/${day}`, sales + 10, '', '', '', '', '', '', '', kpi + 5];
  });
  return rows;
}

function crossingTarget() {
  const rows = Array.from({length:32}, () => Array(52).fill(''));
  ['10/26','10/27','10/28','10/29','10/30','10/31','11/1','11/2'].forEach((date,index) => {
    rows[index*4][0] = date;
    rows[index*4][1] = 'DC';
    rows[index*4+2][35] = 80;
  });
  rows[28][16] = '７日間目標'; rows[28][19] = '７日間結果';
  rows[29][15] = '売上'; rows[30][15] = 'KPI'; rows[31][15] = '時間数';
  return rows;
}

test('cross-month summary keeps original results and row-43 revised targets separate by month', () => {
  const sourceRowsByMonth = {
    '2026-10':monthRows(10,[26,27,28,29,30,31],100,50),
    '2026-11':monthRows(11,[1],200,100),
  };
  const result = buildWeeklySummaryWrites({sourceRowsByMonth,targetValues:crossingTarget(),reportDate:'2026-11-02',sheetName:'目標＆振分'});
  assert.deepEqual(result.summary,{salesGoal:870,salesResult:800,kpiGoal:435,kpiResult:400,hoursGoal:17.4,hoursResult:560,days:7});
  assert.equal(writeValue(result,'Q30'),870);
  assert.equal(writeValue(result,'T30'),800);
  assert.equal(writeValue(result,'W30'),'⬤');
  assert.equal(writeValue(result,'AC30'),'⬤');
  assert.equal(result.writes.some(write => /AW|AY/.test(write.range)),false);
});

test('missing prior month produces no writes rather than reusing the current month', () => {
  const result = buildWeeklySummaryWrites({sourceRowsByMonth:{'2026-11':monthRows(11,[1],200,100)},targetValues:crossingTarget(),reportDate:'2026-11-02',sheetName:'目標＆振分'});
  assert.deepEqual(result.writes,[]);
  assert.match(result.skipped,/2026-10/);
});

function sourceApi(titles, rowsByTitle) {
  const calls = [];
  return {calls,spreadsheets:{
    get:async () => ({data:{sheets:titles.map(title => ({properties:{title}}))}}),
    values:{batchGet:async args => {
      calls.push(args);
      return {data:{valueRanges:args.ranges.map(range => ({values:rowsByTitle[range.split("'")[1]]}))}};
    }},
  }};
}

test('loader reads October archive and current November table in one bounded batch', async () => {
  const oct=monthRows(10,[31],100,50),nov=monthRows(11,[1],200,100);
  const sheets=sourceApi(['総合','2610総合'],{'総合':nov,'2610総合':oct});
  const result=await loadWeeklySummarySources({sheets,spreadsheetId:'source',reportDate:'2026-11-02'});
  assert.deepEqual(result,{'2026-10':oct,'2026-11':nov});
  assert.deepEqual(sheets.calls[0].ranges,["'2610総合'!A1:K80","'総合'!A1:K80"]);
});

test('loader handles a year boundary and validates both source month headings', async () => {
  const dec=[['26年12月']],jan=[['2027年1月']];
  const sheets=sourceApi(['総合','2612総合'],{'総合':jan,'2612総合':dec});
  assert.deepEqual(await loadWeeklySummarySources({sheets,spreadsheetId:'source',reportDate:'2027-01-02'}),{'2026-12':dec,'2027-01':jan});
});

test('missing archive refuses to treat November 総合 as October', async () => {
  const sheets=sourceApi(['総合'],{'総合':[['26年11月']]});
  await assert.rejects(loadWeeklySummarySources({sheets,spreadsheetId:'source',reportDate:'2026-11-02'}),/not 2026-10/);
});

test('loader rejects an archive with the wrong month heading', async () => {
  const sheets=sourceApi(['総合','2610総合'],{'総合':[['26年11月']],'2610総合':[['26年9月']]});
  await assert.rejects(loadWeeklySummarySources({sheets,spreadsheetId:'source',reportDate:'2026-11-02'}),/not 2026-10/);
});
