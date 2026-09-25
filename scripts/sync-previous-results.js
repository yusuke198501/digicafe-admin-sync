import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import * as cheerio from 'cheerio';
import { google } from 'googleapis';
import { CookieJar } from 'tough-cookie';

const SPREADSHEET_ID = process.env.PREVIOUS_RESULTS_SPREADSHEET_ID
  || '11Zoev9Sptv3x6kxx00i8BoVk8jaWPNcKiuJ_oh_xde8';
const SHEET_NAME = '目標＆振分';
const ID_MAP_SHEET_CANDIDATES = ['マケ画面アカウント対応表', 'DCアカウント対応表', '名前_id対応表'];
const SKIP_NAMES = new Set(['佐藤由加里', '吉村祐輔']);
const LOGIN_URL = 'https://log.digicafe.jp/partner/';
const REPORT_URL = 'https://log.digicafe.jp/partner/mailnum_uf';

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

function number(value) {
  const text = String(value ?? '').replace(/[^0-9.-]/g, '');
  return text ? Number(text) : 0;
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
  const nameToId = new Map((idResponse.data.values ?? []).slice(1)
    .filter((row) => row[0] && row[1])
    .map((row) => [String(row[1]).trim(), String(row[0]).trim()]));
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
    for (const [name, accountId] of nameToId.entries()) {
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
      if (prior) targets.push({ row: rowIndex + 1, name, accountId, prior });
    }
  }
  if (!targets.length) throw new Error('更新対象者が見つかりません。');
  return targets;
}

async function login() {
  if (!process.env.LOG_ACCOUNT || !process.env.LOG_PASSWORD) {
    throw new Error('LOG_ACCOUNT または LOG_PASSWORD が未設定です。');
  }
  const client = wrapper(axios.create({ jar: new CookieJar(), maxRedirects: 5, validateStatus: () => true }));
  const first = await client.get(LOGIN_URL);
  if (first.status !== 200) throw new Error(`管理画面ログインページ取得失敗: HTTP ${first.status}`);
  const form = new URLSearchParams({ mode: 'login', account: process.env.LOG_ACCOUNT, pass: process.env.LOG_PASSWORD });
  const response = await client.post(LOGIN_URL, form, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (response.status !== 200 || !String(response.data).includes('ログアウト')) {
    throw new Error('管理画面にログインできませんでした。');
  }
  return client;
}

async function fetchStats(client, mailDay, reportDay) {
  const query = new URLSearchParams({
    sex: '1', sort: 'times', mail_start: dateText(mailDay), mail_end: dateText(mailDay),
    code: '', frm: '', created_at_start: dateText(reportDay), created_at_end: dateText(reportDay),
    disp_type: '', folder_rcv_source: 'point', sum: '集計',
  });
  const response = await client.get(`${REPORT_URL}?${query}`);
  if (response.status !== 200) throw new Error(`${shortDate(mailDay)} の管理画面取得失敗: HTTP ${response.status}`);
  const $ = cheerio.load(response.data);
  let matched = null;
  $('table').each((_, element) => {
    if (matched) return;
    const tableRows = $(element).find('tr').toArray()
      .map((row) => $(row).children('th,td').toArray().map((cell) => $(cell).text().trim()));
    // 表題行ではなく、ログインアカウント名が並ぶ見出し行を使う。
    // 管理画面は表題行を先頭に追加することがあるため、first() 固定では取得できない。
    const accounts = tableRows.find((cells) => cells.includes('y_uekubo'));
    if (!accounts) return;
    const totals = tableRows.find((cells) => cells.some((cell) => cell === '合計'));
    if (totals) matched = { accounts, totals };
  });
  if (!matched) throw new Error(`${shortDate(mailDay)} のログインアカウント別合計表が見つかりません。`);
  const values = matched.totals.slice(1).map(number);
  // 先頭に見出しセルが含まれる場合がある。また、管理画面の項目追加で
  // アカウント単位の列数が変わるため、合計行から実際のグループ幅を求める。
  let accounts = matched.accounts;
  let groupWidth = 0;
  for (let offset = 0; offset < matched.accounts.length; offset += 1) {
    const candidate = matched.accounts.slice(offset);
    if (candidate.length >= 1 && values.length % candidate.length === 0 && values.length / candidate.length >= 2) {
      accounts = candidate;
      groupWidth = values.length / candidate.length;
      break;
    }
  }
  if (!groupWidth) throw new Error(`${shortDate(mailDay)} の合計表の列構成を判定できません。`);
  return new Map(accounts.map((account, index) => [account, [values[index * groupWidth], values[index * groupWidth + 1]]]));
}

async function main() {
  const reportDay = process.env.REPORT_DATE ? new Date(`${process.env.REPORT_DATE}T00:00:00Z`) : jstToday();
  if (Number.isNaN(reportDay.getTime())) throw new Error('REPORT_DATE は YYYY-MM-DD で指定してください。');
  const sheets = await sheetsClient();
  const targets = await findTargets(sheets, reportDay);
  const client = await login();
  const statsByDate = new Map();
  for (const prior of new Map(targets.map((target) => [dateText(target.prior), target.prior])).values()) {
    statsByDate.set(dateText(prior), await fetchStats(client, prior, reportDay));
  }
  const data = targets.flatMap((target) => {
    const stats = statsByDate.get(dateText(target.prior)).get(target.accountId);
    if (!stats) throw new Error(`${target.name} (${target.accountId}) の実績が管理画面にありません。`);
    return [
      { range: `'${SHEET_NAME}'!T${target.row}:U${target.row}`, values: [[stats[0], stats[1]]] },
      { range: `'${SHEET_NAME}'!BZ${target.row}`, values: [[shortDate(target.prior)]] },
    ];
  });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });
  console.log(`${shortDate(reportDay)} の前回実績を ${targets.length} 人分更新しました。`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
