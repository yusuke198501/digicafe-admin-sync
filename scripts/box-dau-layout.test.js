import test from 'node:test';
import assert from 'node:assert/strict';
import { boxColumnsFromHeader, boxHeaderLabels, boxMetricHeader, parseDailyBoxDau, sendColumnsFromHeader, summaryMetricColumnsFromHeader } from './box-dau-layout.js';

test('parses gross and each configured box DAU by its table header', () => {
  const rows = [
    ['', 'DAU（グロス）', 'ADAU', 'BDAU', 'CDAU', 'EDAU', 'HDAU', 'IDAU', 'JDAU', 'KDAU', 'LDAU', 'MDAU', 'NDAU', 'ODAU', 'QDAU'],
    ['2026/10/06', '790', '100', '96', '97', '194', '5', '43', '98', '0', '6', '109', '0', '0', '118'],
  ];
  assert.deepEqual(parseDailyBoxDau(rows, '2026/10/06'), {
    grossDau: 790,
    boxADau: 100,
    boxBDau: 96,
    boxCDau: 97,
    boxEDau: 194,
    boxIDau: 43,
    boxJDau: 98,
    boxMDau: 109,
    boxQDau: 118,
  });
});

test('uses metric labels above the BOX別/目標/進捗 row in the current two-tier layout', () => {
  const metricHeader = ['', ...boxHeaderLabels()];
  const markerHeader = ['BOX別', ...Array(32).fill('目標')];
  assert.equal(boxMetricHeader(markerHeader, metricHeader), metricHeader);
  assert.deepEqual(boxColumnsFromHeader(boxMetricHeader(markerHeader, metricHeader)).A, {
    receiveIndex: 2,
    dauIndex: 4,
  });
});

test('keeps using metric labels on the BOX別 row for older blocks', () => {
  const legacyHeader = ['BOX別', ...boxHeaderLabels()];
  assert.equal(boxMetricHeader(legacyHeader, ['時間/合計']), legacyHeader);
  assert.deepEqual(boxColumnsFromHeader(boxMetricHeader(legacyHeader, ['時間/合計'])).A, {
    receiveIndex: 2,
    dauIndex: 4,
  });
});

test('finds receive and DAU actual columns from the BOX header labels', () => {
  const labels = boxHeaderLabels();
  const columns = boxColumnsFromHeader(['BOX別', ...labels]);
  assert.deepEqual(columns.A, { receiveIndex: 2, dauIndex: 4 });
  assert.deepEqual(columns.J, { receiveIndex: 22, dauIndex: 24 });
  assert.deepEqual(columns.Q, { receiveIndex: 30, dauIndex: 32 });
});

test('rejects an incomplete BOX header instead of writing to a guessed cell', () => {
  assert.throws(() => boxColumnsFromHeader(['BOX別', 'A受信目標', 'A受信']), /ADAU/);
});

test('finds send metrics by label even when global column inserts spaced them apart', () => {
  const columns = sendColumnsFromHeader(['時間/合計', '', '送信数', '', '', 'A', 'B', '', 'C', 'E', '', '', '全体']);
  assert.deepEqual(columns, { A: 5, B: 6, C: 8, E: 9, '全体': 12 });
});

test('finds compact send metrics and the adjacent goal column by header', () => {
  const header = ['時間/合計', ...Array(17).fill(''), '送信数', 'A', 'B', 'C', 'E', '全体', '目標'];
  assert.deepEqual(sendColumnsFromHeader(header), {
    A: 19,
    B: 20,
    C: 21,
    E: 22,
    '全体': 23,
    '目標': 24,
  });
});

test('finds send metrics when the send table is moved to columns K:Q', () => {
  const header = ['時間/合計', ...Array(9).fill(''), '送信数', 'A', 'B', 'C', 'E', '全体', '目標'];
  assert.deepEqual(sendColumnsFromHeader(header), {
    A: 11,
    B: 12,
    C: 13,
    E: 14,
    '全体': 15,
    '目標': 16,
  });
});

test('finds daily summary write columns by header before and after the layout is compacted', () => {
  const oldLayout = ['受信数', 'グロス目標', 'グロス', '', '', 'UF目標', 'UF', '', '', '一般目標', '一般', '', '', 'DAU', ''];
  const compactLayout = ['受信数', 'グロス目標', 'グロス', 'UF目標', 'UF', '一般目標', '一般', 'DAU', ''];

  assert.deepEqual(summaryMetricColumnsFromHeader(oldLayout), {
    grossReceiveIndex: 2,
    ufReceiveIndex: 6,
    grossDauIndex: 14,
  });
  assert.deepEqual(summaryMetricColumnsFromHeader(compactLayout), {
    grossReceiveIndex: 2,
    ufReceiveIndex: 4,
    grossDauIndex: 8,
  });
});

test('refuses to guess if a required daily metric header is missing', () => {
  assert.throws(() => summaryMetricColumnsFromHeader(['受信数', 'グロス目標', 'グロス', 'UF目標', 'UF']), /DAU/);
});
