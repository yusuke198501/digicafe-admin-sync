import test from 'node:test';
import assert from 'node:assert/strict';
import {deltaChartSpec,sameSeriesStyle} from './delta-charts.mjs';
function chart(id, cols) {return {chartId:id,spec:{title:'unchanged',basicChart:{series:cols.map(c=>({series:{sourceRange:{sources:[{sheetId:174166888,startColumnIndex:c,startRowIndex:1899,endRowIndex:2188}]}},color:{red:1}}))}}};}
test('each forecast matches its actual color and is always dashed; averages remain solid',()=>{
 const original=chart(1213750843,[3,7,11,13,12,14]); const spec=deltaChartSpec(original); const s=spec.basicChart.series;
 assert.deepEqual(s[0].colorStyle,s[2].colorStyle); assert.deepEqual(s[1].colorStyle,s[3].colorStyle);
 assert.deepEqual(s.map(x=>x.lineStyle.type),['SOLID','SOLID','MEDIUM_DASHED','MEDIUM_DASHED','SOLID','SOLID']);
 assert.equal(spec.title,'unchanged'); assert.ok(original.spec.basicChart.series[0].color);
 assert.ok(s.every(x=>x.targetAxis==='LEFT_AXIS'));
});
test('broadcast receive actual, prediction and average all use the right axis',()=>{
 const spec=deltaChartSpec(chart(2074059065,[5,9,15,17,16,18]));
 assert.deepEqual(spec.basicChart.series.map(s=>s.targetAxis),['LEFT_AXIS','RIGHT_AXIS','LEFT_AXIS','RIGHT_AXIS','LEFT_AXIS','RIGHT_AXIS']);
 assert.ok(spec.basicChart.axis.some(a=>a.position==='RIGHT_AXIS'));
});
test('reject changed chart layout instead of assigning styles to the wrong metrics',()=>{
 assert.throws(()=>deltaChartSpec(chart(1213750843,[3,7,11,12,13,14])),/Unexpected/);
 assert.equal(deltaChartSpec({chartId:123}),null);
});
test('Google color rounding and omitted zero channels do not cause a false verification failure',()=>{
 const desired=deltaChartSpec(chart(1213750843,[3,7,11,13,12,14])).basicChart.series[3];
 const returned=structuredClone(desired);
 returned.colorStyle.rgbColor={red:0.600000024,blue:1};
 assert.ok(sameSeriesStyle(returned,desired));
 returned.lineStyle.type='SOLID'; assert.equal(sameSeriesStyle(returned,desired),false);
});
