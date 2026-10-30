import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createVerify} from 'node:crypto';
import {parseRealtime,fetchGa4Realtime,ga4OrBlank,realtimeRequest,serviceAccountAssertion,configuredGa4Credentials} from './ga4-realtime.mjs';
const report = value=>({metricHeaders:[{name:'activeUsers'}],rows:[{metricValues:[{value}]}]});
test('parse actual zero and positive counts',()=>{assert.equal(parseRealtime(report('0')),0);assert.equal(parseRealtime(report('123')),123);assert.equal(parseRealtime({metricHeaders:[{name:'activeUsers'}]}),0);});
test('reject malformed counts and headers',()=>{for(const v of ['-1','1.5','secret']) assert.throws(()=>parseRealtime(report(v)));assert.throws(()=>parseRealtime({}));});
test('request unique male realtime total for correct property/window',async()=>{const calls=[];const n=await fetchGa4Realtime(JSON.stringify({client_id:'i',client_secret:'s',refresh_token:'r'}),async(url,opts)=>{calls.push([url,opts]);return {ok:true,json:async()=>calls.length===1?{access_token:'token'}:{...report('99'),rows:[{dimensionValues:[{value:'男性'}],metricValues:[{value:'99'}]}]}};});assert.equal(n,99);assert.match(calls[1][0],/312405480:runRealtimeReport$/);assert.deepEqual(JSON.parse(calls[1][1].body),realtimeRequest(true));});
test('failure is blank, normal zero stays zero',async()=>{assert.equal(await ga4OrBlank(async()=>{throw new Error('secret');},()=>{}),'');assert.equal(await ga4OrBlank(async()=>0),0);});
test('male filter is exact audience membership, not all users',()=>{const q=realtimeRequest(true);assert.equal(q.dimensionFilter.filter.fieldName,'audienceName');assert.equal(q.dimensionFilter.filter.stringFilter.value,'男性');assert.equal(q.dimensionFilter.filter.stringFilter.matchType,'EXACT');assert.deepEqual(q.minuteRanges,[{startMinutesAgo:4,endMinutesAgo:0}]);});
test('production defaults to male audience',()=>assert.deepEqual(realtimeRequest(),realtimeRequest(true)));

const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const serviceCredential={type:'service_account',client_email:'test@example.iam.gserviceaccount.com',private_key:keys.privateKey.export({type:'pkcs8',format:'pem'})};
test('service account assertion is signed and restricted to Analytics read access',()=>{
  const jwt=serviceAccountAssertion(serviceCredential,1700000000);
  const [header,payload,signature]=jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header,'base64url')),{alg:'RS256',typ:'JWT'});
  assert.deepEqual(JSON.parse(Buffer.from(payload,'base64url')),{
    iss:serviceCredential.client_email,scope:'https://www.googleapis.com/auth/analytics.readonly',
    aud:'https://oauth2.googleapis.com/token',iat:1700000000,exp:1700003600
  });
  assert.equal(createVerify('RSA-SHA256').update(header+'.'+payload).verify(keys.publicKey,Buffer.from(signature,'base64url')),true);
});
test('service mode uses existing service credential and never silently falls back to OAuth',()=>{
  assert.equal(configuredGa4Credentials({GA4_AUTH_MODE:'service_account',GOOGLE_SERVICE_ACCOUNT_JSON:'service',GA4_OAUTH_JSON:'oauth'}),'service');
  assert.equal(configuredGa4Credentials({GA4_AUTH_MODE:'service_account',GA4_OAUTH_JSON:'oauth'}),undefined);
  assert.equal(configuredGa4Credentials({GA4_OAUTH_JSON:'oauth'}),'oauth');
});
test('service account exchanges JWT and requests the same male five-minute report',async()=>{
  const calls=[];
  const n=await fetchGa4Realtime(JSON.stringify(serviceCredential),async(url,opts)=>{
    calls.push([url,opts]);
    return {ok:true,json:async()=>calls.length===1?{access_token:'token'}:{...report('77'),rows:[{dimensionValues:[{value:'男性'}],metricValues:[{value:'77'}]}]}};
  });
  assert.equal(n,77);
  assert.equal(calls[0][0],'https://oauth2.googleapis.com/token');
  assert.equal(calls[0][1].body.get('grant_type'),'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(calls[0][1].body.has('refresh_token'),false);
  assert.deepEqual(JSON.parse(calls[1][1].body),realtimeRequest(true));
});
test('service signing and access failures do not expose credentials or copy old values',async()=>{
  assert.throws(()=>serviceAccountAssertion({...serviceCredential,private_key:'private-key-test'}),/^Error: GA4_SERVICE_ACCOUNT_SIGN_FAILED$/);
  const collect=()=>fetchGa4Realtime(JSON.stringify(serviceCredential),async()=>({ok:false,status:400}));
  await assert.rejects(collect,/^Error: GA4_TOKEN_REFRESH_FAILED$/);
  assert.equal(await ga4OrBlank(collect,()=>{}),'');
});
