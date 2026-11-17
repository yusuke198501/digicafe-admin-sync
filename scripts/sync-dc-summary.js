import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { google } from 'googleapis';
import { pathToFileURL } from 'node:url';
import { networkRetry } from './network-retry.js';
import { parseAdCodeDailyValues, parseAdCodeTotalValues, adCodeForCurrentMonthDataRow,
  adCodeLookupKey, adCodeMetricKey, normalizeMetricLabel, isAdCodeMarker, parseGrossSales,
  parsePaidMaleTotalUsagePoints, parsePaidMalePayersTotal,
  parseTotalReceivedMailCount, parseUfMktReceiveTotal } from './dc-daily-parsers.js';

const BASE = 'https://log.digicafe.jp/partner';
const HEADERS = { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ja-JP,ja;q=0.9' };
const DEFAULT_SHEET = '1ZRmMQTiTcYR8aWsbF_ZnPccnILKhjEXW9zgqPgHgzik';
const DAY = 86400000;
const iso = date => date.toISOString().slice(0, 10);
const quote = title => `'${title.replaceAll("'", "''")}'`;
const required = name => { if (!process.env[name]) throw Error(`${name} must be configured.`); return process.env[name]; };
export function column(index) {
  let name = '';
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
}
export function dates(now = new Date(), explicit = process.env.REPORT_DATE) {
  const today = new Date(`${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(now)}T00:00:00Z`);
  let target = new Date(today.getTime() - DAY);
  if (explicit) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(explicit)) throw Error('REPORT_DATE must be YYYY-MM-DD.');
    target = new Date(`${explicit}T00:00:00Z`);
    if (!Number.isFinite(target.getTime()) || iso(target) !== explicit) throw Error('Invalid REPORT_DATE.');
  }
  if (target >= today) throw Error('Target must precede today in Asia/Tokyo.');
  // Original mailnum_uf uses the day following the target as registration date.
  return { target, runDate: new Date(target.getTime() + DAY) };
}
export function queries(target, runDate) {
  const month = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), 1));
  const previous = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() - 1, 1));
  return {
    status: { action_start: iso(month), action_end: iso(target), code: '', frm: '', created_at_start: iso(month), created_at_end: iso(target), sum: '集計' },
    mail: { sex: '1', sort: 'times', mail_start: iso(target), mail_end: iso(target), code: '', frm: '', created_at_start: iso(runDate), created_at_end: iso(runDate), disp_type: '', folder_rcv_source: 'point', sum: '集計' },
    ads: start => ({ category: '1', sex: '0', registed_at_start: iso(start), registed_at_end: iso(target), search: '', keywords: '', term: 'd', sum: '集計' }),
    month, previous,
  };
}
export function summaryValues(status, mail, target) {
  const values = [parseGrossSales(status, iso(target)), parseTotalReceivedMailCount(mail),
    parseUfMktReceiveTotal(mail, target), parsePaidMaleTotalUsagePoints(status, iso(target)), parsePaidMalePayersTotal(status)];
  if (values.some(value => !Number.isSafeInteger(value) || value < 0)) throw Error('Summary contains invalid metrics.');
  return values;
}
export function summaryRow(rows, target) {
  const heading = String(rows[0]?.[0] ?? '').replace(/\s/g, '');
  const match = heading.match(/^(\d{2,4})年(\d{1,2})月$/);
  if (!match || Number(match[1]) % 100 !== target.getUTCFullYear() % 100 || Number(match[2]) !== target.getUTCMonth() + 1) throw Error('総合 month heading differs from target; no writes.');
  const dateParts = row => String(row[0] ?? '').match(/^(\d{1,2})\/(\d{1,2})(?:[（(]|$)/);
  const first = rows.findIndex(row => { const day = dateParts(row); return day && Number(day[1]) === target.getUTCMonth() + 1; });
  let end = first;
  while (end >= 0 && end < rows.length && dateParts(rows[end])) end++;
  // The lower revised-goal table repeats all dates. Only the first contiguous
  // date block under the verified month heading is the primary actuals table.
  const matches = rows.slice(first, end).flatMap((row, offset) => {
    const day = String(row[0] ?? '').match(/^(\d{1,2})\/(\d{1,2})(?:[（(]|$)/);
    return day && Number(day[1]) === target.getUTCMonth() + 1 && Number(day[2]) === target.getUTCDate() ? [first + offset + 1] : [];
  });
  if (matches.length !== 1) throw Error('総合 target date is missing or ambiguous; no writes.');
  return matches[0];
}

// Preserve A/B, formulas, formatting, and unrelated cells. Prepare every source
// day before issuing any writes; never clear the live grid before parsing.
export function adPlan(title, rows, html, start, target, existingColumns = 0) {
  const totals = parseAdCodeTotalValues(html);
  const daily = [];
  for (let d = new Date(start); d <= target; d = new Date(d.getTime() + DAY)) daily.push(parseAdCodeDailyValues(html, d));
  const codes = [...new Set([...totals.keys()].map(key => key.split('|')[0]))];
  const existing = new Set(rows.map((_, i) => adCodeLookupKey(adCodeForCurrentMonthDataRow(rows, i))).filter(Boolean));
  const missing = codes.filter(code => !existing.has(code));
  const markers = rows.flatMap(([a], i) => isAdCodeMarker(String(a ?? '')) ? [i] : []);
  let template, blockSize;
  if (missing.length) {
    if (markers.length < 2) throw Error(`${title}: cannot identify ad block template.`);
    template = markers.at(-1);
    blockSize = template - markers.at(-2);
    if (blockSize < 2 || template + blockSize > rows.length) throw Error(`${title}: incomplete ad block template.`);
  }
  const expanded = rows.map(row => [...row]);
  for (const code of missing) {
    const block = rows.slice(template, template + blockSize).map(row => [...row]);
    block[1][0] = code;
    expanded.push(...block);
  }
  const data = [];
  const width = Math.max(existingColumns, daily.length + 3);
  const dateHeaders = Array.from({ length: daily.length }, (_, i) => iso(new Date(start.getTime() + i * DAY)).replace(/-0?/g, '/'));
  data.push({ range: `${quote(title)}!D1:${column(width - 1)}1`, values: [[...dateHeaders, ...Array(width - 3 - daily.length).fill('')]] });
  let matched = 0;
  const mappedKeys = new Set();
  const managedMetrics = new Set(['アクセス', '男性登録数', '女性登録数', '男性年認完了数', '女性年認完了数', '男性課金者数', '男性課金額']);
  expanded.forEach((row, i) => {
    const key = adCodeMetricKey(adCodeForCurrentMonthDataRow(expanded, i), row[1]);
    if (!totals.has(key)) {
      // Like the GAS refresh, remove stale daily values from old ad codes.
      // Leave their C totals and every non-metric/formula row untouched.
      if (i > 0 && managedMetrics.has(normalizeMetricLabel(row[1]))) data.push({ range: `${quote(title)}!D${i + 1}:${column(width - 1)}${i + 1}`, values: [Array(width - 3).fill('')] });
      return;
    }
    const values = [totals.get(key), ...daily.map(day => {
      if (!day.has(key)) throw Error(`${title}: missing daily ad metric ${key}.`);
      return day.get(key);
    })];
    if (values.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw Error(`${title}: invalid ad metric ${key}.`);
    data.push({ range: `${quote(title)}!C${i + 1}:${column(width - 1)}${i + 1}`, values: [[...values, ...Array(width - 3 - daily.length).fill('')]] });
    matched++;
    mappedKeys.add(key);
  });
  if (!matched || mappedKeys.size !== totals.size) throw Error(`${title}: incomplete ad-code/metric mapping (${mappedKeys.size}/${totals.size} unique keys).`);
  // Consolidate consecutive metric rows for efficient Sheets reads and writes.
  const packed = [];
  for (const item of data) {
    const prior = packed.at(-1);
    const m = item.range.match(/!([CD])(\d+):([A-Z]+)(\d+)$/);
    const p = prior?.range.match(/!([CD])(\d+):([A-Z]+)(\d+)$/);
    if (m && p && m[1] === p[1] && Number(m[2]) === Number(p[4]) + 1) {
      prior.range = `${quote(title)}!${p[1]}${p[2]}:${m[3]}${m[4]}`;
      prior.values.push(...item.values);
    } else packed.push({ range: item.range, values: item.values });
  }
  return { title, data: packed, missing, template, blockSize, oldRows: rows.length, newRows: expanded.length, columns: daily.length + 3, matched, days: daily.length };
}

async function fetchReport(client, path, params) {
  const response = await networkRetry(`DC ${path}`, () => client.get(`${BASE}/${path}`, { params, headers: HEADERS }));
  if (response.status !== 200 || !String(response.data).includes('ログアウト')) throw Error(`DC ${path}: HTTP ${response.status} or unauthenticated; no writes.`);
  return String(response.data);
}
async function authenticatedClient() {
  const client = wrapper(axios.create({ jar: new CookieJar(), timeout: 60000, maxRedirects: 5, validateStatus: () => true }));
  await client.get(`${BASE}/`, { headers: HEADERS });
  const response = await client.post(`${BASE}/`, new URLSearchParams({ mode: 'login', account: required('LOG_ACCOUNT'), pass: required('LOG_PASSWORD') }), { headers: HEADERS });
  if (response.status !== 200 || !String(response.data).includes('ログアウト')) throw Error('DC partner login failed.');
  return client;
}
export async function syncDcSummary() {
  if (process.env.COMPUTERNAME?.toUpperCase() !== 'UF-0049') throw Error('DC summary must run on UF-0049.');
  const { target, runDate } = dates();
  const q = queries(target, runDate);
  const client = await authenticatedClient();
  const status = await fetchReport(client, 'status/pt', q.status);
  const mail = await fetchReport(client, 'mailnum_uf', q.mail);
  const currentAds = await fetchReport(client, 'ad/code', q.ads(q.month));
  const previousAds = await fetchReport(client, 'ad/code', q.ads(q.previous));
  const metrics = summaryValues(status, mail, target);
  const sheets = google.sheets({ version: 'v4', auth: new google.auth.GoogleAuth({ credentials: JSON.parse(required('GOOGLE_SERVICE_ACCOUNT_JSON')), scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) });
  const spreadsheetId = process.env.SPREADSHEET_ID || DEFAULT_SHEET;
  const metadata = (await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' })).data;
  const props = title => { const p = metadata.sheets.find(s => s.properties.title === title)?.properties; if (!p) throw Error(`Missing sheet ${title}`); return p; };
  const readRows = async (title, cols) => (await sheets.spreadsheets.values.get({ spreadsheetId, range: `${quote(title)}!A1:${cols}${props(title).gridProperties.rowCount}`, valueRenderOption: 'FORMATTED_VALUE' })).data.values ?? [];
  const summary = await readRows('総合', 'A');
  const row = summaryRow(summary, target);
  const plans = [adPlan('当月data', await readRows('当月data', 'B'), currentAds, q.month, target, props('当月data').gridProperties.columnCount), adPlan('2ヶ月目data', await readRows('2ヶ月目data', 'B'), previousAds, q.previous, target, props('2ヶ月目data').gridProperties.columnCount)];
  const summaryData = ['C', 'I', 'K', 'O', 'Q'].map((col, i) => ({ range: `'総合'!${col}${row}`, values: [[metrics[i]]] }));
  // Guard manual/accidental formulas in directly managed summary cells.
  const before = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: summaryData.map(x => x.range), valueRenderOption: 'FORMULA' });
  if (before.data.valueRanges.some(v => String(v.values?.[0]?.[0] ?? '').startsWith('='))) throw Error('Managed summary cell contains a formula; no writes.');
  console.log(JSON.stringify({ target: iso(target), pc: process.env.COMPUTERNAME, summary: Object.fromEntries(['C','I','K','O','Q'].map((c,i) => [c,metrics[i]])), ads: plans.map(p => ({ title:p.title, days:p.days, metrics:p.matched, addedCodes:p.missing })) }));
  if (process.env.DC_DRY_RUN === 'true') { console.log('DC dry run: source parsing and destination mapping passed; no writes.'); return; }
  for (const plan of plans) {
    const p = props(plan.title), requests = [];
    if (plan.newRows > p.gridProperties.rowCount) requests.push({ appendDimension: { sheetId:p.sheetId, dimension:'ROWS', length:plan.newRows-p.gridProperties.rowCount } });
    if (plan.columns > p.gridProperties.columnCount) requests.push({ appendDimension: { sheetId:p.sheetId, dimension:'COLUMNS', length:plan.columns-p.gridProperties.columnCount } });
    for (let i=0;i<plan.missing.length;i++) {
      const start = plan.oldRows+i*plan.blockSize;
      requests.push({ copyPaste: { source:{sheetId:p.sheetId,startRowIndex:plan.template,endRowIndex:plan.template+plan.blockSize}, destination:{sheetId:p.sheetId,startRowIndex:start,endRowIndex:start+plan.blockSize}, pasteType:'PASTE_NORMAL' } });
      requests.push({ repeatCell: { range:{sheetId:p.sheetId,startRowIndex:start,endRowIndex:start+plan.blockSize,startColumnIndex:2}, cell:{}, fields:'userEnteredValue' } });
      requests.push({ updateCells: { start:{sheetId:p.sheetId,rowIndex:start+1,columnIndex:0}, rows:[{values:[{userEnteredValue:{stringValue:plan.missing[i]}}]}], fields:'userEnteredValue' } });
    }
    if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody:{requests} });
  }
  const data = [...plans.flatMap(p => p.data), ...summaryData];
  for (let i=0;i<data.length;i+=100) {
    const batch=data.slice(i,i+100);
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody:{valueInputOption:'RAW',data:batch} });
    const actual=(await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges:batch.map(d=>d.range), valueRenderOption:'UNFORMATTED_VALUE' })).data.valueRanges;
    batch.forEach((expected,j)=>{
      expected.values.forEach((r,ri)=>r.forEach((v,ci)=>{
        if ((actual[j]?.values?.[ri]?.[ci] ?? '') !== v) throw Error(`DC readback mismatch: ${expected.range} (${ri},${ci})`);
      }));
    });
  }
  console.log(`${iso(target)} の総合 C/I/K/O/Q・当月data・2ヶ月目dataをUF-0049で更新し、全書込値の読戻し一致を確認しました。`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) syncDcSummary().catch(error => { console.error(error.message); process.exitCode=1; });
