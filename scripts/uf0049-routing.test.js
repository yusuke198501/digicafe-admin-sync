import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { previousDateColumn, previousSourceRange } from './previous-date-layout.js';
test('every DC workflow is pinned to UF-0049 with a hostname check; Feliz remains separate', () => {
  const dir = new URL('../.github/workflows/', import.meta.url);
  const dc = readdirSync(dir).filter(f => f.endsWith('.yml') && f !== 'feliz-network-check.yml');
  assert.equal(dc.length, 11);
  for (const file of dc) {
    const text = readFileSync(new URL(file, dir), 'utf8');
    assert.match(text, /runs-on: \[self-hosted, Windows, X64, UF-0049\]/, file);
    assert.match(text, /COMPUTERNAME -ne 'UF-0049'/, file);
    assert.doesNotMatch(text, /ubuntu-latest|<<'NODE'|\bthen\s*$/m, file);
  }
});
test('previous-date column follows inserted columns, never a time cell', () => {
  for (const [first, expected] of [[36, 'CG'], [55, 'CZ'], [58, 'DC'], [62, 'DG']]) {
    const h = Array(120).fill('');
    for (let i = 0; i < 23; i++) h[first + i * 2] = 7 + i;
    h[first + 46] = '合計';
    assert.equal(previousDateColumn(h), expected);
  }
  assert.throws(() => previousDateColumn(['7', '8', '9']));
});
test('previous-date reads stay inside the live sheet grid after old rows are removed', () => {
  assert.equal(previousSourceRange({ rowCount: 4560, columnCount: 148 }), 'A1:ER4560');
  assert.throws(() => previousSourceRange({ rowCount: 0, columnCount: 148 }));
});
test('previous-date target discovery uses the shifted date column and prior DC day', async () => {
  const rows = Array.from({ length: 65 }, () => []);
  for (const [offset, day, site] of [[0, '11/12(木)', 'DC'], [24, '11/12(木)', 'feliz'], [40, '11/13(金)', 'DC'], [64, '11/13(金)', 'feliz']]) {
    rows[offset] = [day, site];
    for (let h = 0; h < 23; h++) rows[offset][58 + 2 * h] = 7 + h;
    rows[offset][104] = '合計';
  }
  rows[4][57] = '担当者'; rows[44][57] = '担当者';
  const ranges = [];
  const sheets = { spreadsheets: {
    get: async () => ({ data: { sheets: ['目標＆振分', 'マケ画面アカウント対応表'].map(title => ({ properties: { title, gridProperties: { rowCount: 4560, columnCount: 148 } } })) } }),
    values: { get: async ({ range }) => { ranges.push(range); return { data: { values: range.endsWith('A:B') ? [['ID', '名前'], ['id', '担当者']] : rows } }; } },
  } };
  const src = readFileSync(new URL('./sync-previous-results.js', import.meta.url), 'utf8');
  const find = vm.runInNewContext(src.slice(src.indexOf('function jstToday('), src.indexOf('async function main(')) + '\nfindTargets', {
    SPREADSHEET_ID: 'sheet', SHEET_NAME: '目標＆振分', ID_MAP_SHEET_CANDIDATES: ['マケ画面アカウント対応表'], SKIP_NAMES: new Set(), previousDateColumn, previousSourceRange,
  });
  const targets = await find(sheets, new Date('2026-11-13T00:00:00Z'));
  assert.equal(targets.length, 1);
  assert.equal(targets[0].dateColumn, 'DC');
  assert.equal(targets[0].row, 45);
  assert.equal(targets[0].prior.toISOString().slice(0, 10), '2026-11-12');
  assert.ok(ranges.includes("'目標＆振分'!A1:ER4560"));
});
