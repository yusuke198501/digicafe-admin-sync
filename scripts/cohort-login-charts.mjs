export const GRAPH_ID = 174166888;
export const HELPER_ID = 1926103001;
export const HELPER_TITLE = '_登録月別ログイングラフ';
export const VERSION = 'cohort-logins-v2';
export const SUBTITLE = '実線：実績／青い破線：当日予測（比較日基準）';
export const METRICS = [
  {name:'当月登録者ログイン数',column:'AB',chartId:1926103002,comparisonRow:37,offset:0},
  {name:'２ヶ月目登録者ログイン数',column:'AC',chartId:1926103003,comparisonRow:38,offset:10}
];
const graph = "'グラフ'!";
function col(i) { return String.fromCharCode(65+i); }
function cell(value) {return {userEnteredValue:typeof value==='number'?{numberValue:value}:String(value).startsWith('=')?{formulaValue:value}:{stringValue:String(value)}};}
// Same date-scoped, last-record lookup used by the existing comparison table.
export function snapshotFormula(column,date,time) {
  const stamp="'シート8'!$A$2:$A", value=`'シート8'!$${column}$2:$${column}`;
  const limit=`TEXT(${date}+FLOOR(MIN(${time},1-1/1440),1/1440)+TIME(0,0,59),"yyyy-mm-dd hh:mm:ss")`;
  return `=IFERROR(LET(st,FILTER(${stamp},LEFT(${stamp},10)=TEXT(${date},"yyyy-mm-dd"),ISNUMBER(${value})),v,FILTER(${value},LEFT(${stamp},10)=TEXT(${date},"yyyy-mm-dd"),ISNUMBER(${value})),INDEX(v,XMATCH(${limit},st,-1,-1))),"")`;
}
function meanFormula(column,time) {
  const st="'シート8'!$A$2:$A", v=`'シート8'!$${column}$2:$${column}`;
  const criteria=`ISNUMBER(${v}),LEFT(${st},10)>=TEXT(EOMONTH(${graph}$B$3,-1)+1,"yyyy-mm-dd"),LEFT(${st},10)<TEXT(${graph}$B$3,"yyyy-mm-dd")`;
  return `=IFERROR(LET(st,FILTER(${st},${criteria}),v,FILTER(${v},${criteria}),days,UNIQUE(ARRAYFORMULA(LEFT(st,10))),AVERAGE(MAP(days,LAMBDA(day,IFERROR(LET(idx,XMATCH(day&" "&TEXT(MIN(${time},1-1/1440)+TIME(0,0,59),"hh:mm:ss"),st,-1,-1),IF(LEFT(INDEX(st,idx),10)=day,INDEX(v,idx),"")),""))))),"")`;
}
export function helperRows() {
  const rows=Array.from({length:51},()=>Array(20).fill(''));
  rows[0][19]=VERSION;
  for(const m of METRICS) {
    const o=m.offset,t=col(o),latest=col(o+6),base=col(o+7),actual=col(o+8),compare=col(o+2);
    rows[0][o]=m.name;rows[0][o+6]='最終取得日時';rows[0][o+7]='比較日・予測基準';rows[0][o+8]='対象日・最終値';
    ['時刻','対象日','比較日','7日前','予測','当月平均（月初～前日）'].forEach((s,i)=>rows[1][o+i]=s);
    const stamps="'シート8'!$A$2:$A",values=`'シート8'!$${m.column}$2:$${m.column}`;
    rows[1][o+6]=`=IFERROR(INDEX(SORT(FILTER(${stamps},LEFT(${stamps},10)=TEXT(${graph}$B$3,"yyyy-mm-dd"),ISNUMBER(${values})),1,FALSE),1),"")`;
    rows[1][o+7]=snapshotFormula(m.column,`${graph}$E$3`,`IFERROR(TIMEVALUE(RIGHT($${latest}$2,8)),0)`);
    rows[1][o+8]=snapshotFormula(m.column,`${graph}$B$3`,'1');
    for(let i=0;i<49;i++) {
      const r=i+3,tm=`$${t}${r}`,anchor=`TIMEVALUE(RIGHT($${latest}$2,8))`;
      rows[i+2][o]=`=IFERROR(IF(AND(${i}/48>${anchor},${i}/48-1/48<${anchor}),${anchor},${i}/48),${i}/48)`;
      const value=snapshotFormula(m.column,`${graph}$B$3`,tm);
      rows[i+2][o+1]=`=IF($${latest}$2="","",IF(${tm}>IFERROR(${anchor},0),"",${value.slice(1)}))`;
      rows[i+2][o+2]=snapshotFormula(m.column,`${graph}$E$3`,tm);
      rows[i+2][o+3]=snapshotFormula(m.column,`${graph}$H$3`,tm);
      rows[i+2][o+4]=`=IFERROR(IF(OR(${graph}$B$3<>TODAY(),${tm}<${anchor},NOT(ISNUMBER($${actual}$2))),"",IF(ABS(${tm}-${anchor})<0.000000001,$${actual}$2,IF(OR(NOT(ISNUMBER($${base}$2)),$${base}$2<=0,NOT(ISNUMBER(${compare}${r}))),"",$${actual}$2*${compare}${r}/$${base}$2))),"")`;
      rows[i+2][o+5]=meanFormula(m.column,tm);
    }
  }
  return rows.map(row=>({values:row.map(cell)}));
}
export function chartSpec(template,m) {
  const colors=[[66,133,244],[153,153,153],[153,0,255],[66,133,244],[255,109,1]];
  const range=c=>({sheetId:HELPER_ID,startRowIndex:1,endRowIndex:51,startColumnIndex:c,endColumnIndex:c+1});
  return {...template,title:m.name+'の推移',subtitle:SUBTITLE,hiddenDimensionStrategy:'SHOW_ALL',basicChart:{...template.basicChart,chartType:'LINE',headerCount:1,interpolateNulls:false,axis:[{position:'BOTTOM_AXIS',title:'時刻'},{position:'LEFT_AXIS',title:'人'}],domains:[{domain:{sourceRange:{sources:[range(m.offset)]}}}],series:colors.map((rgb,i)=>({series:{sourceRange:{sources:[range(m.offset+i+1)]}},targetAxis:'LEFT_AXIS',colorStyle:{rgbColor:{red:rgb[0]/255,green:rgb[1]/255,blue:rgb[2]/255}},lineStyle:{width:i===0?4:2,type:i===3?'MEDIUM_DASHED':'SOLID'},pointStyle:{size:0}}))}};
}
export function chartRequests(book,rowMetadata=[]) {
  const g=book.sheets?.find(s=>s.properties?.sheetId===GRAPH_ID);
  if(g?.properties.title!=='グラフ')throw Error('グラフの書き込み先が一致しません。');
  const charts=g.charts??[],template=charts.find(c=>c.chartId===1926102601)??charts.find(c=>c.chartId===1702630169);
  if(!template?.spec?.basicChart||!template.position?.overlayPosition)throw Error('共通グラフのテンプレートがありません。');
  if(book.sheets.some(s=>s.properties.sheetId===HELPER_ID&&s.properties.title!==HELPER_TITLE))throw Error('計算用シートIDが使用中です。');
  const helper=book.sheets.find(s=>s.properties.title===HELPER_TITLE);
  if(helper&&helper.properties.sheetId!==HELPER_ID)throw Error('計算用シートを確認できません。');
  const requests=[];
  if(!helper)requests.push({addSheet:{properties:{sheetId:HELPER_ID,title:HELPER_TITLE,hidden:true,gridProperties:{rowCount:60,columnCount:20}}}});
  const small=charts.filter(c=>!METRICS.some(m=>m.chartId===c.chartId)&&c.chartId!==2027820698&&c.position?.overlayPosition?.anchorCell?.rowIndex>=8);
  const top=Math.min(...small.map(c=>c.position.overlayPosition.anchorCell.rowIndex));
  const shift=Math.max(0,38-top);
  if(shift)for(const c of small){const p=c.position.overlayPosition;requests.push({updateEmbeddedObjectPosition:{objectId:c.chartId,newPosition:{overlayPosition:{...p,anchorCell:{...p.anchorCell,rowIndex:p.anchorCell.rowIndex+shift}}},fields:'anchorCell'}});}
  // Hidden rows and existing pixel offsets make row-count estimates unsafe.
  const rowTop=i=>rowMetadata.slice(0,i).reduce((sum,r)=>sum+(r.hiddenByUser||r.hiddenByFilter?0:(r.pixelSize??20)),0)+Math.max(0,i-rowMetadata.length)*20;
  const bottomChart=small.reduce((best,c)=>{
    const p=c.position.overlayPosition;
    const bottom=rowTop(p.anchorCell.rowIndex+shift)+(p.offsetYPixels??0)+(p.heightPixels??300);
    return !best||bottom>best.bottom?{p,bottom}:best;
  },null);
  if(!bottomChart)throw Error('既存グラフの配置を確認できません。');
  const newPosition={...template.position.overlayPosition,anchorCell:{...bottomChart.p.anchorCell,rowIndex:bottomChart.p.anchorCell.rowIndex+shift,columnIndex:0},offsetYPixels:(bottomChart.p.offsetYPixels??0)+(bottomChart.p.heightPixels??300)+40,widthPixels:730,heightPixels:300};
  requests.push({updateCells:{start:{sheetId:HELPER_ID,rowIndex:0,columnIndex:0},rows:helperRows(),fields:'userEnteredValue'}});
  for(const m of METRICS){
    const existing=charts.find(c=>c.chartId===m.chartId);
    if(existing&&existing.spec.title!==m.name+'の推移')throw Error('グラフIDが使用中です。');
    const spec=chartSpec(template.spec,m);
    const position={overlayPosition:{...newPosition,offsetXPixels:(m.offset?1:0)*750}};
    if(existing)requests.push({updateChartSpec:{chartId:m.chartId,spec}},{updateEmbeddedObjectPosition:{objectId:m.chartId,newPosition:position,fields:'anchorCell,offsetXPixels,offsetYPixels,widthPixels,heightPixels'}});
    else requests.push({addChart:{chart:{chartId:m.chartId,spec,position}}});
  }
  const comparison=METRICS.map(m=>{
    const r=m.comparisonRow,predict=col(m.offset+4),base=col(m.offset+7),helper=`'${HELPER_TITLE}'!`;
    return {values:[m.name,snapshotFormula(m.column,'$B$3','$K$3'),snapshotFormula(m.column,'$E$3','$K$3'),`=IF(OR(B${r}="",C${r}=""),"",B${r}-C${r})`,`=IF(OR(B${r}="",C${r}="",C${r}=0),"",B${r}/C${r}-1)`,`=IFERROR(IF(AND($B$3=TODAY(),ISNUMBER(${helper}${base}2),${helper}${base}2>0),ROUND(XLOOKUP(TRUE,ARRAYFORMULA(ISNUMBER(${helper}${predict}3:${predict}51)),${helper}${predict}3:${predict}51,"",0,-1),0),""),"")`,snapshotFormula(m.column,'$E$3','1'),snapshotFormula(m.column,'$H$3','$K$3'),`=IF(OR(B${r}="",H${r}=""),"",B${r}-H${r})`,`=IF(OR(B${r}="",H${r}="",H${r}=0),"",B${r}/H${r}-1)`].map(cell)};
  });
  requests.push({copyPaste:{source:{sheetId:GRAPH_ID,startRowIndex:33,endRowIndex:34,startColumnIndex:0,endColumnIndex:10},destination:{sheetId:GRAPH_ID,startRowIndex:36,endRowIndex:38,startColumnIndex:0,endColumnIndex:10},pasteType:'PASTE_FORMAT'}},{updateCells:{start:{sheetId:GRAPH_ID,rowIndex:36,columnIndex:0},rows:comparison,fields:'userEnteredValue'}});
  for(const [find,replacement] of [["'シート8'!$A$1:$AA$1","'シート8'!$A$1:$AC$1"],["'シート8'!$A$2:$AA","'シート8'!$A$2:$AC"]])requests.push({findReplace:{find,replacement,range:{sheetId:GRAPH_ID,startRowIndex:1552,endRowIndex:1843,startColumnIndex:55,endColumnIndex:60},includeFormulas:true,matchCase:true}});
  for(const o of [0,10])requests.push({repeatCell:{range:{sheetId:HELPER_ID,startRowIndex:2,endRowIndex:51,startColumnIndex:o,endColumnIndex:o+1},cell:{userEnteredFormat:{numberFormat:{type:'TIME',pattern:'hh:mm'}}},fields:'userEnteredFormat.numberFormat'}});
  return requests;
}
export async function refreshCohortLoginCharts(sheets,spreadsheetId) {
  const initial=(await sheets.spreadsheets.get({spreadsheetId,fields:'sheets(properties(sheetId,title),charts(chartId,spec(title,subtitle)))'})).data;
  const g=initial.sheets?.find(s=>s.properties.sheetId===GRAPH_ID),helper=initial.sheets?.find(s=>s.properties.title===HELPER_TITLE);
  if(helper?.properties.sheetId===HELPER_ID&&METRICS.every(m=>g?.charts?.some(c=>c.chartId===m.chartId&&c.spec.title===m.name+'の推移'&&c.spec.subtitle===SUBTITLE)))return;
  const book=(await sheets.spreadsheets.get({spreadsheetId,fields:'sheets(properties(sheetId,title),charts(chartId,spec,position))'})).data;
  const existing=(await sheets.spreadsheets.get({spreadsheetId,ranges:["'グラフ'!L8","'グラフ'!A37:J38"],includeGridData:true,fields:'sheets(data(startRow,startColumn,rowData(values(userEnteredValue,dataValidation))))'})).data;
  const grids=existing.sheets?.flatMap(s=>s.data??[])??[];
  const dropdown=grids.find(d=>d.startRow===7&&d.startColumn===11)?.rowData?.[0]?.values?.[0]?.dataValidation;
  if(dropdown?.condition?.type!=='ONE_OF_LIST')throw Error('拡大表示の選択肢を確認できません。');
  const target=grids.find(d=>d.startRow===36&&(!d.startColumn||d.startColumn===0));
  for(let i=0;i<2;i++){const values=target?.rowData?.[i]?.values??[];if(values[0]?.userEnteredValue?.stringValue&&values[0].userEnteredValue.stringValue!==METRICS[i].name)throw Error('比較表の追加先が使用中です。');if(!(helper?.properties.sheetId===HELPER_ID&&METRICS.every(m=>g?.charts?.some(c=>c.chartId===m.chartId&&c.spec.title===m.name+'の推移')))&&values.slice(1).some(v=>v.userEnteredValue))throw Error('比較表の追加先に既存データがあります。');}
  const dimensions=(await sheets.spreadsheets.get({spreadsheetId,ranges:["'グラフ'!A1:A2200"],includeGridData:true,fields:'sheets(data(rowMetadata(pixelSize,hiddenByUser,hiddenByFilter)))'})).data;
  const rowMetadata=dimensions.sheets?.flatMap(s=>s.data??[]).flatMap(d=>d.rowMetadata??[])??[];
  const requests=chartRequests(book,rowMetadata),names=new Set(dropdown.condition.values.map(v=>v.userEnteredValue));
  requests.push({setDataValidation:{range:{sheetId:GRAPH_ID,startRowIndex:7,endRowIndex:8,startColumnIndex:11,endColumnIndex:12},rule:{...dropdown,condition:{...dropdown.condition,values:[...dropdown.condition.values,...METRICS.filter(m=>!names.has(m.name)).map(m=>({userEnteredValue:m.name}))]}}}});
  await sheets.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests}});
  console.log('登録月別ログイン数: 比較2行・共通デザインのグラフ2個・拡大表示を設定しました。');
}
