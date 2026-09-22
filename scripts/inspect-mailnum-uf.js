import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import * as cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';

const LOGIN_URL = 'https://log.digicafe.jp/partner/';
const REPORT_URL = 'https://log.digicafe.jp/partner/mailnum_uf';

function jstToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function login() {
  const client = wrapper(axios.create({ jar: new CookieJar(), maxRedirects: 5, validateStatus: () => true }));
  await client.get(LOGIN_URL);
  const form = new URLSearchParams({
    mode: 'login', account: process.env.LOG_ACCOUNT, pass: process.env.LOG_PASSWORD,
  });
  const response = await client.post(LOGIN_URL, form, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (response.status !== 200 || !String(response.data).includes('ログアウト')) {
    throw new Error('管理画面にログインできませんでした。');
  }
  return client;
}

function rows($, table) {
  return $(table).find('tr').toArray().map((row) => $(row).children('th,td').toArray()
    .map((cell) => $(cell).text().replace(/\s+/g, ' ').trim())
    .filter(Boolean));
}

function tableFor($, label) {
  const heading = $('h1,h2,h3,h4,h5,h6').toArray()
    .find((element) => $(element).text().replace(/\s+/g, ' ').includes(label));
  if (!heading) throw new Error(`表題「${label}」が見つかりません。`);
  const table = $(heading).nextAll('table').first();
  if (!table.length) throw new Error(`表題「${label}」の表が見つかりません。`);
  return table;
}

async function main() {
  const day = process.env.REPORT_DATE || jstToday();
  const client = await login();
  const query = new URLSearchParams({
    sex: '1', sort: 'times', mail_start: day, mail_end: day,
    code: '', frm: '', created_at_start: day, created_at_end: day,
    disp_type: '', folder_rcv_source: 'point', sum: '集計',
  });
  const response = await client.get(`${REPORT_URL}?${query}`);
  const $ = cheerio.load(response.data);
  for (const label of ['全体受信データ', 'UF_MKT系データ(フォルダ別/日毎)']) {
    console.log(`=== ${label} ===`);
    console.log(JSON.stringify(rows($, tableFor($, label))));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
