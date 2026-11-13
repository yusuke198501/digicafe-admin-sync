import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { google } from 'googleapis';
import { fetchPaymentPoints } from './payment-points.js';

const sheetName = 'シート8';
const sheetId = 1467610996;
const jstNow = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');

export function assertPaymentHost(name) {
  if (String(name).toUpperCase() !== 'UF-0049') throw new Error('入金ポイントの取得はUF-0049専用です。');
}
export function paymentTarget(rows, timestamp, today) {
  const stamp = timestamp || [...rows].reverse().find(r => String(r[0]).startsWith(today + ' '))?.[0];
  if (!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(stamp || '')) throw new Error('入金ポイントの対象日時がありません。');
  const matches = rows.flatMap((r, i) => r[0] === stamp ? [i] : []);
  if (matches.length !== 1) throw new Error('入金ポイントの対象行を一意に特定できません。');
  return { timestamp: stamp, row: matches[0] + 2, previous: rows[matches[0]][22] };
}
export function paymentWrite(target, points) {
  if (!Number.isSafeInteger(points) || points < 0) throw new Error('入金ポイントが不正です。');
  if (Number.isFinite(target.previous) && target.previous > points) throw new Error('既存値より小さい入金ポイントのため保持しました。');
  return { range: `'${sheetName}'!W${target.row}`, values: [[points]] };
}
export async function main() {
  assertPaymentHost(process.env.COMPUTERNAME);
  const now = jstNow();
  if (process.env.PAYMENT_PROBE_ONLY === 'true') {
    const points = await fetchPaymentPoints(now, process.env.ADMIN_DIGICAFE_USERNAME, process.env.ADMIN_DIGICAFE_PASSWORD);
    console.log(JSON.stringify({ paymentProbe: { host: 'UF-0049', timestamp: now, points } }));
    return;
  }
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const sheets = google.sheets({ version: 'v4', auth: new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON), scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  }) });
  const metadata = (await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title)' })).data;
  if (!metadata.sheets.some(s => s.properties.sheetId === sheetId && s.properties.title === sheetName)) throw new Error('シート8の更新先が一致しません。');
  const rows = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${sheetName}'!A2:A`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values || [];
  const target = paymentTarget(rows, process.env.PAYMENT_TIMESTAMP, now.slice(0, 10));
  const points = await fetchPaymentPoints(target.timestamp, process.env.ADMIN_DIGICAFE_USERNAME, process.env.ADMIN_DIGICAFE_PASSWORD);
  const write = paymentWrite(target, points);
  const current = (await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${sheetName}'!A${target.row}:W${target.row}`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values?.[0];
  if (current?.[0] !== target.timestamp) throw new Error('取得中に対象行が移動しました。書き込みません。');
  paymentWrite({ ...target, previous: current[22] }, points);
  await sheets.spreadsheets.values.update({ spreadsheetId, range: write.range, valueInputOption: 'RAW', requestBody: { values: write.values } });
  const verified = (await sheets.spreadsheets.values.get({ spreadsheetId, range: write.range, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values;
  if (verified?.[0]?.[0] !== points) throw new Error('入金ポイントの更新後照合に失敗しました。');
  console.log(JSON.stringify({ paymentUpdated: { host: 'UF-0049', timestamp: target.timestamp, range: write.range, points } }));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `UF-0049: ${target.timestamp} / ${write.range} / ${points} Pt\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
