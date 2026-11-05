import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import { google } from 'googleapis';
import { pathToFileURL } from 'node:url';
import { networkRetry } from './network-retry.js';

const BASE = 'https://mkt.feliznet.jp/';
const WORK = new URL('admin/access_log/message_log', BASE).href;
const ACTION = new URL('admin/access_log/admin_action', BASE).href;
const norm = (s) => String(s ?? '').replace(/\s/g, '');
const number = (s) => {
  const v = String(s).replaceAll(',', '').trim();
  if (!/^\d+$/.test(v)) throw new Error('Feliz: 件数が数値ではありません。');
  return Number(v);
};
function required(name) {
  if (!process.env[name]) throw new Error(`${name} must be configured.`);
  return process.env[name];
}
export function jstDate(now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t) => p.find((x) => x.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
const timeJst = () => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
function page(html, date, dateTime = false) {
  const $ = cheerio.load(html);
  if ($('input[type=password]').length) throw new Error('Feliz: ログインが必要です。');
  const start = $('#search_tarm1').val();
  const end = $('#search_tarm2').val();
  if (start !== `${date}${dateTime ? 'T00:00' : ''}` || end !== `${date}${dateTime ? 'T23:59' : ''}`) {
    throw new Error('Feliz: 取得元の対象日が一致しません。');
  }
  return $;
}
function rows($, t) { return $(t).find('tr').toArray().map((r) => $(r).children('th,td').toArray().map((c) => $(c).text().trim())); }
export function parseMessages(html, date) {
  const $ = page(html, date);
  const table = $('table').toArray().find((t) => norm(rows($, t)[0]?.[1]) === '送信合計');
  if (!table) throw new Error('Feliz: 作業量集計の表がありません。');
  const all = rows($, table), header = all[0], last = all.at(-1);
  if (norm(last[0]) !== '合計' || last.length !== header.length) throw new Error('Feliz: 作業量集計の合計行が不正です。');
  const result = new Map();
  for (let c = 2; c < header.length; c++) {
    const id = header[c];
    if (!id || result.has(id)) throw new Error('Feliz: 担当者IDが空または重複しています。');
    result.set(id, number(last[c]));
  }
  const sum = [...result.values()].reduce((a,b) => a+b, 0);
  if (sum !== number(last[1])) throw new Error('Feliz: 送信数の合計が一致しません。');
  return result;
}
export function parseActions(html, date, action, label) {
  const $ = page(html, date, true);
  if ($('#admin_action').val() !== action || $('#admin_id').val() !== '0') throw new Error('Feliz: アクション検索条件が一致しません。');
  if ($('body').text().includes('検索結果が0件です') && !$('table').length) return new Map();
  const table = $('table').toArray().find((t) => rows($, t)[0]?.slice(0,3).join('|') === 'アクション|ID|件数');
  if (!table) throw new Error('Feliz: アクション集計結果がありません。');
  const result = new Map(); let total = null;
  for (const r of rows($, table).slice(1)) {
    if (!r.some(Boolean)) continue;
    if (!r[3]?.includes(`${date} 00:00:00`) || !r[3]?.includes(`${date} 23:59:00`)) throw new Error('Feliz: アクション集計期間が不正です。');
    if (r[0] === '合計') { if (total !== null) throw new Error('Feliz: 合計が重複しています。'); total = number(r[2]); continue; }
    if (r[0] !== label || !r[1] || result.has(r[1])) throw new Error('Feliz: アクションまたは担当者が不正です。');
    result.set(r[1], number(r[2]));
  }
  if (total === null || total !== [...result.values()].reduce((a,b) => a+b,0)) throw new Error('Feliz: アクション合計が一致しません。');
  return result;
}
function form(html, selector, url, replacements = {}) {
  const $ = cheerio.load(html), f = $(selector).closest('form');
  if (f.length !== 1) throw new Error('Feliz: 検索・ログインフォームがありません。');
  const action = new URL(f.attr('action') || url, url);
  if (action.origin !== new URL(BASE).origin) throw new Error('Feliz: フォームの送信先が不正です。');
  const body = new URLSearchParams();
  f.find('input,select').each((_, el) => {
    const e = $(el), name = e.attr('name');
    if (!name || ['submit','button'].includes(e.attr('type'))) return;
    if (['checkbox','radio'].includes(e.attr('type')) && !e.is(':checked')) return;
    body.set(name, e.val() ?? '');
  });
  for (const [k,v] of Object.entries(replacements)) body.set(k,v);
  return { url: action.href, body };
}
export async function fetchFelizMetrics(date) {
  const account = required('FELIZ_ACCOUNT'), password = required('FELIZ_PASSWORD');
  const client = wrapper(axios.create({ jar: new CookieJar(), withCredentials: true, timeout: 60000, family: 4,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'ja-JP,ja;q=0.9' },
  }));
  const request = async (label, op) => {
    try { return await networkRetry(`Feliz: ${label}`, op, { attempts: 3 }); }
    catch (error) {
      const status = error.response?.status;
      // Never print Axios config/body: they contain the login password.
      throw new Error(`Feliz: ${label} failed (${Number.isInteger(status) ? `HTTP ${status}` : 'network error'})`);
    }
  };
  const login = await request('login page', () => client.get(BASE));
  const loginForm = form(login.data, 'input[type=password]', BASE, { account, pass: password });
  await request('login', () => client.post(loginForm.url, loginForm.body));
  const workPage = await request('work form', () => client.get(WORK));
  const workForm = form(workPage.data, '#search_tarm1', WORK, { search_tarm1: date, search_tarm2: date });
  const work = await request('work totals', () => client.post(workForm.url, workForm.body));
  const messages = parseMessages(work.data, date);
  const actionPage = await request('action form', () => client.get(ACTION));
  const actions = [];
  for (const [code,label] of [['send_message_appeal','手動メッセージ付きいいね送信'],['send_appeal','手動いいね送信']]) {
    const actionForm = form(actionPage.data, '#search_tarm1', ACTION, { search_tarm1: `${date}T00:00`, search_tarm2: `${date}T23:59`, admin_action: code, admin_id: '0' });
    const result = await request(label, () => client.post(actionForm.url, actionForm.body));
    actions.push(parseActions(result.data, date, code, label));
  }
  for (const a of actions) for (const id of a.keys()) if (!messages.has(id)) throw new Error('Feliz: 作業量集計に存在しない担当者IDがあります。');
  return { date, fetchedTime: timeJst(), accounts: new Map([...messages].map(([id,n]) => [id, [n, actions[0].get(id) ?? 0, actions[1].get(id) ?? 0]])) };
}
export function buildFelizWrites(values, mapping, metrics, sheetName = '目標＆振分') {
  const label = `${Number(metrics.date.slice(5,7))}/${Number(metrics.date.slice(8,10))}`;
  const starts = values.flatMap((r,i) => norm(r[0]).startsWith(`${label}(`) && norm(r[1]).toLowerCase() === 'feliz' ? [i] : []);
  if (starts.length !== 1) throw new Error('Feliz: 対象日のブロックを一意に特定できません。');
  const start = starts[0], next = values.findIndex((r,i) => i > start && /^\d{1,2}\/\d{1,2}\(/.test(norm(r[0])) && ['dc','feliz'].includes(norm(r[1]).toLowerCase()));
  const end = next < 0 ? values.length : next;
  if (norm(values[start][48]) !== '本日結果' || ['送信','MSG付いいね','いいね'].some((h,i) => norm(values[start+2]?.[48+i]) !== h)) throw new Error('Feliz: AW～AYの本日結果見出しが一致しません。');
  const names = new Map();
  for (const r of mapping) if (r[0] && r[1]) { const name = norm(r[1]); if (names.has(name)) throw new Error('Feliz: 対応表の名前が重複しています。'); names.set(name, norm(r[0])); }
  const writes = [], seen = new Set();
  for (let i = start+4; i < end; i++) {
    const name = norm(values[i]?.[51]); if (!name || ['実本数','升シフト','理想升シフト'].includes(name)) continue;
    const id = names.get(name); if (!id || seen.has(id) || !metrics.accounts.has(id)) throw new Error('Feliz: 担当者のIDまたは取得実績が見つかりません。');
    const counts = metrics.accounts.get(id); if (counts.length !== 3 || counts.some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('Feliz: 書込数値が不正です。');
    seen.add(id); writes.push({ range: `'${sheetName}'!AW${i+1}:AY${i+1}`, values: [counts] });
  }
  if (!writes.length) throw new Error('Feliz: 更新対象者がいません。');
  writes.push({ range: `'${sheetName}'!AW${start+2}`, values: [[metrics.fetchedTime]] });
  return writes;
}
export async function main() {
  const date = jstDate();
  const metrics = await fetchFelizMetrics(date);
  if (jstDate() !== date) throw new Error('Feliz: 取得中に日付が変わったため書き込みません。');
  const auth = new google.auth.GoogleAuth({ credentials: JSON.parse(required('GOOGLE_SERVICE_ACCOUNT_JSON')), scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth }), spreadsheetId = required('SPREADSHEET_ID');
  const read = (range) => sheets.spreadsheets.values.get({ spreadsheetId, range });
  const metadata = (await sheets.spreadsheets.get({spreadsheetId,fields:'sheets.properties(title,gridProperties(rowCount,columnCount))'})).data;
  const target = metadata.sheets.find(s=>s.properties.title==='目標＆振分')?.properties;
  const mapSheet = metadata.sheets.find(s=>s.properties.title==='マケ画面アカウント対応表')?.properties;
  if (!target || !mapSheet || target.gridProperties.columnCount < 52) throw new Error('Feliz: 更新先または対応表がありません。');
  const sourceRange = `'目標＆振分'!A1:AZ${target.gridProperties.rowCount}`;
  const source = (await read(sourceRange)).data.values ?? [];
  const mapping = (await read(`'マケ画面アカウント対応表'!E3:F${mapSheet.gridProperties.rowCount}`)).data.values ?? [];
  const writes = buildFelizWrites(source, mapping, metrics);
  const recheck = (await read(sourceRange)).data.values ?? [];
  if (JSON.stringify(buildFelizWrites(recheck,mapping,metrics)) !== JSON.stringify(writes) || jstDate() !== date) throw new Error('Feliz: 対象行・日付が変更されたため書き込みません。');
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId, requestBody: { valueInputOption: 'RAW', data: writes } });
  const verified = (await sheets.spreadsheets.values.batchGet({spreadsheetId,ranges:writes.map(w=>w.range),valueRenderOption:'UNFORMATTED_VALUE'})).data.valueRanges;
  if (verified.length !== writes.length || verified.some((r,i)=>JSON.stringify(r.values)!==JSON.stringify(writes[i].values))) throw new Error('Feliz: 書き込み後の照合に失敗しました。');
  console.log(`Feliz ${date} today results updated: people=${writes.length-1}, fetched_at=${metrics.fetchedTime}; totals=${JSON.stringify([...metrics.accounts.values()].reduce((s,r)=>s.map((v,i)=>v+r[i]),[0,0,0]))}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { if (error.message?.startsWith('Feliz:') || /^FELIZ_\w+ must be configured\.$/.test(error.message)) console.error(error.message); console.error('Feliz本日結果更新に失敗しました。認証設定・集計画面・対象行を確認してください。取得失敗時は既存値と取得時刻を保持します。'); process.exitCode = 1; });
