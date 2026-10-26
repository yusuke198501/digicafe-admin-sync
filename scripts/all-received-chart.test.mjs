import test from 'node:test';
import assert from 'node:assert/strict';
import {allReceivedSeries} from './all-received-chart.mjs';
test('full receive chart keeps semantic colors, prediction dashed and matching ranges',()=>{
  const s=allReceivedSeries([[],[0,10,20,30,40,50]]);
  assert.equal(s.length,5);
  assert.deepEqual(s.map(x=>x.lineStyle.type),['SOLID','SOLID','SOLID','MEDIUM_DASHED','SOLID']);
  assert.deepEqual(s[0].colorStyle,s[3].colorStyle);
  assert.notDeepEqual(s[0].colorStyle,s[2].colorStyle);
  assert.notDeepEqual(s[2].colorStyle,s[4].colorStyle);
  for(const x of s){const r=x.series.sourceRange.sources[0];assert.equal(r.endRowIndex-r.startRowIndex,49);}
  const one=allReceivedSeries([[],[0,10,'','','','']]);
  assert.equal(one.length,1); assert.equal(one[0].lineStyle.type,'SOLID');
});
