import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ga4ChartSeries} from './ga4-chart.mjs';
test('GA4 missing history excluded, genuine zero included',()=>{const s=ga4ChartSeries([[],[0,0,'','','','']]);assert.equal(s.length,1);assert.equal(s[0].series.sourceRange.sources[0].startColumnIndex,50);});
test('GA4 prediction remains blue dashed, history colors distinct',()=>{const s=ga4ChartSeries([[],[0,1,2,3,4,5]]);assert.equal(s.length,5);assert.equal(s[3].lineStyle.type,'MEDIUM_DASHED');assert.deepEqual(s[0].colorStyle,s[3].colorStyle);assert.notDeepEqual(s[2].colorStyle,s[4].colorStyle);});
