import test from 'node:test';
import assert from 'node:assert/strict';
import {cohortLoginQuery,cohortLoginOrBlank} from './sync-sheet8.js';
const form='<form><input name="sum"><input name="message_sent_start"><input name="area[]" type="checkbox" checked value="1"><input name="paid_start" value="2020-01-01"></form>';
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
test('real zero is retained and unavailable counts are blank without secret leakage',async()=>{
  assert.equal(await cohortLoginOrBlank(async()=>0),0);
  assert.equal(await cohortLoginOrBlank(async()=>123),123);
  const warnings=[];
  assert.equal(await cohortLoginOrBlank(async()=>{throw new Error('private-password');},m=>warnings.push(m)),'');
  assert.equal(warnings.length,1);assert.ok(!warnings[0].includes('private-password'));
});
