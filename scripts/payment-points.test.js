import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentUrl,parsePaymentPage,sumPaymentPages } from './payment-points.js';
const date='2026-10-21';
function fixture(page=1,total=2,pages=1,items=[{id:1,points:100,time:'9:00'},{id:2,points:200,time:'9:30'}]) {
 const q=new URL(paymentUrl(date,page)).searchParams;
 const form=[...q].filter(([k])=>k.startsWith('payment_filters[paydate]')).map(([k,v])=>`<select name="${k}"><option value="${v}" selected>${v}</option></select>`).join('');
 return `<a href="/dadmin.php/logout">ログアウト</a>${form}<table><thead><tr><th class="sf_admin_list_th_point">ポイント</th></tr></thead><tbody>${items.map(e=>`<tr class="sf_admin_row"><td class="sf_admin_list_td_paydate"><a href="/dadmin.php/payment/${e.id}/edit">2026年10月21日 ${e.time}</a></td><td class="sf_admin_list_td_pay">999999</td><td class="sf_admin_list_td_point">${e.points}</td></tr>`).join('')}</tbody><tfoot><tr><td>${total} 件 (ページ ${page}/${pages})</td></tr></tfoot></table>`;
}
test('payment filters span today to tomorrow across month/year boundaries',()=>{
 for(const [day,y,m,d] of [['2026-10-31','2026','11','1'],['2026-12-31','2027','1','1']]){
 const q=new URL(paymentUrl(day)).searchParams;
 for(const [key,val] of [['year',y],['month',m],['day',d]])assert.equal(q.get(`payment_filters[paydate][to][${key}]`),val);
 }
 assert.throws(()=>paymentUrl('2026-02-30'));
});
test('payment reads points not amount and validates date/authentication/page',()=>{
 const html=fixture();assert.deepEqual(parsePaymentPage(html,date).entries.map(e=>e.points),[100,200]);
 for(const bad of [html.replace('2026年10月21日','2026年10月20日'),html.replace('>100<','>-1<'),html.replace('/logout','/login'),html.replace('ページ 1/1','ページ 2/2'),html.replace('value="22" selected','value="21" selected')])assert.throws(()=>parsePaymentPage(bad,date));
});
test('payment sums all pages and excludes records after snapshot minute',async()=>{
 const pages=[fixture(1,3,2),fixture(2,3,2,[{id:3,points:700,time:'9:45'}])];
 assert.equal(await sumPaymentPages(async p=>pages[p-1],date,date+' 09:40:12'),300);
 assert.equal(await sumPaymentPages(async p=>pages[p-1],date,date+' 09:50:12'),1000);
});
test('payment rejects duplicate, changing totals or incomplete pages',async()=>{
 for(const second of [fixture(2,3,2,[{id:2,points:200,time:'9:30'}]),fixture(2,4,2,[{id:3,points:1,time:'9:00'}]),fixture(2,3,2,[])])await assert.rejects(sumPaymentPages(async p=>p===1?fixture(1,3,2):second,date,date+' 10:00:00'));
 await assert.rejects(sumPaymentPages(async()=>fixture(1,3,1),date,date+' 10:00:00'));
});
test('explicit no-data page is zero, never an authentication or missing-table error',async()=>{
 const html=fixture().replace(/<table>[\s\S]*<\/table>/,'<p>データがありません</p>');
 assert.equal(await sumPaymentPages(async()=>html,date,date+' 00:05:00'),0);
 assert.throws(()=>parsePaymentPage('<html>sign in</html>',date));
});
