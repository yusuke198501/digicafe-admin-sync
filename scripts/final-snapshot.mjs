export function finalSnapshotTimestamp(now) {
  const day=new Date(now.slice(0,10)+'T00:00:00Z');
  day.setUTCDate(day.getUTCDate()-1);
  return day.toISOString().slice(0,10)+' 23:59:59';
}
export function isFinalSnapshotRun(now) {
  return now.slice(11,13)==='00' && Number(now.slice(14,16))>=10 && Number(now.slice(14,16))<15;
}
export async function saveFinalSnapshot(sheets,spreadsheetId,timestamps,row) {
  const exact=timestamps.findIndex(r=>String(r[0])===row[0]);
  const next=timestamps.findIndex(r=>String(r[0])>row[0]);
  const index=exact>=0?exact:next>=0?next:timestamps.length;
  const rowNumber=index+2, sheetId=1467610996;
  const width=Math.max(31,row.length);
  let n=width, endColumn="";
  while(n){n--;endColumn=String.fromCharCode(65+n%26)+endColumn;n=Math.floor(n/26);}
  if(exact<0 && next>=0) {
    await sheets.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests:[
      {insertDimension:{range:{sheetId,dimension:'ROWS',startIndex:rowNumber-1,endIndex:rowNumber},inheritFromBefore:true}},
      {copyPaste:{source:{sheetId,startRowIndex:rowNumber-2,endRowIndex:rowNumber-1,startColumnIndex:0,endColumnIndex:width},destination:{sheetId,startRowIndex:rowNumber-1,endRowIndex:rowNumber,startColumnIndex:0,endColumnIndex:width},pasteType:'PASTE_FORMAT'}}
    ]}});
  }
  const range="'シート8'!A"+rowNumber+':'+endColumn+rowNumber;
  await sheets.spreadsheets.values.update({spreadsheetId,range,valueInputOption:'RAW',requestBody:{values:[row]}});
  return {data:{updates:{updatedRange:range}}};
}
