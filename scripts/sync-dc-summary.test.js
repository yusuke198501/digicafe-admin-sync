import test from 'node:test';
import assert from 'node:assert/strict';
import { dates, queries, summaryRow, summaryValues, adPlan } from './sync-dc-summary.js';
import { parseAdCodeDailyValues } from './dc-daily-parsers.js';

test('JST day/month/year boundaries and original registration filter', () => {
  const { target,runDate }=dates(new Date('2026-12-31T15:16:00Z'), undefined);
  assert.equal(target.toISOString().slice(0,10),'2026-12-31');
  const q=queries(target,runDate);
  assert.equal(q.mail.created_at_start,'2027-01-01');
  assert.equal(q.mail.mail_start,'2026-12-31');
  assert.equal(q.status.action_start,'2026-12-01');
  assert.equal(q.previous.toISOString().slice(0,10),'2026-11-01');
  assert.throws(()=>dates(new Date('2026-11-17T01:00Z'),'2026-02-30'));
});
test('summary date is found by month heading and date, never day+4',()=>{
  const target=new Date('2026-11-16T00:00Z');
  assert.equal(summaryRow([['26年11月'],['11/15(日)'],['11/16(月)']],target),3);
  assert.throws(()=>summaryRow([['26年10月'],['11/16(月)']],target));
  assert.throws(()=>summaryRow([['26年11月'],['11/16(月)'],['11/16(月)']],target));
  assert.equal(summaryRow([['26年11月'],['11/15(日)'],['11/16(月)'],[],['月間平均'],[],['11/16']],target),3);
});
test('preserves original five metrics including period-total payers and points x10',()=>{
  const status='<table><tr><th></th><th>グロス</th><th colspan="2">有料男性</th></tr><tr><th>日時</th><th>売上</th><th>全利用Pt</th><th>課金者数</th></tr><tr><td>2026-11-16</td><td>815,500</td><td>-76,170</td><td>139</td></tr><tr><td>合計</td><td>999</td><td>-999</td><td>1,480</td></tr></table>';
  const mail='<table><tr><td>全体送受信データ</td></tr><tr><td>メール総数</td><td>999</td></tr></table><table><tr><td>全体送受信データ</td></tr><tr><td>メール総数</td><td>3,054</td></tr></table><h3>UF_MKT系データ(フォルダ別/日毎)</h3><table><tr><th>日付</th><th>受信合計</th></tr><tr><td>2026/11/16</td><td>1,900</td></tr></table>';
  assert.deepEqual(summaryValues(status,mail,new Date('2026-11-16T00:00Z')),[815500,3054,1900,761700,1480]);
  assert.throws(()=>summaryValues(status,mail.replace('受信合計','送信合計'),new Date('2026-11-16T00:00Z')));
});
const adHtml=(value='10')=>`<table><tr><th>広告コード</th><th>項目 アクセス(unique)</th><th>合計</th><th>1</th></tr><tr><td>none</td><td><div>アクセス(unique)</div><div>男性登録数</div></td><td><div>30</div><div>3</div></td><td><div>${value}</div><div>1</div></td></tr><tr><td>new</td><td><div>アクセス(unique)</div><div>男性登録数</div></td><td><div>20</div><div>2</div></td><td><div>20</div><div>2</div></td></tr></table>`;
test('ad plans preserve row mapping and add only missing code blocks',()=>{
  const rows=[['','項目'],['合計','other'],['広告コード','アクセス(unique)'],['old','男性登録数'],['広告コード','アクセス(unique)'],['none','男性登録数']];
  const d=new Date('2026-11-01T00:00Z');
  const plan=adPlan('当月data',rows,adHtml(),d,d);
  assert.deepEqual(plan.missing,['new']);
  assert.equal(plan.days,1); assert.equal(plan.matched,4);
  assert.equal(plan.newRows,8);
  assert.deepEqual(plan.data[1],{range:"'当月data'!D3:D4",values:[[''],['']]});
  assert.deepEqual(plan.data[2],{range:"'当月data'!C5:D8",values:[[30,10],[3,1],[20,20],[2,2]]});
  assert.equal(plan.data.some(x=>/!A|!B/.test(x.range)),false);
});
test('empty ad metric does not shift following numbers and aborts before writes',()=>{
  const d=new Date('2026-11-01T00:00Z');
  const parsed=parseAdCodeDailyValues(adHtml(''),d);
  assert.equal(parsed.get('none|男性登録数'),1);
  assert.equal(parsed.get('none|アクセス'),'');
  assert.throws(()=>adPlan('当月data',[['','項目'],['広告コード','アクセス'],['none','男性登録数'],['広告コード','アクセス'],['new','男性登録数']],adHtml(''),d,d));
});
