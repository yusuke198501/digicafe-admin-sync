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
  let headerIndex = targetValues.findIndex((row, index) => index >= titleIndex
    && index < titleIndex + 6
    && ['週目標', '７日間目標'].includes(cellText(row?.[16]))
    && ['週結果', '７日間結果'].includes(cellText(row?.[19])));
  let initializeLabels = false;
  if (headerIndex < 0) {
    // New DC blocks may have no seven-day summary yet. Only initialize one if
    // every cell we would use is empty; never overwrite unrelated content.
    const candidate = titleIndex;
    const occupied = targetValues.slice(candidate, candidate + 4).some((row) =>
      [15, 16, 19, 22, 23, 24, 25, 26, 27, 28].some((column) => cellText(row?.[column])));
    if (occupied) return { writes: [], skipped: `Seven-day summary area is occupied in ${sheetName}.` };
    headerIndex = candidate;
    initializeLabels = true;
  }

  const rowLabels = [headerIndex + 1, headerIndex + 2, headerIndex + 3].map((index) => cellText(targetValues[index]?.[15]));
  if (!initializeLabels && (rowLabels[0] !== '売上' || rowLabels[1] !== 'KPI' || rowLabels[2] !== '時間数')) {
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

    let daySalesGoal;
    let daySalesResult;
    let dayKpiGoal;
    let dayKpiResult;
    const dayTitleIndex = locateDateTitle(targetValues, date);
    if (dayTitleIndex < 0) return { writes: [], skipped: `DC block for ${key} was not found; cannot read planned time.` };
    let dayHours;
    try {
      daySalesGoal = numberValue(source[1], `${key} sales target`);
      daySalesResult = numberValue(source[2], `${key} sales result`);
      dayKpiGoal = numberValue(source[9], `${key} KPI target`);
      dayKpiResult = numberValue(source[10], `${key} KPI result`);
      dayHours = numberValue(targetValues[dayTitleIndex + 2]?.[35], `${key} AJ planned time`);
    } catch (error) {
      // Weekly figures are supplemental to the hourly sync. Missing source
      // results must skip only this summary, not fail the whole 9:05 update.
      return { writes: [], skipped: `Source values are incomplete: ${error.message}` };
    }

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

  // Convert the current block's old week header when necessary. Preserve any
  // existing time-target formula; new values are written with RAW input mode.
  writes.push(
    { range: `'${sheetName}'!Q${headerIndex + 1}`, values: [['７日間目標']] },
    { range: `'${sheetName}'!T${headerIndex + 1}`, values: [['７日間結果']] },
    { range: `'${sheetName}'!W${headerIndex + 1}:AC${headerIndex + 1}`, values: [ROLLING_DAY_LABELS] },
  );
  if (initializeLabels) {
    ['売上', 'KPI', '時間数'].forEach((label, index) => {
      writes.push({ range: `'${sheetName}'!P${headerIndex + index + 2}`, values: [[label]] });
    });
  }
  writes.push(
    { range: `'${sheetName}'!Q${headerIndex + 2}`, values: [[salesGoal]] },
    { range: `'${sheetName}'!T${headerIndex + 2}`, values: [[salesResult]] },
    { range: `'${sheetName}'!Q${headerIndex + 3}`, values: [[kpiGoal]] },
    { range: `'${sheetName}'!T${headerIndex + 3}`, values: [[kpiResult]] },
    { range: `'${sheetName}'!T${headerIndex + 4}`, values: [[hoursResult]] },
  );
  if (!cellText(targetValues[headerIndex + 3]?.[16])) {
    writes.push({ range: `'${sheetName}'!Q${headerIndex + 4}`, values: [[kpiGoal / 25]] });
  }
  return {
    writes,
    summary: { salesGoal, salesResult, kpiGoal, kpiResult, hoursGoal: kpiGoal / 25, hoursResult, days: dates.length },
  };
}
