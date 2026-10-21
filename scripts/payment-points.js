import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import * as cheerio from 'cheerio';

const BASE='https://admin.digicafe.jp/dadmin.php/';
const compact=s=>String(s??'').replace(/\s/g,'');
export function paymentUrl(date,page=1) {
  const d=new Date(`${date}T00:00:00Z`);
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date||!Number.isInteger(page)||page<1)throw new Error('Invalid payment date/page');
  const next=new Date(d.getTime()+86400000),u=new URL('payment',BASE);
  for(const [side,day] of [['from',d],['to',next]])for(const [key,val] of [['year',day.getUTCFullYear()],['month',day.getUTCMonth()+1],['day',day.getUTCDate()]])u.searchParams.set(`payment_filters[paydate][${side}][${key}]`,String(val));
  for(const key of ['uid','pay][text','method','repeater][text'])u.searchParams.set(`payment_filters[${key}]`,'');
  u.searchParams.set('page',String(page));u.searchParams.set('sort','paydate');u.searchParams.set('sort_type','desc');
  return u.href;
}
export function parsePaymentPage(html,date,page=1) {
  const $=cheerio.load(html),q=new URL(paymentUrl(date,page)).searchParams;
  if($('input[type="password"]').length||!$('a[href$="/logout"]').length)throw new Error('Payment authentication failed');
  for(const side of ['from','to'])for(const part of ['year','month','day']) {
    const key=`payment_filters[paydate][${side}][${part}]`;
    const selected=$(`select[name="${key}"] option[selected]`).attr('value');
    if(Number(selected)!==Number(q.get(key)))throw new Error('Payment date filter mismatch');
  }
  for(const key of ['uid','pay][text','method','repeater][text']) {
    const el=$(`[name="payment_filters[${key}]"]`);
    const value=el.is('select')?el.find('option[selected]').attr('value'):el.attr('value');
    if(value)throw new Error('Unexpected payment filter');
  }
  const table=$('th.sf_admin_list_th_point').closest('table');
  if(!table.length&&$('p').toArray().some(e=>compact($(e).text())==='データがありません'))return {total:0,page:1,pages:1,entries:[]};
  if(table.length!==1||compact(table.find('th.sf_admin_list_th_point').text())!=='ポイント')throw new Error('Payment table missing');
  const pager=table.find('tfoot').text().match(/([\d,]+)\s*件\s*\(ページ\s*(\d+)\s*\/\s*(\d+)\)/);
  if(!pager||Number(pager[2])!==page)throw new Error('Payment pagination mismatch');
  const total=Number(pager[1].replaceAll(',','')),pages=Number(pager[3]);
  if(pages<page||pages>60||total>1200)throw new Error('Payment pagination limit');
  const entries=table.find('tbody tr.sf_admin_row').toArray().map(row=>{
    const r=$(row),link=r.find('td.sf_admin_list_td_paydate a'),id=link.attr('href')?.match(/^\/dadmin\.php\/payment\/(\d+)\/edit$/)?.[1];
    const dt=compact(link.text()).match(/^(\d{4})年(\d{1,2})月(\d{1,2})日(\d{1,2}):(\d{2})$/);
    const text=compact(r.find('td.sf_admin_list_td_point').text()).replaceAll(',','');
    if(!id||!dt||!/^\d+$/.test(text)||!Number.isSafeInteger(Number(text)))throw new Error('Invalid payment row');
    const stamp=`${dt[1]}-${dt[2].padStart(2,'0')}-${dt[3].padStart(2,'0')} ${dt[4].padStart(2,'0')}:${dt[5]}:00`;
    if(stamp.slice(0,10)!==date)throw new Error('Payment row outside date');
    return {id,stamp,points:Number(text)};
  });
  if(!entries.length||entries.length>20)throw new Error('Payment rows incomplete');
  return {total,page,pages,entries};
}
export async function sumPaymentPages(getPage,date,timestamp) {
  let expected, pages, count=0,sum=0;const seen=new Set();
  for(let page=1;page<=(pages??1);page++) {
    const parsed=parsePaymentPage(await getPage(page),date,page);
    if(page===1){expected=parsed.total;pages=parsed.pages;}
    if(parsed.total!==expected||parsed.pages!==pages)throw new Error('Payments changed during pagination');
    for(const e of parsed.entries){if(seen.has(e.id))throw new Error('Duplicate payment across pages');seen.add(e.id);count++;if(e.stamp.slice(0,16)<=timestamp.slice(0,16))sum+=e.points;}
  }
  if(count!==expected||!Number.isSafeInteger(sum))throw new Error('Payment count mismatch');
  return sum;
}
export async function fetchPaymentPoints(timestamp,username,password) {
  if(!username||!password)throw new Error('Payment credentials missing');
  let stage='login-form';
  try {
  const client=wrapper(axios.create({jar:new CookieJar(),timeout:15000,headers:{'User-Agent':'Mozilla/5.0','Accept-Language':'ja-JP'}}));
  const start=Date.now(),initial=await client.get(BASE),$=cheerio.load(initial.data),csrf=$('input[name="signin[_csrf_token]"]').attr('value');
  if(!csrf)throw new Error('Payment login form missing');
  stage='login-submit';
  await client.post(new URL('login',BASE).href,new URLSearchParams({'signin[username]':username,'signin[password]':password,'signin[remember]':'on','signin[_csrf_token]':csrf}),{maxRedirects:0,validateStatus:s=>[200,301,302,303].includes(s)});
  stage='pagination';
  return await sumPaymentPages(async page=>{stage=`page-${page}`;if(Date.now()-start>75000)throw new Error('Payment collection timeout');return (await client.get(paymentUrl(timestamp.slice(0,10),page))).data;},timestamp.slice(0,10),timestamp);
  } catch(e) {
    const own=/^(Payment (?:authentication failed|date filter mismatch|table missing|pagination mismatch|pagination limit|rows incomplete|count mismatch|login form missing|collection timeout)|Invalid payment row|Payment row outside date|Unexpected payment filter|Payments changed during pagination|Duplicate payment across pages)$/.test(e.message);
    throw new Error(`Payment ${stage}: ${own?e.message:(e.response?.status?`HTTP ${Number(e.response.status)}`:'network request failed')}`);
  }
}
