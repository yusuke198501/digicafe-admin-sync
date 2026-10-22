import test from 'node:test';
import assert from 'node:assert/strict';
import { numberOrZero, valueOrDefault, requestOrNull } from './zero-on-missing.js';
import { reportMetrics } from './sync-mailnum2.js';

test('missing and invalid numeric metrics become zero without leaking errors', () => {
  const logs=[];
  assert.equal(numberOrZero('売上',()=>{throw new Error('secret');},s=>logs.push(s)),0);
  assert.equal(logs.some(s=>s.includes('secret')),false);
  for(const value of [undefined,null,NaN,Infinity,-1,'12']) assert.equal(numberOrZero('test',()=>value,()=>{}),0);
  for(const value of [0,12,1.5]) assert.equal(numberOrZero('test',()=>value),value);
});
test('failed requests do not abort independent successful data', async () => {
  const a=await requestOrNull('status/pt',async()=>{throw new Error('private');},()=>{});
  const b=await requestOrNull('mailnum_uf',async()=>({data:123}));
  assert.equal(a,null);assert.equal(b.data,123);
  const fallback=new Map();assert.equal(valueOrDefault('accounts',()=>{throw new Error();},fallback,()=>{}),fallback);
});
test('missing report tables produce numeric hourly zeros, not undefined writes', () => {
  const result=reportMetrics('',{display:'2026/10/22',iso:'2026-10-22'},9);
  assert.ok(result.accountSendStats instanceof Map);
  assert.ok(Object.entries(result).filter(([k])=>k!=='accountSendStats').every(([,v])=>v===0));
  assert.equal(result.grossDau,0);assert.equal(result.boxQDau,0);
});
test('available folder hourly data survives missing daily/summary tables', () => {
  const html='<h3>UF_MKT系データ(フォルダ別/時間毎)</h3><table><tr><th>時刻</th><th>A受信</th><th>Aやり取り</th><th>やり取り送信</th></tr><tr><td>8時</td><td>12</td><td>7</td><td>7</td></tr><tr><td>9時</td><td>4</td><td>3</td><td>3</td></tr></table>';
  const result=reportMetrics(html,{display:'2026/10/22',iso:'2026-10-22'},9);
  assert.equal(result.boxAReceivemails,12);assert.equal(result.boxASend,7);assert.equal(result.sendTotal,7);
  assert.equal(result.boxBReceivemails,0);assert.equal(result.receivemails,0);
});
