import test from 'node:test';import assert from 'node:assert/strict';
import {setTimeout as pause} from 'node:timers/promises';
import {createReportPool,ReportFetchError,safeFetchFailure} from './partner-report-pool.js';
const url='https://log.digicafe.jp/partner/mailnum_uf?sex=0';
test('bounded workers use different sessions and never overlap requests within a PHP session',async()=>{
 let sessions=0,active=0,peak=0;const perSession=new Map();
 const pool=createReportPool({size:3,createSession:async()=>{
  const id=++sessions;return {get:async()=>{perSession.set(id,(perSession.get(id)||0)+1);assert.equal(perSession.get(id),1);peak=Math.max(peak,++active);await pause(2);active--;perSession.set(id,0);return {status:200,data:'ログアウト'};}};
 }});
 assert.deepEqual(await Promise.all(Array.from({length:12},()=>pool.get(url))),Array(12).fill('ログアウト'));
 assert.equal(sessions,3);assert.equal(peak,3);
});
test('transient GET failure retries once using a new session and never logs private error/config contents',async()=>{
 let sessions=0,calls=0;const logs=[];
 const pool=createReportPool({size:1,log:e=>logs.push(e),sleep:async()=>{},createSession:async()=>{sessions++;return {get:async()=>{calls++;if(calls===1)throw Object.assign(Error('private-password'),{code:'ECONNABORTED',config:{password:'private-password'}});return {status:200,data:'ログアウト'};}};}});
 assert.equal(await pool.get(url),'ログアウト');assert.equal(calls,2);assert.equal(sessions,2);
 assert.ok(!JSON.stringify(logs).includes('private-password'));assert.equal(logs[0].reason,'ECONNABORTED');
});
test('expired authentication retries once; permanent HTTP errors are not retried',async()=>{
 let sessions=0;
 const pool=createReportPool({size:1,sleep:async()=>{},createSession:async()=>{const i=++sessions;return {get:async()=>({status:200,data:i===1?'<input type="password">':'ログアウト'})};}});
 assert.equal(await pool.get(url),'ログアウト');assert.equal(sessions,2);
 let calls=0;const denied=createReportPool({createSession:async()=>({get:async()=>{calls++;throw {response:{status:403}};}})});
 await assert.rejects(denied.get(url),e=>e instanceof ReportFetchError&&e.reason==='HTTP 403');assert.equal(calls,1);
});
test('deadline prevents retries and rejects queued tasks without issuing new network requests',async()=>{
 let clock=0,calls=0;
 const pool=createReportPool({size:1,deadline:10,now:()=>clock,sleep:async()=>{},createSession:async()=>({get:async(_url,options)=>{assert.equal(options.timeout,10);calls++;clock=20;throw {code:'ECONNRESET'};}})});
 const results=await Promise.allSettled([pool.get(url),pool.get(url)]);
 assert.ok(results.every(r=>r.status==='rejected'));assert.equal(calls,1);
});
test('unsupported hosts are rejected before authentication and unknown errors are reduced to safe categories',async()=>{
 let sessions=0;const pool=createReportPool({createSession:async()=>{sessions++;}});
 await assert.rejects(pool.get('https://example.com/partner/list'));
 await assert.rejects(pool.get('https://log.digicafe.jp/admin/list'));
 assert.equal(sessions,0);assert.equal(safeFetchFailure(Error('private-cookie')),'parse/validation failure');
});
