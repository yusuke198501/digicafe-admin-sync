import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import { google } from 'googleapis';
import { pathToFileURL } from 'node:url';

const BASE = 'https://log.digicafe.jp/partner/';
const SHEET = "'シート8'";
const HEADERS = ['日時', '送信数', '受信数', '送信ユーザー数', 'ログイン数', '入金者数', '入金額', '同報送信数', '同報受信'];
const compact = (s) => String(s ?? '').replace(/\s/g, '');
function number(s) {
  const value = compact(s).replace(/,/g, '');
  if (!/^\d+$/.test(value)) throw new Error('集計値が整数ではありません。書き込みを中止します。');
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('集計値が範囲外です。');
  return n;
}
export function jstTimestamp(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
}
export function slot(timestamp) {
  if (!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(timestamp)) return null;
  return timestamp.slice(0, 14) + String(Math.floor(Number(timestamp.slice(14, 16)) / 5) * 5).padStart(2, '0');
}
export function collectionWindowValid(start, end) {
  return end >= start && end - start < 240000 && jstTimestamp(start).slice(0,10) === jstTimestamp(end).slice(0,10);
}
export function parseInteractions(html) {
  const $ = cheerio.load(html);
  const title = 'UF_MKT系データ(ログインアカウント別/時間毎)';
  const h = $('h1,h2,h3,h4,h5,h6').toArray().find(e => compact($(e).text()) === title);
  if (!h) throw new Error('時間毎のログインアカウント別表がありません。');
  let table;
  for (const e of $(h).nextAll().toArray()) {
    if (/^h[1-6]$/i.test(e.tagName)) break;
    const candidate = $(e).is('table') ? $(e) : $(e).find('table').first();
    if (candidate.length) { table = candidate; break; }
  }
  if (!table) throw new Error('時間毎表を取得できません。');
  const rows = table.find('tr').toArray().map(r => $(r).children('th,td').toArray().map(c => compact($(c).text())));
  const metricIndexes = [0, 1, 5, 6];
  const expectedMetrics = ['やり取り送信', 'やり取り受信', '同報配信', '同報受信'];
  if (rows[0]?.[1] !== '全体' || metricIndexes.some((index, i) => rows[1]?.[index] !== expectedMetrics[i])) {
    throw new Error('全体・送受信の列配置が変わりました。');
  }
  const total = rows.filter(r => r[0] === '合計');
  const hours = rows.filter(r => /^\d+時$/.test(r[0]));
  if (total.length !== 1 || hours.length !== 24 || new Set(hours.map(r => r[0])).size !== 24) throw new Error('時間別24行または合計が不正です。');
  const result = metricIndexes.map(index => number(total[0][index + 1]));
  const sums = hours.reduce((a, r) => metricIndexes.map((index,i) => a[i] + number(r[index + 1])), [0, 0, 0, 0]);
  if (result.some((v, i) => v !== sums[i])) throw new Error('時間毎合計と合計行が一致しません。');
  return result;
}
export function parsePayers(html, date) {
  const $ = cheerio.load(html);
  for (const table of $('table').toArray()) {
    const rows = $(table).find('tr').toArray().map(r => $(r).children('th,td').toArray().flatMap(c => Array(Number($(c).attr('colspan') || 1)).fill(compact($(c).text()))));
    const groups = rows.find(r => r.includes('有料男性'));
    const header = rows.find(r => r.includes('日時') && r.includes('課金者数'));
    const data = rows.filter(r => r[0]?.replaceAll('/', '-') === date);
    if (!groups || !header || data.length !== 1) continue;
    const indexes = ['課金者数', '売上'].map(label => header.map((v, i) => v === label && groups[i] === '有料男性' ? i : -1).filter(i => i >= 0));
    if (indexes.some(a => a.length !== 1)) throw new Error('有料男性の入金列が一意ではありません。');
    return indexes.map(a => number(data[0][a[0]]));
  }
  throw new Error('対象日の有料男性入金データがありません。');
}
export function parseMembers(html) {
  const $ = cheerio.load(html);
  const match = $.root().text().match(/抽出件数\s*([\d,]+)\s*件/);
  if (!match) throw new Error('会員一覧の抽出件数が取得できません。');
  const count = number(match[1]);
  if (count >= 10000) throw new Error('会員一覧の上限に達しています。');
  return count;
}
export function memberQuery(html, date, type) {
  const $ = cheerio.load(html);
  const form = $('input[name="sum"]').closest('form');
  if (form.length !== 1 || !form.find('input[name="message_sent_start"]').length) throw new Error('会員検索フォームが変わりました。');
  const q = new URLSearchParams();
  form.find('input[name],select[name]').each((_, e) => {
    const input = $(e), name = input.attr('name'), t = input.attr('type');
    if (input.is('[disabled]') || ['button','file','reset'].includes(t)) return;
    if (['checkbox','radio'].includes(t) && !input.is('[checked]')) return;
    const value = input.is('select') ? input.val() : input.attr('value') ?? '';
    for (const v of Array.isArray(value) ? value : [value]) q.append(name, v ?? '');
  });
  for (const name of ['regist','login','paid','used','message_sent']) {
    q.set(`${name}_start`, ''); q.set(`${name}_end`, '');
  }
  q.set('mode','1'); q.set('sex','0'); q.set('is_paying','1'); q.set('is_confirmed_identity','0');
  q.set(`${type}_start`, date); q.set(`${type}_end`, date);
  q.set('sum','この条件で集計');
  return q;
}
function required(name) { if (!process.env[name]) throw new Error(`${name} is missing`); return process.env[name]; }
async function main() {
  const start = new Date(), timestamp = jstTimestamp(start), date = timestamp.slice(0,10);
  // Old queued dispatches must not manufacture historical snapshots.
  if (process.env.GITHUB_RUN_ID && process.env.GITHUB_TOKEN) {
    const r = await fetch(`https://api.github.com/repos/${required('GITHUB_REPOSITORY')}/actions/runs/${process.env.GITHUB_RUN_ID}`, {headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`}});
    if (!r.ok) throw new Error('起動時刻を確認できません。');
    const run = await r.json(), lag = start - new Date(run.created_at);
    if (!Number.isFinite(lag)) throw new Error('起動時刻が不正です。');
    if (lag >= 300000) { console.log('SKIPPED: dispatch delayed 5+ minutes'); return; }
  }
  const sheets = google.sheets({version:'v4',auth:new google.auth.GoogleAuth({credentials:JSON.parse(required('GOOGLE_SERVICE_ACCOUNT_JSON')),scopes:['https://www.googleapis.com/auth/spreadsheets']})});
  const spreadsheetId = required('SPREADSHEET_ID');
  const header = (await sheets.spreadsheets.values.get({spreadsheetId,range:`${SHEET}!A1:I1`})).data.values?.[0];
  if (!header || HEADERS.some((h,i)=>h !== header[i])) throw new Error('シート8の見出しが一致しません。');
  const timestamps = (await sheets.spreadsheets.values.get({spreadsheetId,range:`${SHEET}!A2:A`})).data.values ?? [];
  if (timestamps.slice(-100).some(r => slot(String(r[0])) === slot(timestamp))) { console.log('SKIPPED: snapshot for this 5-minute slot exists'); return; }
  const client = wrapper(axios.create({jar:new CookieJar(),timeout:45000,headers:{'User-Agent':'Mozilla/5.0','Accept-Language':'ja-JP,ja;q=0.9'}}));
  // Do not log axios errors/configs: they can contain login credentials.
  async function get(url) {
    try {
      const r = await client.get(url);
      if (!String(r.data).includes('ログアウト') || cheerio.load(r.data)('input[type="password"]').length) throw new Error();
      return r.data;
    } catch { throw new Error('管理画面の取得または認証に失敗しました。'); }
  }
  try {
    await client.get(BASE);
    const login = await client.post(BASE,new URLSearchParams({mode:'login',account:required('LOG_ACCOUNT'),pass:required('LOG_PASSWORD')}));
    if (!String(login.data).includes('ログアウト')) throw new Error();
  } catch { throw new Error('管理画面へのログインに失敗しました。'); }
  const mailUrl = new URL('mailnum_uf', BASE);
  mailUrl.search = new URLSearchParams({sex:'1',sort:'times',mail_start:date,mail_end:date,created_at_start:date,created_at_end:date,folder_rcv_source:'point',sum:'集計'});
  const [sent,received,broadcastSent,broadcastReceived] = parseInteractions(await get(mailUrl.href));
  const formHtml = await get(new URL('list', BASE).href);
  const listUrl = new URL('list', BASE);
  listUrl.search = memberQuery(formHtml,date,'message_sent');
  const senders = parseMembers(await get(listUrl.href));
  listUrl.search = memberQuery(formHtml,date,'login');
  const logins = parseMembers(await get(listUrl.href));
  const ptUrl = new URL('status/pt',BASE);
  ptUrl.search = new URLSearchParams({action_start:date,action_end:date,created_at_start:date,created_at_end:date,sum:'集計'});
  const [payers,amount] = parsePayers(await get(ptUrl.href),date);
  if (!collectionWindowValid(start,new Date())) throw new Error('取得が4分以上経過、または日付が変わりました。追記しません。');
  const row = [timestamp,sent,received,senders,logins,payers,amount,broadcastSent,broadcastReceived];
  const result = await sheets.spreadsheets.values.append({spreadsheetId,range:`${SHEET}!A:I`,valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',requestBody:{values:[row]}});
  const range = result.data.updates?.updatedRange;
  if (!range) throw new Error('追記結果の範囲がありません。');
  const read = (await sheets.spreadsheets.values.get({spreadsheetId,range,valueRenderOption:'UNFORMATTED_VALUE'})).data.values;
  if (JSON.stringify(read?.[0]) !== JSON.stringify(row)) throw new Error('追記後の照合に失敗しました。');
  console.log(JSON.stringify({range,row}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
