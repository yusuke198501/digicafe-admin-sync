// Read-only verification on the dedicated runner; never writes historical snapshots.
import axios from 'axios';
import {wrapper} from 'axios-cookiejar-support';
import {CookieJar} from 'tough-cookie';
import {todayRegistrationMailUrl,parseCohortMail,jstTimestamp} from './sync-sheet8.js';
const date=process.env.PROBE_DATE;
const url=todayRegistrationMailUrl(date);
const client=wrapper(axios.create({jar:new CookieJar(),timeout:120000,headers:{'User-Agent':'Mozilla/5.0'}}));
try {
 if(!process.env.LOG_ACCOUNT||!process.env.LOG_PASSWORD)throw Error();
 const base='https://log.digicafe.jp/partner/';
 await client.get(base);
 const login=await client.post(base,new URLSearchParams({mode:'login',account:process.env.LOG_ACCOUNT,pass:process.env.LOG_PASSWORD}));
 if(!String(login.data).includes('ログアウト'))throw Error();
 const response=await client.get(url);
 if(!String(response.data).includes('ログアウト'))throw Error();
 const [dau,received]=parseCohortMail(response.data);
 console.log(JSON.stringify({date,acquiredAt:jstTimestamp(),url,dau,received,readOnly:true}));
}catch{console.error('当日登録者データの読み取り確認に失敗しました。シートは変更していません。');process.exitCode=1;}
