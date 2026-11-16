import test from 'node:test';
import assert from 'node:assert/strict';
import { updateWeeklySummaryOnly } from './sync-weekly-summary.js';

function fixture(incomplete = false) {
  const target = Array.from({ length: 32 }, () => []);
  const source = Array.from({ length: 80 }, () => []);
  source[0] = ['26年11月'];
  for (let i = 0; i < 8; i++) {
    target[i * 4] = [`11/${9 + i}(月)`, 'DC'];
    target[i * 4 + 2][35] = 8;
    if (i < 7) {
      source[i + 4] = [`11/${9 + i}`, 999, 100, '', '', '', '', '', '', 999, 50];
      source[i + 42] = [`11/${9 + i}`, 200, '', '', '', '', '', '', '', 60];
    }
  }
  target[28][16] = '７日間目標'; target[28][19] = '７日間結果';
  ['売上', 'KPI', '時間数'].forEach((label, i) => { target[29 + i][15] = label; });
  target[31][16] = '=Q31/25';
  target[29][17] = 'preserve neighbor';
  let summary = target.slice(28, 32).map(row => Array.from({ length: 14 }, (_, c) => row[c + 15] ?? ''));
  const writes = [];
  if (incomplete) source[10][10] = '';
  const sheets = { spreadsheets: {
    get: async ({ spreadsheetId }) => ({ data: { sheets: [{ properties: { title: spreadsheetId === 'target' ? '目標＆振分' : '総合', gridProperties: { rowCount: 32 } } }] } }),
    values: {
      get: async ({ range }) => ({ data: { values: range.includes('A1:AJ') ? target : structuredClone(summary) } }),
      batchGet: async () => ({ data: { valueRanges: [{ values: source }] } }),
      batchUpdate: async ({ requestBody }) => {
        writes.push(...requestBody.data);
        for (const w of requestBody.data) {
          const [, col, row] = /!([A-Z]+)(\d+)/.exec(w.range);
          const offset = [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 16;
          w.values[0].forEach((value, c) => { summary[Number(row) - 29][offset + c] = value; });
        }
      },
    },
  } };
  return { sheets, writes, summary: () => summary };
}

test('weekly-only repair verifies its values and preserves neighboring cells and time-target formula', async () => {
  const f = fixture();
  const result = await updateWeeklySummaryOnly({ sheets: f.sheets, spreadsheetId: 'target', sourceSpreadsheetId: 'source', reportDate: '2026-11-16' });
  assert.equal(result.summary.salesGoal, 1400);
  assert.equal(result.summary.salesResult, 700);
  assert.equal(result.summary.kpiGoal, 420);
  assert.equal(result.summary.kpiResult, 350);
  assert.equal(f.summary()[3][1], '=Q31/25');
  assert.equal(f.summary()[1][2], 'preserve neighbor');
  assert.ok(f.writes.every(w => !/!(?:A|AY|BC|DC)\d/.test(w.range)));
});

test('weekly-only repair fails without any write if one source result is missing', async () => {
  const f = fixture(true);
  await assert.rejects(updateWeeklySummaryOnly({ sheets: f.sheets, spreadsheetId: 'target', sourceSpreadsheetId: 'source', reportDate: '2026-11-16' }), /11\/15/);
  assert.equal(f.writes.length, 0);
});
