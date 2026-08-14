import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import { google } from 'googleapis';

const DEFAULT_PHPLITEADMIN_URL = 'https://smlovely.chatlove.xyz/dc/admin/phpliteadmin.php?database=..%2Fdb.db&table=mailnum2&fulltexts=0&numRows=30&action=row_view&sort=datetime&order=DESC';
const SHEET_NAME = '目標＆振分 のコピー';

const SCHEDULE_HOURS = new Map([
  ['7 0 * * *', 9],
  ['7 3 * * *', 12],
  ['7 6 * * *', 15],
  ['7 9 * * *', 18],
  ['7 12 * * *', 21],
  ['7 15 * * *', 24],
  ['7 18 * * *', 27],
]);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be configured.`);
  return value;
}

function text(cell) {
  return String(cell ?? '').replace(/\s/g, '').trim();
}

function headerName(cell) {
  return text(cell).replace(/[↑↓]/g, '');
}

function jstDateParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function reportHour() {
  if (process.env.REPORT_HOUR) {
    const hour = Number(process.env.REPORT_HOUR);
    if ([9, 12, 15, 18, 21, 24, 27].includes(hour)) return hour;
    throw new Error('REPORT_HOUR must be one of: 9, 12, 15, 18, 21, 24, 27.');
  }

  const hour = SCHEDULE_HOURS.get(process.env.GITHUB_EVENT_SCHEDULE);
  if (!hour) throw new Error('Could not determine the target hour from the schedule. Use REPORT_HOUR for manual runs.');
  return hour;
}

function reportDate(hour) {
  const { year, month, day } = jstDateParts();
  const date = new Date(Date.UTC(year, month - 1, day));
  if (hour >= 24) date.setUTCDate(date.getUTCDate() - 1);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
  };
}

async function loginIfNeeded(client, url) {
  const response = await client.get(url, { headers: { 'User-Agent': 'mailnum2-sheet-sync/1.0' } });
  const $ = cheerio.load(response.data);
  const passwordInput = $('input[type="password"]').first();
  if (!passwordInput.length) return response.data;

  const password = required('PHPLITEADMIN_PASSWORD');
  const form = passwordInput.closest('form');
  if (!form.length) throw new Error('phpLiteAdmin login form was not found.');

  const payload = new URLSearchParams();
  form.find('input[name]').each((_, input) => {
    const field = $(input);
    const name = field.attr('name');
    if (!name || field.attr('type') === 'submit') return;
    payload.set(name, field.attr('value') ?? '');
  });
  payload.set(passwordInput.attr('name') ?? 'password', password);

  const action = new URL(form.attr('action') || url, url).toString();
  await client.post(action, payload, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'mailnum2-sheet-sync/1.0' },
  });

  const authenticated = await client.get(url, { headers: { 'User-Agent': 'mailnum2-sheet-sync/1.0' } });
  if (cheerio.load(authenticated.data)('input[type="password"]').length) {
    throw new Error('phpLiteAdmin login failed. Check PHPLITEADMIN_PASSWORD.');
  }
  return authenticated.data;
}

function sourceTimestamp(date, hour) {
  const source = new Date(Date.UTC(date.year, date.month - 1, date.day));
  const sourceHour = hour - 1;
  if (sourceHour >= 24) source.setUTCDate(source.getUTCDate() + 1);
  return {
    year: source.getUTCFullYear(),
    month: source.getUTCMonth() + 1,
    day: source.getUTCDate(),
    hour: sourceHour % 24,
  };
}

function matchesSourceHour(datetime, source) {
  const matched = String(datetime).match(/(\d{4})-(\d{1,2})-(\d{1,2})\D+(\d{1,2})/);
  return Boolean(matched
    && Number(matched[1]) === source.year
    && Number(matched[2]) === source.month
    && Number(matched[3]) === source.day
    && Number(matched[4]) === source.hour);
}

function latestMetrics(html, source) {
  const $ = cheerio.load(html);
  const inspectedHeaders = [];
  for (const table of $('table').toArray()) {
    const rows = $(table).find('tr').toArray();
    const rowCells = (row) => $(row).children('th,td').toArray();
    const headerIndex = rows.findIndex((row) => rowCells(row)
      .map((cell) => text($(cell).text()))
      .includes('receivemails'));
    const firstHeader = rows.find((row) => rowCells(row).length >= 3);
    if (firstHeader) inspectedHeaders.push(rowCells(firstHeader).map((cell) => text($(cell).text())).slice(0, 20));
    if (headerIndex < 0) continue;

    // phpLiteAdmin groups the checkbox and action columns under a colspan=2 header.
    // Expand it so header positions match the cells in the data rows.
    const headers = rowCells(rows[headerIndex]).flatMap((cell) => {
      const colspan = Number($(cell).attr('colspan') ?? 1);
      return Array.from({ length: Number.isFinite(colspan) && colspan > 0 ? colspan : 1 }, () => headerName($(cell).text()));
    });
    const datetimeIndex = headers.indexOf('datetime');
    const receiveIndex = headers.indexOf('receivemails');
    const mktReceiveIndex = headers.indexOf('mkt_receivemails');
    const grossDauIndex = headers.indexOf('gross_dau');
    if ([datetimeIndex, receiveIndex, mktReceiveIndex, grossDauIndex].some((index) => index < 0)) continue;

    const values = rows.slice(headerIndex + 1)
      .map((row) => rowCells(row).map((cell) => $(cell).text().trim()))
      .filter((cells) => /^\d{4}-\d{2}-\d{2}/.test(cells[datetimeIndex] ?? ''))
      .map((cells) => ({
        datetime: cells[datetimeIndex].replace(/\s+/g, ' '),
        receivemails: Number(cells[receiveIndex]),
        mktReceivemails: Number(cells[mktReceiveIndex]),
        grossDau: Number(cells[grossDauIndex]),
      }))
      .filter((row) => Number.isFinite(row.receivemails)
        && Number.isFinite(row.mktReceivemails)
        && Number.isFinite(row.grossDau));

    if (values.length) {
      const matchingRows = values.filter((row) => matchesSourceHour(row.datetime, source));
      if (matchingRows.length) {
        matchingRows.sort((a, b) => b.datetime.localeCompare(a.datetime));
        return matchingRows[0];
      }
      const expected = `${source.year}-${String(source.month).padStart(2, '0')}-${String(source.day).padStart(2, '0')} ${String(source.hour).padStart(2, '0')}:xx`;
      throw new Error(`mailnum2 does not contain a record for ${expected}.`);
    }
  }
  const title = $('title').first().text().trim().replace(/\s+/g, ' ');
  const loginFields = $('input[name]').toArray().map((input) => $(input).attr('name')).filter(Boolean);
  const headerSummary = inspectedHeaders.slice(0, 4).map((headers) => headers.join(',')).join(' | ');
  throw new Error(`mailnum2 table or the required columns were not found. title=${title || '(none)'}; forms=${loginFields.join(',') || '(none)'}; tableHeaders=${headerSummary || '(none)'}`);
}

function locateTargetRow(values, date, hour) {
  const titleIndex = values.findIndex(([columnA, columnB]) => text(columnA).startsWith(date.label) && text(columnB) === 'DC');
  if (titleIndex < 0) throw new Error(`${date.label} DC block was not found in ${SHEET_NAME}.`);

  const timeHeaderIndex = values.findIndex((columns, index) => index > titleIndex
    && index < titleIndex + 35
    && columns.some((column) => text(column).startsWith('時間/')));
  if (timeHeaderIndex < 0) throw new Error(`The time table was not found below the ${date.label} DC block.`);

  const rowIndex = values.findIndex((columns, index) => index > timeHeaderIndex
    && index < timeHeaderIndex + 10
    && columns.some((column) => text(column) === String(hour)));
  if (rowIndex < 0) throw new Error(`${hour} o'clock row was not found in the ${date.label} DC block.`);
  return rowIndex + 1;
}

async function updateSheet(metrics, hour, date) {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(required('GOOGLE_SERVICE_ACCOUNT_JSON')),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = required('SPREADSHEET_ID');
  const range = `'${SHEET_NAME}'!A:C`;
  const source = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const row = locateTargetRow(source.data.values ?? [], date, hour);

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `'${SHEET_NAME}'!C${row}`, values: [[metrics.receivemails]] },
        { range: `'${SHEET_NAME}'!E${row}`, values: [[metrics.mktReceivemails]] },
        { range: `'${SHEET_NAME}'!I${row}`, values: [[metrics.grossDau]] },
      ],
    },
  });
  return row;
}

async function main() {
  const hour = reportHour();
  const date = reportDate(hour);
  const source = sourceTimestamp(date, hour);
  const client = wrapper(axios.create({ jar: new CookieJar(), validateStatus: (status) => status >= 200 && status < 400 }));
  const html = await loginIfNeeded(client, process.env.PHPLITEADMIN_URL || DEFAULT_PHPLITEADMIN_URL);
  const metrics = latestMetrics(html, source);
  const row = await updateSheet(metrics, hour, date);
  console.log(`${date.label} ${hour}:00 -> row ${row}; receivemails=${metrics.receivemails}, mkt_receivemails=${metrics.mktReceivemails}, gross_dau=${metrics.grossDau}; source=${metrics.datetime}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
