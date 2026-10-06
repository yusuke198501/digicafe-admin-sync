import test from 'node:test';
import assert from 'node:assert/strict';
import { boxColumnsFromHeader, boxHeaderLabels, parseDailyBoxDau, sendColumnsFromHeader, summaryMetricColumnsFromHeader } from './box-dau-layout.js';

test('parses gross and each configured box DAU by its table header', () => {
  const rows = [
    ['DAU（グロス）', 'ADAU', 'BDAU', 'CDAU', 'EDAU', 'HDAU', 'IDAU', 'JDAU', 'KDAU', 'LDAU', 'MDAU', 'NDAU', 'ODAU', 'QDAU'],
    ['2026/10/06', '732', '92', '85', '90', '178', '6', '37', '92', '0', '6', '100', '0', '0', '106'],
  ];
  assert.deepEqual(parseDailyBoxDau(rows, '2026/10/06'), {
    grossDau: 732,
    boxADau: 92,
    boxBDau: 85,
    boxCDau: 90,
    boxEDau: 178,
    boxIDau: 37,
    boxJDau: 92,
    boxMDau: 100,
    boxQDau: 106,
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
