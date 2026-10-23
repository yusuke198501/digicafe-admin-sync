import test from 'node:test';
import assert from 'node:assert/strict';
import {ageChartSeries} from './age-verification-chart.js';
test('age chart keeps actual, comparison, seven-day, forecast, average order and styles',()=>{
const result=ageChartSeries([['time','actual','comparison','seven','forecast','average'],[0,1,2,3,4,5]]);
assert.deepEqual(result.map(s=>s.series.sourceRange.sources[0].startColumnIndex),[42,43,44,45,46]);
assert.deepEqual(result.map(s=>s.lineStyle.type),['SOLID','SOLID','SOLID','MEDIUM_DASHED','SOLID']);
assert.deepEqual(result[0].colorStyle,result[3].colorStyle); assert.notDeepEqual(result[0].colorStyle,result[2].colorStyle);
});
test('missing history is omitted, not manufactured as zero',()=>{assert.equal(ageChartSeries([[],[0,8,'','','','']]).length,1);});
test('fresh real zeros are valid data',()=>{assert.equal(ageChartSeries([[],[0,0,0,0,0,0]]).length,5);});
