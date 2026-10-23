export const AGE_CHART_TITLE = '年確数の推移';
export function ageChartSeries(values) {
  const styles = [[1,'SOLID',[66,133,244]],[2,'SOLID',[153,153,153]],[3,'SOLID',[153,0,255]],[4,'MEDIUM_DASHED',[66,133,244]],[5,'SOLID',[255,109,1]]];
  return styles.filter(([column]) => values.slice(1).some(row => typeof row[column] === 'number' && Number.isFinite(row[column])))
    .map(([column,type,rgb]) => ({series:{sourceRange:{sources:[{sheetId:174166888,startRowIndex:1605,endRowIndex:1654,startColumnIndex:41+column,endColumnIndex:42+column}]}},targetAxis:'LEFT_AXIS',colorStyle:{rgbColor:{red:rgb[0]/255,green:rgb[1]/255,blue:rgb[2]/255}},lineStyle:{width:column===1?4:2,type},pointStyle:{size:0}}));
}
export async function refreshAgeChart(sheets,spreadsheetId) {
  const metadata=await sheets.spreadsheets.get({spreadsheetId,fields:'sheets(charts(chartId,spec))'});
  const chart=metadata.data.sheets?.flatMap(s=>s.charts??[]).find(c=>c.spec?.title===AGE_CHART_TITLE);
  if(!chart?.spec?.basicChart) return;
  const response=await sheets.spreadsheets.values.get({spreadsheetId,range:"'グラフ'!AP1606:AU1654",valueRenderOption:'UNFORMATTED_VALUE'});
  const series=ageChartSeries(response.data.values??[]);
  if(!series.length) return;
  const shape=s=>({range:s.series?.sourceRange,line:s.lineStyle,color:s.colorStyle,point:s.pointStyle});
  if(JSON.stringify(chart.spec.basicChart.series?.map(shape))===JSON.stringify(series.map(shape))) return;
  await sheets.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests:[{updateChartSpec:{chartId:chart.chartId,spec:{...chart.spec,basicChart:{...chart.spec.basicChart,series}}}}]}});
}
