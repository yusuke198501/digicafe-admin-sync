import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { google } from 'googleapis';
import { buildWeeklySummaryWrites, loadWeeklySummarySources } from './weekly-summary.js';

export async function updateWeeklySummaryOnly({ sheets, spreadsheetId, sourceSpreadsheetId, reportDate, sheetName = '目標＆振分' }) {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(title,gridProperties(rowCount)))' });
  const rowCount = metadata.data.sheets.find(s => s.properties.title === sheetName)?.properties.gridProperties.rowCount;
  assert(Number.isInteger(rowCount) && rowCount > 0, 'Target sheet is missing.');
  const [sourceRowsByMonth, target] = await Promise.all([
    loadWeeklySummarySources({ sheets, spreadsheetId: sourceSpreadsheetId, reportDate }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: `'${sheetName}'!A1:AJ${rowCount}` }),
  ]);
  const targetValues = target.data.values ?? [];
  const result = buildWeeklySummaryWrites({ sourceRowsByMonth, targetValues, reportDate, sheetName });
  assert(!result.skipped, result.skipped);
  // This mode must never write hourly or personal results, or any other date.
  const writeRows = result.writes.map(w => {
    const match = /^'目標＆振分'!(P|Q|T|W|X|Y|Z|AA|AB|AC)(\d+)(?::AC\d+)?$/.exec(w.range);
    assert(match, `Unexpected weekly write: ${w.range}`);
    return Number(match[2]);
  });
  const firstRow = Math.min(...writeRows);
  assert(Math.max(...writeRows) <= firstRow + 3, 'Weekly write crossed its summary block.');
  const inspectRange = `'${sheetName}'!P${firstRow}:AC${firstRow + 3}`;
  const read = async () => (await sheets.spreadsheets.values.get({ spreadsheetId, range: inspectRange, valueRenderOption: 'FORMULA' })).data.values ?? [];
  const normalize = rows => Array.from({ length: 4 }, (_, r) => Array.from({ length: 14 }, (_, c) => rows[r]?.[c] ?? ''));
  const before = normalize(await read());
  const expected = structuredClone(before);
  for (const write of result.writes) {
    const [, column, row] = /!([A-Z]+)(\d+)/.exec(write.range);
    const index = [...column].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 16;
    write.values[0].forEach((value, c) => { expected[Number(row) - firstRow][index + c] = value; });
  }
  // Do not replace formulas or user edits that appeared during preparation.
  assert.deepEqual(normalize(await read()), before, 'Weekly cells changed during preparation.');
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data: result.writes } });
  assert.deepEqual(normalize(await read()), expected, 'Weekly readback mismatch.');
  console.log(JSON.stringify({ reportDate, range: inspectRange, weeklySummary: result.summary, verified: true, hourlyAndPersonalResultsUntouched: true }));
  return result;
}

async function main() {
  const reportDate = process.env.REPORT_DATE || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const auth = new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON), scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  await updateWeeklySummaryOnly({
    sheets: google.sheets({ version: 'v4', auth }),
    spreadsheetId: process.env.SPREADSHEET_ID,
    sourceSpreadsheetId: '1ZRmMQTiTcYR8aWsbF_ZnPccnILKhjEXW9zgqPgHgzik',
    reportDate,
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
