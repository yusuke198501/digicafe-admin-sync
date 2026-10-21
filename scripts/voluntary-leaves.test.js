import test from 'node:test';
import assert from 'node:assert/strict';
import { leaveUrl, parseVoluntaryLeaves, hourlyVoluntaryLeaves, leaveChartSeries } from './voluntary-leaves.js';

const timestamp = '2026-10-21 15:00:00';
function fixture(rows = [['1', '2026-10-21 14:00:00', '男', '自主'], ['2', '2026-10-21 12:00:00', '男', '強制']]) {
  return '<form><input name="start" value="2026-10-21"><input name="end" value="2026-10-21"><input type="radio" name="sex" value="0" checked><input type="checkbox" name="is_create"><select name="code"><option value="" selected>全体</option></select><input name="frm" value=""></form>'
    + `<table><tr><td>総数</td><td>男性</td><td>女性</td><td>年認済</td><td>課金者(男性のみ)</td></tr><tr><td>${rows.length} 人</td><td>${rows.length} 人</td><td>0 人</td><td>0 人</td><td>0 人</td></tr></table>`
    + '<table><tr><td>ユーザID</td><td>退会日</td><td>性別</td><td>自or強</td></tr>' + rows.map((r) => '<tr>'+r.map((c)=>`<td>${c}</td>`).join('')+'</tr>').join('') + '</table>';
}
test('URL selects male, same-day departures, all registrations and no cohort checkbox', () => {
  const u = new URL(leaveUrl('2026-10-21'));
  assert.equal(u.port, '8081');
  assert.equal(u.searchParams.get('sex'), '0');
  assert.equal(u.searchParams.get('start'), '2026-10-21');
  assert.equal(u.searchParams.get('end'), '2026-10-21');
  assert.equal(u.searchParams.has('is_create'), false);
  assert.throws(()=>leaveUrl('2026-02-30'));
});
test('counts voluntary males only and never counts events after snapshot time', () => {
  assert.equal(parseVoluntaryLeaves(fixture(), timestamp), 1);
  assert.equal(parseVoluntaryLeaves(fixture([['1','2026-10-21 15:00:01','男','自主']]),timestamp),0);
  assert.equal(parseVoluntaryLeaves(fixture([]),timestamp),0);
});
test('rejects wrong filters, females, duplicate users, dates, truncation and missing pages', () => {
  const html = fixture();
  for (const bad of [html.replace('value="0" checked','value="1" checked'),html.replace('name="is_create"','name="is_create" checked'),html.replace('2026-10-21 14:00','2026-10-20 14:00'),html.replace('<td>男</td>','<td>女</td>'),html.replace('<td>2</td>','<td>1</td>'),html.replace('2 人','3 人'),'<html>ログイン</html>']) assert.throws(()=>parseVoluntaryLeaves(bad,timestamp));
});
function fakeSheets(cache) {
  const writes=[];
  return {writes,spreadsheets:{values:{get:async()=>({data:{values:cache?[cache]:[]}}),update:async(p)=>{writes.push(p.requestBody.values[0]);cache=p.requestBody.values[0];}}}};
}
test('heavy collection runs once per hour, same-hour 5-minute calls use cache', async () => {
  const sheets=fakeSheets();let calls=0;
  const fetcher=async()=>{calls++;return 19;};
  assert.equal(await hourlyVoluntaryLeaves(sheets,'id',timestamp,fetcher),19);
  assert.equal(await hourlyVoluntaryLeaves(sheets,'id','2026-10-21 15:05:00',fetcher),19);
  assert.equal(calls,1);
  await hourlyVoluntaryLeaves(sheets,'id','2026-10-21 16:00:00',fetcher);
  assert.equal(calls,2);
});
test('first available run catches up a missed hour; no prior-day count leaks', async () => {
  const sheets=fakeSheets(['2026-10-20 23:00:00',88]);
  assert.equal(await hourlyVoluntaryLeaves(sheets,'id','2026-10-21 00:05:00',async()=>0),0);
  assert.equal(sheets.writes[0][1],0);
});
test('failed collection preserves same-day count, retries only next hour', async () => {
  const sheets=fakeSheets(['2026-10-21 14:00:00',19]);let calls=0;
  const fail=async()=>{calls++;throw new Error('private-config');};
  assert.equal(await hourlyVoluntaryLeaves(sheets,'id',timestamp,fail),19);
  assert.equal(await hourlyVoluntaryLeaves(sheets,'id','2026-10-21 15:05:00',fail),19);
  assert.equal(calls,1);
});

test('chart skips missing observations, keeps forecast dashed blue, and adds comparison/average when available', () => {
  const series=leaveChartSeries([true,false,true,false]);
  assert.deepEqual(series.map(s=>s.series.sourceRange.sources[0].startColumnIndex),[37,39]);
  assert.equal(series[1].lineStyle.type,'MEDIUM_DASHED');
  assert.deepEqual(series[1].color,series[0].color);
  assert.equal(leaveChartSeries([true,true,true,true]).length,4);
  assert.equal(leaveChartSeries([false,false,false,false]).length,0);
});
