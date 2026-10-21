import test from 'node:test';
import assert from 'node:assert/strict';
import { clickWindows, parseClickCount, fetchClickCount } from './cats-clicks.js';
import { metricOrZero } from './sync-sheet8.js';
import { validateSnapshotDestination } from './sync-sheet8.js';
import { carryForwardZeros } from './sync-sheet8.js';
import { cohortMailUrl, parseCohortMail } from './sync-sheet8.js';
import { registrationUrl, parseRegistrations } from './sync-sheet8.js';
import { cohortSalesUrl, parseCohortSales, buildSnapshotRow } from './sync-sheet8.js';
import { parseInteractions, parsePayers, parseMembers, memberQuery, slot, jstTimestamp, collectionWindowValid, maleReceiveUrl, parseMaleReceive } from './sync-sheet8.js';
const hours = Array.from({length:24},(_,i)=>`<tr><td>${i}時</td><td>${i===0?312:0}</td><td>${i===0?335:0}</td><td>0</td><td>0</td><td>8</td><td>${i===0?1009:0}</td><td>${i===0?82:0}</td></tr>`).join('');
const mail = `<h3>UF_MKT系データ(ログインアカウント別/時間毎)</h3><div><table><tr><th></th><th colspan="7">全体</th></tr><tr><th>やり取り送信</th><th>やり取り受信</th><th>個別送信</th><th>個別受信</th><th>同報配信キャラ数</th><th>同報配信</th><th>同報受信</th></tr>${hours}<tr><td>合計</td><td>312</td><td>335</td><td>0</td><td>0</td><td>8</td><td>1009</td><td>82</td></tr></table></div>`;
test('exact interaction and broadcast columns, excluding broadcast character count',()=>assert.deepEqual(parseInteractions(mail),[312,335,1009,82]));
test('reject missing data and inconsistent totals',()=>{assert.throws(()=>parseInteractions('')); assert.throws(()=>parseInteractions(mail.replace('<td>82</td></tr></table>','<td>83</td></tr></table>')));});
test('reject missing broadcast header instead of taking an adjacent metric',()=>assert.throws(()=>parseInteractions(mail.replace('<th>同報配信</th>','<th>別の項目</th>'))));
test('paid male sales excludes gross and sponsor',()=>{
  const html='<table><tr><th colspan="2">グロス</th><th colspan="2">有料男性</th><th>スポンサー決済</th></tr><tr><th>日時</th><th>売上</th><th>売上</th><th>課金者数</th><th>売上</th></tr><tr><td>2026-10-15</td><td>150,010</td><td>148,710</td><td>34</td><td>1,300</td></tr></table>';
  assert.deepEqual(parsePayers(html,'2026-10-15'),[34,148710]); assert.throws(()=>parsePayers(html,'2026-10-14'));
});
test('member counts fail closed',()=>{assert.equal(parseMembers('抽出件数 3,151 件'),3151); assert.throws(()=>parseMembers('ログイン')); assert.throws(()=>parseMembers('抽出件数 10,000 件'));});
test('member query preserves checked area and paid cohort, clears other dates',()=>{
  const q=memberQuery('<form><input name="sum" value="集計"><input name="message_sent_start"><input name="login_start" value="2020-01-01"><input name="area[]" type="checkbox" checked value="1"><input name="area[]" type="checkbox" checked value="2"><input name="is_paying" type="radio" checked value="0"></form>','2026-10-15','message_sent');
  assert.equal(q.get('is_paying'),'1'); assert.equal(q.get('sex'),'0'); assert.equal(q.get('login_start'),''); assert.equal(q.get('message_sent_start'),'2026-10-15'); assert.deepEqual(q.getAll('area[]'),['1','2']);
});
test('JST date and 5 minute deduplication',()=>{assert.equal(jstTimestamp(new Date('2026-10-14T15:02:30Z')),'2026-10-15 00:02:30'); assert.equal(slot('2026-10-15 09:19:59'),'2026-10-15 09:15'); assert.equal(slot('日時'),null);});
test('collection may cross a five-minute boundary but not midnight or four minutes',()=>{assert.equal(collectionWindowValid(new Date('2026-10-15T00:29:29Z'),new Date('2026-10-15T00:30:09Z')),true);assert.equal(collectionWindowValid(new Date('2026-10-15T14:59:29Z'),new Date('2026-10-15T15:00:09Z')),false);assert.equal(collectionWindowValid(new Date('2026-10-15T00:00:00Z'),new Date('2026-10-15T00:04:00Z')),false);});
const maleHtml = '<form><input name="mail_start" value="2026-10-15"><input name="mail_end" value="2026-10-16"><input name="sex" type="radio" value="0" checked><input name="type" type="radio" value="2" checked><input name="is_create" type="checkbox"></form><table><tr><td>メール総数</td><td>人数</td><td>平均通数</td></tr><tr><td>77237 通</td><td>22078 人</td><td>3.5 通</td></tr></table>';
test('male receive uses summary totals, not average or individual users',()=>assert.deepEqual(parseMaleReceive(maleHtml,'2026-10-15'),[77237,22078]));
test('male receive rejects wrong date, gender/type, registration filter, or missing table',()=>{
  for (const html of [maleHtml.replace('2026-10-16','2026-10-15'),maleHtml.replace('value="2" checked','value="1" checked'),maleHtml.replace('type="checkbox"','type="checkbox" checked'),maleHtml.replace('メール総数','別項目')]) assert.throws(()=>parseMaleReceive(html,'2026-10-15'));
});
test('male receive searches today through tomorrow across month/year end',()=>{
  const q = new URL(maleReceiveUrl('2026-12-31')).searchParams;
  assert.equal(q.get('mail_end'),'2027-01-01'); assert.equal(q.get('sex'),'0'); assert.equal(q.get('type'),'2'); assert.equal(q.has('is_create'),false);
});

test('click windows cover midnight through snapshot minute without overlapping minutes',()=>{
  assert.deepEqual(clickWindows('2026-10-15 02:05:12'),[['2026-10-15 00:00','2026-10-15 00:59'],['2026-10-15 01:00','2026-10-15 01:59'],['2026-10-15 02:00','2026-10-15 02:05']]);
  assert.equal(clickWindows('2026-10-15 23:59:59').length,24);
  assert.equal(clickWindows('2026-10-16 00:00:01').length,1);
  assert.throws(()=>clickWindows('2026-10-15 24:00:00'));
});
const clickLog = {clientId:'8',clientName:'NORG',contentName:'デジカフェ_cross'};
test('click count includes duplicates and all matching ads only',()=>{
  const logs=[clickLog,clickLog,{...clickLog,contentName:'別広告'},{...clickLog,clientId:'9'},{...clickLog,clientName:'Other'}];
  assert.equal(parseClickCount({params:{totalNum:5,logs}}),2);
  assert.equal(parseClickCount({params:{totalNum:0,logs:[]}}),0);
});
test('click count rejects truncated logs, API errors, and malformed data',()=>{
  for (const data of [{params:{totalNum:2,logs:[clickLog]}},{errors:{clickDateTime:'invalid'},params:{totalNum:0,logs:[]}},{params:{totalNum:1,logs:[{}]}},{}]) assert.throws(()=>parseClickCount(data));
});
test('click API uses fixed host, safe authentication, hourly windows and rate limit',async()=>{
  const requests=[],waits=[];
  const count = await fetchClickCount('2026-10-15 01:05:00','test-secret',{request:async(url,options)=>{
    requests.push([url,options]);
    return {ok:true,json:async()=>({params:{totalNum:2,logs:[clickLog,clickLog]}})};
  },pause:async ms=>waits.push(ms)});
  assert.equal(count,4);assert.deepEqual(waits,[1100]);assert.equal(requests[0][0],'https://afad-api-shiba.catsys.jp/log/click/listspan');
  assert.equal(requests[0][1].headers.apiKey,'test-secret');assert.equal(requests[0][1].redirect,'error');
  assert.equal(requests[1][1].body.get('clickDateTime'),'2026-10-15 01:00 - 2026-10-15 01:05');
});
test('click network failures do not expose secret or raw response',async()=>{
  await assert.rejects(fetchClickCount('2026-10-15 00:05:00','test-secret',{request:async()=>{throw new Error('test-secret');}}),e=>!e.message.includes('test-secret'));
});

test('missing payment row becomes two zeros without blocking independent metrics',async()=>{
  const warnings=[];
  const rows=await Promise.all([
    metricOrZero('F/G',2,()=>parsePayers('<html></html>','2026-10-16'),m=>warnings.push(m)),
    metricOrZero('L',1,async()=>[112],m=>warnings.push(m))
  ]);
  assert.deepEqual(rows,[[0,0],[112]]);assert.equal(warnings.length,1);
});
test('every failed metric group has numeric zero fallback, no secret leakage',async()=>{
  for (const width of [1,2,4]) {
    const warnings=[];
    assert.deepEqual(await metricOrZero('test',width,async()=>{throw new Error('private-token');},m=>warnings.push(m)),Array(width).fill(0));
    assert.equal(warnings.length,1);assert.equal(warnings[0].includes('private-token'),false);
  }
});
test('successful zero and valid values remain unchanged; malformed values become zero',async()=>{
  assert.deepEqual(await metricOrZero('test',2,async()=>[0,42]),[0,42]);
  for (const values of [[undefined],[NaN],[-1],[],['12']]) assert.deepEqual(await metricOrZero('test',1,async()=>values,()=>{}),[0]);
});
test('column-based destination ignores renamed labels, preserves sheet identity check',()=>{
  assert.doesNotThrow(()=>validateSnapshotDestination([{properties:{sheetId:1467610996,title:'シート8',gridProperties:{columnCount:26}}}]));
  for (const properties of [{sheetId:0,title:'シート8',gridProperties:{columnCount:26}},{sheetId:1467610996,title:'別シート',gridProperties:{columnCount:26}},{sheetId:1467610996,title:'シート8',gridProperties:{columnCount:11}}]) assert.throws(()=>validateSnapshotDestination([{properties}]));
});
test('zero metrics copy same-day previous values column by column without replacing nonzero values',()=>{
  const row=['2026-10-19 10:05:00',0,12,0,0],previous=['2026-10-19 10:00:00',8,20,0,55],warnings=[];
  assert.deepEqual(carryForwardZeros(row,previous,m=>warnings.push(m)),[row[0],8,12,0,55]);
  assert.equal(row[1],0);assert.equal(warnings.length,1);
});
test('carry forward never copies yesterday or future snapshots',()=>{
  const row=['2026-10-19 00:00:10',0,0];
  for (const previous of [undefined,['2026-10-18 23:55:00',100,90],['2026-10-19 00:05:00',100,90],['日時',100,90]]) assert.deepEqual(carryForwardZeros(row,previous),row);
});
test('missing and invalid previous values remain zero and all B:L columns are covered',()=>{
  assert.deepEqual(carryForwardZeros(['2026-10-19 10:05:00',0,0,0],['2026-10-19 10:00:00','5',null,-1]),['2026-10-19 10:05:00',0,0,0]);
  assert.deepEqual(carryForwardZeros(['2026-10-19 10:05:00',...Array(11).fill(0)],['2026-10-19 10:00:00',...Array(11).fill(9)],()=>{}),['2026-10-19 10:05:00',...Array(11).fill(9)]);
});
test('cohort mail separates current month from previous month, including January rollover',()=>{
  for (const [date,prior,start,end] of [['2026-10-19',false,'2026-10-01','2026-10-19'],['2026-10-19',true,'2026-09-01','2026-09-30'],['2027-01-02',true,'2026-12-01','2026-12-31']]) {
    const u=new URL(cohortMailUrl(date,prior));
    assert.equal(u.pathname,'/partner/mailnum_uf');
    for(const [key,value] of Object.entries({sex:'0',is_create:'1',mail_start:date,mail_end:date,created_at_start:start,created_at_end:end})) assert.equal(u.searchParams.get(key),value);
  }
});
test('cohort mail uses whole SEND table and returns users then total, not received table or UF',()=>{
  const html='<table><tr><th>全体受信データ</th></tr><tr><th>メール総数</th><th>メール人数</th></tr><tr><td>999</td><td>888</td></tr></table><table><tr><th colspan="3">全体送信データ</th></tr><tr><th>メール総数</th><th>メール人数</th><th>平均</th></tr><tr><td>1,234 通</td><td>56 人</td><td>22</td></tr></table>';
  assert.deepEqual(parseCohortMail(html),[56,1234]);
  assert.throws(()=>parseCohortMail(''));
  assert.throws(()=>parseCohortMail(html.replace('56 人','-')));
});
test('carry forward also covers M:P without previous day leakage',()=>{
  const row=['2026-10-19 11:05:00',...Array(15).fill(0)],previous=['2026-10-19 11:00:00',...Array(15).fill(2)];
  assert.deepEqual(carryForwardZeros(row,previous,()=>{}).slice(12),[2,2,2,2]);
});
test('registration source matches distribution X column: selected-day male kaidan registrations',()=>{
  const q=new URL(registrationUrl('2026-10-19')).searchParams;
  for(const [k,v] of Object.entries({category:'1',sex:'0',registed_at_start:'2026-10-19',registed_at_end:'2026-10-19',term:'d'})) assert.equal(q.get(k),v);
  const html='<table><tr><th>日付</th><th>男性登録数</th><th>男性年認完了数</th></tr><tr><td>2026/10/19</td><td>123</td><td>45</td></tr></table>';
  assert.equal(parseRegistrations(html,'2026-10-19'),123);
});
test('carry forward retains inserted M registration and shifted N:Q cohort columns',()=>{
  const old=['2026-10-19 15:00:00',...Array(11).fill(1),123,88,241,42,107];
  assert.deepEqual(carryForwardZeros(['2026-10-19 15:05:00',...Array(16).fill(0)],old,()=>{}).slice(12),[123,88,241,42,107]);
  assert.throws(()=>validateSnapshotDestination([{properties:{sheetId:1467610996,title:'シート8',gridProperties:{columnCount:16}}}]));
});

test('cohort sales uses selected-day totals, male registration cohort, and prior-month rollover',()=>{
  for (const [date,prior,start,end] of [['2026-10-20',false,'2026-10-01','2026-10-20'],['2026-10-20',true,'2026-09-01','2026-09-30'],['2027-01-02',true,'2026-12-01','2026-12-31']]) {
    const q=new URL(cohortSalesUrl(date,prior)).searchParams;
    for(const [key,value] of Object.entries({start:date,end:date,reg_start:start,reg_end:end,sex:'0',reg_flg:'1'})) assert.equal(q.get(key),value);
  }
});
function salesFixture(date='2026-10-20',prior=false) {
  const q=new URL(cohortSalesUrl(date,prior)).searchParams;
  return '<form>'+['start','end','reg_start','reg_end'].map(k=>`<input name="${k}" value="${q.get(k)}">`).join('')+'<input type="radio" name="sex" value="0" checked><input type="checkbox" name="reg_flg" value="1" checked></form><table><tr><th>区切り</th><th>区分1</th><th>区分2</th><th>合計</th></tr><tr><td>￥</td><td>10,000</td><td>20,000</td><td>30,000</td></tr><tr><td>人</td><td>2</td><td>3</td><td>5</td></tr></table>';
}
test('cohort sales returns payer count then amount, not daily or registration counts',()=>{
  assert.deepEqual(parseCohortSales(salesFixture(),'2026-10-20'),[5,30000]);
  assert.deepEqual(parseCohortSales(salesFixture('2026-10-20',true),'2026-10-20',true),[5,30000]);
});
test('cohort sales rejects wrong filters, missing totals and inconsistent data',()=>{
  const html=salesFixture();
  for(const bad of [html.replace('name="sex" value="0" checked','name="sex" value="1" checked'),html.replace('name="reg_flg" value="1" checked','name="reg_flg" value="1"'),html.replace('30,000','30,001'),html.replace('<td>5</td>','<td>-</td>'),html.replace('name="end" value="2026-10-20"','name="end" value="2026-10-21"'),'<html>ログイン</html>']) assert.throws(()=>parseCohortSales(bad,'2026-10-20'));
});
test('cohort sales accepts explicit zero totals and does not invent a missing table',()=>{
  const html=salesFixture().replaceAll(/(?:10,000|20,000|30,000|<td>[235]<\/td>)/g,s=>s.startsWith('<')?'<td>0</td>':'0');
  assert.deepEqual(parseCohortSales(html,'2026-10-20'),[0,0]);
});
test('21-column row places cohort sales in P/Q and T/U and prior mail in R/S',()=>{
  const keys=['timestamp','sent','received','senders','logins','payers','amount','broadcastSent','broadcastReceived','maleReceived','maleReceivers','clicks','registrations','currentDau','currentReceived','currentCohortPayers','currentCohortAmount','priorDau','priorReceived','priorCohortPayers','priorCohortAmount'];
  const data=Object.fromEntries(keys.map((key,i)=>[key,i]));
  data.allUsagePt=21;
  data.paymentPoints=22;
  data.voluntaryLeaves=23;
  assert.deepEqual(buildSnapshotRow(data),Array.from({length:24},(_,i)=>i));
  for (const n of [17,19,20]) assert.throws(()=>validateSnapshotDestination([{properties:{sheetId:1467610996,title:'シート8',gridProperties:{columnCount:n}}}]));
  assert.throws(()=>validateSnapshotDestination([{properties:{sheetId:1467610996,title:'シート8',gridProperties:{columnCount:21}}}]));
  assert.throws(()=>validateSnapshotDestination([{properties:{sheetId:1467610996,title:'シート8',gridProperties:{columnCount:22}}}]));
  assert.throws(()=>validateSnapshotDestination([{properties:{sheetId:1467610996,title:'シート8',gridProperties:{columnCount:23}}}]));
  assert.doesNotThrow(()=>validateSnapshotDestination([{properties:{sheetId:1467610996,title:'シート8',gridProperties:{columnCount:24}}}]));
});
test('zero carry-forward uses all twenty updated columns without mixing R/S and P/Q',()=>{
  const previous=['2026-10-20 14:00:00',...Array.from({length:20},(_,i)=>i+1)];
  assert.deepEqual(carryForwardZeros(['2026-10-20 14:05:00',...Array(20).fill(0)],previous,()=>{}).slice(15),[15,16,17,18,19,20]);
});
