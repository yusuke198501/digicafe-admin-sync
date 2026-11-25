import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';
import { writeFileSync } from 'node:fs';
const BASE='https://admin.digicafe.jp/dadmin.php/',FROM='2026-11-24',TO='2026-11-25';
const clean=s=>String(s??'').replace(/\s/g,'');
function parse(html,page){
  const $=cheerio.load(html);
  if($('input[type=password]').length||!$('a[href$="/logout"]').length)throw Error('Authentication missing');
  for(const[side,date]of[['from',FROM],['to',TO]])for(const[i,p]of['year','month','day'].entries())if(Number($(`select[name="member_point_history_filters[created_at][${side}][${p}]"] option[selected]`).attr('value'))!==Number(date.split('-')[i]))throw Error('Date mismatch');
  if($('input[name="member_point_history_filters[member_id]"]').attr('value'))throw Error('Member filter mismatch');
  const ts=$('table').toArray().filter(t=>clean($(t).find('tr').first().text()).includes('MP増減量'));
  if(ts.length!==1)throw Error('History table missing');
  const t=$(ts[0]),h=t.find('tr').first().children().toArray().map(e=>clean($(e).text()));
  if(h[0]!=='履歴ID'||h[3]!=='ユーザー行動'||h[4]!=='MP増減量')throw Error('Header mismatch');
  const m=t.text().match(/([\d,]+)\s*件\s*\(ページ\s*(\d+)\s*\/\s*(\d+)\)/);
  if(!m||Number(m[2])!==page)throw Error('Page mismatch');
  const rows=t.find('tr').toArray().flatMap(r=>{
    const c=$(r).children('td').toArray().map(e=>$(e).text().trim());
    if(c.length!==9||!/^\d+$/.test(c[0]))return [];
    const d=clean(c[2]).match(/^(\d{4})年(\d+)月(\d+)日(\d+):(\d{2})$/);
    if(!d||!/^(-?\d+)$/.test(clean(c[4])))throw Error('Invalid row');
    const date=`${d[1]}-${d[2].padStart(2,'0')}-${d[3].padStart(2,'0')}`;
    if(date<FROM||date>TO)throw Error('Row outside dates');
    return[{id:Number(c[0]),date,action:clean(c[3]),mp:Number(clean(c[4]))}];
  });
  if(!rows.length||rows.length>20)throw Error('Incomplete rows');
  return{total:Number(m[1].replaceAll(',','')),pages:Number(m[3]),rows};
}
async function main(){
  if(process.env.COMPUTERNAME!=='UF-0049')throw Error('UF-0049 required');
  const username=process.env.ADMIN_DIGICAFE_USERNAME,password=process.env.ADMIN_DIGICAFE_PASSWORD;
  if(!username||!password)throw Error('Credentials missing');
  const client=wrapper(axios.create({jar:new CookieJar(),timeout:45000,headers:{'User-Agent':'Mozilla/5.0','Accept-Language':'ja-JP'}}));
  const login=cheerio.load((await client.get(BASE,{validateStatus:s=>s===200||s===401})).data),csrf=login('input[name="signin[_csrf_token]"]').attr('value');
  if(!csrf)throw Error('Login form missing');
  await client.post(new URL('login',BASE).href,new URLSearchParams({'signin[username]':username,'signin[password]':password,'signin[remember]':'on','signin[_csrf_token]':csrf}),{maxRedirects:0,validateStatus:s=>[200,301,302,303].includes(s)});
  const $=cheerio.load((await client.get(new URL('memberPointHistory',BASE).href)).data),form=$('input[name="member_point_history_filters[member_id]"]').closest('form');
  if(form.length!==1)throw Error('Search form missing');
  const action=new URL(form.attr('action'),BASE);
  if(action.origin!==new URL(BASE).origin||!action.pathname.endsWith('/memberPointHistory/filter/action'))throw Error('Unexpected filter action');
  const body=new URLSearchParams();form.find('input[type=hidden]').each((_,e)=>{const n=$(e).attr('name');if(n)body.set(n,$(e).attr('value')||'');});body.set('member_point_history_filters[member_id]','');
  for(const[side,date]of[['from',FROM],['to',TO]])for(const[i,p]of['year','month','day'].entries())body.set(`member_point_history_filters[created_at][${side}][${p}]`,String(Number(date.split('-')[i])));
  await client.post(action.href,body);
  const first=parse((await client.get(new URL('memberPointHistory?sort=member_point_history_id&sort_type=asc&page=1',BASE).href)).data,1);
  if(first.pages>10000||first.total>200000)throw Error('Unexpected dataset size');
  const out={host:process.env.COMPUTERNAME,filters:{from:FROM,to:TO,memberId:'all'},startedAt:new Date().toISOString(),total:first.total,pages:first.pages,scanned:0,matched:0,byDate:{},minusTwoActions:{},firstId:null,lastId:null};const seen=new Set();
  for(let page=1;page<=first.pages;page++){
    let d=first;
    if(page>1)for(let attempt=0;attempt<3;attempt++)try{d=parse((await client.get(new URL(`memberPointHistory?page=${page}`,BASE).href)).data,page);break;}catch(e){if(attempt===2)throw e;console.log(JSON.stringify({retryPage:page,attempt:attempt+1}));}
    if(d.total!==first.total||d.pages!==first.pages)throw Error('Dataset changed');
    if(d.rows.length!==(page<first.pages?20:first.total-20*(first.pages-1)))throw Error('Incomplete page');
    for(const r of d.rows){
      if(seen.has(r.id)||out.lastId!==null&&r.id<=out.lastId)throw Error('Duplicate or unsorted ID');seen.add(r.id);out.firstId??=r.id;out.lastId=r.id;out.scanned++;
      const day=out.byDate[r.date]??={scanned:0,matched:0};day.scanned++;
      if(r.mp===-2){out.minusTwoActions[r.action]=(out.minusTwoActions[r.action]||0)+1;if(r.action==='message_send'){out.matched++;day.matched++;}}
    }
    if(page%50===0||page===first.pages)console.log(JSON.stringify({progress:{page,pages:first.pages,scanned:out.scanned,matched:out.matched}}));
  }
  if(out.scanned!==out.total)throw Error('Total reconciliation failed');
  const check=parse((await client.get(new URL('memberPointHistory?page=1',BASE).href)).data,1);
  if(check.total!==first.total||check.rows[0].id!==first.rows[0].id)throw Error('Final reconciliation failed');
  out.completedAt=new Date().toISOString();out.reconciled=true;writeFileSync('point-history-count.json',JSON.stringify(out,null,2));console.log(JSON.stringify({pointHistoryCount:out}));
}
main().catch(e=>{console.error(`Point history count failed: ${e.response?.status?'HTTP '+e.response.status:e.isAxiosError?'network request failed':e.message}`);process.exitCode=1;});
