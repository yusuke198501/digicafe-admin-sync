import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { tableFor } from './inspect-mailnum-uf.js';
test('read-only inspection finds the embedded all-receive title and wrapped folder table', () => {
  const $ = cheerio.load('<table id="all"><tr><td>全体受信データ</td></tr><tr><td>42</td></tr></table><h3>UF_MKT系データ(フォルダ別/日毎)</h3><div><table id="folder"><tr><td>27</td></tr></table></div>');
  assert.equal(tableFor($, '全体受信データ').attr('id'), 'all');
  assert.equal(tableFor($, 'UF_MKT系データ(フォルダ別/日毎)').attr('id'), 'folder');
});
test('inspection rejects absent sections instead of selecting the next report section', () => {
  const $ = cheerio.load('<h3>UF_MKT系データ(フォルダ別/日毎)</h3><h3>別の集計</h3><table><tr><td>99</td></tr></table>');
  assert.throws(() => tableFor($, '全体受信データ'));
  assert.throws(() => tableFor($, 'UF_MKT系データ(フォルダ別/日毎)'));
});
