const JST_WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];
const DAY_COLUMNS_START = 22; // W

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
  const mondayOffset = (cursor.getUTCDay() + 6) % 7;
  cursor.setUTCDate(cursor.getUTCDate() - mondayOffset);
  const dates = [];
  while (cursor.toISOString().slice(0, 10) < reportDate) {
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

function findWeekdayColumns(values, titleIndex) {
  for (let rowIndex = titleIndex; rowIndex < Math.min(values.length, titleIndex + 6); rowIndex += 1) {
    const columns = new Map();
    for (let offset = 0; offset < 7; offset += 1) {
      const value = cellText(values[rowIndex]?.[DAY_COLUMNS_START + offset]);
      const weekday = JST_WEEKDAYS.find((day) => value === day || value === `${day}曜日`);
      if (weekday) columns.set(weekday, DAY_COLUMNS_START + offset);
    }
    if (columns.size === 7) return { rowIndex, columns };
  }
  return null;
}

/**
 * Creates safe, narrowly-scoped cell updates for the weekly summary in the
 * current date's DC block. Returns a skip reason if there is no completed day
 * in the week or if the block does not have the expected weekly layout.
 */
export function buildWeeklySummaryWrites({ sourceRows, targetValues, reportDate, sheetName }) {
  const dates = dateSequence(reportDate);
  if (!dates.length) return { writes: [], skipped: 'Monday has no completed days in this week.' };

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
    && cellText(row?.[16]) === '週目標'
    && cellText(row?.[19]) === '週結果');
  if (headerIndex < 0) return { writes: [], skipped: `Weekly summary headers were not found in ${sheetName}.` };

  const rowLabels = [headerIndex + 1, headerIndex + 2, headerIndex + 3].map((index) => cellText(targetValues[index]?.[15]));
  if (rowLabels[0] !== '売上' || rowLabels[1] !== 'KPI' || rowLabels[2] !== '時間数') {
    return { writes: [], skipped: `Weekly summary row labels did not match in ${sheetName}.` };
  }
  const weekdayLayout = findWeekdayColumns(targetValues, titleIndex);
  if (!weekdayLayout) return { writes: [], skipped: `Weekday columns W:AC were not found in ${sheetName}.` };

  let salesGoal = 0;
  let salesResult = 0;
  let kpiGoal = 0;
  let kpiResult = 0;
  let hoursResult = 0;
  const writes = [];
  for (const date of dates) {
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

    const weekday = JST_WEEKDAYS[(date.getUTCDay() + 6) % 7];
    const column = columnName(weekdayLayout.columns.get(weekday));
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

  // Q time target is an existing formula (= weekly KPI target / 25); preserve it.
  writes.push(
    { range: `'${sheetName}'!Q${headerIndex + 2}`, values: [[salesGoal]] },
    { range: `'${sheetName}'!T${headerIndex + 2}`, values: [[salesResult]] },
    { range: `'${sheetName}'!Q${headerIndex + 3}`, values: [[kpiGoal]] },
    { range: `'${sheetName}'!T${headerIndex + 3}`, values: [[kpiResult]] },
    { range: `'${sheetName}'!T${headerIndex + 4}`, values: [[hoursResult]] },
  );
  return {
    writes,
    summary: { salesGoal, salesResult, kpiGoal, kpiResult, hoursGoal: kpiGoal / 25, hoursResult, days: dates.length },
  };
}
