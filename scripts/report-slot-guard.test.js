import test from 'node:test';
import assert from 'node:assert/strict';
import { inferReportHourFromTrigger, isReportSlotStale, reportSlotJstLabel, reportSlotLagMinutes } from './report-slot-guard.js';

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

test('rejects invalid report dates and hours', () => {
  assert.throws(() => reportSlotLagMinutes('2026/10/01', 10));
  assert.throws(() => reportSlotLagMinutes('2026-10-01', 28));
});
