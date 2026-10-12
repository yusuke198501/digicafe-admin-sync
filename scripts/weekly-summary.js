const DAY_COLUMNS_START = 22; // W
const ROLLING_DAY_LABELS = ['７日前', '６日前', '５日前', '４日前', '３日前', '２日前', '昨日'];

function cellText(value) {
  return String(value ?? '').replace(/\s/g, '').trim();
}

function numberValue(value, label) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = String(value ?? '').replace(/[￥¥,円\s]/g, '');
  if (!cleaned || cleaned === '-') throw new Error(`${label} is blank.`);
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not numeric: ${value}`);
  return parsed;
}

function dateKeyFromCell(value) {
  const match = /^(?:(\d{4})[/-])?(\d{1,2})[/-](\d{1,2})/.exec(cellText(value));
  return match ? `${Number(match[2])}/${Number(match[3])}` : null;
}

function dateSequence(reportDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(reportDate);
  if (!match) throw new Error(`Invalid report date: ${reportDate}`);
  const cursor = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  cursor.setUTCDate(cursor.getUTCDate() - 7);
  const dates = [];
  for (let day = 0; day < 7; day += 1) {
    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function columnName(index) {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function locateDateTitle(values, date) {
  return values.findIndex((row) => cellText(row[0]).startsWith(`${date.getUTCMonth() + 1}/${date.getUTCDate()}`)
    && cellText(row[1]) === 'DC');
}

/**
 * Creates safe, narrowly-scoped updates for the seven completed days before
 * the report date. The current DC block is converted from legacy week labels
 * to rolling-day labels without touching its existing time-target formula.
 */
export function buildWeeklySummaryWrites({ sourceRows, targetValues, reportDate, sheetName }) {
  const dates = dateSequence(reportDate);

  const sourceByDate = new Map();
  for (const row of sourceRows) {
    const key = dateKeyFromCell(row?.[0]);
    if (key) sourceByDate.set(key, row);
  }

  const reportParts = reportDate.split('-').map(Number);
  const titleIndex = locateDateTitle(targetValues, new Date(Date.UTC(reportParts[0], reportParts[1] - 1, reportParts[2])));
  if (titleIndex < 0) return { writes: [], skipped: `DC block for ${reportDate} was not found.` };
  const headerIndex = targetValues.findIndex((row, index) => index >= titleIndex
    && index < titleIndex + 6
    && ['週目標', '７日間目標'].includes(cellText(row?.[16]))
    && ['週結果', '７日間結果'].includes(cellText(row?.[19])));
  if (headerIndex < 0) return { writes: [], skipped: `Seven-day summary headers were not found in ${sheetName}.` };

  const rowLabels = [headerIndex + 1, headerIndex + 2, headerIndex + 3].map((index) => cellText(targetValues[index]?.[15]));
  if (rowLabels[0] !== '売上' || rowLabels[1] !== 'KPI' || rowLabels[2] !== '時間数') {
    return { writes: [], skipped: `Weekly summary row labels did not match in ${sheetName}.` };
  }
  let salesGoal = 0;
  let salesResult = 0;
  let kpiGoal = 0;
  let kpiResult = 0;
  let hoursResult = 0;
  const writes = [];
  for (const [index, date] of dates.entries()) {
    const key = `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
    const source = sourceByDate.get(key);
    if (!source) return { writes: [], skipped: `Source row for ${key} is missing.` };

    const daySalesGoal = numberValue(source[1], `${key} sales target`);
    const daySalesResult = numberValue(source[2], `${key} sales result`);
    const dayKpiGoal = numberValue(source[9], `${key} KPI target`);
    const dayKpiResult = numberValue(source[10], `${key} KPI result`);
    const dayTitleIndex = locateDateTitle(targetValues, date);
    if (dayTitleIndex < 0) return { writes: [], skipped: `DC block for ${key} was not found; cannot read planned time.` };
    const dayHours = numberValue(targetValues[dayTitleIndex + 2]?.[35], `${key} AJ planned time`);

    salesGoal += daySalesGoal;
    salesResult += daySalesResult;
    kpiGoal += dayKpiGoal;
    kpiResult += dayKpiResult;
    hoursResult += dayHours;

    const column = columnName(DAY_COLUMNS_START + index);
    const dayRows = [headerIndex + 1, headerIndex + 2, headerIndex + 3];
    const achieved = [
      daySalesResult >= daySalesGoal,
      dayKpiResult >= dayKpiGoal,
      dayHours >= dayKpiGoal / 25,
    ];
    dayRows.forEach((rowIndex, metricIndex) => {
      writes.push({
        range: `'${sheetName}'!${column}${rowIndex + 1}`,
        values: [[achieved[metricIndex] ? '◯' : '⬤']],
      });
    });
  }

  // Convert the current block's old week header when necessary. Q time target
  // is an existing formula (= KPI target / 25), so preserve it.
  writes.push(
    { range: `'${sheetName}'!Q${headerIndex + 1}`, values: [['７日間目標']] },
    { range: `'${sheetName}'!T${headerIndex + 1}`, values: [['７日間結果']] },
    { range: `'${sheetName}'!W${headerIndex + 1}:AC${headerIndex + 1}`, values: [ROLLING_DAY_LABELS] },
  );
  writes.push(
    { range: `'${sheetName}'!Q${headerIndex + 2}`, values: [[salesGoal]] },
    { range: `'${sheetName}'!T${headerIndex + 2}`, values: [[salesResult]] },
    { range: `'${sheetName}'!Q${headerIndex + 3}`, values: [[kpiGoal]] },
    { range: `'${sheetName}'!T${headerIndex + 3}`, values: [[kpiResult]] },
    { range: `'${sheetName}'!T${headerIndex + 4}`, values: [[hoursResult]] },
  );
  if (!cellText(targetValues[headerIndex + 3]?.[16])) {
    writes.push({ range: `'${sheetName}'!Q${headerIndex + 4}`, values: [[`=Q${headerIndex + 3}/25`]] });
  }
  return {
    writes,
    summary: { salesGoal, salesResult, kpiGoal, kpiResult, hoursGoal: kpiGoal / 25, hoursResult, days: dates.length },
  };
}
