import {test} from 'node:test';
import assert from 'node:assert/strict';
import {expandedSeries} from './expanded-chart.mjs';
test('expanded chart has 288 five-minute points and independent source',()=>{const s=expandedSeries([[],[0,1,2,3,4]]);assert.equal(s.length,4);assert.equal(s[0].series.sourceRange.sources[0].startRowIndex,1554);assert.equal(s[0].series.sourceRange.sources[0].endRowIndex,1843);assert.equal(s[0].series.sourceRange.sources[0].startColumnIndex,56);assert.equal(s[2].lineStyle.type,'MEDIUM_DASHED');assert.deepEqual(s[0].colorStyle,s[2].colorStyle);});
