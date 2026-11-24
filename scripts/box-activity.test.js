import test from 'node:test';import assert from 'node:assert/strict';
import {parseBoxActivity} from './box-unread.js';
const now=new Date('2026-11-24T10:01:00Z');
const html='<body>最終更新：2026-11-24 19:00:39<table><tr><th rowspan="2">BOX</th><th rowspan="2">現在の未読数</th><th colspan="4">1時間以内</th><th colspan="3">当日</th><th colspan="3">昨日</th></tr><tr>'+['やりとり送信','やりとり受信','同報受信','対応アカウント','やりとり送信','やりとり受信','同報受信','やりとり送信','やりとり受信','同報受信'].map(s=>`<th>${s}</th>`).join('')+'</tr>'+['A','B','C','E'].map((b,i)=>'<tr>'+[b,5,999,888,777,'account',i*100,i*200,666,555,444,333].map(s=>`<td>${s}</td>`).join('')+'</tr>').join('')+'</table></body>';
test('current-day interactions follow the two-level headers, preserving zeros and excluding broadcast/yesterday/hourly',()=>{
 assert.deepEqual(parseBoxActivity(html,{now}),{activity:[0,0,100,200,200,400,300,600],sourceUpdatedAt:'2026-11-24 19:00:39'});
});
test('ambiguous or missing day headers, malformed values, missing boxes and stale data are rejected',()=>{
 for(const bad of [html.replace('>当日<','>指定日<'),html.replace('>昨日<','>当日<'),html.replace('<td>100</td>','<td>—</td>'),html.replace('<td>B</td>','<td>Q</td>'),html.replace('19:00:39','18:50:00')])assert.throws(()=>parseBoxActivity(bad,{now}));
});
