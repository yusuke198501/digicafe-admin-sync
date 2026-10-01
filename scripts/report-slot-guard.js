const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

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
