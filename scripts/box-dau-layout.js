export const BOX_CODES = ['A', 'B', 'C', 'E', 'I', 'J', 'M', 'Q'];

const normalize = (value) => String(value ?? '').replace(/\s/g, '').replace(/[（）]/g, (char) => char === '（' ? '(' : ')');
const metricNumber = (value, label) => {
  const number = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(number)) throw new Error(`「${label}」の数値を取得できませんでした。`);
  return number;
};

export function parseDailyBoxDau(rows, dateDisplay) {
  const header = rows.find((row) => row.some((cell) => normalize(cell) === 'DAU(グロス)'));
  const data = rows.find((row) => normalize(row[0]) === normalize(dateDisplay));
  if (!header || !data) {
    throw new Error(`フォルダ別DAU/日毎の ${dateDisplay} の集計行または見出しが見つかりません。`);
  }

  const indexFor = (label) => {
    const index = header.findIndex((cell) => normalize(cell) === normalize(label));
    if (index < 0) throw new Error(`フォルダ別DAU/日毎の「${label}」が見つかりません。`);
    return index;
  };

  return {
    // The DAU table omits the date cell from its header row; the data row has
    // the date first, so metric indices are shifted right by one.
    grossDau: metricNumber(data[indexFor('DAU(グロス)') + 1], 'DAU（グロス）'),
    ...Object.fromEntries(BOX_CODES.map((box) => [
      `box${box}Dau`, metricNumber(data[indexFor(`${box}DAU`) + 1], `${box} DAU`),
    ])),
  };
}

export function boxColumnsFromHeader(header) {
  const labels = header.map(normalize);
  return Object.fromEntries(BOX_CODES.map((box) => {
    const receiveLabel = `${box}受信`;
    const dauLabel = `${box}DAU`;
    const receiveIndex = labels.indexOf(receiveLabel);
    const dauIndex = labels.indexOf(dauLabel);
    if (receiveIndex < 0 || dauIndex < 0) {
      throw new Error(`BOX別見出しに「${receiveLabel}」または「${dauLabel}」がありません。`);
    }
    return [box, { receiveIndex, dauIndex }];
  }));
}

export function boxHeaderLabels() {
  return BOX_CODES.flatMap((box) => [
    `${box}受信目標`, `${box}受信`, `${box}DAU目標`, `${box}DAU`,
  ]);
}
