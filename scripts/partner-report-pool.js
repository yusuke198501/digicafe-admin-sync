import axios from 'axios';
import {wrapper} from 'axios-cookiejar-support';
import {CookieJar} from 'tough-cookie';
import {retryableNetworkFailure} from './network-retry.js';

const BASE='https://log.digicafe.jp/partner/';
const NETWORK_CODES=new Set(['ECONNRESET','ECONNABORTED','ETIMEDOUT','EAI_AGAIN','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH','ERR_NETWORK']);
export class ReportFetchError extends Error {
 constructor(stage,reason){super(`report ${stage}: ${reason}`);this.name='ReportFetchError';this.stage=stage;this.reason=reason;}
}
export function safeFetchFailure(error){
 if(error instanceof ReportFetchError)return error.message;
 if(Number.isInteger(error?.response?.status))return `HTTP ${error.response.status}`;
 if(NETWORK_CODES.has(error?.code))return error.code;
 return 'parse/validation failure';
}

// Each worker owns a different PHP session and uses it for only one request at
// a time. A global queue bounds server load rather than queueing inside PHP.
export function createReportPool({createSession,size=3,timeoutMs=90000,deadline=Date.now()+225000,now=()=>Date.now(),log=()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
 if(!Number.isInteger(size)||size<1||size>4)throw Error('Invalid report worker count');
 const workers=Array.from({length:size},()=>({busy:false,session:null})),queue=[];
 let sequence=0;
 async function perform(worker,task){
  const started=now(),path=new URL(task.url).pathname,requestId=++sequence;
  for(let attempt=1;attempt<=2;attempt++){
   const remaining=deadline-now();
   if(remaining<=0)throw new ReportFetchError('deadline','collection window expired');
   try{
    if(!worker.session)worker.session=await createSession(Math.min(timeoutMs,remaining));
    const left=deadline-now();if(left<=0)throw new ReportFetchError('deadline','collection window expired');
    const response=await worker.session.get(task.url,{timeout:Math.min(timeoutMs,left)});
    const html=String(response.data??'');
    if(!html.includes('ログアウト')||/<input\b[^>]*type\s*=\s*["']?password\b/i.test(html))throw new ReportFetchError('auth','session expired');
    log({requestId,path,attempt,result:'success',status:response.status,elapsedMs:now()-started,queueMs:started-task.queuedAt});
    return html;
   }catch(error){
    const auth=error instanceof ReportFetchError&&error.stage==='auth';
    const reason=safeFetchFailure(error);
    log({requestId,path,attempt,result:'failed',reason,elapsedMs:now()-started,queueMs:started-task.queuedAt});
    if(attempt===2||!(auth||retryableNetworkFailure(error))||deadline-now()<1500)throw new ReportFetchError(auth?'auth':'http',reason);
    // A timed-out PHP request may still hold its old session lock.
    worker.session=null;await sleep(Math.min(500,Math.max(0,deadline-now())));
   }
  }
 }
 function drain(){for(const worker of workers){if(worker.busy||!queue.length)continue;const task=queue.shift();worker.busy=true;perform(worker,task).then(task.resolve,task.reject).finally(()=>{worker.busy=false;drain();});}}
 return {get(url){
  const target=new URL(url);
  if(target.username||target.password||target.origin!==new URL(BASE).origin||!target.pathname.startsWith('/partner/'))return Promise.reject(new ReportFetchError('destination','unsupported report host/path'));
  return new Promise((resolve,reject)=>{queue.push({url:target.href,resolve,reject,queuedAt:now()});drain();});
 }};
}

export function createPartnerReportPool({account,password,deadline,log=event=>console.log(JSON.stringify({reportFetch:event}))}){
 const limit=deadline??Date.now()+225000;
 return createReportPool({deadline:limit,log,createSession:async timeout=>{
  const client=wrapper(axios.create({jar:new CookieJar(),timeout,headers:{'User-Agent':'Mozilla/5.0','Accept-Language':'ja-JP,ja;q=0.9'}}));
  // Login failures are reduced to fixed categories; never emit axios configs.
  try{
   await client.get(BASE,{timeout:Math.min(timeout,Math.max(1,limit-Date.now()))});
   if(limit<=Date.now())throw new ReportFetchError('deadline','collection window expired');
   const response=await client.post(BASE,new URLSearchParams({mode:'login',account,pass:password}),{timeout:Math.min(timeout,Math.max(1,limit-Date.now()))});
   if(!String(response.data).includes('ログアウト'))throw new ReportFetchError('auth','login rejected');
   return client;
  }catch(error){if(error instanceof ReportFetchError)throw error;throw new ReportFetchError('auth',safeFetchFailure(error));}
 }});
}
