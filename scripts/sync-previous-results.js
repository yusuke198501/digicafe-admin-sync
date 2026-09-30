import { google } from 'googleapis';

const SPREADSHEET_ID = process.env.PREVIOUS_RESULTS_SPREADSHEET_ID
  || '11Zoev9Sptv3x6kxx00i8BoVk8jaWPNcKiuJ_oh_xde8';
const SHEET_NAME = '目標＆振分';
const ID_MAP_SHEET_CANDIDATES = ['マケ画面アカウント対応表', 'DCアカウント対応表', '名前_id対応表'];
const SKIP_NAMES = new Set(['佐藤由加里', '吉村祐輔']);

function jstToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type).value;
  return new Date(Date.UTC(Number(value('year')), Number(value('month')) - 1, Number(value('day'))));
}

function parseDate(value, year) {
  const text = String(value ?? '').trim();
  let found = text.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if (found) return new Date(Date.UTC(Number(found[1]), Number(found[2]) - 1, Number(found[3])));
  found = text.match(/(\d{1,2})\/(\d{1,2})/);
  if (found) return new Date(Date.UTC(year, Number(found[1]) - 1, Number(found[2])));
  found = text.match(/(\d{1,2})月(\d{1,2})日/);
  if (found) return new Date(Date.UTC(year, Number(found[1]) - 1, Number(found[2])));
  return null;
}

function dateText(value) {
  return value.toISOString().slice(0, 10);
}

function shortDate(value) {
  return `${value.getUTCMonth() + 1}/${value.getUTCDate()}`;
}

function sameDate(left, right) {
  return dateText(left) === dateText(right);
}

async function sheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function findTargets(sheets, reportDay) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties(title)',
  });
  const normalizeSheetName = (value) => String(value ?? '').replace(/[\s_]/g, '');
  const sheetTitles = (metadata.data.sheets ?? []).map((sheet) => sheet.properties?.title).filter(Boolean);
  const idMapSheet = sheetTitles.find((title) => ID_MAP_SHEET_CANDIDATES
    .some((candidate) => normalizeSheetName(candidate) === normalizeSheetName(title)));
  if (!idMapSheet) throw new Error(`名前・ID対応表が見つかりません。確認済みタブ: ${sheetTitles.join(', ')}`);
  const [sheetResponse, idResponse] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${SHEET_NAME}'!A1:BZ6000` }),
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${idMapSheet}'!A:B` }),
  ]);
  const rows = sheetResponse.data.values ?? [];
  const mappedNames = new Set((idResponse.data.values ?? []).slice(1)
    .filter((row) => row[0] && row[1])
    .map((row) => String(row[1]).trim()));
  const headers = rows.map((row, index) => ({
    index,
    date: row.slice(0, 18).map((cell) => parseDate(cell, reportDay.getUTCFullYear())).find(Boolean) ?? null,
  })).filter((item) => item.date);
  const start = headers.find((item) => sameDate(item.date, reportDay))?.index;
  if (start === undefined) throw new Error(`${shortDate(reportDay)} のDCブロックが見つかりません。`);
  const end = headers.find((item) => item.index > start)?.index ?? rows.length;
  const targets = [];

  for (let rowIndex = start + 1; rowIndex < end; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    for (const name of mappedNames) {
      if (SKIP_NAMES.has(name) || !row.includes(name)) continue;
      let prior = null;
      for (let previous = rowIndex - 1; previous >= 0 && !prior; previous -= 1) {
        if (!(rows[previous] ?? []).includes(name)) continue;
        for (let header = previous; header >= 0; header -= 1) {
          const date = (rows[header] ?? []).slice(0, 18)
            .map((cell) => parseDate(cell, reportDay.getUTCFullYear())).find(Boolean);
          if (date) {
            prior = date;
            break;
          }
        }
      }
      if (prior) targets.push({ row: rowIndex + 1, name, prior });
    }
  }
  if (!targets.length) throw new Error('更新対象者が見つかりません。');
  return targets;
}

async function main() {
  const reportDay = process.env.REPORT_DATE ? new Date(`${process.env.REPORT_DATE}T00:00:00Z`) : jstToday();
  if (Number.isNaN(reportDay.getTime())) throw new Error('REPORT_DATE は YYYY-MM-DD で指定してください。');
  const sheets = await sheetsClient();
  const targets = await findTargets(sheets, reportDay);
  const data = targets.map((target) => ({
    range: `'${SHEET_NAME}'!CG${target.row}`,
    values: [[shortDate(target.prior)]],
  }));
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });
  console.log(`${shortDate(reportDay)} の前回出勤日をCG列に ${targets.length} 人分更新しました。T/U列の実績は更新していません。`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
