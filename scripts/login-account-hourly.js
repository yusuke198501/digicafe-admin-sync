function cellText(value) {
  return String(value ?? '').replace(/\s/g, '').trim();
}

function metricNumber(value, label) {
  const number = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(number)) throw new Error(`「${label}」の数値を取得できませんでした。`);
  return number;
}

/** Sum the 全体 account's hourly metrics before the requested report slot. */
export function cumulativeLoginAccountMetrics(rows, hour) {
  const accountHeader = rows.find((row) => row.some((value) => cellText(value) === '全体'));
  const metricHeader = rows.find((row) => cellText(row[0]) === 'やり取り送信');
  if (!accountHeader || !metricHeader) {
    throw new Error('ログインアカウント別/時間毎の全体集計見出しが見つかりません。');
  }

  const accountIndex = accountHeader.findIndex((value) => cellText(value) === '全体');
  const metricIndices = ['やり取り受信', '個別送信', '個別受信', '同報受信'].map((label) => {
    const metricIndex = metricHeader.findIndex((value) => cellText(value) === label);
    if (metricIndex < 0) throw new Error(`ログインアカウント別/時間毎の「${label}」が見つかりません。`);
    return accountIndex + metricIndex;
  });

  const totals = [0, 0, 0, 0];
  for (const row of rows) {
    const match = cellText(row[0]).match(/^(\d+)時$/);
    if (!match || Number(match[1]) >= hour) continue;
    metricIndices.forEach((index, metric) => {
      totals[metric] += metricNumber(row[index], 'ログインアカウント別/時間毎');
    });
  }

  const [interactionReceive, individualSend, individualReceive, broadcastReceive] = totals;
  return {
    ufReceive: interactionReceive + individualReceive + broadcastReceive,
    individualSend,
    individualReceive,
  };
}
