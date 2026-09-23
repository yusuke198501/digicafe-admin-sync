import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import { google } from 'googleapis';

const LOGIN_URL = 'https://log.digicafe.jp/partner/';
const REPORT_URL = 'https://log.digicafe.jp/partner/mailnum_uf';
const SHEET_NAMES = ['目標＆振分'];
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

  // Keep the intended target when a GitHub cron job starts late.
  const scheduledHours = new Map([
    ['15 0 * * *', 9],
    ['15 3 * * *', 12],
    ['15 6 * * *', 15],
    ['15 9 * * *', 18],
    ['15 12 * * *', 21],
    ['15 15 * * *', 24],
    ['15 18 * * *', 27],
  ]);
  const scheduledHour = scheduledHours.get(process.env.GITHUB_EVENT_SCHEDULE);
  if (scheduledHour) return scheduledHour;

  // Cloud Scheduler starts this workflow through workflow_dispatch without
  // REPORT_HOUR.  Infer the latest completed reporting slot from JST.
  if (process.env.GITHUB_EVENT_NAME === 'schedule'
    || process.env.GITHUB_EVENT_NAME === 'workflow_dispatch'
    || process.env.GITHUB_EVENT_SCHEDULE) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tokyo',
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date());
    const get = (type) => Number(parts.find((part) => part.type === type).value);
    const currentHour = get('hour');
    const currentMinute = get('minute');

    // mailnum2 records the next reporting slot around :56.  For example,
    // the 17:56 record belongs in the 18:00 row, even if Actions starts
    // before 18:00 (such as 17:58).
    if (currentMinute >= 56) {
      const slotForFreshSourceHour = new Map([
        [2, 27],
        [8, 9],
        [11, 12],
        [14, 15],
        [17, 18],
        [20, 21],
        [23, 24],
      ]);
      const freshSlot = slotForFreshSourceHour.get(currentHour);
      if (freshSlot) return freshSlot;
    }

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
    iso: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`,
    display: `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`,
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

function isTemporaryVerificationPageError(error) {
  return error instanceof Error
    && error.message.includes('mailnum2 table or the required columns were not found.')
    && error.message.includes('title=少々お待ちください');
}

/**
 * HTTP 200で一時的なアクセス確認ページが返った場合も、待機して再取得する。
 * 表の列構成変更など、確認ページ以外の解析エラーはそのまま失敗させる。
 */
async function fetchMetricsWithRetry(client, url, source) {
  const retries = 3;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const html = await loginIfNeeded(client, url);
    try {
      return latestMetrics(html, source);
    } catch (error) {
      if (!isTemporaryVerificationPageError(error) || attempt === retries) throw error;
      const delay = (attempt + 1) * 10000;
      console.warn(`Temporary access verification page returned. Retrying in ${delay / 1000} seconds (${attempt + 1}/${retries}).`);
      await wait(delay);
    }
  }
  throw new Error('mailnum2 metrics could not be retrieved.');
}

async function loginToReport() {
  const client = wrapper(axios.create({ jar: new CookieJar(), maxRedirects: 5, validateStatus: () => true }));
  await client.get(LOGIN_URL, { headers: REQUEST_HEADERS });
  const response = await client.post(LOGIN_URL, new URLSearchParams({
    mode: 'login', account: required('LOG_ACCOUNT'), pass: required('LOG_PASSWORD'),
  }), { headers: { ...REQUEST_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (response.status !== 200 || !String(response.data).includes('ログアウト')) {
    throw new Error('管理画面にログインできませんでした。LOG_ACCOUNT と LOG_PASSWORD を確認してください。');
  }
  return client;
}

function reportRows($, table) {
  return $(table).find('tr').toArray().map((row) => $(row).children('th,td').toArray()
    .map((cell) => $(cell).text().replace(/\s+/g, ' ').trim()));
}

function reportTable($, label) {
  const heading = $('h1,h2,h3,h4,h5,h6').toArray()
    .find((element) => text($(element).text()) === text(label));
  if (!heading) throw new Error(`表題「${label}」が見つかりません。`);
  // 管理画面では表が table の直後ではなく、ラッパー要素内に置かれる場合がある。
  // そのため、見出しの後に続く要素の中も含めて最初の表を取得する。
  const following = $(heading).nextAll();
  const table = following.filter('table').first().add(following.find('table').first()).first();
  if (!table.length) throw new Error(`表題「${label}」の表が見つかりません。`);
  return table;
}

function metricNumber(value, label) {
  const number = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(number)) throw new Error(`「${label}」の数値を取得できませんでした。`);
  return number;
}

function folderReceive(rows, date, header) {
  const index = rows[0].map(text).indexOf(text(header));
  const data = rows.find((row) => text(row[0]) === date.display);
  if (index < 0 || !data) throw new Error(`フォルダ別/日毎の「${header}」または ${date.display} の行が見つかりません。`);
  // ヘッダー先頭にも日付列用の空セルがあるため、データ行と列位置は一致する。
  return metricNumber(data[index], header);
}

function expandedTableRows($, table) {
  return $(table).find('tr').toArray().map((row) => $(row).children('th,td').toArray()
    .flatMap((cell) => {
      const colspan = Number($(cell).attr('colspan') ?? 1);
      const value = $(cell).text().replace(/\s+/g, ' ').trim();
      return Array.from({ length: Number.isFinite(colspan) && colspan > 0 ? colspan : 1 }, () => value);
    }));
}

function loginAccountSend(html, date) {
  const $ = cheerio.load(html);
  const rows = expandedTableRows($, reportTable($, 'UF_MKT系データ(ログインアカウント別/日毎)'));
  const accountHeader = rows.find((row) => row.some((value) => text(value) === '全体'));
  const metricHeader = rows.find((row) => text(row[0]) === 'やり取り送信');
  const data = rows.find((row) => text(row[0]) === date.display);
  if (!accountHeader || !metricHeader || !data) {
    throw new Error(`ログインアカウント別/日毎の全体送信または ${date.display} の行が見つかりません。`);
  }
  const accountIndex = accountHeader.findIndex((value) => text(value) === '全体');
  // The account header has a leading blank date column while the metric header
  // starts directly with the seven metrics, so the two headers are offset by one.
  const metricIndex = metricHeader.length === accountHeader.length - 1 ? accountIndex - 1 : accountIndex;
  if (accountIndex < 0 || text(metricHeader[metricIndex]) !== 'やり取り送信') {
    throw new Error('ログインアカウント別/日毎の「全体 / やり取り送信」が見つかりません。');
  }
  return metricNumber(data[accountIndex], '全体 / やり取り送信');
}

function reportMetrics(html, date) {
  const $ = cheerio.load(html);
  const overallTable = $('table').toArray().find((table) => text($(table).find('tr').first().text()) === '全体受信データ');
  if (!overallTable) throw new Error('全体受信データの表が見つかりません。');
  const overallRows = reportRows($, overallTable);
  const overallIndex = overallRows[1]?.map(text).indexOf('メール総数');
  if (overallIndex === undefined || overallIndex < 0 || !overallRows[2]) throw new Error('全体受信データの「メール総数」が見つかりません。');

  const folderRows = reportRows($, reportTable($, 'UF_MKT系データ(フォルダ別/日毎)'));
  const dauRows = reportRows($, reportTable($, 'UF_MKT系データ(フォルダ別DAU/日毎)'));
  const dauIndex = dauRows[0].map(text).indexOf('DAU(グロス)');
  const dauData = dauRows.find((row) => text(row[0]) === date.display);
  if (dauIndex < 0 || !dauData) throw new Error(`DAU（グロス）または ${date.display} の行が見つかりません。`);

  return {
    receivemails: metricNumber(overallRows[2][overallIndex], 'メール総数'),
    mktReceivemails: folderReceive(folderRows, date, '受信合計'),
    grossDau: metricNumber(dauData[dauIndex], 'DAU（グロス）'),
    boxAReceivemails: folderReceive(folderRows, date, 'A受信'),
    boxBReceivemails: folderReceive(folderRows, date, 'B受信'),
    boxCReceivemails: folderReceive(folderRows, date, 'C受信'),
    boxEReceivemails: folderReceive(folderRows, date, 'E受信'),
    boxIReceivemails: folderReceive(folderRows, date, 'I受信'),
    boxJReceivemails: folderReceive(folderRows, date, 'J受信'),
    boxMReceivemails: folderReceive(folderRows, date, 'M受信'),
    boxQReceivemails: folderReceive(folderRows, date, 'Q受信'),
    sendTotal: loginAccountSend(html, date),
    boxASend: folderReceive(folderRows, date, 'Aやり取り'),
    boxBSend: folderReceive(folderRows, date, 'Bやり取り'),
    boxCSend: folderReceive(folderRows, date, 'Cやり取り'),
    boxESend: folderReceive(folderRows, date, 'Eやり取り'),
  };
}

async function fetchReportMetrics(date) {
  const client = await loginToReport();
  const query = new URLSearchParams({
    sex: '1', sort: 'times', mail_start: date.iso, mail_end: date.iso,
    code: '', frm: '', created_at_start: date.iso, created_at_end: date.iso,
    disp_type: '', folder_rcv_source: 'point', sum: '集計',
  });
  const response = await client.get(`${REPORT_URL}?${query}`, { headers: REQUEST_HEADERS });
  if (response.status !== 200) throw new Error(`管理画面データの取得に失敗しました（HTTP ${response.status}）。`);
  return reportMetrics(response.data, date);
}

function locateTargetRow(values, date, hour, sheetName) {
  const titleIndex = values.findIndex(([columnA, columnB]) => text(columnA).startsWith(date.label) && text(columnB) === 'DC');
  if (titleIndex < 0) throw new Error(`${date.label} DC block was not found in ${sheetName}.`);

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

function locateBoxTargetRow(values, date, hour, sheetName) {
  const titleIndex = values.findIndex(([columnA, columnB]) => text(columnA).startsWith(date.label) && text(columnB) === 'DC');
  if (titleIndex < 0) throw new Error(`${date.label} DC block was not found in ${sheetName}.`);

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

function locateSendTargetRow(values, date, hour, sheetName) {
  const titleIndex = values.findIndex(([columnA, columnB]) => text(columnA).startsWith(date.label) && text(columnB) === 'DC');
  if (titleIndex < 0) throw new Error(`${date.label} DC block was not found in ${sheetName}.`);

  const sendHeaderIndex = values.findIndex((columns, index) => index > titleIndex
    && index < titleIndex + 50
    && ['A', 'B', 'C', 'E', '全体'].every((label) => columns.some((column) => text(column) === label))
    && columns.some((column) => text(column) === '送信数'));
  if (sendHeaderIndex < 0) throw new Error(`The send table was not found below the ${date.label} DC block.`);

  const rowIndex = values.findIndex((columns, index) => index > sendHeaderIndex
    && index < sendHeaderIndex + 10
    && columns.some((column) => text(column) === String(hour)));
  if (rowIndex < 0) throw new Error(`${hour} o'clock row was not found in the ${date.label} DC send table.`);
  return rowIndex + 1;
}

async function updateSheet(metrics, hour, date) {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(required('GOOGLE_SERVICE_ACCOUNT_JSON')),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = required('SPREADSHEET_ID');
  const results = [];
  for (const sheetName of SHEET_NAMES) {
    const range = `'${sheetName}'!A:Q`;
    const source = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const values = source.data.values ?? [];
    const row = locateTargetRow(values, date, hour, sheetName);
    const boxRow = locateBoxTargetRow(values, date, hour, sheetName);
    const sendRow = locateSendTargetRow(values, date, hour, sheetName);

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: `'${sheetName}'!C${row}`, values: [[metrics.receivemails]] },
          { range: `'${sheetName}'!E${row}`, values: [[metrics.mktReceivemails]] },
          { range: `'${sheetName}'!I${row}`, values: [[metrics.grossDau]] },
          { range: `'${sheetName}'!C${boxRow}`, values: [[metrics.boxAReceivemails]] },
          { range: `'${sheetName}'!E${boxRow}`, values: [[metrics.boxBReceivemails]] },
          { range: `'${sheetName}'!G${boxRow}`, values: [[metrics.boxCReceivemails]] },
          { range: `'${sheetName}'!I${boxRow}`, values: [[metrics.boxEReceivemails]] },
          { range: `'${sheetName}'!K${boxRow}`, values: [[metrics.boxIReceivemails]] },
          { range: `'${sheetName}'!M${boxRow}`, values: [[metrics.boxJReceivemails]] },
          { range: `'${sheetName}'!O${boxRow}`, values: [[metrics.boxMReceivemails]] },
          { range: `'${sheetName}'!Q${boxRow}`, values: [[metrics.boxQReceivemails]] },
          { range: `'${sheetName}'!L${sendRow}:P${sendRow}`, values: [[
            metrics.boxASend, metrics.boxBSend, metrics.boxCSend, metrics.boxESend, metrics.sendTotal,
          ]] },
        ],
      },
    });
    results.push({ sheetName, row, boxRow, sendRow });
  }
  return results;
}

async function main() {
  const hour = reportHour();
  const date = reportDate(hour);
  const metrics = await fetchReportMetrics(date);
  const updatedSheets = await updateSheet(metrics, hour, date);
  const destination = updatedSheets.map(({ sheetName, row, boxRow, sendRow }) => `${sheetName}: row ${row}, box row ${boxRow}, send row ${sendRow}`).join('; ');
  console.log(`${date.label} ${hour}:00 -> ${destination}; all_receive=${metrics.receivemails}, uf_receive=${metrics.mktReceivemails}, gross_dau=${metrics.grossDau}, send_a=${metrics.boxASend}, send_b=${metrics.boxBSend}, send_c=${metrics.boxCSend}, send_e=${metrics.boxESend}, send_total=${metrics.sendTotal}; source=${date.display}`);
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
