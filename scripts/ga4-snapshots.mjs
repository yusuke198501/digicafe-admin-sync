export const GA4_SHEET = "'_GA4_5分'";
export function fullCollectionDue(timestamp) {
  return Number(timestamp.slice(14,16)) % 30 < 5;
}
export function ga4Slot(timestamp) {
  if (!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(timestamp)) throw Error('Invalid GA4 timestamp');
  return timestamp.slice(0,14) + String(Math.floor(Number(timestamp.slice(14,16))/5)*5).padStart(2,'0');
}
export async function recordGa4Snapshot(sheets, spreadsheetId, timestamp, count) {
  if (!Number.isSafeInteger(count) || count < 0) throw Error('Invalid GA4 active-user count');
  const stamps = (await sheets.spreadsheets.values.get({spreadsheetId,range:GA4_SHEET+'!A2:A'})).data.values ?? [];
  if (stamps.slice(-100).some(r=>ga4Slot(String(r[0]))===ga4Slot(timestamp))) return false;
  const row=[ga4Slot(timestamp)+':00',count];
  const result=await sheets.spreadsheets.values.append({spreadsheetId,range:GA4_SHEET+'!A:B',valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',requestBody:{values:[row]}});
  const range=result.data.updates?.updatedRange;
  if(!range)throw Error('Missing GA4 write result');
  const read=(await sheets.spreadsheets.values.get({spreadsheetId,range,valueRenderOption:'UNFORMATTED_VALUE'})).data.values;
  if(JSON.stringify(read)!==JSON.stringify([row]))throw Error('GA4 readback mismatch');
  console.log(JSON.stringify({ga4Range:range,timestamp:row[0],activeUsers:count}));
  return true;
}
