import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {accountStatsForTarget} from './today-results-other.js';
import {abceReceiveWrites} from './box-receive-summary.js';
const source=readFileSync(new URL('./sync-mailnum2.js',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('function locateTodayResultTargets('),source.indexOf('function currentTimeJst()'));
const update=source.slice(source.indexOf('async function updateTodayResults('),source.indexOf('async function main()'));
function fixture(){const rows=[['11/8(日)','DC'],[],[],[],[],[],['11/8(日)','feliz']];rows[2]=Array.from({length:55},(_,i)=>({51:'受信',52:'個別受信',53:'同報受信',54:'実本数'}[i]||''));rows[4][54]='担当者';rows[5][54]='その他';return rows;}
function runner(rows){let writes;const sheets={spreadsheets:{values:{get:async()=>({data:{values:rows}}),batchUpdate:async r=>writes=r.requestBody.data}}};const context={google:{auth:{GoogleAuth:function(){}},sheets:()=>sheets},required:k=>k==='GOOGLE_SERVICE_ACCOUNT_JSON'?'{}':'sheet',loadNameToId:async()=>new Map([['担当者','id']]),currentTimeJst:()=> '12:30',SHEET_NAMES:['目標＆振分'],text:x=>String(x??'').replace(/\s/g,''),abceReceiveWrites,accountStatsForTarget,console};return {run:vm.runInNewContext(functions+'\n'+update+'\nupdateTodayResults',context),writes:()=>JSON.parse(JSON.stringify(writes))};}
const people={interaction:10,individual:3,broadcast:4,interactionReceive:5,individualReceive:0,broadcastReceive:7};
const all={interaction:20,individual:5,broadcast:10,interactionReceive:12,individualReceive:2,broadcastReceive:15};
test('writes six metrics in AW:BB and balances all six for Other without touching BC names',async()=>{const r=runner(fixture());await r.run(new Map([['id',people],['全体',all]]),{iso:'2026-11-08',label:'11/8'},100);assert.deepEqual(r.writes().slice(0,2),[{range:"'目標＆振分'!AW5:BB5",values:[[10,3,4,5,0,7]]},{range:"'目標＆振分'!AW6:BB6",values:[[10,2,6,7,2,8]]}]);});
test('missing breakdown does not become zero or write a partial batch',async()=>{const r=runner(fixture());await assert.rejects(()=>r.run(new Map([['id',{...people,individualReceive:undefined}],['全体',all]]),{iso:'2026-11-08',label:'11/8'},100),/受信内訳/);});
test('incomplete breakdown headers refuse writes',async()=>{const rows=fixture();rows[2][53]='';const r=runner(rows);await assert.rejects(()=>r.run(new Map([['id',people],['全体',all]]),{iso:'2026-11-08',label:'11/8'},100),/見出し/);});
test('inserted AW receive target is preserved while staff, Other and ABCE summary shift right',async()=>{
  const rows=fixture(); for(const row of rows) { while(row.length<48)row.push(''); row.splice(48,0,''); }
  rows[2][48]='受信目標'; rows[4][48]=999;
  const r=runner(rows);await r.run(new Map([['id',people],['全体',all]]),{iso:'2026-11-08',label:'11/8'},100);
  const writes=r.writes();assert.deepEqual(writes.slice(0,2),[{range:"'目標＆振分'!AX5:BC5",values:[[10,3,4,5,0,7]]},{range:"'目標＆振分'!AX6:BC6",values:[[10,2,6,7,2,8]]}]);
  assert.ok(writes.some(w=>w.range==="'目標＆振分'!AY2"));assert.ok(writes.some(w=>w.range==="'目標＆振分'!AV2"));assert.ok(!writes.some(w=>/!AW/.test(w.range)));
});
