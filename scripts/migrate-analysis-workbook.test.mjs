import test from 'node:test';
import assert from 'node:assert/strict';
import {formulaRequests,validateSource,PLAN,SOURCE,DESTINATION,migrate} from './migrate-analysis-workbook.mjs';
test('migration source and destination are distinct and all eight identities are exact',()=>{
 assert.notEqual(SOURCE,DESTINATION);
 const source={spreadsheetId:SOURCE,sheets:PLAN.map(([sheetId,title])=>({properties:{sheetId,title}}))};
 assert.doesNotThrow(()=>validateSource(source));
 assert.throws(()=>validateSource({...source,spreadsheetId:DESTINATION}));
 assert.throws(()=>validateSource({...source,sheets:source.sheets.slice(1)}));
 assert.equal(new Set(PLAN.map(p=>p[0])).size,8);
});
test('formula repair touches only genuine formula cells, preserving literals and all other fields',()=>{
 const rows=[[{userEnteredValue:{stringValue:'=literal'}},{userEnteredValue:{numberValue:42}},{userEnteredValue:{formulaValue:"='シート8'!A1"}}],[],[{userEnteredValue:{formulaValue:'=B3-1'}}]];
 const requests=formulaRequests(174166888,rows);
 assert.equal(requests.length,2);
 assert.deepEqual(requests.map(r=>r.updateCells.start),[{sheetId:174166888,rowIndex:0,columnIndex:2},{sheetId:174166888,rowIndex:2,columnIndex:0}]);
 assert.ok(requests.every(r=>r.updateCells.fields==='userEnteredValue'));
});
test('staging refuses to write while the source workflow is active',async()=>{
 let writes=0;
 const source={spreadsheetId:SOURCE,sheets:PLAN.map(([sheetId,title])=>({properties:{sheetId,title}}))};
 const destination={spreadsheetId:DESTINATION,sheets:[{properties:{sheetId:0,title:'シート1'}}]};
 const sheets={spreadsheets:{get:async({spreadsheetId})=>({data:spreadsheetId===SOURCE?source:destination}),values:{get:async()=>({data:{}})},batchUpdate:async()=>writes++}};
 const previous=process.env.MIGRATION_SOURCE_PAUSED;delete process.env.MIGRATION_SOURCE_PAUSED;
 try{await assert.rejects(()=>migrate(sheets,'stage'),/Pause/);assert.equal(writes,0);}finally{if(previous!==undefined)process.env.MIGRATION_SOURCE_PAUSED=previous;}
});
test('destination name or ID collisions abort before any mutation',async()=>{
 let writes=0;
 const source={spreadsheetId:SOURCE,sheets:PLAN.map(([sheetId,title])=>({properties:{sheetId,title}}))};
 const destination={spreadsheetId:DESTINATION,sheets:[{properties:{sheetId:888,title:'シート8'}}]};
 const sheets={spreadsheets:{get:async({spreadsheetId})=>({data:spreadsheetId===SOURCE?source:destination}),values:{get:async()=>({data:{}})},batchUpdate:async()=>writes++}};
 await assert.rejects(()=>migrate(sheets,'stage'),/collision/);assert.equal(writes,0);
});
