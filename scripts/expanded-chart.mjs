export function expandedSeries(values) {
  const colors=[[66,133,244],[153,153,153],[66,133,244],[255,109,1]];
  return colors.flatMap((rgb,i)=>values.slice(1).some(r=>typeof r[i+1]==='number' && Number.isFinite(r[i+1]))?[{series:{sourceRange:{sources:[{sheetId:174166888,startRowIndex:1554,endRowIndex:1843,startColumnIndex:56+i,endColumnIndex:57+i}]}},targetAxis:'LEFT_AXIS',colorStyle:{rgbColor:{red:rgb[0]/255,green:rgb[1]/255,blue:rgb[2]/255}},lineStyle:{width:i===0?4:2,type:i===2?'MEDIUM_DASHED':'SOLID'},pointStyle:{size:0}}]:[]);
}
export async function refreshExpandedChart(sheets,spreadsheetId) {
  const m=await sheets.spreadsheets.get({spreadsheetId,fields:'sheets(charts(chartId,spec))'});
  const c=m.data.sheets?.flatMap(s=>s.charts??[]).find(c=>c.chartId===2027820698);
  if(!c?.spec?.basicChart) return;
  const r=await sheets.spreadsheets.values.get({spreadsheetId,range:"'グラフ'!BD1555:BH1843",valueRenderOption:'UNFORMATTED_VALUE'});
  const series=expandedSeries(r.data.values??[]);
  const domains=[{domain:{sourceRange:{sources:[{sheetId:174166888,startRowIndex:1554,endRowIndex:1843,startColumnIndex:55,endColumnIndex:56}]}}}];
  const shape=s=>({range:s.series?.sourceRange,line:s.lineStyle,color:s.colorStyle,point:s.pointStyle});
  if(JSON.stringify(c.spec.basicChart.domains)===JSON.stringify(domains) && JSON.stringify(c.spec.basicChart.series?.map(shape)??[])===JSON.stringify(series.map(shape))) return;
  if(!series.length) return;
  await sheets.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests:[{updateChartSpec:{chartId:c.chartId,spec:{...c.spec,basicChart:{...c.spec.basicChart,domains,series,headerCount:1,interpolateNulls:false}}}}]}});
}
