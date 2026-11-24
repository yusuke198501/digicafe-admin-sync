import test from 'node:test';import assert from 'node:assert/strict';
import {helperRows,chartRequests,chartSpec,METRICS,GRAPH_ID,HELPER_ID} from './box-activity-charts.mjs';
const template={chartId:1926102601,spec:{title:'全体受信数の推移',basicChart:{chartType:'LINE',legendPosition:'BOTTOM_LEGEND'}},position:{overlayPosition:{anchorCell:{sheetId:GRAPH_ID,rowIndex:49,columnIndex:0},widthPixels:730,heightPixels:300}}};
test('eight interaction metrics have distinct AL:AS sources and independent forecast columns',()=>{
 const rows=helperRows();assert.equal(rows.length,51);assert.equal(rows[0].values.length,80);
 assert.deepEqual(METRICS.map(m=>m.column),['AL','AM','AN','AO','AP','AQ','AR','AS']);
 for(const m of METRICS){assert.ok(JSON.stringify(rows).includes('$'+m.column+'$2:$'+m.column));assert.ok(rows[20].values[m.offset+4].userEnteredValue.formulaValue.includes('TODAY()'));}
});
test('eight charts, three across, common solid/dashed colors, and eight comparisons without inserted/deleted rows',()=>{
 const req=chartRequests({sheets:[{properties:{sheetId:GRAPH_ID,title:'グラフ'},charts:[template]}]});
 const charts=req.filter(r=>r.addChart).map(r=>r.addChart.chart);assert.equal(charts.length,8);
 assert.deepEqual(charts.map(c=>c.position.overlayPosition.offsetXPixels),[0,750,1500,0,750,1500,0,750]);
 assert.equal(charts[6].position.overlayPosition.offsetYPixels-charts[0].position.overlayPosition.offsetYPixels,680);
 const cmp=req.find(r=>r.updateCells?.start.sheetId===GRAPH_ID).updateCells;assert.equal(cmp.start.rowIndex,47);assert.equal(cmp.rows.length,8);
 assert.ok(cmp.rows.every(r=>r.values.length===11&&r.values[5].userEnteredValue.formulaValue));
 assert.equal(req.find(r=>r.addSheet).addSheet.properties.gridProperties.columnCount,80);
 assert.ok(!req.some(r=>r.insertDimension||r.deleteDimension||r.deleteSheet));
 const series=chartSpec(template.spec,METRICS[0]).basicChart.series;
 assert.equal(series[3].lineStyle.type,'MEDIUM_DASHED');assert.deepEqual(series[0].colorStyle,series[3].colorStyle);
 assert.ok(req.filter(r=>r.findReplace).every(r=>r.findReplace.replacement.includes('$AS')));
});
