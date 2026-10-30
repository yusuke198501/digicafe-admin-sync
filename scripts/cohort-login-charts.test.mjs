import test from 'node:test';
import assert from 'node:assert/strict';
import {chartRequests,helperRows,chartSpec,METRICS,GRAPH_ID,HELPER_ID,snapshotFormula,refreshCohortLoginCharts} from './cohort-login-charts.mjs';
const template={chartId:1926102601,spec:{title:'全体受信数の推移',fontName:'Arial',basicChart:{chartType:'LINE',legendPosition:'BOTTOM_LEGEND'}},position:{overlayPosition:{anchorCell:{sheetId:GRAPH_ID,rowIndex:180,columnIndex:0},widthPixels:730,heightPixels:300}}};
const first={...template,chartId:123,position:{overlayPosition:{...template.position.overlayPosition,anchorCell:{sheetId:GRAPH_ID,rowIndex:36,columnIndex:0}}}};
const book={sheets:[{properties:{sheetId:GRAPH_ID,title:'グラフ'},charts:[first,template,{chartId:2027820698,position:{overlayPosition:{anchorCell:{sheetId:GRAPH_ID,rowIndex:8,columnIndex:8},heightPixels:500}}}]}]};
test('only the two new metrics get charts and source ranges remain aligned',()=>{
 const req=chartRequests(book),added=req.filter(r=>r.addChart).map(r=>r.addChart.chart);
 assert.equal(added.length,2);assert.deepEqual(added.map(c=>c.spec.title),METRICS.map(m=>m.name+'の推移'));
 for(const c of added){assert.equal(c.spec.fontName,'Arial');assert.equal(c.spec.basicChart.legendPosition,'BOTTOM_LEGEND');assert.equal(c.spec.basicChart.headerCount,1);assert.equal(c.spec.hiddenDimensionStrategy,'SHOW_ALL');assert.equal(c.spec.basicChart.series.length,5);assert.ok(c.position.overlayPosition.anchorCell.rowIndex>198);}
 assert.equal(added[1].position.overlayPosition.offsetXPixels,750);
 assert.ok(!req.some(r=>r.deleteSheet||r.deleteDimension||r.insertDimension));
 assert.ok(!req.some(r=>r.updateEmbeddedObjectPosition?.objectId===2027820698));
});
test('colors and dash meanings match the existing common chart design',()=>{
 const s=chartSpec(template.spec,METRICS[0]).basicChart.series;
 assert.deepEqual(s.map(x=>x.lineStyle.type),['SOLID','SOLID','SOLID','MEDIUM_DASHED','SOLID']);
 assert.deepEqual(s[0].colorStyle,s[3].colorStyle);assert.notDeepEqual(s[0].colorStyle,s[2].colorStyle);assert.notDeepEqual(s[2].colorStyle,s[4].colorStyle);
 assert.deepEqual(s.map(x=>x.series.sourceRange.sources[0].startColumnIndex),[1,2,3,4,5]);
});
test('formula matrix covers 00:00 to 24:00 and never substitutes missing history with zero',()=>{
 const rows=helperRows();assert.equal(rows.length,51);assert.ok(rows.every(r=>r.values.length===20));
 assert.ok(rows[2].values[1].userEnteredValue.formulaValue.startsWith('=IF($G$2="","",IF('));
 assert.ok(rows[2].values[11].userEnteredValue.formulaValue.startsWith('=IF($Q$2="","",IF('));
 assert.ok(rows[50].values[0].userEnteredValue.formulaValue.includes('48/48'));
 const text=JSON.stringify(rows);assert.ok(text.includes('$AB$2:$AB'));assert.ok(text.includes('$AC$2:$AC'));assert.ok(!text.includes('IFERROR(AVERAGE(vals),0)'));
 const f=snapshotFormula('AB',"'グラフ'!$E$3",'1');assert.ok(f.includes('ISNUMBER'));assert.ok(f.includes('1-1/1440'));assert.ok(f.endsWith(',"")'));
});
test('writes are scoped to the owned helper and the requested graph additions',()=>{
 const req=chartRequests(book);assert.equal(req.find(r=>r.addSheet).addSheet.properties.sheetId,HELPER_ID);
 const replacements=req.filter(r=>r.findReplace);assert.equal(replacements.length,2);assert.ok(replacements.every(r=>r.findReplace.range.sheetId===GRAPH_ID&&r.findReplace.range.startRowIndex===1552));
 const cmp=req.find(r=>r.updateCells?.start.sheetId===GRAPH_ID).updateCells;assert.equal(cmp.start.rowIndex,36);assert.equal(cmp.rows.length,2);assert.ok(cmp.rows.every(r=>r.values.length===10));
 assert.ok(cmp.rows[0].values[5].userEnteredValue.formulaValue.includes("ISNUMBER('_登録月別ログイングラフ'!H2)"));
 assert.throws(()=>chartRequests({sheets:[...book.sheets,{properties:{sheetId:HELPER_ID,title:'他の計算'}}]}));
});
test('already installed charts perform no writes on regular five-minute runs',async()=>{
 let writes=0;const sheets={spreadsheets:{get:async()=>({data:{sheets:[{properties:{sheetId:GRAPH_ID,title:'グラフ'},charts:METRICS.map(m=>({chartId:m.chartId,spec:{title:m.name+'の推移'}}))},{properties:{sheetId:HELPER_ID,title:'_登録月別ログイングラフ'}}]}}),batchUpdate:async()=>writes++}};
 await refreshCohortLoginCharts(sheets,'test');assert.equal(writes,0);
});
