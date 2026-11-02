import test from 'node:test';
import assert from 'node:assert/strict';
import {cohortLoginQuery,existingCohortLoginQuery,cohortLoginOrBlank,carryForwardCohortLogins} from './sync-sheet8.js';
const form='<form><input name="sum"><input name="message_sent_start"><input name="area[]" type="checkbox" checked value="1"><input name="paid_start" value="2020-01-01"></form>';
test('existing logins exclude current and prior registration months with the all-male scope',()=>{
 for(const [date,end] of [['2026-11-02','2026-09-30'],['2027-01-01','2026-11-30'],['2028-04-01','2028-02-29']]){
  const q=existingCohortLoginQuery(form,date);
  assert.equal(q.get('regist_start'),'');assert.equal(q.get('regist_end'),end);
  assert.equal(q.get('login_start'),date);assert.equal(q.get('login_end'),date);
  assert.equal(q.get('sex'),'0');assert.equal(q.get('is_paying'),'0');
  assert.equal(q.get('paid_start'),'');assert.equal(q.get('message_sent_start'),'');
 }
 assert.throws(()=>existingCohortLoginQuery(form,'2026-02-30'));
});
test('paid existing logins use E payment scope and exclude current and prior registration months',()=>{
 for(const [date,end] of [['2026-11-02','2026-09-30'],['2027-01-01','2026-11-30'],['2028-04-01','2028-02-29']]){
  const q=existingCohortLoginQuery(form,date,true);
  assert.equal(q.get('is_paying'),'1');assert.equal(q.get('sex'),'0');
  assert.equal(q.get('login_start'),date);assert.equal(q.get('login_end'),date);
  assert.equal(q.get('regist_start'),'');assert.equal(q.get('regist_end'),end);
  assert.equal(q.get('paid_start'),'');assert.equal(q.get('paid_end'),'');
 }
});
test('paid existing failures use AE history only, retain zero and exclude previous-day data',()=>{
 const history=[['2026-11-01 23:55:00',1,2,3,9999],['2026-11-02 13:00:00',10,20,300,200]];
 assert.deepEqual(carryForwardCohortLogins([12,22,330,''],history,'2026-11-02 13:10:00',()=>{}),[12,22,330,200]);
 assert.deepEqual(carryForwardCohortLogins([12,22,330,0],history,'2026-11-02 13:10:00',()=>{}),[12,22,330,0]);
 assert.deepEqual(carryForwardCohortLogins([12,22,330,''],history.slice(0,1),'2026-11-02 13:10:00',()=>{}),[12,22,330,'']);
});
test('third cohort keeps real zero, fills only unavailable older-cohort counts and never uses another day',()=>{
 const history=[['2026-11-01 23:55:00',1,2,9999],['2026-11-02 13:00:00',10,20,300],['2026-11-02 13:05:00',11,21,'']];
 assert.deepEqual(carryForwardCohortLogins([12,22,''],history,'2026-11-02 13:10:00',()=>{}),[12,22,300]);
 assert.deepEqual(carryForwardCohortLogins([12,22,0],history,'2026-11-02 13:10:00',()=>{}),[12,22,0]);
 assert.deepEqual(carryForwardCohortLogins([12,22,''],history.slice(0,1),'2026-11-02 13:10:00',()=>{}),[12,22,'']);
});
test('login snapshots use all males and exact registration calendar months',()=>{
  for (const [date,prior,start,end] of [
    ['2026-10-30',false,'2026-10-01','2026-10-31'],
    ['2026-10-30',true,'2026-09-01','2026-09-30'],
    ['2027-01-01',true,'2026-12-01','2026-12-31'],
    ['2028-03-01',true,'2028-02-01','2028-02-29']
  ]) {
    const q=cohortLoginQuery(form,date,prior);
    assert.equal(q.get('regist_start'),start);assert.equal(q.get('regist_end'),end);
    assert.equal(q.get('login_start'),date);assert.equal(q.get('login_end'),date);
    assert.equal(q.get('sex'),'0');assert.equal(q.get('is_paying'),'0');
    assert.equal(q.get('is_confirmed_identity'),'0');assert.equal(q.get('paid_start'),'');
    assert.equal(q.get('message_sent_start'),'');assert.deepEqual(q.getAll('area[]'),['1']);
  }
  assert.throws(()=>cohortLoginQuery(form,'2026-02-30'));
});
test('missing cohort metrics independently use the most recent same-day valid count',()=>{
 const rows=[['2026-10-30 13:00:00',120,40],['2026-10-30 13:05:00','',42],['2026-10-30 13:10:00',125,'']];
 assert.deepEqual(carryForwardCohortLogins(['',''],rows,'2026-10-30 13:15:00',()=>{}),[125,42]);
 assert.deepEqual(carryForwardCohortLogins([0,45],rows,'2026-10-30 13:15:00',()=>{}),[0,45]);
 assert.deepEqual(carryForwardCohortLogins(['',0],[['2026-10-30 13:10:00',0,42]],'2026-10-30 13:15:00',()=>{}),[0,0]);
});
test('cohort fallback excludes other days, same/future timestamps, and invalid counts',()=>{
 const rows=[['2026-10-29 23:55:00',999,999],['2026-10-30 13:15:00',888,888],['2026-10-30 13:20:00',777,777],['invalid',666,666],['2026-10-30 13:10:00',-1,1.5]];
 assert.deepEqual(carryForwardCohortLogins(['',''],rows,'2026-10-30 13:15:00',()=>{}),['','']);
 assert.deepEqual(carryForwardCohortLogins(['',''],[['2026-10-31 23:55:00',55,66]],'2026-11-01 00:00:00',()=>{}),['','']);
});
test('real zero is retained and unavailable counts are blank without secret leakage',async()=>{
  assert.equal(await cohortLoginOrBlank(async()=>0),0);
  assert.equal(await cohortLoginOrBlank(async()=>123),123);
  const warnings=[];
  assert.equal(await cohortLoginOrBlank(async()=>{throw new Error('private-password');},m=>warnings.push(m)),'');
  assert.equal(warnings.length,1);assert.ok(!warnings[0].includes('private-password'));
});
