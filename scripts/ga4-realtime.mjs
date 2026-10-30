import {createSign} from 'node:crypto';

export function parseRealtime(report) {
  if (report.metricHeaders?.length !== 1 || report.metricHeaders[0].name !== 'activeUsers') throw new Error('GA4_INVALID_REPORT');
  if (!report.rows?.length) return 0;
  if (report.rows.length !== 1) throw new Error('GA4_INVALID_REPORT');
  const value = report.rows[0].metricValues?.[0]?.value;
  if (!/^\d+$/.test(value ?? '') || !Number.isSafeInteger(Number(value))) throw new Error('GA4_INVALID_REPORT');
  return Number(value);
}
export function realtimeRequest(maleOnly = true) {
  return {metrics:[{name:'activeUsers'}],minuteRanges:[{startMinutesAgo:4,endMinutesAgo:0}],...(maleOnly ? {dimensions:[{name:'audienceName'}],dimensionFilter:{filter:{fieldName:'audienceName',stringFilter:{matchType:'EXACT',value:'男性',caseSensitive:true}}}} : {})};
}
export function serviceAccountAssertion(c, now = Math.floor(Date.now()/1000)) {
  if (c.type !== 'service_account' || !c.client_email || !c.private_key) throw new Error('GA4_CREDENTIALS_MISSING');
  const encode = value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const content = encode({alg:'RS256',typ:'JWT'})+'.'+encode({
    iss:c.client_email,scope:'https://www.googleapis.com/auth/analytics.readonly',
    aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600
  });
  try { return content+'.'+createSign('RSA-SHA256').update(content).sign(c.private_key,'base64url'); }
  catch { throw new Error('GA4_SERVICE_ACCOUNT_SIGN_FAILED'); }
}
export function configuredGa4Credentials(env = process.env) {
  return env.GA4_AUTH_MODE === 'service_account' ? env.GOOGLE_SERVICE_ACCOUNT_JSON : env.GA4_OAUTH_JSON;
}
export async function fetchGa4Realtime(encoded = configuredGa4Credentials(), request = fetch) {
  let c;
  try { c = JSON.parse(encoded); } catch { throw new Error('GA4_CREDENTIALS_MISSING'); }
  const serviceAccount = c.type === 'service_account';
  if (!serviceAccount && ![c.client_id,c.client_secret,c.refresh_token].every(v=>typeof v === 'string' && v)) throw new Error('GA4_CREDENTIALS_MISSING');
  const body = serviceAccount
    ? new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:serviceAccountAssertion(c)})
    : new URLSearchParams({client_id:c.client_id,client_secret:c.client_secret,refresh_token:c.refresh_token,grant_type:'refresh_token'});
  // Only fixed Google endpoints receive OAuth credentials. Never log raw responses/errors.
  const tokenResponse = await request('https://oauth2.googleapis.com/token', {method:'POST',body,signal:AbortSignal.timeout(20000)});
  if (!tokenResponse.ok) throw new Error('GA4_TOKEN_REFRESH_FAILED');
  const token = await tokenResponse.json();
  if (!token.access_token) throw new Error('GA4_TOKEN_REFRESH_FAILED');
  console.log('GA4_AUTH_METHOD='+(serviceAccount?'service_account':'user_oauth'));
  if (process.env.GA4_PROBE_ONLY === 'true' && !serviceAccount) {
    const scope = typeof token.scope === 'string' ? token.scope.split(' ') : [];
    console.log('GA4_ANALYTICS_READ_SCOPE=' + scope.includes('https://www.googleapis.com/auth/analytics.readonly'));
    const infoResponse = await request('https://oauth2.googleapis.com/tokeninfo', {method:'POST',body:new URLSearchParams({access_token:token.access_token}),signal:AbortSignal.timeout(20000)});
    if (infoResponse.ok) {
      const info = await infoResponse.json();
      console.log('GA4_TOKENINFO_ANALYTICS_READ_SCOPE=' + String(info.scope ?? '').split(' ').includes('https://www.googleapis.com/auth/analytics.readonly'));
      if (/^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+$/.test(info.email ?? '')) console.log('GA4_AUTH_EMAIL=' + info.email);
      else console.log('GA4_AUTH_EMAIL_NOT_INCLUDED_IN_EXISTING_SCOPE');
    }
  }
  const query=realtimeRequest();
  const response = await request('https://analyticsdata.googleapis.com/v1beta/properties/312405480:runRealtimeReport', {method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(query),signal:AbortSignal.timeout(20000)});
  if (!response.ok) {
    const failure = await response.json().catch(()=>({}));
    const reason = failure.error?.details?.find(d=>/^[A-Z_]+$/.test(d.reason ?? ''))?.reason;
    const category = reason ?? (/sufficient permissions|permission.*property/i.test(failure.error?.message ?? '') ? 'PROPERTY_ACCESS_DENIED' : 'REQUEST_DENIED');
    throw new Error('GA4_REPORT_HTTP_' + response.status + '_' + category);
  }
  const report=await response.json();
  if (query.dimensionFilter && report.rows?.some(row=>row.dimensionValues?.[0]?.value !== '男性')) throw new Error('GA4_AUDIENCE_MISMATCH');
  return parseRealtime(report);
}
export async function ga4OrBlank(collect = fetchGa4Realtime, warn = console.warn) {
  try { return await collect(); } catch { warn('WARNING: GA4 realtime unavailable; Z left blank (not copied or zero-filled).'); return ''; }
}
