import {METRICS,VERSION,columnIndex,columnName,profile,selectMethod,backtest} from './historical-forecast.mjs';
export const MODEL_TITLE='_予測モデル',MODEL_ID=1926112701;
const MODEL="'_予測モデル'!",GRAPH="'グラフ'!",START=10,END=58;
const color=rgb=>({rgbColor:{red:rgb[0]/255,green:rgb[1]/255,blue:rgb[2]/255}});
const normalized=s=>String(s??'').replace(/\s|人数/g,'');
export const modelColumn=m=>columnName(m.index+1);
export function linearFormula(range,time){return `LET(pos,MIN(48,MAX(0,(${time})*48)),idx,MIN(49,INT(pos)+1),frac,pos-INT(pos),a,INDEX(${range},idx),b,INDEX(${range},MIN(49,idx+1)),IF(frac<0.000000001,IF(ISNUMBER(a),a,""),IF(COUNT(a,b)=2,a*(1-frac)+b*frac,"")))`;}
export function forecastFormula(metric,time,{summary=false,dynamicColumn=null}={}){
 const c=dynamicColumn??`"${modelColumn(metric)}"`,ref=r=>dynamicColumn?`INDIRECT(${JSON.stringify(MODEL+"$")}&mc&"${r}")`:`${MODEL}${modelColumn(metric)}${r}`,curve=dynamicColumn?`INDIRECT(${JSON.stringify(MODEL+"$")}&mc&"${START}:$"&mc&"${END}")`:`${MODEL}${modelColumn(metric)}${START}:${modelColumn(metric)}${END}`;
 const stock=dynamicColumn?`INDEX(${MODEL}$B$61:$AM$61,1,MATCH(mc,${MODEL}$B$60:$AM$60,0))`:metric.stock?'TRUE':'FALSE';
 const value=`IF(isstock,MAX(0,actual*(1-MIN(1,(t-anchor)*24))+future*MAX(0.25,MIN(4,1+${ref(7)}*(${ref(6)}-1)))*MIN(1,(t-anchor)*24)),MAX(actual,actual*future/base))`;
 return `=IFERROR(LET(mc,${c},t,MIN(1,MAX(0,${time})),anchor,${ref(4)},actual,${ref(3)},base,${ref(5)},isstock,${stock},future,${linearFormula(curve,'t')},IF(OR(${GRAPH}$B$3<>TODAY(),TEXT(${GRAPH}$B$3,"yyyy-mm-dd")<>${MODEL}$AZ$2,NOT(ISNUMBER(anchor)),NOT(ISNUMBER(actual)),t+0.000000001<anchor),"",IF(ABS(t-anchor)<0.000000001,actual,IF(OR(NOT(ISNUMBER(base)),base<=0,NOT(ISNUMBER(future))),"",${summary?`ROUND(${value},0)`:value})))),"")`;
}
export function discoverBindings(book,comparison,headers){
 const graph=book.sheets.find(s=>s.properties.title==='グラフ');if(graph?.properties.sheetId!==174166888)throw Error('Graph identity mismatch');
 return METRICS.map(m=>{
  const expected=m.stock?'GA4男性アクティブユーザー数（直近5分）':headers[columnIndex(m.column)];
  const hits=comparison.flatMap((r,i)=>normalized(r[0])===normalized(expected)?[{r,i}]:[]);
  if(hits.length!==1)throw Error('Comparison row not unique: '+m.column);
  const {r,i}=hits[0],f=r[5];const match=String(f).match(/\$?([A-Z]+)\$?(\d+):\$?\1\$?(\d+)/);
  if(!match)throw Error('Forecast source missing: '+m.column);
  const sourceTitle=String(f).match(/'([^']+)'!/)?.[1]??'グラフ';const source=book.sheets.find(s=>s.properties.title===sourceTitle);
  if(!source)throw Error('Forecast source tab missing');
  let range={sheetId:source.properties.sheetId,startRowIndex:Number(match[2])-1,endRowIndex:Number(match[3]),startColumnIndex:columnIndex(match[1]),endColumnIndex:columnIndex(match[1])+1};
  let timeColumn='A';
  if(sourceTitle!=='グラフ')timeColumn=columnName(range.startColumnIndex-4);
  if(m.stock){range={sheetId:graph.properties.sheetId,startRowIndex:1606,endRowIndex:1894,startColumnIndex:53,endColumnIndex:54};timeColumn='AX';}
  const row=8+i;
  return{...m,row,name:r[0],range,timeColumn,sourceTitle};
 });
}
export function fitModels(history,date){
 const start=new Date(Date.parse(date+'T00:00:00Z')-7*86400000).toISOString().slice(0,10),end=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 const validation=backtest(history,{start,end});
 return METRICS.map(m=>{
  const test=validation.find(r=>r.column===m.column),choice=selectMethod(history,m,date);
  const approved=!!(test?.baseline?.n>=8&&test.improved.wape<test.baseline.wape*.97);
  const method=approved?choice.method:'previous',alpha=m.stock?(approved?choice.alpha:1):.5;
  const p=profile(history,m,date,method)??profile(history,m,date,'previous');
  return{...m,method:p?.method??method,alpha,profile:p,validation:test,approved};
 });
}
export function modelRows(models,date,bindings){
 const rows=Array.from({length:65},()=>Array(52).fill(''));rows[0][51]=VERSION;rows[1][51]=date;rows[2][51]=new Date().toISOString();rows[5][51]=JSON.stringify(bindings);rows[6][51]=JSON.stringify(models.map(m=>({column:m.column,method:m.method,alpha:m.alpha,days:m.profile?.days??0,approved:m.approved,validation:m.validation})));
 for(let i=0;i<49;i++)rows[i+9][0]=i/48;
 for(const m of models){const c=modelColumn(m),ci=m.index+1,stamp=m.stock?"'_GA4_5分'!$A$2:$A":"'シート8'!$A$2:$A",v=m.stock?"'_GA4_5分'!$B$2:$B":`'シート8'!$${m.column}$2:$${m.column}`;
  rows[0][ci]=bindings.find(b=>b.column===m.column)?.name??m.column;
  rows[1][ci]=`=IFERROR(INDEX(SORT(FILTER(${stamp},LEFT(${stamp},10)=TEXT(${GRAPH}$B$3,"yyyy-mm-dd"),ISNUMBER(${v})),1,FALSE),1),"")`;
  rows[2][ci]=`=IF($${c}$2="","",IFERROR(XLOOKUP($${c}$2,${stamp},${v},"",0,-1),""))`;
  rows[3][ci]=`=IFERROR(TIMEVALUE(MID($${c}$2,12,5)),"")`;
  rows[4][ci]=`=IFERROR(${linearFormula(`$${c}$${START}:$${c}$${END}`,`$${c}$4`)},"")`;
  rows[5][ci]=m.stock?(m.method==='previous'?`=IFERROR($${c}$3/$${c}$5,1)`:`=IFERROR(LET(ts,${stamp},vs,${v},condition,ARRAYFORMULA((LEFT(ts,10)=TEXT(${GRAPH}$B$3,"yyyy-mm-dd"))*(ts<=$${c}$2)*(ts>=TEXT(${GRAPH}$B$3+MAX(0,$${c}$4-1/24),"yyyy-mm-dd hh:mm:ss"))*ISNUMBER(vs)),st,FILTER(ts,condition),val,FILTER(vs,condition),AVERAGE(val)/AVERAGE(MAP(st,LAMBDA(s,${linearFormula(`$${c}$${START}:$${c}$${END}`,'TIMEVALUE(RIGHT(s,8))')})))),1)`):1;
  rows[6][ci]=m.alpha;rows[7][ci]=m.method;rows[8][ci]=m.profile?.days??0;
  for(let i=0;i<49;i++)rows[i+9][ci]=m.profile?.values[i]??'';
  rows[59][ci]=c;rows[60][ci]=m.stock;
 }
 return rows;
}
function cell(v){return {userEnteredValue:typeof v==='number'?{numberValue:v}:typeof v==='boolean'?{boolValue:v}:String(v).startsWith('=')?{formulaValue:v}:{stringValue:String(v)}};}
const single=(sheetId,row,column,value,note)=>({updateCells:{range:{sheetId,startRowIndex:row-1,endRowIndex:row,startColumnIndex:column-1,endColumnIndex:column},rows:[{values:[{...cell(value),...(note?{note}:{})}]}],fields:note?'userEnteredValue,note':'userEnteredValue'}});
export function predictionRequests(bindings,models){
 const req=[];
 for(const b of bindings){
  req.push({updateCells:{range:b.range,rows:Array.from({length:b.range.endRowIndex-b.range.startRowIndex},(_,i)=>({values:[cell(forecastFormula(b,`$${b.timeColumn}${b.range.startRowIndex+i+1}`))]})),fields:'userEnteredValue'}});
  const m=models.find(m=>m.column===b.column),test=m.validation;
  const note=`過去実績予測: ${m.method} / 学習${m.profile?.days??0}日 / ${m.stock?'直近1時間の傾向で補正':'当日の進捗で補正'}。検証${test?.baseline?.n??0}件。予測は参考値です。`;
  req.push(single(174166888,b.row,6,forecastFormula(b,'1',{summary:true}),note));
  req.push(single(b.range.sheetId,b.range.startRowIndex,b.range.startColumnIndex+1,'予測（過去実績基準）'));
 }
 // Derived metrics continue to reconcile to the component forecasts.
 for(const [row,columns,helperId,pcol,tcol,start]of[[38,['AA','O','S'],2134298915,4,'A',2],[39,['G','Q','U'],2134298915,11,'H',2]]){
  const formula=t=>{const xs=columns.map(c=>forecastFormula(bindings.find(b=>b.column===c),t).slice(1));return `=IFERROR(LET(a,${xs[0]},b,${xs[1]},c,${xs[2]},IF(COUNT(a,b,c)=3,MAX(0,a-b-c),"")),"")`;};
  req.push({updateCells:{range:{sheetId:helperId,startRowIndex:start-1,endRowIndex:49,startColumnIndex:pcol,endColumnIndex:pcol+1},rows:Array.from({length:50-start},(_,i)=>({values:[cell(formula(`$${tcol}${start+i}`))]})),fields:'userEnteredValue'}});
  req.push(single(174166888,row,6,`=IFERROR(ROUND(${formula('1').slice(1)},0),"")`));
 }
 // The expanded chart keeps five-minute sampling, independent of small charts.
 const mc=`IFERROR(INDEX(${MODEL}$B$60:$AM$60,1,MATCH(${GRAPH}$M$8,${MODEL}$B$1:$AM$1,0)),"")`;
 req.push({updateCells:{range:{sheetId:174166888,startRowIndex:1555,endRowIndex:1843,startColumnIndex:58,endColumnIndex:59},rows:Array.from({length:288},(_,i)=>({values:[cell(forecastFormula({},`$BD${1556+i}`,{dynamicColumn:mc}))]})),fields:'userEnteredValue'}});
 req.push(single(174166888,1555,59,'予測（過去実績基準）'));
 // Five-minute growth forecasts are smooth estimates, never invented observations.
 for(const [column,source]of[[12,'B'],[14,'C'],[16,'H'],[18,'I']]){
  const m=bindings.find(b=>b.column===source);
  const rows=Array.from({length:288},(_,i)=>{const r=1901+i,a=forecastFormula(m,`$A${r}`).slice(1),b=forecastFormula(m,`MIN(1,$A${r}+5/1440)`).slice(1);return{values:[cell(`=IFERROR(LET(a,${a},b,${b},IF(COUNT(a,b)=2,MAX(0,b-a),"")),"")`)]};});
  req.push({updateCells:{range:{sheetId:174166888,startRowIndex:1900,endRowIndex:2188,startColumnIndex:column-1,endColumnIndex:column},rows,fields:'userEnteredValue'}});
 }
 req.push({updateCells:{range:{sheetId:174166888,startRowIndex:1900,endRowIndex:2188,startColumnIndex:19,endColumnIndex:20},rows:Array.from({length:288},(_,i)=>({values:[cell(`=IF(COUNT(N${1901+i},R${1901+i})=2,N${1901+i}+R${1901+i},"")`)]})),fields:'userEnteredValue'}});
 req.push(single(174166888,6,1,'予測：過去7～28日・曜日・当日の進捗から項目別に検証。青い破線は参考予測。データ不足・改善未確認の項目は直近日を基準にします。'));
 return req;
}
export function chartStyleRequests(book,bindings){
 const graph=book.sheets.find(s=>s.properties.sheetId===174166888),req=[];
 for(const c of graph.charts??[]){
  const b=bindings.find(b=>c.spec.title===b.name+'の推移');if(!b)continue;
  const prediction=c.spec.basicChart?.series?.findIndex(s=>s.series.sourceRange.sources.some(r=>r.sheetId===b.range.sheetId&&r.startColumnIndex===b.range.startColumnIndex&&r.startRowIndex===b.range.startRowIndex-1));
  const index=b.stock?3:prediction;
  const series=c.spec.basicChart.series.map((s,i)=>({...s,colorStyle:color(i===0||i===index?[66,133,244]:i===1?[153,153,153]:i===c.spec.basicChart.series.length-1?[255,109,1]:[153,0,255]),lineStyle:{width:i===0?4:2,type:i===index?'MEDIUM_DASHED':'SOLID'},pointStyle:{size:0}}));
  req.push({updateChartSpec:{chartId:c.chartId,spec:{...c.spec,subtitle:'実線：実績／青い破線：過去実績と当日の進捗から予測',basicChart:{...c.spec.basicChart,series}}}});
 }
 for(const [id,actual,predicted,mean]of[[1213750843,3,11,12],[1926102703,7,13,14],[2074059065,5,15,16],[1926102704,9,17,18],[1229979882,1,19,20]]){
  const c=graph.charts.find(c=>c.chartId===id);if(!c?.spec?.basicChart)continue;
  const series=[actual,predicted,mean].map((column,i)=>({series:{sourceRange:{sources:[{sheetId:174166888,startRowIndex:1899,endRowIndex:2188,startColumnIndex:column,endColumnIndex:column+1}]}},targetAxis:'LEFT_AXIS',colorStyle:color(i===2?[255,109,1]:[66,133,244]),lineStyle:{width:i===0?3:2,type:i===1?'MEDIUM_DASHED':'SOLID'},pointStyle:{size:0}}));
  req.push({updateChartSpec:{chartId:id,spec:{...c.spec,subtitle:'青破線：過去実績からの5分増加予測（30分推移を補間）',basicChart:{...c.spec.basicChart,series,interpolateNulls:false}}}});
 }
 return req;
}
