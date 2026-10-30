import {google} from 'googleapis';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export const SOURCE='11Zoev9Sptv3x6kxx00i8BoVk8jaWPNcKiuJ_oh_xde8';
export const DESTINATION='1gsDZpoK1WZ4iZN4F8AqCdRw2EJotpixposi8KgIy4gU';
export const PLAN=[
  [1467610996,'シート8'],[174166888,'グラフ'],[1638130807,'日毎集計'],[940331649,'シート12'],
  [1876410221,'_退会毎時キャッシュ'],[1926102701,'_5分増加量計算'],
  [2134298915,'_既存指標グラフ'],[1926103001,'_登録月別ログイングラフ']
];
const MARKER_ID=1926103050,MARKER='_分析移行管理',VERSION='analysis-migration-20261030-v1';
const quote=t=>"'"+t.replaceAll("'","''")+"'";
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fields='spreadsheetId,properties(title,locale,timeZone),namedRanges,sheets(properties,charts,merges,basicFilter,conditionalFormats,bandedRanges)';
export function validateSource(book){
  if(book.spreadsheetId!==SOURCE)throw Error('Wrong source');
  for(const [id,title]of PLAN)if(!book.sheets.some(s=>s.properties.sheetId===id&&s.properties.title===title))throw Error('Source identity mismatch: '+title);
}
export function formulaRequests(sheetId,rows){
  const result=[];
  for(let r=0;r<rows.length;r++)for(let c=0;c<rows[r].length;c++){
    const formula=rows[r][c]?.userEnteredValue?.formulaValue;
    if(typeof formula==='string'&&formula.startsWith('='))result.push({updateCells:{start:{sheetId,rowIndex:r,columnIndex:c},rows:[{values:[{userEnteredValue:{formulaValue:formula}}]}],fields:'userEnteredValue'}});
  }
  return result;
}
function assertDestination(book){
  if(book.spreadsheetId!==DESTINATION||SOURCE===DESTINATION)throw Error('Wrong destination');
  const marker=book.sheets.find(s=>s.properties.sheetId===MARKER_ID);
  if(marker&&marker.properties.title!==MARKER)throw Error('Migration marker collision');
  for(const[id,title]of PLAN){
    const found=book.sheets.find(s=>s.properties.sheetId===id||s.properties.title===title);
    if(found&&(!marker||found.properties.sheetId!==id||found.properties.title!==title))throw Error('Destination sheet collision: '+title);
  }
}
export async function migrate(sheets,phase='stage'){
  const get=id=>sheets.spreadsheets.get({spreadsheetId:id,fields}).then(r=>r.data);
  const values=async(id,range)=>((await sheets.spreadsheets.values.get({spreadsheetId:id,range,valueRenderOption:'FORMULA'})).data.values??[]);
  const batch=async requests=>{if(requests.length)await sheets.spreadsheets.batchUpdate({spreadsheetId:DESTINATION,requestBody:{requests}});};
  const source=await get(SOURCE);validateSource(source);
  let target=await get(DESTINATION);assertDestination(target);
  if(phase==='stage'||phase==='core'){
    if(process.env.MIGRATION_SOURCE_PAUSED!=='true')throw Error('Pause the five-minute workflow and finish its active run before staging');
    if(!target.sheets.some(s=>s.properties.sheetId===MARKER_ID)){
      await batch([{addSheet:{properties:{sheetId:MARKER_ID,title:MARKER,hidden:true,gridProperties:{rowCount:10,columnCount:4}}}},{updateCells:{start:{sheetId:MARKER_ID,rowIndex:0,columnIndex:0},rows:[{values:[{userEnteredValue:{stringValue:VERSION}},{userEnteredValue:{stringValue:SOURCE}}]}],fields:'userEnteredValue'}}]);
    }else if((await values(DESTINATION,quote(MARKER)+'!A1:B1'))[0]?.join('|')!==VERSION+'|'+SOURCE)throw Error('Invalid migration marker');
    for(const[id,title]of PLAN.filter(([id])=>phase!=='core'||id!==940331649)){
      target=await get(DESTINATION);
      if(target.sheets.some(s=>s.properties.sheetId===id))continue;
      const tempTitle='_移行_'+id;
      let temporary=target.sheets.find(s=>s.properties.title===tempTitle)?.properties.sheetId;
      if(temporary===undefined){
        const copied=await sheets.spreadsheets.sheets.copyTo({spreadsheetId:SOURCE,sheetId:id,requestBody:{destinationSpreadsheetId:DESTINATION}});
        temporary=copied.data.sheetId;
        await batch([{updateSheetProperties:{properties:{sheetId:temporary,title:tempTitle},fields:'title'}}]);
      }
      // The final IDs stay unchanged, so existing chart and updater guards remain valid.
      await batch([{duplicateSheet:{sourceSheetId:temporary,newSheetId:id,newSheetName:title}},{deleteSheet:{sheetId:temporary}}]);
      const original=source.sheets.find(s=>s.properties.sheetId===id).properties;
      await batch([{updateSheetProperties:{properties:{sheetId:id,hidden:original.hidden??false},fields:'hidden'}}]);
      console.log('COPIED '+title+' sheetId='+id);
    }
    // Restore cross-sheet formulas after all referenced tabs exist. Never read member message bodies.
    for(const[id,title]of PLAN.filter(([id])=>![1467610996,940331649].includes(id))){
      const p=source.sheets.find(s=>s.properties.sheetId===id).properties;
      const formulaData=await sheets.spreadsheets.get({spreadsheetId:SOURCE,ranges:[quote(title)+'!A1:'+column(p.gridProperties.columnCount)+p.gridProperties.rowCount],includeGridData:true,fields:'sheets(data(rowData(values(userEnteredValue(formulaValue)))))'});
      const rows=(formulaData.data.sheets[0].data?.[0]?.rowData??[]).map(r=>r.values??[]);
      const requests=formulaRequests(id,rows);
      for(let i=0;i<requests.length;i+=500){await batch(requests.slice(i,i+500));await pause();}
      console.log('FORMULAS_RESTORED '+title+' count='+requests.length);
    }
    // Recreate only copied graph objects with their exact source IDs/specs/ranges.
    target=await get(DESTINATION);
    const chartRequests=[];
    for(const[id]of PLAN.filter(([id])=>phase!=='core'||id!==940331649)){
      const current=target.sheets.find(s=>s.properties.sheetId===id);
      for(const c of current.charts??[])chartRequests.push({deleteEmbeddedObject:{objectId:c.chartId}});
    }
    for(const[id]of PLAN.filter(([id])=>phase!=='core'||id!==940331649))for(const c of source.sheets.find(s=>s.properties.sheetId===id).charts??[])chartRequests.push({addChart:{chart:c}});
    await batch(chartRequests);
    const named=(source.namedRanges??[]).filter(n=>PLAN.some(([id])=>n.range.sheetId===id));
    const existingNamed=new Set((target.namedRanges??[]).map(n=>n.name));
    await batch(named.filter(n=>!existingNamed.has(n.name)).map(n=>({addNamedRange:{namedRange:n}})));
    // The graph's validated date/time selectors retain the original constraints.
    const controls=await sheets.spreadsheets.get({spreadsheetId:SOURCE,ranges:["'グラフ'!B3:K3","'グラフ'!K5:L5","'グラフ'!L8"],includeGridData:true,fields:'sheets(data(startRow,startColumn,rowData(values(userEnteredValue,dataValidation))))'});
    const restore=[];
    for(const d of controls.data.sheets.flatMap(s=>s.data??[]))for(const[r,row]of(d.rowData??[]).entries())for(const[c,cell]of(row.values??[]).entries())if(cell.userEnteredValue||cell.dataValidation)restore.push({updateCells:{start:{sheetId:174166888,rowIndex:(d.startRow??0)+r,columnIndex:(d.startColumn??0)+c},rows:[{values:[cell]}],fields:'userEnteredValue,dataValidation'}});
    await batch(restore);
  }
  if(phase==='members')await copyMembersInChunks(sheets,source);
  target=await get(DESTINATION);assertDestination(target);
  for(const[id,title]of PLAN.filter(([id])=>phase==='members'?id===940331649:phase==='core'?id!==940331649:true)){
    const a=source.sheets.find(s=>s.properties.sheetId===id),b=target.sheets.find(s=>s.properties.sheetId===id);
    if(!b||a.properties.gridProperties.columnCount!==b.properties.gridProperties.columnCount||(id!==1467610996&&a.properties.gridProperties.rowCount!==b.properties.gridProperties.rowCount))throw Error('Dimensions mismatch: '+title);
    const headerRange=quote(title)+'!A1:'+column(Math.min(16,a.properties.gridProperties.columnCount))+'1';
    const sourceHeader=await values(SOURCE,headerRange),targetHeader=await values(DESTINATION,headerRange);
    if(hash(sourceHeader)!==hash(targetHeader))throw Error('Header mismatch: '+title);
  }
  if(phase==='core'){
    const rows=source.sheets.find(s=>s.properties.sheetId===1467610996).properties.gridProperties.rowCount;
    if(hash(await values(SOURCE,"'シート8'!A1:AC"+rows))!==hash(await values(DESTINATION,"'シート8'!A1:AC"+rows)))throw Error('Snapshot values mismatch');
    console.log('CORE_VERIFIED 7 sheets; member history transfers independently');return;
  }
  const sourceMembers=await values(SOURCE,"'シート12'!A1:P3128"),targetMembers=await values(DESTINATION,"'シート12'!A1:P3128");
  if(hash(sourceMembers)!==hash(targetMembers))throw Error('Member metadata mismatch');
  // Sample message chunks are hashed in memory; their contents never enter logs.
  for(const row of [2,1564,3128]){
    const range="'シート12'!Q"+row+':R'+row;
    if(hash(await values(SOURCE,range))!==hash(await values(DESTINATION,range)))throw Error('Message sample mismatch at row '+row);
  }
  const sourceCharts=source.sheets.find(s=>s.properties.sheetId===174166888).charts??[],targetCharts=target.sheets.find(s=>s.properties.sheetId===174166888).charts??[];
  if(sourceCharts.length!==targetCharts.length||sourceCharts.some(c=>!targetCharts.some(t=>t.chartId===c.chartId&&t.spec.title===c.spec.title)))throw Error('Chart identity mismatch');
  const daily=await values(DESTINATION,"'日毎集計'!A2");
  if(!daily[0]?.[0]?.includes("'シート8'!"))throw Error('Daily formula mismatch');
  console.log('VERIFIED sheets='+PLAN.length+' charts='+sourceCharts.length+' members='+(sourceMembers.length-1)+' historyCount='+sourceMembers.slice(1).reduce((n,r)=>n+Number(r[14]??0),0));
}
const pause=()=>new Promise(resolve=>setTimeout(resolve,1100));
export function valueRows(rows){
  const normalized=rows.map(r=>{const values=(r.values??[]).map(c=>c.userEnteredValue??null);while(values.length&&values.at(-1)===null)values.pop();return values;});
  while(normalized.length&&!normalized.at(-1).length)normalized.pop();return normalized;
}
async function copyMembersInChunks(sheets,source){
  const id=940331649,title='シート12',original=source.sheets.find(s=>s.properties.sheetId===id);
  const target=(await sheets.spreadsheets.get({spreadsheetId:DESTINATION,fields:'sheets(properties(sheetId,title))'})).data;
  if(!target.sheets.some(s=>s.properties.sheetId===MARKER_ID&&s.properties.title===MARKER))throw Error('Migration marker missing');
  const batch=requests=>sheets.spreadsheets.batchUpdate({spreadsheetId:DESTINATION,requestBody:{requests}});
  if(!target.sheets.some(s=>s.properties.sheetId===id)){
    const {index,...properties}=original.properties;
    await batch([{addSheet:{properties}}]);
  }
  const marker=(await sheets.spreadsheets.values.get({spreadsheetId:DESTINATION,range:quote(MARKER)+'!A1:D5'})).data.values??[];
  if(marker[0]?.[0]!==VERSION||marker[0]?.[1]!==SOURCE)throw Error('Invalid migration marker');
  const total=original.properties.gridProperties.rowCount;
  let completed=Number(marker[4]?.[2]??0);
  if(!Number.isInteger(completed)||completed<0||completed>total)throw Error('Invalid member transfer cursor');
  const cellFields='sheets(data(rowData(values(userEnteredValue,userEnteredFormat,textFormatRuns,note,dataValidation))))';
  for(let start=completed;start<total;start+=25){
    const end=Math.min(start+25,total),range=quote(title)+'!A'+(start+1)+':CV'+end;
    const result=await sheets.spreadsheets.get({spreadsheetId:SOURCE,ranges:[range],includeGridData:true,fields:cellFields});await pause();
    const rows=result.data.sheets[0].data?.[0]?.rowData??[];
    // Split large message rows by columns; no request exceeds roughly 1.5 MB.
    let requests=[],bytes=0;
    async function flush(){if(requests.length){await batch(requests);await pause();requests=[];bytes=0;}}
    for(let r=0;r<rows.length;r++)for(let c=0;c<(rows[r].values??[]).length;c+=10){
      const cells=rows[r].values.slice(c,c+10),request={updateCells:{start:{sheetId:id,rowIndex:start+r,columnIndex:c},rows:[{values:cells}],fields:'userEnteredValue,userEnteredFormat,textFormatRuns,note,dataValidation'}};
      const size=Buffer.byteLength(JSON.stringify(request));if(bytes+size>1500000)await flush();requests.push(request);bytes+=size;
    }
    await flush();
    const written=await sheets.spreadsheets.get({spreadsheetId:DESTINATION,ranges:[range],includeGridData:true,fields:'sheets(data(rowData(values(userEnteredValue))))'});await pause();
    const actual=written.data.sheets[0].data?.[0]?.rowData??[];
    if(hash(valueRows(rows))!==hash(valueRows(actual)))throw Error('Member chunk verification failed at row '+(start+1));
    await batch([{updateCells:{start:{sheetId:MARKER_ID,rowIndex:4,columnIndex:2},rows:[{values:[{userEnteredValue:{numberValue:end}}]}],fields:'userEnteredValue'}}]);await pause();
    if(end%250===0||end===total)console.log('MEMBERS_VERIFIED rows='+end+'/'+total);
  }
  const dimensions=await sheets.spreadsheets.get({spreadsheetId:SOURCE,ranges:[quote(title)+'!A1:CV'+total],includeGridData:true,fields:'sheets(data(rowMetadata(pixelSize,hiddenByUser),columnMetadata(pixelSize,hiddenByUser)))'});
  const grid=dimensions.data.sheets[0].data?.[0]??{},requests=[];
  for(const[dimension,items]of [['ROWS',grid.rowMetadata??[]],['COLUMNS',grid.columnMetadata??[]]]){
    for(let start=0;start<items.length;){let end=start+1;while(end<items.length&&JSON.stringify(items[end])===JSON.stringify(items[start]))end++;if(Object.keys(items[start]).length)requests.push({updateDimensionProperties:{range:{sheetId:id,dimension,startIndex:start,endIndex:end},properties:items[start],fields:Object.keys(items[start]).join(',')}});start=end;}
  }
  if(original.basicFilter)requests.push({setBasicFilter:{filter:original.basicFilter}});
  for(const range of original.merges??[])requests.push({mergeCells:{range,mergeType:'MERGE_ALL'}});
  for(const[ index,rule]of(original.conditionalFormats??[]).entries())requests.push({addConditionalFormatRule:{rule,index}});
  for(const b of original.bandedRanges??[]){const{bandedRangeId,...bandedRange}=b;requests.push({addBanding:{bandedRange}});}
  if(requests.length)await batch(requests);
  console.log('MEMBER_TRANSFER_COMPLETE all cell values verified in chunks');
}
function column(n){let result='';for(;n>0;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;return result;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const credentials=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const sheets=google.sheets({version:'v4',auth:new google.auth.GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/spreadsheets']})});
  migrate(sheets,process.env.MIGRATION_PHASE??'verify').catch(e=>{console.error('MIGRATION_FAILED '+(e.response?.status??e.code??'')+' '+(e.response?'Google API request failed':e.message));process.exitCode=1;});
}
