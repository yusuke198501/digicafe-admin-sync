import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { abceReceiveWrites } from './box-receive-summary.js';
import { accountStatsForTarget } from './today-results-other.js';

async function collectWrites(backfill,receive=false,detailed=false,total=false,sendTotal=false) {
  const source=readFileSync(new URL('./sync-mailnum2.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('async function updateSheet('),source.indexOf('async function updateTodayResults('));
  let written;
  const sheets={spreadsheets:{values:{get:async()=>({data:{values:[]}}),batchUpdate:async(req)=>{written=req.requestBody.data;}}}};
  const boxes=['A','B','C','E','I','J','M','Q'];
  const metrics=new Proxy({accountSendStats:new Map([['id',{interaction:10,individual:2,broadcast:3,interactionReceive:7,individualReceive:4,broadcastReceive:6}]]),registrationMetrics:{registrations:5,ageVerifications:2},abceReceiveTotal:100},{get:(target,key)=>key in target?target[key]:1});
  const context={google:{auth:{GoogleAuth:function(){}},sheets:()=>sheets},required:key=>key==='GOOGLE_SERVICE_ACCOUNT_JSON'?'{}':'sheet',loadNameToId:async()=>new Map(),currentTimeJst:()=> '08:50',SHEET_NAMES:['目標＆振分'],process:{env:{REPORT_DATE:backfill?'2026-11-06':''}},console,
    locateTargetRow:()=>({row:3892,metricColumns:{grossReceiveIndex:2,ufReceiveIndex:4,grossDauIndex:8},registrationColumns:{registrations:23,ageVerifications:25,newMaleReceive:27,newMaleDau:29}}),
    locateBoxTargetRow:()=>({row:3902,columns:Object.fromEntries(boxes.map((b,i)=>[b,{receiveIndex:2+4*i,dauIndex:4+4*i}]))}),
    locateIndividualTargetRow:()=>({row:3902,columns:{send:33,receive:35}}),locateSendTable:()=>({columns:{A:11,B:12,C:13,E:14,'全体':19}}),
    // A staff row deliberately overlaps the slot row. It must still be excluded during a backfill.
    locateTodayResultTargets:()=>[{row:3892,accountId:'id',name:'担当者',hasReceiveColumn:receive,hasDetailedReceiveColumns:detailed,hasReceiveTotalColumn:total,hasSendTotalColumn:sendTotal,resultOffset:total?1:0}],locateTodayResultTimeRow:()=>3882,abceReceiveWrites,accountStatsForTarget,
    columnLetter:(n)=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}};
  const helper=source.slice(source.indexOf('function buildTodayResultWrites('),source.indexOf('function locateTodayResultTimeRow('));
  const run=vm.runInNewContext(helper+'\n'+code+'\nupdateSheet',context);
  await run(metrics,24,{iso:'2026-11-06',label:'11/6'},()=>true);
  return JSON.parse(JSON.stringify(written));
}

test('explicit-date backfill writes only requested report rows, preserving staff and timestamp',async()=>{
  const writes=await collectWrites(true);
  assert.ok(writes.length>20);
  for(const write of writes){
    const match=write.range.match(/!([A-Z]+)(\d+)$/);
    assert.ok(match,write.range);
    assert.ok(['3892','3902'].includes(match[2]),write.range);
    assert.ok(!['AV','AW','AX','AY'].includes(match[1]),write.range);
  }
});

test('ordinary scheduled run still updates staff results, timestamp, and daily receive summary',async()=>{
  const writes=await collectWrites(false);
  assert.ok(writes.some(w=>w.range==="'目標＆振分'!AW3892:AY3892"));
  assert.ok(writes.some(w=>w.range==="'目標＆振分'!AV3882"));
  assert.ok(writes.some(w=>w.range==="'目標＆振分'!AX3882"));
});

test('new layout writes interaction receive to AZ while leaving the staff name in BA untouched',async()=>{
  const writes=await collectWrites(false,true);
  assert.deepEqual(writes.find(w=>w.range==="'目標＆振分'!AW3892:AZ3892")?.values,[[10,2,3,7]]);
  assert.ok(!writes.some(w=>w.range.includes('BA3892')));
});
test('hourly sync writes all six results after the detailed receive columns are added',async()=>{
  const writes=await collectWrites(false,true,true);
  assert.deepEqual(writes.find(w=>w.range==="'目標＆振分'!AW3892:BB3892")?.values,[[10,2,3,7,4,6]]);
  assert.ok(!writes.some(w=>w.range.includes('BC3892')));
});

test('hourly sync preserves BA receive-total formulas and writes receive details in BB:BD',async()=>{
  const writes=await collectWrites(false,true,true,true);
  assert.deepEqual(writes.find(w=>w.range==="'目標＆振分'!AX3892:AZ3892")?.values,[[10,2,3]]);
  assert.deepEqual(writes.find(w=>w.range==="'目標＆振分'!BB3892:BD3892")?.values,[[7,4,6]]);
  assert.ok(!writes.some(w=>w.range.includes('BA3892')));
});

test('hourly sync skips both total formulas and moves ABCE summary after send-total insertion',async()=>{
  const writes=await collectWrites(false,true,true,true,true);
  assert.deepEqual(writes.find(w=>w.range==="'目標＆振分'!AY3892:BA3892")?.values,[[10,2,3]]);
  assert.deepEqual(writes.find(w=>w.range==="'目標＆振分'!BC3892:BE3892")?.values,[[7,4,6]]);
  assert.ok(writes.some(w=>w.range==="'目標＆振分'!AZ3882"));
  assert.ok(!writes.some(w=>/!(AX|BB|BF)3892/.test(w.range)));
});
