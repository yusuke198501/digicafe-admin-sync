import {writeFileSync} from 'node:fs';
import {METRICS,VERSION,buildHistory} from './historical-forecast.mjs';
import {MODEL_TITLE,MODEL_ID,discoverBindings,fitModels,modelRows,predictionRequests,chartStyleRequests} from './forecast-sheet.mjs';
const jstDate=now=>new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
function asCell(v){return {userEnteredValue:typeof v==='number'?{numberValue:v}:typeof v==='boolean'?{boolValue:v}:String(v).startsWith('=')?{formulaValue:v}:{stringValue:String(v)}};}
export function requestChunks(requests,maxBytes=1400000){const chunks=[];let chunk=[],bytes=0;for(const request of requests){const n=Buffer.byteLength(JSON.stringify(request));if(bytes+n>maxBytes&&chunk.length){chunks.push(chunk);chunk=[];bytes=0;}chunk.push(request);bytes+=n;}if(chunk.length)chunks.push(chunk);return chunks;}
export async function refreshHistoricalForecast(sheets,spreadsheetId,{force=false,now=new Date(),backupPath}={}){
 const date=jstDate(now);let saved=[];
 try{saved=(await sheets.spreadsheets.values.get({spreadsheetId,range:`'${MODEL_TITLE}'!AZ1:AZ7`,valueRenderOption:'UNFORMATTED_VALUE'})).data.values??[];}catch(e){if(e.code!==400&&e.response?.status!==400)throw e;}
 if(!force&&saved[0]?.[0]===VERSION&&saved[1]?.[0]===date){console.log('Historical forecast: daily model already current; formulas use live observations.');return{cached:true};}
 const {data:book}=await sheets.spreadsheets.get({spreadsheetId,fields:'sheets(properties,charts(chartId,spec,position))'});
 const graph=book.sheets.find(s=>s.properties.sheetId===174166888),source=book.sheets.find(s=>s.properties.sheetId===1467610996);
 if(graph?.properties.title!=='グラフ'||source?.properties.title!=='シート8')throw Error('Forecast workbook identity mismatch');
 const model=book.sheets.find(s=>s.properties.title===MODEL_TITLE);if(model&&model.properties.sheetId!==MODEL_ID||book.sheets.some(s=>s.properties.sheetId===MODEL_ID&&s.properties.title!==MODEL_TITLE))throw Error('Forecast model sheet collision');
 const stamps=(await sheets.spreadsheets.values.get({spreadsheetId,range:"'シート8'!A2:A",valueRenderOption:'UNFORMATTED_VALUE'})).data.values??[];
 const since=new Date(Date.parse(date+'T00:00:00Z')-35*86400000).toISOString().slice(0,10);
 const indices=stamps.flatMap((r,i)=>typeof r[0]==='string'&&r[0].slice(0,10)>=since&&r[0].slice(0,10)<date?[i+2]:[]);
 if(!indices.length)throw Error('No completed history for forecast');
 const [raw,ga4,comparison,headers]=await Promise.all([
  sheets.spreadsheets.values.get({spreadsheetId,range:`'シート8'!A${indices[0]}:AS${indices.at(-1)}`,valueRenderOption:'UNFORMATTED_VALUE'}),
  sheets.spreadsheets.values.get({spreadsheetId,range:"'_GA4_5分'!A2:B",valueRenderOption:'UNFORMATTED_VALUE'}),
  sheets.spreadsheets.values.get({spreadsheetId,range:"'グラフ'!A8:K80",valueRenderOption:'FORMULA'}),
  sheets.spreadsheets.values.get({spreadsheetId,range:"'シート8'!A1:AS1",valueRenderOption:'UNFORMATTED_VALUE'})
 ]);
 const history=buildHistory(raw.data.values??[],ga4.data.values??[]),models=fitModels(history,date);
 // Saved bindings survive our replacement of the original forecast formulas.
 const bindings=saved[5]?.[0]?JSON.parse(saved[5][0]):discoverBindings(book,comparison.data.values??[],headers.data.values?.[0]??[]);
 if(bindings.length!==METRICS.length)throw Error('Forecast binding count mismatch');
 for(const b of bindings){if(!book.sheets.some(s=>s.properties.sheetId===b.range.sheetId&&s.properties.title===b.sourceTitle))throw Error('Forecast binding destination changed');if(comparison.data.values?.[b.row-8]?.[0]!==b.name)throw Error('Forecast comparison rows moved; rebind before writing');}
 const rows=modelRows(models,date,bindings);const formulaRequests=predictionRequests(bindings,models),styleRequests=chartStyleRequests(book,bindings);
 if(backupPath){const ranges=formulaRequests.filter(r=>r.updateCells).map(r=>{const q=r.updateCells.range,p=book.sheets.find(s=>s.properties.sheetId===q.sheetId).properties;const name=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};return `'${p.title}'!${name(q.startColumnIndex)}${q.startRowIndex+1}:${name(q.endColumnIndex-1)}${q.endRowIndex}`;});const backup=(await sheets.spreadsheets.values.batchGet({spreadsheetId,ranges,valueRenderOption:'FORMULA'})).data;writeFileSync(backupPath,JSON.stringify({spreadsheetId,createdAt:new Date().toISOString(),book,ranges:backup.valueRanges},null,2));}
 if(!model)await sheets.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests:[{addSheet:{properties:{sheetId:MODEL_ID,title:MODEL_TITLE,hidden:true,gridProperties:{rowCount:80,columnCount:52}}}}]}});
 // Publish the version only after every forecast binding and chart is installed.
 rows[0][51]='installing-'+VERSION;
 const all=[{updateCells:{range:{sheetId:MODEL_ID,startRowIndex:0,endRowIndex:65,startColumnIndex:0,endColumnIndex:52},rows:rows.map(row=>({values:row.map(asCell)})),fields:'userEnteredValue'}},...formulaRequests,...styleRequests];
 for(const requests of requestChunks(all))await sheets.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests}});
 await sheets.spreadsheets.values.update({spreadsheetId,range:`'${MODEL_TITLE}'!AZ1`,valueInputOption:'RAW',requestBody:{values:[[VERSION]]}});
 const check=(await sheets.spreadsheets.values.get({spreadsheetId,range:"'グラフ'!A8:F80",valueRenderOption:'UNFORMATTED_VALUE'})).data.values??[];
 const failed=bindings.filter(b=>typeof check[b.row-8]?.[5]==='string'&&/^#/.test(check[b.row-8][5]));if(failed.length)throw Error('Forecast formula errors: '+failed.map(b=>b.column).join(','));
 const result={date,version:VERSION,models:models.map(m=>({column:m.column,method:m.method,alpha:m.alpha,days:m.profile?.days??0,approved:m.approved,validation:m.validation})),cells:bindings.map(b=>({name:b.name,row:b.row,prediction:check[b.row-8]?.[5]??''}))};
 console.log(JSON.stringify({historicalForecast:result}));return result;
}
