import * as cheerio from 'cheerio';
import {createPartnerReportPool,safeFetchFailure} from './partner-report-pool.js';
import {cohortMailUrl,parseCohortMail,parseAllReceived,jstTimestamp} from './sync-sheet8.js';
import {parsePaidMaleAllUsagePt} from './gross-sales-report.js';
import {BOX_UNREAD_URL,parseBoxActivity} from './box-unread.js';
const date='2026-11-25',base='https://log.digicafe.jp/partner/';
const compact=s=>String(s??'').replace(/\s/g,'');
function formFields(html){const $=cheerio.load(html);return $('form input,form select').toArray().flatMap(e=>{const n=$(e).attr('name');if(!n||!/^(sex|mail_start|mail_end|created_at_start|created_at_end|is_create|account_scope|folder_rcv_source|action_start|action_end)$/.test(n))return[];return[{name:n,value:e.tagName==='select'?$(e).find('option[selected]').attr('value')??$(e).find('option').first().attr('value'):$(e).attr('type')==='checkbox'?$(e).is('[checked]'):$(e).attr('value')}];});}
function summaryTable(html,label){const $=cheerio.load(html),t=$('table').toArray().find(e=>compact($(e).find('tr').first().text())===label);if(!t)throw Error('Summary missing '+label);return $(t).find('tr').toArray().map(r=>$(r).children('th,td').toArray().map(c=>$(c).text().trim()));}
async function main(){
 if(process.env.COMPUTERNAME!=='UF-0049')throw Error('UF-0049 required');
 const pool=createPartnerReportPool({account:process.env.LOG_ACCOUNT,password:process.env.LOG_PASSWORD,deadline:Date.now()+225000});
 const female=new URL('mailnum_uf',base);female.search=new URLSearchParams({sex:'1',sort:'times',mail_start:date,mail_end:date,created_at_start:date,created_at_end:date,folder_rcv_source:'point',account_scope:'all',sum:'集計'});
 const pt=new URL('status/pt',base);pt.search=new URLSearchParams({action_start:date,action_end:date,created_at_start:date,created_at_end:date,sum:'集計'});
 const tasks=[
  {name:'R/S',url:cohortMailUrl(date,true),parse:html=>({values:parseCohortMail(html),table:summaryTable(html,'全体送信データ'),filters:formFields(html)})},
  {name:'V',url:pt.href,parse:html=>({value:parsePaidMaleAllUsagePt(html,{iso:date}),filters:formFields(html),sourceRow:(()=>{const $=cheerio.load(html);return $('table').toArray().filter(t=>$(t).text().includes('有料男性')).map(t=>({headers:$(t).find('tr').toArray().slice(0,3).map(r=>$(r).children('th,td').toArray().map(c=>({text:$(c).text().trim(),colspan:$(c).attr('colspan')}))),rows:$(t).find('tr').toArray().map(r=>$(r).children('th,td').toArray().map(c=>$(c).text().trim())).filter(r=>r[0]?.replace(/\D/g,'').startsWith('20261125'))}));})()})},
  {name:'AA',url:female.href,parse:html=>({value:parseAllReceived(html),table:summaryTable(html,'全体受信データ'),filters:formFields(html)})},
  {name:'AR',url:BOX_UNREAD_URL,parse:html=>{const r=parseBoxActivity(html);return{value:r.activity[6],sourceUpdatedAt:r.sourceUpdatedAt,allActivity:r.activity};}}
 ];
 const results=await Promise.all(tasks.map(async t=>{try{const html=await pool.get(t.url);const out={readOnly:true,metric:t.name,url:t.url,acquiredAt:jstTimestamp(),...t.parse(html)};console.log(JSON.stringify({sourceRecheck:out}));return true;}catch(e){console.log(JSON.stringify({sourceRecheck:{metric:t.name,url:t.url,acquiredAt:jstTimestamp(),error:safeFetchFailure(e)}}));return false;}}));
 if(results.some(x=>!x))process.exitCode=1;
}
main().catch(()=>{console.error('Source recheck failed; no sheet was changed.');process.exitCode=1;});
