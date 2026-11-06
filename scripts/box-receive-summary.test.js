import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseAbceReceiveTotal, abceReceiveWrites } from './box-receive-summary.js';
const html = (cells = ['10', '20', '30', '40']) => `<h3>UF_MKT系データ(フォルダ別/時間毎)</h3><table><tr><td>9時</td><td>999</td></tr></table><h3>UF_MKT系データ(フォルダ別/日毎)</h3><table><tr><th>日付</th><th>Q受信</th><th>C受信</th><th>A受信</th><th>E受信</th><th>B受信</th></tr><tr><td>2026/11/05</td><td>999</td><td>999</td><td>999</td><td>999</td><td>999</td></tr><tr><td>2026/11/06</td><td>999</td><td>${cells[2]}</td><td>${cells[0]}</td><td>${cells[3]}</td><td>${cells[1]}</td></tr></table>`;
test('daily named columns exclude other dates, Q, and hourly totals', () => {
  assert.equal(parseAbceReceiveTotal(html(['1,000','20','30','40']), '2026/11/06'),1090);
});
test('explicit zero is valid; missing report, date and invalid cells fail', () => {
  assert.equal(parseAbceReceiveTotal(html(['0','0','0','0']), '2026/11/06'),0);
  assert.throws(()=>parseAbceReceiveTotal('', '2026/11/06'));
  assert.throws(()=>parseAbceReceiveTotal(html(), '2026/11/07'));
  assert.throws(()=>parseAbceReceiveTotal(html(['','20','30','40']), '2026/11/06'));
});
test('daily report can be inside a wrapper element', () => {
  const wrapped=html().replace('<h3>UF_MKT系データ(フォルダ別/日毎)</h3><table>', '<h3>UF_MKT系データ(フォルダ別/日毎)</h3><div><table>')+'</div>';
  assert.equal(parseAbceReceiveTotal(wrapped,'2026/11/06'),100);
});
test('only AX in the authorized date block is written, missing data preserves it', () => {
  assert.deepEqual(abceReceiveWrites('目標＆振分',{iso:'2026-11-06'},3882,100),[{range:"'目標＆振分'!AX3882",values:[[100]]}]);
  assert.deepEqual(abceReceiveWrites('目標＆振分',{iso:'2026-11-05'},3842,100),[]);
  assert.deepEqual(abceReceiveWrites('目標＆振分',{iso:'2026-11-07'},3922,200),[{range:"'目標＆振分'!AX3922",values:[[200]]}]);
  assert.deepEqual(abceReceiveWrites('目標＆振分',{iso:'2026-12-01'},4882,0),[{range:"'目標＆振分'!AX4882",values:[[0]]}]);
  for (const invalid of [null,undefined,NaN,-1]) assert.deepEqual(abceReceiveWrites('目標＆振分',{iso:'2026-11-06'},3882,invalid),[]);
});
test('actual today-only update keeps staff columns and moves timestamp while writing AX summary', async () => {
  const source=readFileSync(new URL('./sync-mailnum2.js',import.meta.url),'utf8');
  const functions=source.slice(source.indexOf('function locateTodayResultTargets('),source.indexOf('function currentTimeJst()'));
  const update=source.slice(source.indexOf('async function updateTodayResults('),source.indexOf('async function main()'));
  const rows=[['11/6(金)','DC'],[],[],[],Array.from({length:52},(_,i)=>i===51?'担当者':'')];
  let written;
  const sheets={spreadsheets:{values:{get:async()=>({data:{values:rows}}),batchUpdate:async(req)=>{written=req.requestBody.data;}}}};
  const context={google:{auth:{GoogleAuth:function(){}},sheets:()=>sheets},required:key=>key==='GOOGLE_SERVICE_ACCOUNT_JSON'?'{}':'sheet',loadNameToId:async()=>new Map([['担当者','id']]),currentTimeJst:()=> '17:42',SHEET_NAMES:['目標＆振分'],text:x=>String(x??'').replace(/\s/g,''),abceReceiveWrites};
  const run=vm.runInNewContext(functions+'\n'+update+'\nupdateTodayResults',context);
  for (const date of [{iso:'2026-11-06',label:'11/6'},{iso:'2026-11-07',label:'11/7'},{iso:'2026-12-01',label:'12/1'}]) {
    rows[0][0]=date.label;
    await run(new Map([['id',{interaction:12,individual:3,broadcast:4}]]),date,100);
    const writes=JSON.parse(JSON.stringify(written));
    assert.deepEqual(writes,[{range:"'目標＆振分'!AW5:AY5",values:[[12,3,4]]},{range:"'目標＆振分'!AX2",values:[[100]]},{range:"'目標＆振分'!AV2",values:[['17:42']]}]);
  }
});
