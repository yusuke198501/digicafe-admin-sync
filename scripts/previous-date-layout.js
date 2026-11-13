/** The date column follows 23 pairs of time cells and the two-cell total. */
export function previousDateColumn(header) {
  const first = header.findIndex((v, i) => Number(v) === 7
    && Array.from({ length: 23 }, (_, h) => Number(header[i + 2 * h]) === 7 + h).every(Boolean)
    && String(header[i + 46] ?? '').trim() === '合計');
  if (first < 0) throw new Error('7〜29時と合計の見出しを確認できません。前回出勤日は変更しません。');
  let n = first + 49, label = '';
  for (; n; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label;
  return label;
}

export function previousSourceRange(grid) {
  if (!Number.isInteger(grid?.rowCount) || grid.rowCount < 1 || !Number.isInteger(grid?.columnCount) || grid.columnCount < 1) throw new Error('振分表のサイズを確認できません。');
  let n = grid.columnCount, label = '';
  for (; n; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label;
  return `A1:${label}${grid.rowCount}`;
}
