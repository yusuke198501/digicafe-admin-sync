export function parseRealtime(report) {
  if (report.metricHeaders?.length !== 1 || report.metricHeaders[0].name !== 'activeUsers') throw new Error('GA4_INVALID_REPORT');
  if (!report.rows?.length) return 0;
  if (report.rows.length !== 1) throw new Error('GA4_INVALID_REPORT');
  const value = report.rows[0].metricValues?.[0]?.value;
  if (!/^\d+$/.test(value ?? '') || !Number.isSafeInteger(Number(value))) throw new Error('GA4_INVALID_REPORT');
  return Number(value);
}
export async function fetchGa4Realtime(encoded = process.env.GA4_OAUTH_JSON, request = fetch) {
  let c;
  try { c = JSON.parse(encoded); } catch { throw new Error('GA4_CREDENTIALS_MISSING'); }
  if (![c.client_id,c.client_secret,c.refresh_token].every(v=>typeof v === 'string' && v)) throw new Error('GA4_CREDENTIALS_MISSING');
  // Only fixed Google endpoints receive OAuth credentials. Never log raw responses/errors.
  const tokenResponse = await request('https://oauth2.googleapis.com/token', {method:'POST',body:new URLSearchParams({client_id:c.client_id,client_secret:c.client_secret,refresh_token:c.refresh_token,grant_type:'refresh_token'}),signal:AbortSignal.timeout(20000)});
  if (!tokenResponse.ok) throw new Error('GA4_TOKEN_REFRESH_FAILED');
  const token = await tokenResponse.json();
  if (!token.access_token) throw new Error('GA4_TOKEN_REFRESH_FAILED');
  const response = await request('https://analyticsdata.googleapis.com/v1beta/properties/312405480:runRealtimeReport', {method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({metrics:[{name:'activeUsers'}],minuteRanges:[{startMinutesAgo:29,endMinutesAgo:0}]}),signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error('GA4_REPORT_HTTP_' + response.status);
  return parseRealtime(await response.json());
}
export async function ga4OrBlank(collect = fetchGa4Realtime, warn = console.warn) {
  try { return await collect(); } catch { warn('WARNING: GA4 realtime unavailable; Z left blank (not copied or zero-filled).'); return ''; }
}
