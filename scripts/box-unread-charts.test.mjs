import test from 'node:test';import assert from 'node:assert/strict';
import {helperRows,chartRequests,chartSpec,METRICS,GRAPH_ID,HELPER_ID} from './box-unread-charts.mjs';
const template={chartId:1926102601,spec:{title:'全体受信数の推移',basicChart:{chartType:'LINE',legendPosition:'BOTTOM_LEGEND'}},position:{overlayPosition:{anchorCell:{sheetId:GRAPH_ID,rowIndex:180,columnIndex:0},widthPixels:730,heightPixels:300}}};
test('four stock metrics preserve zeros and use distinct AH:AK sources without forecasts',()=>{
 const rows=helperRows();assert.equal(rows.length,51);assert.equal(rows[0].values.length,40);
 for(const m of METRICS){assert.ok(JSON.stringify(rows).includes('$'+m.column+'$2:$'+m.column));assert.equal(rows[20].values[m.offset+4].userEnteredValue.stringValue,'');}
});
test('four charts, three across, common colors, four comparisons, and expanded limits',()=>{
 const req=chartRequests({sheets:[{properties:{sheetId:GRAPH_ID,title:'グラフ'},charts:[template]}]});
 const charts=req.filter(r=>r.addChart).map(r=>r.addChart.chart);assert.equal(charts.length,4);
 assert.deepEqual(charts.map(c=>c.position.overlayPosition.offsetXPixels),[0,750,1500,0]);
 assert.equal(charts[3].position.overlayPosition.offsetYPixels-charts[0].position.overlayPosition.offsetYPixels,340);
 const cmp=req.find(r=>r.updateCells?.start.sheetId===GRAPH_ID).updateCells;assert.equal(cmp.start.rowIndex,43);assert.equal(cmp.rows.length,4);
 assert.ok(cmp.rows.every(r=>r.values.length===11&&r.values[5].userEnteredValue.stringValue===''));
 assert.equal(req.find(r=>r.addSheet).addSheet.properties.gridProperties.columnCount,40);
 assert.ok(!req.some(r=>r.insertDimension||r.deleteDimension||r.deleteSheet));
 const series=chartSpec(template.spec,METRICS[0],[1,2,3,5]).basicChart.series;
 assert.ok(series.every(s=>s.lineStyle.type==='SOLID'));assert.notDeepEqual(series[0].colorStyle,series[2].colorStyle);
 assert.ok(req.filter(r=>r.findReplace).every(r=>r.findReplace.replacement.includes('$AK')));
});
