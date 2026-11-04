import test from 'node:test';import assert from 'node:assert/strict';
import {finalSnapshotTimestamp,isFinalSnapshotRun,saveFinalSnapshot} from './final-snapshot.mjs';
test('00:10 launch window and previous-day month/year rollover',()=>{
 assert.equal(isFinalSnapshotRun('2026-11-04 00:10:20'),true);
 for(const t of ['00:05','00:15','12:10'])assert.equal(isFinalSnapshotRun('2026-11-04 '+t+':00'),false);
 assert.equal(finalSnapshotTimestamp('2026-11-01 00:10:20'),'2026-10-31 23:59:59');
 assert.equal(finalSnapshotTimestamp('2027-01-01 00:10:20'),'2026-12-31 23:59:59');
});
test('final record inserts before the next day and updates the same row on retry',async()=>{
 const requests=[],writes=[];
 const s={spreadsheets:{batchUpdate:async q=>requests.push(q),values:{update:async q=>writes.push(q)}}};
 const row=['2026-11-03 23:59:59',5];
 await saveFinalSnapshot(s,'id',[['2026-11-03 23:30:20'],['2026-11-04 00:00:20']],row);
 assert.equal(requests.length,1);assert.equal(writes[0].range,"'シート8'!A3:AE3");
 await saveFinalSnapshot(s,'id',[['2026-11-03 23:30:20'],[row[0]],['2026-11-04 00:00:20']],row);
 assert.equal(requests.length,1);assert.equal(writes[1].range,writes[0].range);
});
