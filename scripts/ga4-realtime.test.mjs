import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseRealtime,fetchGa4Realtime,ga4OrBlank} from './ga4-realtime.mjs';
const report = value=>({metricHeaders:[{name:'activeUsers'}],rows:[{metricValues:[{value}]}]});
test('parse actual zero and positive counts',()=>{assert.equal(parseRealtime(report('0')),0);assert.equal(parseRealtime(report('123')),123);assert.equal(parseRealtime({metricHeaders:[{name:'activeUsers'}]}),0);});
test('reject malformed counts and headers',()=>{for(const v of ['-1','1.5','secret']) assert.throws(()=>parseRealtime(report(v)));assert.throws(()=>parseRealtime({}));});
test('request unique realtime total for correct property/window',async()=>{const calls=[];const n=await fetchGa4Realtime(JSON.stringify({client_id:'i',client_secret:'s',refresh_token:'r'}),async(url,opts)=>{calls.push([url,opts]);return {ok:true,json:async()=>calls.length===1?{access_token:'token'}:report('99')};});assert.equal(n,99);assert.match(calls[1][0],/312405480:runRealtimeReport$/);assert.deepEqual(JSON.parse(calls[1][1].body),{metrics:[{name:'activeUsers'}],minuteRanges:[{startMinutesAgo:29,endMinutesAgo:0}]});});
test('failure is blank, normal zero stays zero',async()=>{assert.equal(await ga4OrBlank(async()=>{throw new Error('secret');},()=>{}),'');assert.equal(await ga4OrBlank(async()=>0),0);});
