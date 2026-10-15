const base = 'https://afad-api-shiba.catsys.jp';
const token = process.env.CATS_API_TOKEN;
if (!token) throw new Error('CATS_API_TOKEN is not configured');
const end = new Date(Date.now() + 9 * 3600000).toISOString().slice(0,16).replace('T',' ');
const start = end.slice(0,10) + ' 00:00';
const logs = [];
let total = 0;
for (let hour = 0; hour <= Number(end.slice(11,13)); hour++) {
const hourStart = start.slice(0,11) + String(hour).padStart(2,'0') + ':00';
const hourEnd = hour === Number(end.slice(11,13)) ? end : hourStart.slice(0,14) + '59';
if (hour) await new Promise(resolve => setTimeout(resolve,1100));
const response = await fetch(base + '/log/click/listspan', {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90000),
  headers: { apiKey: token, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({clickDateTime: hourStart + ' - ' + hourEnd})
});
if (!response.ok) throw new Error('CATS HTTP status ' + response.status);
const data = await response.json();
if (data.errors?.length || !Array.isArray(data.params?.logs)) {
  const errors = JSON.stringify(data.errors ?? []).split(token).join('[REDACTED]').slice(0,1500);
  throw new Error('CATS response invalid: code=' + String(data.code) + ' errors=' + errors);
}
const chunkTotal = Number(data.params.totalNum);
if (!Number.isSafeInteger(chunkTotal) || chunkTotal !== data.params.logs.length) throw new Error('Incomplete hourly click logs');
logs.push(...data.params.logs);
total += chunkTotal;
}
console.log(JSON.stringify({periodStart:start,periodEnd:end,totalNum:total,returnedLogs:logs.length}));
if (!Number.isSafeInteger(total) || total !== logs.length) throw new Error('Incomplete click logs; refusing to report count');
const matches = logs.filter(l => String(l.clientName).trim().toLowerCase() === 'norg' && String(l.contentName).includes('デジカフェ'));
const ads = new Map();
for (const l of matches) {
  const key = JSON.stringify([l.clientId,l.clientName,l.contentId,l.contentName]);
  ads.set(key,(ads.get(key)||0)+1);
}
console.log(JSON.stringify({clicks:matches.length,ads:[...ads].map(([k,count])=>({identity:JSON.parse(k),count}))}));
