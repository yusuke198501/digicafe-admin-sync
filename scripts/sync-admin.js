import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import { google } from 'googleapis';

const BASE_URL = 'https://admin.digicafe.jp/dadmin.php/';
const LOGIN_URL = 'https://admin.digicafe.jp/dadmin.php/login';
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const MALE_SHEET_NAME = '男性日データ';
const FEMALE_SHEET_NAME = '女性日データ';

const labels = [
  '男性売上',
  '男性新規購入者数',
  '男性ログイン人数',
  '男性購入者数',
  '男性オモテメール送信数',
  '男性ウラメール送信数',
  '男性メール送信ユーザ数',
  '有料男性ログイン人数',
  '有料男性メール送信人数',
];

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
  'Accept-Language': 'ja-JP,ja;q=0.9',
};

function jstYesterday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const part = (type) => parts.find((value) => value.type === type).value;
  const date = new Date(Date.UTC(
    Number(part('year')),
    Number(part('month')) - 1,
    Number(part('day')),
  ));
  date.setUTCDate(date.getUTCDate() - 1);

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    text: `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
  };
}

function normalize(value) {
  return String(value ?? '').replace(/\s/g, '').replace(/-/g, '/');
}

// 26/8/13(水) / 2026-08-13 / 2026/08/13 / 2026/8/13 をすべて 2026/8/13 に統一する
function dateKey(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/(\d{2,4})\D+(\d{1,2})\D+(\d{1,2})/);

  if (match) {
    const rawYear = Number(match[1]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    return `${year}/${Number(match[2])}/${Number(match[3])}`;
  }

  return normalize(text);
}

function toNumber(value) {
  const matched = String(value).match(/-?[\d,]+/);
  if (!matched) throw new Error(`数値を読めません: ${value}`);
  return Number(matched[0].replace(/,/g, ''));
}

async function login(client) {
  const initial = await client.get(BASE_URL, { headers });
  const $ = cheerio.load(initial.data);
  const csrf = $('input[name="signin[_csrf_token]"]').attr('value');

  if (!csrf) {
    throw new Error('ログイン画面のCSRFトークンを取得できません。');
  }

  const form = new URLSearchParams({
    'signin[username]': process.env.ADMIN_DIGICAFE_USERNAME,
    'signin[password]': process.env.ADMIN_DIGICAFE_PASSWORD,
    'signin[remember]': 'on',
    'signin[_csrf_token]': csrf,
  });

  const response = await client.post(LOGIN_URL, form, {
    headers: {
      ...headers,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    maxRedirects: 0,
    validateStatus: (status) => [200, 301, 302, 303].includes(status),
  });

  if (![200, 301, 302, 303].includes(response.status)) {
    throw new Error(`ログイン失敗: HTTP ${response.status}`);
  }
}

async function fetchMetrics(client, target) {
  const ids = [6, 7, 15, 21, 143, 144, 173, 176, 183];

  const query = new URLSearchParams({
    year: String(target.year),
    month: String(target.month),
    filter: '検索',
  });

  ids.forEach((id) => query.append('associated_items[]', String(id)));

  const url = `https://admin.digicafe.jp/dadmin.php/ak_stats_item/analytics_month?${query}`;
  const response = await client.get(url, { headers });

  if (response.status !== 200) {
    throw new Error(`分析表の取得失敗: HTTP ${response.status}`);
  }

  const $ = cheerio.load(response.data);

  for (const table of $('table').toArray()) {
    const rows = $(table).find('tr').toArray();

    for (let headerIndex = 0; headerIndex < rows.length; headerIndex += 1) {
      const headerCells = $(rows[headerIndex])
        .find('th,td')
        .toArray()
        .map((cell) => normalize($(cell).text()));

      const indices = labels.map((label) => headerCells.indexOf(normalize(label)));

      if (indices.some((index) => index < 0)) continue;

      for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
        const cells = $(rows[rowIndex])
          .find('th,td')
          .toArray()
          .map((cell) => $(cell).text().trim());

        if (dateKey(cells[0]) !== target.text) continue;

        return indices.map((index) => toNumber(cells[index]));
      }
    }
  }

  throw new Error(`${target.text} の男性日データが見つかりません。`);
}

async function fetchFemaleMetrics(client, target) {
  const ids = [16, 231, 78, 238, 79, 239, 172, 285, 286, 287];
  const query = new URLSearchParams({
    year: String(target.year),
    month: String(target.month),
    filter: '検索',
  });
  ids.forEach((id) => query.append('associated_items[]', String(id)));

  const url = `https://admin.digicafe.jp/dadmin.php/ak_stats_item/analytics_month?${query}`;
  const response = await client.get(url, { headers });
  if (response.status !== 200) {
    throw new Error(`女性日データ用の分析表取得に失敗しました: HTTP ${response.status}`);
  }

  return parseDailyValuesInSelectedOrder(response.data, target, ids.length, '女性日データ');
}

/**
 * associated_items の指定順で表示される日別表から、対象日の値を取り出す。
 * 女性日データは「全体」「UF除」のペアを含む10項目を、B〜K列へ同じ順で書き込む。
 */
function parseDailyValuesInSelectedOrder(html, target, itemCount, dataName) {
  const $ = cheerio.load(html);

  for (const table of $('table').toArray()) {
    for (const row of $(table).find('tr').toArray()) {
      const cells = $(row).children('th,td').toArray()
        .map((cell) => $(cell).text().trim());

      if (cells.length < itemCount + 1 || dateKey(cells[0]) !== target.text) continue;
      return cells.slice(1, itemCount + 1).map((value) => toNumber(value));
    }
  }

  throw new Error(`${target.text} の${dataName}が見つかりません。`);
}

async function updateSheet(target, values, sheetName, endColumn, copyStartColumnIndex, copyStartColumnLabel) {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({
    version: 'v4',
    auth,
  });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A:A`,
  });

  const rowIndex = (response.data.values ?? [])
    .findIndex(([value]) => dateKey(value) === target.text);

  if (rowIndex < 0) {
    throw new Error(`${sheetName}のA列に ${target.text} がありません。`);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!B${rowIndex + 1}:${endColumn}${rowIndex + 1}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [values],
    },
  });

  await copyFormulasFromPreviousRow(
    sheets,
    sheetName,
    rowIndex,
    copyStartColumnIndex,
    copyStartColumnLabel,
  );
}

async function copyFormulasFromPreviousRow(
  sheets,
  sheetName,
  targetRowIndex,
  startColumnIndex,
  startColumnLabel,
) {
  if (targetRowIndex === 0) {
    throw new Error(`先頭行には直上行がないため、${startColumnLabel}〜S列をコピーできません。`);
  }

  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties(sheetId,title)',
  });
  const sheet = spreadsheet.data.sheets
    .find((item) => item.properties.title === sheetName);

  if (!sheet) throw new Error(`${sheetName}のシートIDを取得できません。`);

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        copyPaste: {
          source: {
            sheetId: sheet.properties.sheetId,
            startRowIndex: targetRowIndex - 1,
            endRowIndex: targetRowIndex,
            startColumnIndex,
            endColumnIndex: 19, // S列の次
          },
          destination: {
            sheetId: sheet.properties.sheetId,
            startRowIndex: targetRowIndex,
            endRowIndex: targetRowIndex + 1,
            startColumnIndex,
            endColumnIndex: 19,
          },
          // 数式に加えて、%表示などの表示形式・セル書式も直上行から複製する。
          pasteType: 'PASTE_NORMAL',
          pasteOrientation: 'NORMAL',
        },
      }],
    },
  });
}

async function main() {
  const target = jstYesterday();

  const client = wrapper(axios.create({
    jar: new CookieJar(),
    validateStatus: () => true,
  }));

  await login(client);

  const maleValues = await fetchMetrics(client, target);
  await updateSheet(target, maleValues, MALE_SHEET_NAME, 'J', 11, 'L');

  const femaleValues = await fetchFemaleMetrics(client, target);
  await updateSheet(target, femaleValues, FEMALE_SHEET_NAME, 'K', 12, 'M');

  console.log(`${target.text} の男性日データ・女性日データを更新しました。`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
