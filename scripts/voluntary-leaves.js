import axios from 'axios';
import * as cheerio from 'cheerio';

export const LEAVE_CACHE_SHEET = '_退会毎時キャッシュ';
export function leaveUrl(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('退会検索の日付が不正です。');
  const url = new URL('http://log.digicafe.jp:8081/admin/data/user/leave');
  url.search = new URLSearchParams({ start: date, end: date, sex: '0', created_at_start: date, created_at_end: date, code: '', frm: '', sum: '集計' });
  return url.href; // No is_create: registration date must not restrict departures.
}

export function parseVoluntaryLeaves(html, timestamp) {
  const date = timestamp.slice(0, 10), $ = cheerio.load(html);
  const compact = (s) => String(s).replace(/\s/g, '');
  const form = $('input[name="start"]').closest('form');
  if (form.length !== 1 || form.find('input[name="start"]').val() !== date
    || form.find('input[name="end"]').val() !== date
    || form.find('input[name="sex"][value="0"]:checked').length !== 1
    || form.find('input[name="is_create"]:checked').length
    || form.find('[name="code"]').val() || form.find('[name="frm"]').val()) throw new Error('男性退会の検索条件が一致しません。');
  const tables = $('table').toArray();
  const summary = tables.find((t) => compact($(t).find('tr').first().text()) === '総数男性女性年認済課金者(男性のみ)');
  const totals = summary && $(summary).find('tr').eq(1).children('td,th').toArray().map((c) => compact($(c).text()).replace(/人$/, '').replaceAll(',', ''));
  if (!totals || totals.length !== 5 || totals.some((v) => !/^\d+$/.test(v))) throw new Error('退会者総数が確認できません。');
  const [total, males, females] = totals.map(Number);
  if (males !== total || females !== 0) throw new Error('男性のみの退会表ではありません。');
  const table = tables.find((t) => $(t).find('tr').first().children('td,th').toArray().some((c) => compact($(c).text()) === '自or強'));
  if (!table) throw new Error('自主・強制の退会明細がありません。');
  const rows = $(table).find('tr').toArray().map((r) => $(r).children('td,th').toArray().map((c) => $(c).text().trim()));
  const header = rows.shift().map(compact);
  const indexes = ['ユーザID', '退会日', '性別', '自or強'].map((label) => header.indexOf(label));
  if (indexes.some((i) => i < 0) || new Set(header).size !== header.length) throw new Error('退会明細の見出しが不正です。');
  if (rows.length !== total) throw new Error('退会明細と総数が一致しません。省略・ページ分割の可能性があります。');
  let count = 0;
  const ids = new Set();
  for (const row of rows) {
    const [idCol, dateCol, sexCol, typeCol] = indexes;
    const id = row[idCol]?.match(/^\d+/)?.[0], leftAt = row[dateCol];
    if (!id || ids.has(id) || row[sexCol] !== '男' || !['自主', '強制'].includes(row[typeCol])
      || !/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(leftAt) || leftAt.slice(0, 10) !== date) throw new Error('退会明細の日時・性別・重複を確認できません。');
    ids.add(id);
    if (row[typeCol] === '自主' && leftAt <= timestamp) count++;
  }
  return count;
}

export async function fetchVoluntaryLeaves(timestamp) {
  try {
    // Anonymous endpoint: no credentials or partner cookies are sent to HTTP.
    const response = await axios.get(leaveUrl(timestamp.slice(0, 10)), { timeout: 90000, maxRedirects: 0, headers: { 'User-Agent': 'Mozilla/5.0' } });
    return parseVoluntaryLeaves(response.data, timestamp);
  } catch { throw new Error('男性自主退会数の取得または検索条件の検証に失敗しました。'); }
}

export async function hourlyVoluntaryLeaves(sheets, spreadsheetId, timestamp, fetcher = fetchVoluntaryLeaves) {
  const range = `'${LEAVE_CACHE_SHEET}'!A2:B2`;
  const cache = (await sheets.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values?.[0];
  if (typeof cache?.[0] === 'string' && cache[0].slice(0, 13) === timestamp.slice(0, 13)
    && cache[0] <= timestamp && Number.isSafeInteger(cache[1]) && cache[1] >= 0) return cache[1];
  let count;
  try { count = await fetcher(timestamp); }
  catch {
    count = typeof cache?.[0] === 'string' && cache[0].slice(0, 10) === timestamp.slice(0, 10)
      && cache[0] < timestamp && Number.isSafeInteger(cache[1]) && cache[1] >= 0 ? cache[1] : 0;
    console.warn('WARNING: X 男性自主退会数の毎時取得に失敗。同日直前値（なければ0）を使用し、次の時間に再取得します。');
  }
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('自主退会数が不正です。');
  await sheets.spreadsheets.values.update({ spreadsheetId, range, valueInputOption: 'RAW', requestBody: { values: [[timestamp, count]] } });
  console.log(JSON.stringify({ voluntaryLeaves: { timestamp, count, interval: 'hourly' } }));
  return count;
}
