const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function parseExplicitReportDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) throw new Error(`Invalid report date: ${value}`);
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error(`Invalid report date: ${value}`);
  }
  return {
    year,
    month,
    day,
    label: `${month}/${day}`,
    iso: String(value),
    display: `${yearText}/${monthText}/${dayText}`,
  };
}

export function inferReportHourFromTrigger(triggerTime) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(triggerTime));
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  const currentHour = get('hour');
  const currentMinute = get('minute');

  if (currentMinute >= 56) {
    const freshSlot = new Map([[2, 27], [8, 9], [9, 10], [12, 13], [16, 17], [20, 21], [23, 24]]).get(currentHour);
    if (freshSlot) return freshSlot;
  }
  if (currentHour < 3) return 24;
  if (currentHour < 9) return 27;
  if (currentHour < 10) return 9;
  if (currentHour < 13) return 10;
  if (currentHour < 17) return 13;
  if (currentHour < 21) return 17;
  return 21;
}

/**
 * Resolves the spreadsheet date for a report slot. A scheduled run for an
 * hour below 24 that starts after midnight but before that hour belongs to
 * the previous JST day; otherwise a delayed 21:00 run could write tomorrow's
 * 21:00 row. Manual runs keep the explicitly selected current date behavior.
 */
export function reportDateForSlot(reportHour, referenceDate = new Date(), scheduled = false) {
  if (!Number.isInteger(reportHour) || reportHour < 0 || reportHour > 27) {
    throw new Error(`Invalid report hour: ${reportHour}`);
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hourCycle: 'h23',
    hour: '2-digit',
  }).formatToParts(referenceDate);
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  const date = new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
  const hour = get('hour');

  if (reportHour >= 24 || (scheduled && hour < reportHour)) {
    date.setUTCDate(date.getUTCDate() - 1);
  }

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return {
    year,
    month,
    day,
    label: `${month}/${day}`,
    iso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    display: `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`,
  };
}

/**
 * Returns how many minutes a run is past its reporting slot.
 * reportDate is the spreadsheet date; slots 24 and 27 occur on the following
 * JST calendar day at 00:00 and 03:00 respectively.
 */
export function reportSlotLagMinutes(reportDate, reportHour, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(reportDate);
  if (!match) throw new Error(`Invalid report date: ${reportDate}`);
  if (!Number.isInteger(reportHour) || reportHour < 0 || reportHour > 27) {
    throw new Error(`Invalid report hour: ${reportHour}`);
  }

  const [, year, month, day] = match.map(Number);
  const targetDayOffset = Math.floor(reportHour / 24);
  const targetHour = reportHour % 24;
  // Treat the JST wall-clock fields as UTC, then convert that instant to UTC.
  const targetUtc = Date.UTC(year, month - 1, day + targetDayOffset, targetHour) - JST_OFFSET_MS;
  return (now.getTime() - targetUtc) / 60_000;
}

export function reportSlotJstLabel(reportDate, reportHour) {
  const [year, month, day] = reportDate.split('-').map(Number);
  const targetDate = new Date(Date.UTC(year, month - 1, day + Math.floor(reportHour / 24)));
  const dateLabel = targetDate.toISOString().slice(0, 10);
  const hourLabel = String(reportHour % 24).padStart(2, '0');
  return `${dateLabel} ${hourLabel}:00 JST`;
}

export function isReportSlotStale(reportDate, reportHour, now = new Date(), maxLagMinutes = 60) {
  return reportSlotLagMinutes(reportDate, reportHour, now) >= maxLagMinutes;
}
