import test from 'node:test';import assert from 'node:assert/strict';
import {parseBoxUnread} from './box-unread.js';
const now=new Date('2026-11-24T10:01:00Z');
const html='<body>最終更新：2026-11-24 19:00:39<table><tr><th rowspan="2">BOX</th><th rowspan="2">現在の<br>未読数</th><th>1時間以内</th></tr><tr><th>やりとり受信</th></tr>'+[['合計',762],['A',111],['B',80],['C',0],['E',54],['I',138]].map(([b,n])=>`<tr><td>${b}</td><td>${n}</td><td>99999</td></tr>`).join('')+'</table><table><tr><th>アカウント名</th></tr></table></body>';
test('reads only current unread A/B/C/E, preserving real zero',()=>assert.deepEqual(parseBoxUnread(html,{now}),{counts:[111,80,0,54],sourceUpdatedAt:'2026-11-24 19:00:39'}));
test('rejects missing, duplicate, malformed, stale and unauthenticated pages',()=>{
 for(const bad of [html.replace('<td>B</td>','<td>Q</td>'),html.replace('<td>I</td>','<td>A</td>'),html.replace('<td>111</td>','<td>—</td>'),html.replace('19:00:39','18:50:39'),html.replace('現在の<br>未読数','昨日の未読数'),html+'<input type="password">'])assert.throws(()=>parseBoxUnread(bad,{now}));
 assert.throws(()=>parseBoxUnread(html.replace('19:00:39','19:05:39'),{now}));
});
