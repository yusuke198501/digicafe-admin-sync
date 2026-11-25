// Read-only comparison: shared PHP session versus independent sessions.
import axios from 'axios';import {wrapper} from 'axios-cookiejar-support';import {CookieJar} from 'tough-cookie';
import {cohortMailUrl,todayRegistrationMailUrl,memberQuery,parseMembers,parseCohortMail,jstTimestamp} from './sync-sheet8.js';
const base='https://log.digicafe.jp/partner/',date=jstTimestamp().slice(0,10);
const client=()=>wrapper(axios.create({jar:new CookieJar(),timeout:100000,headers:{'User-Agent':'Mozilla/5.0','Accept-Language':'ja-JP,ja;q=0.9'}}));
async function login(c){
 await c.get(base);const r=await c.post(base,new URLSearchParams({mode:'login',account:process.env.LOG_ACCOUNT,pass:process.env.LOG_PASSWORD}));
 if(!String(r.data).includes('ログアウト'))throw Error('AUTH');
}
async function measure(c,group,task){
 const start=Date.now();let r;
 try{r=await c.get(task.url);}catch(e){const result={group,metric:task.name,date,elapsedMs:Date.now()-start,stage:'http',code:/^[A-Z_]+$/.test(e.code??'')?e.code:'NETWORK',status:e.response?.status??null};console.log(JSON.stringify(result));return result;}
 const result={group,metric:task.name,date,elapsedMs:Date.now()-start,status:r.status,authenticated:String(r.data).includes('ログアウト')};
 try{result.value=task.parse(r.data);result.stage='success';}catch(e){result.stage='parse';result.reason=e.message;}
 console.log(JSON.stringify(result));return result;
}
try{
 if(!process.env.LOG_ACCOUNT||!process.env.LOG_PASSWORD)throw Error('AUTH');
 const shared=client();await login(shared);const form=(await shared.get(new URL('list',base).href)).data;
 const loginUrl=new URL('list',base);loginUrl.search=memberQuery(form,date,'login');
 const tasks=[{name:'N/O current-month cohort',url:cohortMailUrl(date),parse:parseCohortMail},{name:'AF/AG same-day registrations',url:todayRegistrationMailUrl(date),parse:parseCohortMail},{name:'E paid male logins',url:loginUrl.href,parse:parseMembers}];
 console.log(JSON.stringify({readOnly:true,date,test:'shared-session-parallel'}));
 await Promise.all(tasks.map(t=>measure(shared,'shared-session',t)));
 const clients=tasks.map(()=>client());await Promise.all(clients.map(login));
 console.log(JSON.stringify({readOnly:true,date,test:'independent-session-parallel'}));
 await Promise.all(tasks.map((t,i)=>measure(clients[i],'independent-session',t)));
}catch{console.error('Read-only diagnostic could not authenticate or obtain the search form. No sheet was changed.');process.exitCode=1;}
