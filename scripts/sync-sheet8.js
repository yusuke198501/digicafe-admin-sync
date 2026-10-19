import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import { google } from 'googleapis';
import { pathToFileURL } from 'node:url';
import { fetchClickCount } from './cats-clicks.js';

const BASE = 'https://log.digicafe.jp/partner/';
const SHEET = "'シート8'";
export function validateSnapshotDestination(sheets) {
  const sheet = sheets?.find(s => s.properties?.sheetId === 1467610996)?.properties;
  if (!sheet || sheet.title !== 'シート8' || sheet.gridProperties?.columnCount < 16) throw new Error('シート8の書き込み先を確認できません。');
}
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
export function maleReceiveUrl(date) {
  const day = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0,10) !== date) throw new Error('日付が不正です。');
  day.setUTCDate(day.getUTCDate() + 1);
  const url = new URL('http://log.digicafe.jp:8081/admin/data/user/mail');
  url.search = new URLSearchParams({sex:'0',type:'2',mail_start:date,mail_end:day.toISOString().slice(0,10),code:'',frm:'',created_at_start:`${date.slice(0,7)}-01`,created_at_end:date,sum:'集計'});
  return url.href;
}
export function parseMaleReceive(html, date) {
  const $ = cheerio.load(html);
  const q = new URL(maleReceiveUrl(date)).searchParams;
  const form = $('input[name="mail_start"]').closest('form');
  for (const name of ['mail_start','mail_end']) {
    if (form.find(`input[name="${name}"]`).attr('value') !== q.get(name)) throw new Error('男性受信の検索期間が一致しません。');
  }
  for (const [name,value] of [['sex','0'],['type','2']]) {
    if (form.find(`input[name="${name}"][value="${value}"][checked]`).length !== 1) throw new Error('男性・受信の条件が一致しません。');
  }
  if (form.find('input[name="is_create"][checked]').length) throw new Error('登録日を考慮する設定が有効です。');
  const candidates = [];
  for (const table of $('table').toArray()) {
    const rows = $(table).find('tr').toArray().map(r => $(r).children('th,td').toArray().map(c => compact($(c).text())));
    if (rows[0]?.[0] !== 'メール総数' || rows[0]?.[1] !== '人数' || rows.length !== 2) continue;
    candidates.push([number(rows[1][0].replace(/通$/, '')),number(rows[1][1].replace(/人$/, ''))]);
  }
  if (candidates.length !== 1) throw new Error('男性受信のメール総数・人数が一意に取得できません。');
  return candidates[0];
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
export function cohortMailUrl(date, previousMonth = false) {
  const day = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0,10) !== date) throw new Error('集計日が不正です。');
  const monthStart = new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),1));
  const priorStart = new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth()-1,1));
  const priorEnd = new Date(monthStart.getTime()-86400000);
  const url = new URL('mailnum_uf',BASE);
  url.search = new URLSearchParams({sex:'0',sort:'times',mail_start:date,mail_end:date,code:'',frm:'',created_at_start:(previousMonth?priorStart:monthStart).toISOString().slice(0,10),created_at_end:previousMonth?priorEnd.toISOString().slice(0,10):date,is_create:'1',disp_type:'',folder_rcv_source:'point',sum:'集計'});
  return url.href;
}
export function parseCohortMail(html) {
  const $ = cheerio.load(html);
  const tables = $('table').toArray().filter(t=>compact($(t).find('tr').first().text()) === '全体送信データ');
  if (tables.length !== 1) throw new Error('全体送信データの表が一意ではありません。');
  const rows=$(tables[0]).find('tr').toArray().map(r=>$(r).children('th,td').toArray().map(c=>compact($(c).text())));
  const index=rows.findIndex(r=>r.includes('メール総数')&&r.includes('メール人数'));
  if(index<0 || !rows[index+1]) throw new Error('全体送信データの集計行がありません。');
  return ['メール人数','メール総数'].map(label=>{
    const col=rows[index].indexOf(label);
    return number(rows[index+1][col].replace(/(?:人|通)$/,''));
  });
}
export async function metricOrZero(label, width, collect, warn = message => console.warn(message)) {
  try {
    const values = await collect();
    if (!Array.isArray(values) || values.length !== width || values.some(v => !Number.isSafeInteger(v) || v < 0)) throw new Error();
    return values;
  } catch {
    // Never print raw network errors: request configs may contain credentials.
    warn(`WARNING: ${label} の取得に失敗。${width}項目を0扱いとし、同日直前の記録値があれば補完します。`);
    return Array(width).fill(0);
  }
}
export function carryForwardZeros(row, previous, warn = message => console.warn(message)) {
  const result = [...row];
  if (!previous || !slot(String(previous[0])) || String(previous[0]).slice(0,10) !== String(row[0]).slice(0,10) || String(previous[0]) >= String(row[0])) return result;
  const copied = [];
  for (let i=1;i<result.length;i++) {
    if (result[i] === 0 && Number.isSafeInteger(previous[i]) && previous[i] >= 0) {
      result[i] = previous[i];
      if (previous[i] > 0) copied.push(String.fromCharCode(65+i));
    }
  }
  if (copied.length) warn(`WARNING: 取得値0のため同日直前 ${previous[0]} の値を補完: ${copied.join(',')}列`);
  return result;
}
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
  // A:P positions are fixed by agreement; display labels may be renamed.
  const metadata = await sheets.spreadsheets.get({spreadsheetId,fields:'sheets(properties(sheetId,title,gridProperties(columnCount)))'});
  validateSnapshotDestination(metadata.data.sheets);
  const timestamps = (await sheets.spreadsheets.values.get({spreadsheetId,range:`${SHEET}!A2:A`})).data.values ?? [];
  if (timestamps.slice(-100).some(r => slot(String(r[0])) === slot(timestamp))) { console.log('SKIPPED: snapshot for this 5-minute slot exists'); return; }
  let previous;
  for (let i=timestamps.length-1;i>=0;i--) {
    const candidate = String(timestamps[i][0]);
    if (!slot(candidate) || candidate >= timestamp) continue;
    if (candidate.slice(0,10) === date) {
      previous = (await sheets.spreadsheets.values.get({spreadsheetId,range:`${SHEET}!A${i+2}:P${i+2}`,valueRenderOption:'UNFORMATTED_VALUE'})).data.values?.[0];
    }
    break;
  }
  const client = wrapper(axios.create({jar:new CookieJar(),timeout:45000,headers:{'User-Agent':'Mozilla/5.0','Accept-Language':'ja-JP,ja;q=0.9'}}));
  // Do not log axios errors/configs: they can contain login credentials.
  async function get(url) {
    try {
      const r = await client.get(url);
      if (!String(r.data).includes('ログアウト') || cheerio.load(r.data)('input[type="password"]').length) throw new Error();
      return r.data;
    } catch { throw new Error('管理画面の取得または認証に失敗しました。'); }
  }
  let loggedIn = false;
  try {
    await client.get(BASE);
    const login = await client.post(BASE,new URLSearchParams({mode:'login',account:required('LOG_ACCOUNT'),pass:required('LOG_PASSWORD')}));
    if (!String(login.data).includes('ログアウト')) throw new Error();
    loggedIn = true;
  } catch { console.warn('WARNING: 管理画面へのログインに失敗。該当項目は同日直前値で補完し、独立した取得は続行します。'); }
  async function partnerGet(url) {
    if (!loggedIn) throw new Error('管理画面が未認証です。');
    return get(url);
  }
  const mailUrl = new URL('mailnum_uf', BASE);
  mailUrl.search = new URLSearchParams({sex:'1',sort:'times',mail_start:date,mail_end:date,created_at_start:date,created_at_end:date,folder_rcv_source:'point',sum:'集計'});
  // Independent metric groups run concurrently. One missing table, failed
  // request, or authentication failure cannot abort the remaining metrics.
  const formHtml = partnerGet(new URL('list', BASE).href).catch(()=>null);
  async function memberCount(type) {
    const html = await formHtml;
    if (!html) throw new Error('会員検索フォームがありません。');
    const url = new URL('list',BASE);
    url.search = memberQuery(html,date,type);
    return [parseMembers(await partnerGet(url.href))];
  }
  const ptUrl = new URL('status/pt',BASE);
  ptUrl.search = new URLSearchParams({action_start:date,action_end:date,created_at_start:date,created_at_end:date,sum:'集計'});
  // This endpoint has no partner navigation/logout link; validate its actual
  // form conditions and summary table instead. Never send credentials to it.
  const [[sent,received,broadcastSent,broadcastReceived],[senders],[logins],[payers,amount],[maleReceived,maleReceivers],[clicks],[currentDau,currentReceived],[priorDau,priorReceived]] = await Promise.all([
    metricOrZero('B/C/H/I 送受信・同報',4,async()=>parseInteractions(await partnerGet(mailUrl.href))),
    metricOrZero('D 送信ユーザー数',1,()=>memberCount('message_sent')),
    metricOrZero('E ログイン数',1,()=>memberCount('login')),
    metricOrZero('F/G 入金者数・入金額',2,async()=>parsePayers(await partnerGet(ptUrl.href),date)),
    metricOrZero('J/K 男性メール受信数・人数',2,async()=>{
      const response = await axios.get(maleReceiveUrl(date),{timeout:45000,headers:{'User-Agent':'Mozilla/5.0'}});
      return parseMaleReceive(response.data,date);
    }),
    metricOrZero('L 広告クリック数',1,async()=>[await fetchClickCount(timestamp,process.env.CATS_API_TOKEN)]),
    metricOrZero('M/N 当月DAU・受信数',2,async()=>parseCohortMail(await partnerGet(cohortMailUrl(date)))),
    metricOrZero('O/P 2ヶ月目DAU・受信数',2,async()=>parseCohortMail(await partnerGet(cohortMailUrl(date,true))))
  ]);
  if (!collectionWindowValid(start,new Date())) throw new Error('取得が4分以上経過、または日付が変わりました。追記しません。');
  const row = carryForwardZeros([timestamp,sent,received,senders,logins,payers,amount,broadcastSent,broadcastReceived,maleReceived,maleReceivers,clicks,currentDau,currentReceived,priorDau,priorReceived],previous);
  const result = await sheets.spreadsheets.values.append({spreadsheetId,range:`${SHEET}!A:P`,valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',requestBody:{values:[row]}});
  const range = result.data.updates?.updatedRange;
  if (!range) throw new Error('追記結果の範囲がありません。');
  const read = (await sheets.spreadsheets.values.get({spreadsheetId,range,valueRenderOption:'UNFORMATTED_VALUE'})).data.values;
  if (JSON.stringify(read?.[0]) !== JSON.stringify(row)) throw new Error('追記後の照合に失敗しました。');
  console.log(JSON.stringify({range,row}));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
