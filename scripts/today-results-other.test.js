import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {accountStatsForTarget} from './today-results-other.js';
import {abceReceiveWrites} from './box-receive-summary.js';
import {parseExplicitReportDate} from './report-slot-guard.js';
const source=readFileSync(new URL('./sync-mailnum2.js',import.meta.url),'utf8');
const person={name:'担当者',accountId:'id',hasReceiveColumn:true},other={name:'その他',isOther:true,hasReceiveColumn:true};
const accounts=new Map([['全体',{interaction:100,individual:20,broadcast:1000,interactionReceive:40}],['id',{interaction:30,individual:20,broadcast:500,interactionReceive:15}]]);
test('other equals all minus listed people for all four metrics, including zero',()=>assert.deepEqual(accountStatsForTarget(other,[person,other],accounts),{interaction:70,individual:0,broadcast:500,interactionReceive:25}));
test('invalid or unavailable totals and duplicate staff refuse an other balance',()=>{
  assert.throws(()=>accountStatsForTarget(other,[person,other],new Map([['全体',accounts.get('全体')]])),/不足/);
  assert.throws(()=>accountStatsForTarget(other,[person,other],new Map([['id',accounts.get('id')]])),/全体/);
  assert.throws(()=>accountStatsForTarget(other,[person,person,other],accounts),/重複/);
  assert.throws(()=>accountStatsForTarget(other,[person,other],new Map([...accounts,['全体',{...accounts.get('全体'),interaction:1}]])),/超え/);
});
test('explicit yesterday date is used in today-results-only mode',()=>{
 const code=source.slice(source.indexOf('function todayReportDate()'),source.indexOf('const wait ='));
 const run=vm.runInNewContext(code+'\ntodayReportDate',{process:{env:{REPORT_DATE:'2026-11-08'}},parseExplicitReportDate});
 assert.equal(run().iso,'2026-11-08');
});
test('yesterday target and other row are updated without touching the next day or Feliz',async()=>{
 const functions=source.slice(source.indexOf('function locateTodayResultTargets('),source.indexOf('function currentTimeJst()'));
 const update=source.slice(source.indexOf('async function updateTodayResults('),source.indexOf('async function main()'));
 const rows=[['11/8(日)','DC'],[],Array.from({length:53},(_,i)=>i===51?'受信':i===52?'実本数':''),[],Array.from({length:53},(_,i)=>i===52?'担当者':''),Array.from({length:53},(_,i)=>i===52?'その他':''),['11/8(日)','feliz'],[],['11/9(月)','DC']];
 let writes;
 const sheets={spreadsheets:{values:{get:async()=>({data:{values:rows}}),batchUpdate:async r=>writes=r.requestBody.data}}};
 const ctx={google:{auth:{GoogleAuth:function(){}},sheets:()=>sheets},required:k=>k==='GOOGLE_SERVICE_ACCOUNT_JSON'?'{}':'sheet',loadNameToId:async()=>new Map([['担当者','id']]),currentTimeJst:()=> '12:20',SHEET_NAMES:['目標＆振分'],text:x=>String(x??'').replace(/\s/g,''),abceReceiveWrites,accountStatsForTarget,console};
 const run=vm.runInNewContext(functions+'\n'+update+'\nupdateTodayResults',ctx);
 await run(accounts,{iso:'2026-11-08',label:'11/8'},100);
 assert.deepEqual(JSON.parse(JSON.stringify(writes.slice(0,2))),[{range:"'目標＆振分'!AW5:AZ5",values:[[30,20,500,15]]},{range:"'目標＆振分'!AW6:AZ6",values:[[70,0,500,25]]}]);
 assert.ok(writes.every(w=>!/[789]/.test(w.range)));
});
