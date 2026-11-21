import test from 'node:test';
import assert from 'node:assert/strict';
import {chartRequests,helperRows,chartSpec,METRICS,GRAPH_ID,HELPER_ID} from './today-registration-charts.mjs';
const template={chartId:1926102601,spec:{title:'全体受信数の推移',basicChart:{chartType:'LINE',legendPosition:'BOTTOM_LEGEND'}},position:{overlayPosition:{anchorCell:{sheetId:GRAPH_ID,rowIndex:180,columnIndex:0},widthPixels:730,heightPixels:300}}};
test('new cohort reads AF/AG only and never substitutes absent history with zero',()=>{
 const rows=helperRows(),text=JSON.stringify(rows);
 assert.equal(rows.length,51);assert.ok(text.includes('$AF$2:$AF'));assert.ok(text.includes('$AG$2:$AG'));
 assert.ok(text.includes('ISNUMBER'));assert.ok(!text.includes('$AB$2:$AB'));
 assert.ok(rows[50].values[0].userEnteredValue.formulaValue.includes('48/48'));
});
test('comparison, charts and styles leave existing cells and expanded-chart position intact',()=>{
 const req=chartRequests({sheets:[{properties:{sheetId:GRAPH_ID,title:'グラフ'},charts:[template]}]});
 const comparison=req.find(r=>r.updateCells?.start.sheetId===GRAPH_ID).updateCells;
 assert.equal(comparison.start.rowIndex,41);assert.ok(comparison.rows.every(r=>r.values.length===11));
 assert.ok(comparison.rows[1].values[10].userEnteredValue.formulaValue.includes('$H$3'));
 assert.equal(req.filter(r=>r.addChart).length,2);
 assert.equal(req.find(r=>r.addSheet).addSheet.properties.sheetId,HELPER_ID);
 assert.ok(!req.some(r=>r.insertDimension||r.deleteDimension||r.deleteSheet));
 for(const m of METRICS){const chart=chartSpec(template.spec,m);const series=chart.basicChart.series;
 assert.deepEqual(series.map(s=>s.lineStyle.type),['SOLID','SOLID','SOLID','MEDIUM_DASHED','SOLID']);
 assert.deepEqual(series[0].colorStyle,series[3].colorStyle);
 assert.equal(chart.basicChart.axis[1].title,m.column==='AF'?'人':'通');}
 assert.ok(req.filter(r=>r.findReplace).every(r=>r.findReplace.replacement.includes('$AG')));
});
