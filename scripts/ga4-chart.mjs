import { refreshExpandedChart } from './expanded-chart.mjs';
export const GA4_CHART_TITLE='GA4男性アクティブユーザー数（直近5分）の推移';
export function ga4ChartSeries(values) {
  const styles=[[1,'SOLID',[66,133,244]],[2,'SOLID',[153,153,153]],[3,'SOLID',[153,0,255]],[4,'MEDIUM_DASHED',[66,133,244]],[5,'SOLID',[255,109,1]]];
  return styles.filter(([c])=>values.slice(1).some(r=>typeof r[c]==='number' && Number.isFinite(r[c]))).map(([c,type,rgb])=>({series:{sourceRange:{sources:[{sheetId:174166888,startRowIndex:1605,endRowIndex:1654,startColumnIndex:60+c,endColumnIndex:61+c}]}},targetAxis:'LEFT_AXIS',colorStyle:{rgbColor:{red:rgb[0]/255,green:rgb[1]/255,blue:rgb[2]/255}},lineStyle:{width:c===1?4:2,type},pointStyle:{size:0}}));
}
export async function refreshGa4Chart(sheets,spreadsheetId) {
  await refreshExpandedChart(sheets,spreadsheetId);
  const metadata=await sheets.spreadsheets.get({spreadsheetId,fields:'sheets(charts(chartId,spec))'});
  const chart=metadata.data.sheets?.flatMap(s=>s.charts??[]).find(c=>c.spec?.title===GA4_CHART_TITLE);
  if(!chart?.spec?.basicChart) return;
  const data=await sheets.spreadsheets.values.get({spreadsheetId,range:"'グラフ'!BI1606:BN1654",valueRenderOption:'UNFORMATTED_VALUE'});
  const series=ga4ChartSeries(data.data.values??[]);
  if(!series.length) return;
  const shape=s=>({range:s.series?.sourceRange,line:s.lineStyle,color:s.colorStyle,point:s.pointStyle});
  if(JSON.stringify(chart.spec.basicChart.series?.map(shape))===JSON.stringify(series.map(shape))) return;
  const axis=[{position:'BOTTOM_AXIS',title:'時刻'},{position:'LEFT_AXIS',title:'人'}];
  await sheets.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests:[{updateChartSpec:{chartId:chart.chartId,spec:{...chart.spec,basicChart:{...chart.spec.basicChart,series,axis,interpolateNulls:false}}}}]}});
}
