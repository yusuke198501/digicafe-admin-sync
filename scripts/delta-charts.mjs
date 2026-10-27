import { pathToFileURL } from 'node:url';

const TARGETS = new Map([[1213750843, [3,7,11,13,12,14]], [2074059065, [5,9,15,17,16,18]]]);
const COLORS = [[66,133,244],[153,0,255],[66,133,244],[153,0,255],[255,109,1],[180,95,6]];

export function deltaChartSpec(chart) {
  const expected = TARGETS.get(chart.chartId);
  if (!expected) return null;
  const spec = structuredClone(chart.spec);
  const basic = spec.basicChart;
  if (basic?.series?.length !== 6 || basic.series.some((s,i) => {
    const r = s.series?.sourceRange?.sources;
    return r?.length !== 1 || r[0].sheetId !== 174166888 || r[0].startColumnIndex !== expected[i] || r[0].startRowIndex !== 1899 || r[0].endRowIndex !== 2188;
  })) throw new Error('Unexpected delta chart source ranges: ' + chart.chartId);
  basic.series.forEach((series,i) => {
    delete series.color;
    const [r,g,b] = COLORS[i];
    series.colorStyle = {rgbColor:{red:r/255,green:g/255,blue:b/255}};
    series.lineStyle = {width:i<2?3:2,type:i===2||i===3?'MEDIUM_DASHED':'SOLID'};
    series.pointStyle = {size:0};
    series.targetAxis = chart.chartId===2074059065 && i%2===1 ? 'RIGHT_AXIS' : 'LEFT_AXIS';
  });
  basic.axis = [{position:'BOTTOM_AXIS',title:'時刻（5分刻み）'}, {position:'LEFT_AXIS',title:chart.chartId===2074059065?'送信数（通／5分）':'増加数（通／5分）'}];
  if(chart.chartId===2074059065) basic.axis.push({position:'RIGHT_AXIS',title:'受信数（通／5分）'});
  basic.interpolateNulls = false;
  return spec;
}

export async function refreshDeltaCharts(sheets, spreadsheetId) {
  const read = () => sheets.spreadsheets.get({spreadsheetId,fields:'sheets(charts(chartId,spec))'});
  const metadata = await read();
  const charts = metadata.data.sheets?.flatMap(s=>s.charts??[]) ?? [];
  const requests = [];
  for(const chart of charts) {
    const spec = deltaChartSpec(chart);
    if(spec && JSON.stringify(spec)!==JSON.stringify(chart.spec)) requests.push({updateChartSpec:{chartId:chart.chartId,spec}});
  }
  if(requests.length) {
    await sheets.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests}});
    const verified = (await read()).data.sheets?.flatMap(s=>s.charts??[]) ?? [];
    for(const request of requests) {
      const chart = verified.find(c=>c.chartId===request.updateChartSpec.chartId);
      const want = request.updateChartSpec.spec.basicChart.series;
      if(!chart || chart.spec.basicChart.series.some((s,i)=>s.lineStyle?.type!==want[i].lineStyle.type || s.targetAxis!==want[i].targetAxis || JSON.stringify(s.colorStyle)!==JSON.stringify(want[i].colorStyle))) throw new Error('Delta chart style verification failed');
    }
  }
  console.log('Delta charts verified: six series, matching dashed forecasts, monthly averages, correct receive axis.');
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const {google}=await import('googleapis');
    const auth=new google.auth.GoogleAuth({credentials:JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),scopes:['https://www.googleapis.com/auth/spreadsheets']});
    await refreshDeltaCharts(google.sheets({version:'v4',auth}),process.env.SPREADSHEET_ID);
  } catch(e) { console.error(e.message); process.exitCode=1; }
}
