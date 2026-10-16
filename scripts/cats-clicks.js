const ENDPOINT = 'https://afad-api-shiba.catsys.jp/log/click/listspan';

export function clickWindows(timestamp) {
  if (!/^\d{4}-\d\d-\d\d (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(timestamp)) throw new Error('クリック集計日時が不正です。');
  const prefix = timestamp.slice(0,11), lastHour = Number(timestamp.slice(11,13));
  return Array.from({length:lastHour+1},(_,hour)=> {
    const base = prefix + String(hour).padStart(2,'0') + ':';
    return [base+'00',hour===lastHour?timestamp.slice(0,16):base+'59'];
  });
}

export function parseClickCount(data) {
  const errors = data?.errors;
  if (errors && (typeof errors !== 'object' || Object.keys(errors).length)) throw new Error('クリックAPIがエラーを返しました。');
  const logs = data?.params?.logs, total = Number(data?.params?.totalNum);
  if (!Array.isArray(logs) || data.params.totalNum == null || !Number.isSafeInteger(total) || total < 0 || total !== logs.length) throw new Error('クリックログが全件取得できません。');
  if (logs.some(l=>!l || typeof l.clientName !== 'string' || typeof l.contentName !== 'string')) throw new Error('クリックログの広告情報が不正です。');
  // Advertiser ID 8 and NORG were confirmed by the live API verification.
  return logs.filter(l => String(l.clientId)==='8' && l.clientName.trim().toLowerCase()==='norg' && l.contentName.includes('デジカフェ')).length;
}

export async function fetchClickCount(timestamp, token, {request=fetch,pause=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  if (!token) throw new Error('CATS_API_TOKEN is missing');
  let clicks = 0;
  const overall = AbortSignal.timeout(75000);
  const windows = clickWindows(timestamp);
  for (let i=0;i<windows.length;i++) {
    // API allows at most one request per second and at most one hour per query.
    if (i) await pause(1100);
    let response, data;
    try {
      overall.throwIfAborted();
      response = await request(ENDPOINT,{method:'POST',redirect:'error',signal:AbortSignal.any([overall,AbortSignal.timeout(15000)]),headers:{apiKey:token,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({clickDateTime:windows[i].join(' - ')})});
      if (!response.ok) throw new Error();
      data = await response.json();
    } catch { throw new Error('クリックAPIへの接続または応答の読み取りに失敗しました。'); }
    clicks += parseClickCount(data);
  }
  return clicks;
}
