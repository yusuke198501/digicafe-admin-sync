import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import { google } from 'googleapis';

const DEFAULT_PHPLITEADMIN_URL = 'https://smlovely.chatlove.xyz/dc/admin/phpliteadmin.php?database=..%2Fdb.db&table=mailnum2&fulltexts=0&numRows=30&action=row_view&sort=datetime&order=DESC';
const SHEET_NAME = '目標＆振分 のコピー';
const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ja-JP,ja;q=0.9',
};

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

  // Scheduled runs repeat hourly. Each run refreshes the most recently
  // completed reporting slot, catching up after a delayed schedule.
  if (process.env.GITHUB_EVENT_NAME === 'schedule' || process.env.GITHUB_EVENT_SCHEDULE) {
    const currentHour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tokyo',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date()));
    if (currentHour < 3) return 24;
    if (currentHour < 9) return 27;
    if (currentHour < 12) return 9;
    if (currentHour < 15) return 12;
    if (currentHour < 18) return 15;
    if (currentHour < 21) return 18;
    return 21;
  }

  throw new Error('Could not determine the target hour from the schedule. Use REPORT_HOUR for manual runs.');
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

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function isRetryableFetchError(error) {
  if (!axios.isAxiosError(error)) return false;
  if (!error.response) return true;
  return error.response.status === 403
    || error.response.status === 429
    || error.response.status >= 500;
}

async function fetchWithRetry(label, request) {
  const retries = 3;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      if (!isRetryableFetchError(error) || attempt === retries) throw error;
      const status = error.response?.status ?? 'network error';
      const delay = (attempt + 1) * 5000;
      console.warn(`${label} failed (${status}). Retrying in ${delay / 1000} seconds (${attempt + 1}/${retries}).`);
      await wait(delay);
    }
  }
  throw new Error(`${label} could not be completed.`);
}

async function loginIfNeeded(client, url) {
  const response = await fetchWithRetry('phpLiteAdmin page fetch', () => client.get(url, { headers: REQUEST_HEADERS }));
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
    headers: { ...REQUEST_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const authenticated = await fetchWithRetry('phpLiteAdmin authenticated page fetch', () => client.get(url, { headers: REQUEST_HEADERS }));
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
    const boxAReceiveIndex = headers.indexOf('box_a_receivemails');
    const boxBReceiveIndex = headers.indexOf('box_b_receivemails');
    const boxCReceiveIndex = headers.indexOf('box_c_receivemails');
    const boxEReceiveIndex = headers.indexOf('box_e_receivemails');
    const boxIReceiveIndex = headers.indexOf('box_i_receivemails');
    const boxJReceiveIndex = headers.indexOf('box_j_receivemails');
    const boxMReceiveIndex = headers.indexOf('box_m_receivemails');
    const boxQReceiveIndex = headers.indexOf('box_q_receivemails');
    const requiredIndices = [
      datetimeIndex, receiveIndex, mktReceiveIndex, grossDauIndex,
      boxAReceiveIndex, boxBReceiveIndex, boxCReceiveIndex, boxEReceiveIndex,
      boxIReceiveIndex, boxJReceiveIndex, boxMReceiveIndex, boxQReceiveIndex,
    ];
    if (requiredIndices.some((index) => index < 0)) continue;

    const values = rows.slice(headerIndex + 1)
      .map((row) => rowCells(row).map((cell) => $(cell).text().trim()))
      .filter((cells) => /^\d{4}-\d{2}-\d{2}/.test(cells[datetimeIndex] ?? ''))
      .map((cells) => ({
        datetime: cells[datetimeIndex].replace(/\s+/g, ' '),
        receivemails: Number(cells[receiveIndex]),
        mktReceivemails: Number(cells[mktReceiveIndex]),
        grossDau: Number(cells[grossDauIndex]),
        boxAReceivemails: Number(cells[boxAReceiveIndex]),
        boxBReceivemails: Number(cells[boxBReceiveIndex]),
        boxCReceivemails: Number(cells[boxCReceiveIndex]),
        boxEReceivemails: Number(cells[boxEReceiveIndex]),
        boxIReceivemails: Number(cells[boxIReceiveIndex]),
        boxJReceivemails: Number(cells[boxJReceiveIndex]),
        boxMReceivemails: Number(cells[boxMReceiveIndex]),
        boxQReceivemails: Number(cells[boxQReceiveIndex]),
      }))
      .filter((row) => Number.isFinite(row.receivemails)
        && Number.isFinite(row.mktReceivemails)
        && Number.isFinite(row.grossDau)
        && Number.isFinite(row.boxAReceivemails)
        && Number.isFinite(row.boxBReceivemails)
        && Number.isFinite(row.boxCReceivemails)
        && Number.isFinite(row.boxEReceivemails)
        && Number.isFinite(row.boxIReceivemails)
        && Number.isFinite(row.boxJReceivemails)
        && Number.isFinite(row.boxMReceivemails)
        && Number.isFinite(row.boxQReceivemails));

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

function locateBoxTargetRow(values, date, hour) {
  const titleIndex = values.findIndex(([columnA, columnB]) => text(columnA).startsWith(date.label) && text(columnB) === 'DC');
  if (titleIndex < 0) throw new Error(`${date.label} DC block was not found in ${SHEET_NAME}.`);

  const boxHeaderIndex = values.findIndex((columns, index) => index > titleIndex
    && index < titleIndex + 50
    && columns.some((column) => text(column).startsWith('BOX別')));
  if (boxHeaderIndex < 0) throw new Error(`The BOX table was not found below the ${date.label} DC block.`);

  const rowIndex = values.findIndex((columns, index) => index > boxHeaderIndex
    && index < boxHeaderIndex + 10
    && columns.some((column) => text(column) === String(hour)));
  if (rowIndex < 0) throw new Error(`${hour} o'clock row was not found in the ${date.label} BOX table.`);
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
  const values = source.data.values ?? [];
  const row = locateTargetRow(values, date, hour);
  const boxRow = locateBoxTargetRow(values, date, hour);

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: [
        { range: `'${SHEET_NAME}'!C${row}`, values: [[metrics.receivemails]] },
        { range: `'${SHEET_NAME}'!E${row}`, values: [[metrics.mktReceivemails]] },
        { range: `'${SHEET_NAME}'!I${row}`, values: [[metrics.grossDau]] },
        { range: `'${SHEET_NAME}'!C${boxRow}`, values: [[metrics.boxAReceivemails]] },
        { range: `'${SHEET_NAME}'!E${boxRow}`, values: [[metrics.boxBReceivemails]] },
        { range: `'${SHEET_NAME}'!G${boxRow}`, values: [[metrics.boxCReceivemails]] },
        { range: `'${SHEET_NAME}'!I${boxRow}`, values: [[metrics.boxEReceivemails]] },
        { range: `'${SHEET_NAME}'!K${boxRow}`, values: [[metrics.boxIReceivemails]] },
        { range: `'${SHEET_NAME}'!M${boxRow}`, values: [[metrics.boxJReceivemails]] },
        { range: `'${SHEET_NAME}'!O${boxRow}`, values: [[metrics.boxMReceivemails]] },
        { range: `'${SHEET_NAME}'!Q${boxRow}`, values: [[metrics.boxQReceivemails]] },
      ],
    },
  });
  return { row, boxRow };
}

async function main() {
  const hour = reportHour();
  const date = reportDate(hour);
  const source = sourceTimestamp(date, hour);
  const client = wrapper(axios.create({ jar: new CookieJar(), validateStatus: (status) => status >= 200 && status < 400 }));
  const html = await loginIfNeeded(client, process.env.PHPLITEADMIN_URL || DEFAULT_PHPLITEADMIN_URL);
  const metrics = latestMetrics(html, source);
  const { row, boxRow } = await updateSheet(metrics, hour, date);
  console.log(`${date.label} ${hour}:00 -> row ${row}, box row ${boxRow}; receivemails=${metrics.receivemails}, mkt_receivemails=${metrics.mktReceivemails}, gross_dau=${metrics.grossDau}; source=${metrics.datetime}`);
}

main().catch((error) => {
  if (axios.isAxiosError(error) && error.response) {
    const title = cheerio.load(String(error.response.data ?? ''))('title').first().text().trim().replace(/\s+/g, ' ');
    console.error(`phpLiteAdmin request failed: HTTP ${error.response.status}; title=${title || '(none)'}`);
    process.exit(1);
  }
  console.error(error.message);
  process.exit(1);
});
