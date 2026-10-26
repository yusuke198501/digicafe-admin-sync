export const ALL_RECEIVED_CHART_TITLE = '全体受信数の推移';
export const ALL_RECEIVED_CHART_ID = 1926102601;
export function allReceivedSeries(values) {
  const styles = [[1,'SOLID',[66,133,244]],[2,'SOLID',[153,153,153]],[3,'SOLID',[153,0,255]],[4,'MEDIUM_DASHED',[66,133,244]],[5,'SOLID',[255,109,1]]];
  return styles.filter(([c])=>values.slice(1).some(r=>typeof r[c]==='number' && Number.isFinite(r[c]))).map(([c,type,rgb])=>({series:{sourceRange:{sources:[{sheetId:174166888,startRowIndex:1656,endRowIndex:1705,startColumnIndex:41+c,endColumnIndex:42+c}]}},targetAxis:'LEFT_AXIS',colorStyle:{rgbColor:{red:rgb[0]/255,green:rgb[1]/255,blue:rgb[2]/255}},lineStyle:{width:c===1?4:2,type},pointStyle:{size:0}}));
}
export async function refreshAllReceivedChart(sheets,spreadsheetId) {
  const m=await sheets.spreadsheets.get({spreadsheetId,fields:'sheets(charts(chartId,spec,position))'});
  const charts=m.data.sheets?.flatMap(s=>s.charts??[])??[];
  const existing=charts.find(c=>c.spec?.title===ALL_RECEIVED_CHART_TITLE);
  const template=charts.find(c=>c.chartId===1702630169);
  if(!template?.spec?.basicChart) throw Error('Common chart template missing');
  const r=await sheets.spreadsheets.values.get({spreadsheetId,range:"'グラフ'!AP1657:AU1705",valueRenderOption:'UNFORMATTED_VALUE'});
  const series=allReceivedSeries(r.data.values??[]);
  // Keep a correctly styled empty target series until the selected day has records.
  const shown=series.length?series:allReceivedSeries([[],[0,0]]);
  const domains=[{domain:{sourceRange:{sources:[{sheetId:174166888,startRowIndex:1656,endRowIndex:1705,startColumnIndex:41,endColumnIndex:42}]}}}];
  const spec={...(existing?.spec??template.spec),title:ALL_RECEIVED_CHART_TITLE,basicChart:{...(existing?.spec?.basicChart??template.spec.basicChart),domains,series:shown,headerCount:1,interpolateNulls:false,axis:[{position:'BOTTOM_AXIS',title:'時刻'},{position:'LEFT_AXIS',title:'通'}]}};
  const requests=[];
  if(!existing) {
    const ga=charts.find(c=>c.chartId===546867842)?.position?.overlayPosition;
    let p=ga?{...ga,anchorCell:{...ga.anchorCell},offsetXPixels:750,widthPixels:730,heightPixels:300}:null;
    if(!p || charts.some(c=>{const q=c.position?.overlayPosition;return q?.anchorCell?.rowIndex===p.anchorCell.rowIndex && (q.offsetXPixels??0)===750;})) {
      const bottom=Math.max(...charts.map(c=>c.position?.overlayPosition?.anchorCell?.rowIndex??0));
      p={anchorCell:{sheetId:174166888,rowIndex:bottom+18,columnIndex:0},offsetXPixels:0,offsetYPixels:0,widthPixels:730,heightPixels:300};
    }
    requests.push({addChart:{chart:{chartId:ALL_RECEIVED_CHART_ID,spec,position:{overlayPosition:p}}}});
  } else if(JSON.stringify(existing.spec.basicChart.series)!==JSON.stringify(shown)) {
    requests.push({updateChartSpec:{chartId:existing.chartId,spec}});
  }
  // The newly added comparison row 34 must not sit underneath the first chart row.
  for(const id of [577540268,1677660376,1292478822]) {
    const p=charts.find(c=>c.chartId===id)?.position?.overlayPosition;
    if(p?.anchorCell?.rowIndex===33) requests.push({updateEmbeddedObjectPosition:{objectId:id,newPosition:{overlayPosition:{...p,anchorCell:{...p.anchorCell,rowIndex:34}}},fields:'anchorCell'}});
  }
  if(requests.length) await sheets.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests}});
  console.log('All-received chart: common series styles verified; historical missing values remain blank.');
}
