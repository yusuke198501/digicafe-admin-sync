import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInteractions, parsePayers, parseMembers, memberQuery, slot, jstTimestamp } from './sync-sheet8.js';
const hours = Array.from({length:24},(_,i)=>`<tr><td>${i}時</td><td>${i===0?312:0}</td><td>${i===0?335:0}</td></tr>`).join('');
const mail = `<h3>UF_MKT系データ(ログインアカウント別/時間毎)</h3><div><table><tr><th></th><th colspan="7">全体</th></tr><tr><th>やり取り送信</th><th>やり取り受信</th></tr>${hours}<tr><td>合計</td><td>312</td><td>335</td></tr></table></div>`;
test('exact interaction columns, not overall or broadcast',()=>assert.deepEqual(parseInteractions(mail),[312,335]));
test('reject missing data and inconsistent totals',()=>{assert.throws(()=>parseInteractions('')); assert.throws(()=>parseInteractions(mail.replace('<td>335</td></tr></table>','<td>336</td></tr></table>')));});
test('paid male sales excludes gross and sponsor',()=>{
  const html='<table><tr><th colspan="2">グロス</th><th colspan="2">有料男性</th><th>スポンサー決済</th></tr><tr><th>日時</th><th>売上</th><th>売上</th><th>課金者数</th><th>売上</th></tr><tr><td>2026-10-15</td><td>150,010</td><td>148,710</td><td>34</td><td>1,300</td></tr></table>';
  assert.deepEqual(parsePayers(html,'2026-10-15'),[34,148710]); assert.throws(()=>parsePayers(html,'2026-10-14'));
});
test('member counts fail closed',()=>{assert.equal(parseMembers('抽出件数 3,151 件'),3151); assert.throws(()=>parseMembers('ログイン')); assert.throws(()=>parseMembers('抽出件数 10,000 件'));});
test('member query preserves checked area and paid cohort, clears other dates',()=>{
  const q=memberQuery('<form><input name="sum" value="集計"><input name="message_sent_start"><input name="login_start" value="2020-01-01"><input name="area[]" type="checkbox" checked value="1"><input name="area[]" type="checkbox" checked value="2"><input name="is_paying" type="radio" checked value="0"></form>','2026-10-15','message_sent');
  assert.equal(q.get('is_paying'),'1'); assert.equal(q.get('sex'),'0'); assert.equal(q.get('login_start'),''); assert.equal(q.get('message_sent_start'),'2026-10-15'); assert.deepEqual(q.getAll('area[]'),['1','2']);
});
test('JST date and 5 minute deduplication',()=>{assert.equal(jstTimestamp(new Date('2026-10-14T15:02:30Z')),'2026-10-15 00:02:30'); assert.equal(slot('2026-10-15 09:19:59'),'2026-10-15 09:15'); assert.equal(slot('日時'),null);});
