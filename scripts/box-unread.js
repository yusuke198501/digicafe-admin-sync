import * as cheerio from 'cheerio';
export const BOX_UNREAD_URL='https://log.digicafe.jp/partner/marketing/marketing_stats';
export const UNREAD_BOXES=['A','B','C','E'];
const norm=s=>String(s??'').replace(/\s/g,'');
export function parseBoxUnread(html,{now=new Date()}={}){
 const $=cheerio.load(html);
 if($('input[type=password]').length)throw Error('BOX未読数: 未認証です。');
 const tables=$('table').toArray().filter(t=>{
   const cells=$(t).find('tr').first().children('th,td').toArray();
   return norm($(cells[0]).text())==='BOX'&&norm($(cells[1]).text())==='現在の未読数';
 });
 if(tables.length!==1)throw Error('BOX未読数: 対象表が一意ではありません。');
 const counts=UNREAD_BOXES.map(box=>{
   const rows=$(tables[0]).find('tr').toArray().filter(r=>norm($(r).children('th,td').first().text())===box);
   if(rows.length!==1)throw Error('BOX未読数: BOX行が不足または重複しています。');
   const value=norm($(rows[0]).children('th,td').eq(1).text()).replaceAll(',','');
   if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('BOX未読数: 値が不正です。');
   return Number(value);
 });
 const match=$('body').text().match(/最終更新[：:]\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
 if(!match)throw Error('BOX未読数: 更新日時を確認できません。');
 const sourceUpdatedAt=match[1]+' '+match[2],lag=now-new Date(match[1]+'T'+match[2]+'+09:00');
 if(!Number.isFinite(lag)||lag< -60000||lag>300000)throw Error('BOX未読数: 取得元が5分以上更新されていません。');
 return {counts,sourceUpdatedAt};
}

// Expand both header rows so a layout change cannot substitute a rolling-hour
// or yesterday column for the current-day interaction counts.
export function parseBoxActivity(html,options={}){
 const {sourceUpdatedAt}=parseBoxUnread(html,options),$=cheerio.load(html);
 const table=$('table').toArray().find(t=>{
  const cells=$(t).find('tr').first().children('th,td');
  return norm(cells.eq(0).text())==='BOX'&&norm(cells.eq(1).text())==='現在の未読数';
 });
 const grid=[[],[]],headers=$(table).find('tr').toArray().slice(0,2);
 headers.forEach((tr,r)=>{
  let c=0;
  $(tr).children('th,td').each((_,el)=>{
   while(grid[r][c]!==undefined)c++;
   const rs=Number($(el).attr('rowspan')||1),cs=Number($(el).attr('colspan')||1);
   if(rs>2||cs>30||rs<1||cs<1)throw Error('BOX送受信: 見出しが不正です。');
   for(let i=r;i<Math.min(r+rs,2);i++)for(let j=c;j<c+cs;j++)grid[i][j]=norm($(el).text());
   c+=cs;
  });
 });
 const columns=['やりとり送信','やりとり受信'].map(label=>{
  const matches=grid[0].flatMap((s,i)=>s==='当日'&&grid[1][i]===label?[i]:[]);
  if(matches.length!==1)throw Error('BOX送受信: 当日の送受信見出しを確認できません。');
  return matches[0];
 });
 const activity=UNREAD_BOXES.flatMap(box=>{
  const row=$(table).find('tr').toArray().find(tr=>norm($(tr).children().first().text())===box);
  return columns.map(i=>{
   const value=norm($(row).children('th,td').eq(i).text()).replaceAll(',','');
   if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('BOX送受信: 数値を確認できません。');
   return Number(value);
  });
 });
 return {activity,sourceUpdatedAt};
}
