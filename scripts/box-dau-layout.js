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

  // The report includes an empty header cell for the date column. Data rows
  // use that same first column for the date, so the metric indices align.
  return {
    grossDau: metricNumber(data[indexFor('DAU(グロス)')], 'DAU（グロス）'),
    ...Object.fromEntries(BOX_CODES.map((box) => [
      `box${box}Dau`, metricNumber(data[indexFor(`${box}DAU`)], `${box} DAU`),
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

export function boxColumnsFromTableHeaders(markerHeader, precedingHeader) {
  const precedingLabels = precedingHeader.map(normalize);
  // In the current two-tier sheet layout, the metric labels (A受信, ADAU,
  // etc.) are one row above BOX別 / 目標 / 進捗. Each metric spans a goal
  // and an actual column, so actuals are one column to the right of labels.
  if (precedingLabels.includes('A受信') && precedingLabels.includes('ADAU')) {
    return Object.fromEntries(Object.entries(boxColumnsFromHeader(precedingHeader)).map(([box, columns]) => [
      box,
      { receiveIndex: columns.receiveIndex + 1, dauIndex: columns.dauIndex + 1 },
    ]));
  }
  // Older blocks keep explicit field labels in the BOX別 header itself.
  return boxColumnsFromHeader(markerHeader);
}

export function sendColumnsFromHeader(header) {
  const labels = header.map(normalize);
  const sendIndex = labels.indexOf('送信数');
  if (sendIndex < 0) throw new Error('送信表の「送信数」見出しがありません。');
  const columns = Object.fromEntries(['A', 'B', 'C', 'E', '全体'].map((label) => {
    const index = labels.findIndex((value, i) => i > sendIndex && value === normalize(label));
    if (index < 0) throw new Error(`送信表の「${label}」見出しがありません。`);
    return [label, index];
  }));
  const goalIndex = labels.findIndex((value, i) => i > sendIndex && value === '目標');
  if (goalIndex >= 0) columns['目標'] = goalIndex;
  return columns;
}

export function summaryMetricColumnsFromHeader(header) {
  const labels = header.map(normalize);
  const grossReceiveIndex = labels.indexOf('グロス');
  const ufReceiveIndex = labels.indexOf('UF');
  const dauGoalIndex = labels.indexOf('DAU');
  if (grossReceiveIndex < 0 || ufReceiveIndex < 0 || dauGoalIndex < 0 || dauGoalIndex + 1 >= labels.length) {
    throw new Error('日別集計の「グロス」「UF」「DAU」見出しから書込列を特定できません。');
  }
  return {
    grossReceiveIndex,
    ufReceiveIndex,
    grossDauIndex: dauGoalIndex + 1,
  };
}

export function boxHeaderLabels() {
  return BOX_CODES.flatMap((box) => [
    `${box}受信目標`, `${box}受信`, `${box}DAU目標`, `${box}DAU`,
  ]);
}
