import test from 'node:test';
import assert from 'node:assert/strict';
import {fullCollectionDue,recordGa4Snapshot} from './ga4-snapshots.mjs';
test('normal collection runs only in the 00 and 30 minute launch windows',()=>{
  for(let m=0;m<60;m+=5)assert.equal(fullCollectionDue('2026-11-03 18:'+String(m).padStart(2,'0')+':25'),m===0||m===30);
  assert.equal(fullCollectionDue('2026-11-03 18:31:59'),true);
});
test('GA4-only records retain zero, touch only their own sheet, and verify readback',async()=>{
  let writes=0;
  const sheets={spreadsheets:{values:{get:async q=>({data:{values:q.range.endsWith('!A2:A')?[]:[['2026-11-03 18:05:00',0]]}}),append:async q=>{
    writes++;assert.equal(q.range,"'_GA4_5分'!A:B");assert.deepEqual(q.requestBody.values,[['2026-11-03 18:05:00',0]]);
    return {data:{updates:{updatedRange:"'_GA4_5分'!A2:B2"}}};
  }}}};
  assert.equal(await recordGa4Snapshot(sheets,'id','2026-11-03 18:05:35',0),true);assert.equal(writes,1);
  await assert.rejects(recordGa4Snapshot(sheets,'id','2026-11-03 18:05:35',''));
  sheets.spreadsheets.values.get=async()=>({data:{values:[['2026-11-03 18:05:00']]}});
  assert.equal(await recordGa4Snapshot(sheets,'id','2026-11-03 18:09:00',12),false);assert.equal(writes,1);
});
