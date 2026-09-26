import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import { google } from 'googleapis';

const LOGIN_URL = 'https://log.digicafe.jp/partner/';
const REPORT_URL = 'https://log.digicafe.jp/partner/mailnum_uf';
const PHPLITEADMIN_URL = 'https://smlovely.chatlove.xyz/dc/admin/phpliteadmin.php?database=..%2Fdb.db&table=mailnum2&fulltexts=0&numRows=30&action=row_view';
const PHPLITEADMIN_SQL_URL = 'https://smlovely.chatlove.xyz/dc/admin/phpliteadmin.php?database=..%2Fdb.db&table=mailnum2&fulltexts=0&numRows=30&action=table_sql';
const SHEET_NAMES = ['目標＆振分'];
const REPORT_HOURS = [9, 10, 13, 17, 21, 24, 27];
const ID_MAP_SHEET_CANDIDATES = ['マケ画面アカウント対応表', 'DCアカウント対応表', '名前_id対応表'];
// 古い時刻表を複製して作られた日付ブロックでも、初回更新時に新しい時刻へ置換する。
const LEGACY_TIME_BY_REPORT_HOUR = new Map([[10, 12], [13, 15], [17, 18]]);
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
    if (REPORT_HOURS.includes(hour)) return hour;
    throw new Error(`REPORT_HOUR must be one of: ${REPORT_HOURS.join(', ')}.`);
  }

  // Keep the intended target when a GitHub cron job starts late.
  const scheduledHours = new Map([
    ['5 0 * * *', 9],
    ['5 1 * * *', 10],
    ['5 4 * * *', 13],
    ['5 8 * * *', 17],
    ['5 12 * * *', 21],
    ['5 15 * * *', 24],
    ['5 18 * * *', 27],
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
        [9, 10],
        [12, 13],
        [16, 17],
        [20, 21],
        [23, 24],
      ]);
      const freshSlot = slotForFreshSourceHour.get(currentHour);
      if (freshSlot) return freshSlot;
    }

    if (currentHour < 3) return 24;
    if (currentHour < 9) return 27;
    if (currentHour < 10) return 9;
    if (currentHour < 13) return 10;
    if (currentHour < 17) return 13;
    if (currentHour < 21) return 17;
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
    // UF受信・BOX受信は管理画面の時間別表で取得する。
    // 履歴DBから必要なのは、同時点の全体受信とDAUだけ。
    const requiredIndices = [datetimeIndex, receiveIndex, grossDauIndex];
    if (requiredIndices.some((index) => index < 0)) continue;

    const values = rows.slice(headerIndex + 1)
      .map((row) => rowCells(row).map((cell) => $(cell).text().trim()))
      .filter((cells) => /^\d{4}-\d{2}-\d{2}/.test(cells[datetimeIndex] ?? ''))
      .map((cells) => ({
        datetime: cells[datetimeIndex].replace(/\s+/g, ' '),
        receivemails: Number(cells[receiveIndex]),
        mktReceivemails: Number(cells[mktReceiveIndex] ?? 0),
        grossDau: Number(cells[grossDauIndex]),
        boxAReceivemails: Number(cells[boxAReceiveIndex] ?? 0),
        boxBReceivemails: Number(cells[boxBReceiveIndex] ?? 0),
        boxCReceivemails: Number(cells[boxCReceiveIndex] ?? 0),
        boxEReceivemails: Number(cells[boxEReceiveIndex] ?? 0),
        boxIReceivemails: Number(cells[boxIReceiveIndex] ?? 0),
        boxJReceivemails: Number(cells[boxJReceiveIndex] ?? 0),
        boxMReceivemails: Number(cells[boxMReceiveIndex] ?? 0),
        boxQReceivemails: Number(cells[boxQReceiveIndex] ?? 0),
      }))
      .filter((row) => Number.isFinite(row.receivemails) && Number.isFinite(row.grossDau));

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

/**
 * 一覧表示は右端の gross_dau 列を省略するため、SQL画面から必要な3列だけを読む。
 * これにより一覧の表示件数・列数の変更に影響されない。
 */
async function fetchArchiveMetrics(client, source) {
  const start = new Date(Date.UTC(source.year, source.month - 1, source.day, source.hour));
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const sqliteTimestamp = (value) => `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')} ${String(value.getUTCHours()).padStart(2, '0')}:00:00`;
  const sql = [
    'SELECT datetime, receivemails, gross_dau',
    'FROM mailnum2',
    `WHERE datetime >= '${sqliteTimestamp(start)}'`,
    `AND datetime < '${sqliteTimestamp(end)}'`,
    'ORDER BY datetime DESC',
    'LIMIT 1;',
  ].join(' ');
  const html = await loginIfNeeded(client, PHPLITEADMIN_SQL_URL);
  const $ = cheerio.load(html);
  const form = $('textarea[name="queryval"]').first().closest('form');
  if (!form.length) throw new Error('phpLiteAdmin SQL query form was not found.');

  const payload = new URLSearchParams();
  form.find('input[name], textarea[name]').each((_, field) => {
    const input = $(field);
    const name = input.attr('name');
    if (!name || input.attr('type') === 'submit') return;
    payload.set(name, input.is('textarea') ? input.text() : (input.attr('value') ?? ''));
  });
  payload.set('queryval', sql);
  // phpLiteAdmin distinguishes a form display from execution by the submit name.
  payload.set('query', 'Go');
  const action = new URL(form.attr('action') || PHPLITEADMIN_SQL_URL, PHPLITEADMIN_SQL_URL).toString();
  const response = await fetchWithRetry('phpLiteAdmin SQL query', () => client.post(action, payload, {
    headers: { ...REQUEST_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
  }));
  return latestMetrics(response.data, source);
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

function loginAccountDailyStats(html, date) {
  const $ = cheerio.load(html);
  const rows = expandedTableRows($, reportTable($, 'UF_MKT系データ(ログインアカウント別/日毎)'));
  const accountHeader = rows.find((row) => row.some((value) => text(value) === '全体'));
  const metricHeader = rows.find((row) => text(row[0]) === 'やり取り送信');
  const data = rows.find((row) => text(row[0]) === date.display);
  if (!accountHeader || !metricHeader || !data) {
    throw new Error(`ログインアカウント別/日毎の ${date.display} の行が見つかりません。`);
  }

  const firstAccountIndex = accountHeader.findIndex((value) => text(value) === '全体');
  // アカウント名は、配下の7項目分だけ colspan で繰り返されている。
  // 連続重複を除いたものをアカウント一覧として扱う。
  const accountCells = accountHeader.slice(firstAccountIndex);
  const accounts = accountCells.filter((account, index) => index === 0
    || text(account) !== text(accountCells[index - 1]));
  const values = data.slice(1);
  if (firstAccountIndex < 0 || !accounts.length || values.length % accounts.length !== 0) {
    throw new Error('ログインアカウント別/日毎のアカウント列構成を判定できません。');
  }
  const groupWidth = values.length / accounts.length;
  if (groupWidth !== 7 || text(metricHeader[0]) !== 'やり取り送信') {
    throw new Error('ログインアカウント別/日毎の7項目構成を判定できません。');
  }
  // 項目順: やり取り送信、やり取り受信、個別送信、個別受信、
  // 同報配信キャラ数、同報配信、同報受信。
  const [interactionIndex, individualIndex, broadcastIndex] = [0, 2, 5];

  return new Map(accounts.map((account, index) => {
    const offset = index * groupWidth;
    return [text(account), {
      interaction: metricNumber(values[offset + interactionIndex], `${account} / やり取り送信`),
      individual: metricNumber(values[offset + individualIndex], `${account} / 個別送信`),
      broadcast: metricNumber(values[offset + broadcastIndex], `${account} / 同報配信`),
    }];
  }));
}

function loginAccountSend(html, date) {
  const all = loginAccountDailyStats(html, date).get('全体');
  if (!all) throw new Error('ログインアカウント別/日毎の「全体 / やり取り送信」が見つかりません。');
  return all.interaction;
}

function cumulativeHourlyMetric(rows, header, hour) {
  const headerIndex = rows[0].map(text).indexOf(text(header));
  if (headerIndex < 0) throw new Error(`フォルダ別/時間毎の「${header}」が見つかりません。`);

  return rows.slice(1)
    .filter((row) => {
      const matched = text(row[0]).match(/^(\d+)時$/);
      return matched && Number(matched[1]) < hour;
    })
    .reduce((total, row) => total + metricNumber(row[headerIndex], header), 0);
}

function cumulativeUfReceive(html, hour) {
  const $ = cheerio.load(html);
  const rows = expandedTableRows($, reportTable($, 'UF_MKT系データ(ログインアカウント別/時間毎)'));
  const accountHeader = rows.find((row) => row.some((value) => text(value) === '全体'));
  const metricHeader = rows.find((row) => text(row[0]) === 'やり取り送信');
  if (!accountHeader || !metricHeader) {
    throw new Error('ログインアカウント別/時間毎の全体受信データが見つかりません。');
  }

  const accountIndex = accountHeader.findIndex((value) => text(value) === '全体');
  const receiveTypes = ['やり取り受信', '個別受信', '同報受信'];
  const indices = receiveTypes.map((label) => {
    const metricIndex = metricHeader.findIndex((value) => text(value) === text(label));
    if (metricIndex < 0) throw new Error(`ログインアカウント別/時間毎の「${label}」が見つかりません。`);
    return accountIndex + metricIndex;
  });

  return rows
    .filter((row) => /^\d+時$/.test(text(row[0])) && Number(text(row[0]).replace('時', '')) < hour)
    .reduce((total, row) => total + indices.reduce((sum, index) => sum + metricNumber(row[index], 'UF受信'), 0), 0);
}

function reportMetrics(html, date, hour) {
  const $ = cheerio.load(html);
  const hourlyRows = reportRows($, reportTable($, 'UF_MKT系データ(フォルダ別/時間毎)'));
  return {
    mktReceivemails: cumulativeUfReceive(html, hour),
    boxAReceivemails: cumulativeHourlyMetric(hourlyRows, 'A受信', hour),
    boxBReceivemails: cumulativeHourlyMetric(hourlyRows, 'B受信', hour),
    boxCReceivemails: cumulativeHourlyMetric(hourlyRows, 'C受信', hour),
    boxEReceivemails: cumulativeHourlyMetric(hourlyRows, 'E受信', hour),
    boxIReceivemails: cumulativeHourlyMetric(hourlyRows, 'I受信', hour),
    boxJReceivemails: cumulativeHourlyMetric(hourlyRows, 'J受信', hour),
    boxMReceivemails: cumulativeHourlyMetric(hourlyRows, 'M受信', hour),
    boxQReceivemails: cumulativeHourlyMetric(hourlyRows, 'Q受信', hour),
    sendTotal: cumulativeHourlyMetric(hourlyRows, 'やり取り送信', hour),
    boxASend: cumulativeHourlyMetric(hourlyRows, 'Aやり取り', hour),
    boxBSend: cumulativeHourlyMetric(hourlyRows, 'Bやり取り', hour),
    boxCSend: cumulativeHourlyMetric(hourlyRows, 'Cやり取り', hour),
    boxESend: cumulativeHourlyMetric(hourlyRows, 'Eやり取り', hour),
    accountSendStats: loginAccountDailyStats(html, date),
  };
}

async function fetchReportMetrics(date, hour) {
  const client = await loginToReport();
  const query = new URLSearchParams({
    sex: '1', sort: 'times', mail_start: date.iso, mail_end: date.iso,
    code: '', frm: '', created_at_start: date.iso, created_at_end: date.iso,
    disp_type: '', folder_rcv_source: 'point', sum: '集計',
  });
  const response = await client.get(`${REPORT_URL}?${query}`, { headers: REQUEST_HEADERS });
  if (response.status !== 200) throw new Error(`管理画面データの取得に失敗しました（HTTP ${response.status}）。`);
  return reportMetrics(response.data, date, hour);
}

function locateTargetRow(values, date, hour, sheetName) {
  const titleIndex = values.findIndex(([columnA, columnB]) => text(columnA).startsWith(date.label) && text(columnB) === 'DC');
  if (titleIndex < 0) throw new Error(`${date.label} DC block was not found in ${sheetName}.`);

  const timeHeaderIndex = values.findIndex((columns, index) => index > titleIndex
    && index < titleIndex + 35
    && columns.some((column) => text(column).startsWith('時間/')));
  if (timeHeaderIndex < 0) throw new Error(`The time table was not found below the ${date.label} DC block.`);

  // 時間はA列。集計値にも「9」「12」などが含まれるため、行全体は検索しない。
  let rowIndex = values.findIndex((columns, index) => index > timeHeaderIndex
    && index < timeHeaderIndex + 10
    && text(columns[0]) === String(hour));
  let replaceTimeLabel = false;
  if (rowIndex < 0 && LEGACY_TIME_BY_REPORT_HOUR.has(hour)) {
    const legacyHour = LEGACY_TIME_BY_REPORT_HOUR.get(hour);
    rowIndex = values.findIndex((columns, index) => index > timeHeaderIndex
      && index < timeHeaderIndex + 10
      && text(columns[0]) === String(legacyHour));
    replaceTimeLabel = rowIndex >= 0;
  }
  if (rowIndex < 0) throw new Error(`${hour} o'clock row was not found in the ${date.label} DC block.`);
  return { row: rowIndex + 1, replaceTimeLabel };
}

function locateBoxTargetRow(values, date, hour, sheetName) {
  const titleIndex = values.findIndex(([columnA, columnB]) => text(columnA).startsWith(date.label) && text(columnB) === 'DC');
  if (titleIndex < 0) throw new Error(`${date.label} DC block was not found in ${sheetName}.`);

  const boxHeaderIndex = values.findIndex((columns, index) => index > titleIndex
    && index < titleIndex + 50
    && columns.some((column) => text(column).startsWith('BOX別')));
  if (boxHeaderIndex < 0) throw new Error(`The BOX table was not found below the ${date.label} DC block.`);

  // 時間はA列。BOXの集計値に同じ数値があっても別の行を選ばない。
  let rowIndex = values.findIndex((columns, index) => index > boxHeaderIndex
    && index < boxHeaderIndex + 10
    && text(columns[0]) === String(hour));
  let replaceTimeLabel = false;
  if (rowIndex < 0 && LEGACY_TIME_BY_REPORT_HOUR.has(hour)) {
    const legacyHour = LEGACY_TIME_BY_REPORT_HOUR.get(hour);
    rowIndex = values.findIndex((columns, index) => index > boxHeaderIndex
      && index < boxHeaderIndex + 10
      && text(columns[0]) === String(legacyHour));
    replaceTimeLabel = rowIndex >= 0;
  }
  if (rowIndex < 0) throw new Error(`${hour} o'clock row was not found in the ${date.label} BOX table.`);
  return { row: rowIndex + 1, replaceTimeLabel };
}

function locateSendHeaderRow(values, date, sheetName) {
  const titleIndex = values.findIndex(([columnA, columnB]) => text(columnA).startsWith(date.label) && text(columnB) === 'DC');
  if (titleIndex < 0) throw new Error(`${date.label} DC block was not found in ${sheetName}.`);

  const sendHeaderIndex = values.findIndex((columns, index) => index > titleIndex
    && index < titleIndex + 50
    && columns.some((column) => text(column).startsWith('時間/')));
  if (sendHeaderIndex < 0) throw new Error(`The time table was not found below the ${date.label} DC block.`);
  return sendHeaderIndex + 1;
}

function normalizeSheetName(value) {
  return String(value ?? '').replace(/[\s_]/g, '');
}

async function loadNameToId(sheets, spreadsheetId) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(title)',
  });
  const titles = (metadata.data.sheets ?? []).map((sheet) => sheet.properties?.title).filter(Boolean);
  const idMapSheet = titles.find((title) => ID_MAP_SHEET_CANDIDATES
    .some((candidate) => normalizeSheetName(candidate) === normalizeSheetName(title)));
  if (!idMapSheet) throw new Error(`名前・ID対応表が見つかりません。確認済みタブ: ${titles.join(', ')}`);

  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${idMapSheet}'!A:B` });
  return new Map((response.data.values ?? []).slice(1)
    .filter((row) => row[0] && row[1])
    .map((row) => [text(row[1]), text(row[0])]));
}

function locateTodayResultTargets(values, date, nameToId, sheetName) {
  const titleIndex = values.findIndex(([columnA, columnB]) => text(columnA).startsWith(date.label) && text(columnB) === 'DC');
  if (titleIndex < 0) throw new Error(`${date.label} DC block was not found in ${sheetName}.`);
  const nextBlockIndex = values.findIndex((row, index) => index > titleIndex
    && /^\d{1,2}\/\d{1,2}/.test(text(row[0]))
    && ['DC', 'feliz'].includes(text(row[1])));
  const endIndex = nextBlockIndex < 0 ? values.length : nextBlockIndex;
  const targets = [];
  for (let index = titleIndex + 1; index < endIndex; index += 1) {
    // 本日結果の担当者名は、各日のDCブロック内で対応表に一致する名前として
    // 特定する。これにより結合セルの見出しが空として返っても影響を受けない。
    const nameColumn = values[index].findIndex((cell) => nameToId.has(text(cell)));
    // 右側の本日結果エリアだけを対象にし、シフト表内の同名は除外する。
    if (nameColumn < 25) continue;
    const name = text(values[index][nameColumn]);
    targets.push({ row: index + 1, name, accountId: nameToId.get(name) });
  }
  if (!targets.length) throw new Error(`${date.label} DC block の本日結果に更新対象者が見つかりません。`);
  return targets;
}

async function updateSheet(metrics, hour, date) {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(required('GOOGLE_SERVICE_ACCOUNT_JSON')),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = required('SPREADSHEET_ID');
  const nameToId = await loadNameToId(sheets, spreadsheetId);
  const results = [];
  for (const sheetName of SHEET_NAMES) {
    const range = `'${sheetName}'!A:AJ`;
    const source = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const values = source.data.values ?? [];
    const target = locateTargetRow(values, date, hour, sheetName);
    const boxTarget = locateBoxTargetRow(values, date, hour, sheetName);
    const row = target.row;
    const boxRow = boxTarget.row;
    const sendHeaderRow = locateSendHeaderRow(values, date, sheetName);
    const sendRow = row;
    const todayResultTargets = locateTodayResultTargets(values, date, nameToId, sheetName);
    const todayResultWrites = todayResultTargets.map((target) => {
      const stats = metrics.accountSendStats.get(target.accountId);
      if (!stats) throw new Error(`${target.name} (${target.accountId}) の本日送信実績が管理画面にありません。`);
      return {
        range: `'${sheetName}'!AG${target.row}:AI${target.row}`,
        values: [[stats.interaction, stats.individual, stats.broadcast]],
      };
    });

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          ...(target.replaceTimeLabel ? [{ range: `'${sheetName}'!A${row}`, values: [[hour]] }] : []),
          ...(boxTarget.replaceTimeLabel ? [{ range: `'${sheetName}'!A${boxRow}`, values: [[hour]] }] : []),
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
          { range: `'${sheetName}'!K${sendHeaderRow}:P${sendHeaderRow}`, values: [['送信数', 'A', 'B', 'C', 'E', '全体']] },
          { range: `'${sheetName}'!L${sendRow}:P${sendRow}`, values: [[
            metrics.boxASend, metrics.boxBSend, metrics.boxCSend, metrics.boxESend, metrics.sendTotal,
          ]] },
          ...todayResultWrites,
        ],
      },
    });
    results.push({ sheetName, row, boxRow, sendRow, todayResultCount: todayResultTargets.length });
  }
  return results;
}

async function main() {
  const hour = reportHour();
  const date = reportDate(hour);
  const archiveClient = wrapper(axios.create({ jar: new CookieJar(), maxRedirects: 5, validateStatus: () => true }));
  const receiveMetrics = await fetchArchiveMetrics(archiveClient, sourceTimestamp(date, hour));
  const sendMetrics = await fetchReportMetrics(date, hour);
  const metrics = { ...receiveMetrics, ...sendMetrics };
  const updatedSheets = await updateSheet(metrics, hour, date);
  const destination = updatedSheets.map(({ sheetName, row, boxRow, sendRow, todayResultCount }) => `${sheetName}: row ${row}, box row ${boxRow}, send row ${sendRow}, today results ${todayResultCount}`).join('; ');
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
