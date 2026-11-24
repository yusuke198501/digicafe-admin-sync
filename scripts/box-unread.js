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
