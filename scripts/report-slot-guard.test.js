import test from 'node:test';
import assert from 'node:assert/strict';
import { inferReportHourFromTrigger, isReportSlotStale, parseExplicitReportDate, reportDateForSlot, reportSlotJstLabel, reportSlotLagMinutes } from './report-slot-guard.js';

test('parses an explicitly selected report date for a backfill', () => {
  assert.deepEqual(parseExplicitReportDate('2026-10-06'), {
    year: 2026,
    month: 10,
    day: 6,
    label: '10/6',
    iso: '2026-10-06',
    display: '2026/10/06',
  });
});

test('rejects malformed and impossible explicit report dates', () => {
  assert.throws(() => parseExplicitReportDate('2026-2-6'), /Invalid report date/);
  assert.throws(() => parseExplicitReportDate('2026-02-30'), /Invalid report date/);
});

test('infers the slot from the original dispatch time, not the delayed runner start', () => {
  assert.equal(inferReportHourFromTrigger('2026-10-02T00:05:04Z'), 9); // 09:05 JST
  assert.equal(inferReportHourFromTrigger('2026-10-02T01:05:04Z'), 10); // 10:05 JST
  assert.equal(inferReportHourFromTrigger('2026-10-02T18:05:04Z'), 27); // 03:05 JST next day
});

test('allows a scheduled report within the first 60 minutes', () => {
  const at = new Date('2026-10-01T01:59:59Z'); // 10:59:59 JST, target 10:00
  assert.equal(isReportSlotStale('2026-10-01', 10, at), false);
  assert.equal(Math.round(reportSlotLagMinutes('2026-10-01', 10, at)), 60);
});

test('blocks a report once it is exactly 60 minutes late', () => {
  const at = new Date('2026-10-01T02:00:00Z'); // 11:00 JST, target 10:00
  assert.equal(isReportSlotStale('2026-10-01', 10, at), true);
});

test('maps the 24:00 and 27:00 report slots to the next JST calendar day', () => {
  assert.equal(isReportSlotStale('2026-10-01', 24, new Date('2026-10-01T15:59:59Z')), false);
  assert.equal(isReportSlotStale('2026-10-01', 24, new Date('2026-10-01T16:00:00Z')), true);
  assert.equal(isReportSlotStale('2026-10-01', 27, new Date('2026-10-02T01:00:00Z')), true);
  assert.equal(reportSlotJstLabel('2026-10-01', 24), '2026-10-02 00:00 JST');
  assert.equal(reportSlotJstLabel('2026-10-01', 27), '2026-10-02 03:00 JST');
});

test('a delayed scheduled 21:00 run after midnight stays on the previous report date', () => {
  const delayed = new Date('2026-10-03T15:56:00Z'); // 2026-10-04 00:56 JST
  const date = reportDateForSlot(21, delayed, true);
  assert.equal(date.iso, '2026-10-03');
  assert.equal(isReportSlotStale(date.iso, 21, delayed), true);
});

test('same-day scheduled runs and manually selected dates retain their date', () => {
  assert.equal(reportDateForSlot(21, new Date('2026-10-03T12:10:00Z'), true).iso, '2026-10-03');
  assert.equal(reportDateForSlot(21, new Date('2026-10-03T15:56:00Z'), false).iso, '2026-10-04');
});

test('rejects invalid report dates and hours', () => {
  assert.throws(() => reportSlotLagMinutes('2026/10/01', 10));
  assert.throws(() => reportSlotLagMinutes('2026-10-01', 28));
});
