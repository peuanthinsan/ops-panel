import assert from 'node:assert/strict';
import test from 'node:test';
import {
  durationSeconds,
  formatMobileReportDateTime,
  formatMobileReportDay,
  formatMobileReportMonth,
  formatMobileReportTime,
  formatReportDuration,
  mobileReportDayKey,
  savedJobDayKeys,
  savedJobsForDay,
  summarizeSavedJobs,
} from '../lib/mobile-report.ts';

const jobs = [
  { id: 'finish', vehicleNumber: 'FORD T', deviceId: 'tablet-01', driverName: null, driverId: null, mode: 'Finish work', startTime: '2026-08-24T16:50:00.000Z', endTime: '2026-08-24T17:05:00.000Z', duration: '15:00' },
  { id: 'load', vehicleNumber: 'FORD T', deviceId: 'tablet-01', driverName: null, driverId: null, mode: 'Load', startTime: '2026-08-24T02:00:00.000Z', endTime: '2026-08-24T03:30:00.000Z', duration: '01:30:00' },
  { id: 'cancelled', vehicleNumber: 'FORD T', deviceId: 'tablet-01', driverName: null, driverId: null, mode: 'Break', startTime: '2026-08-24T01:00:00.000Z', endTime: '2026-08-24T01:00:00.000Z', duration: '00:00', status: 'Cancelled' as const },
];

test('mobile reports use the Bangkok operating day across UTC midnight', () => {
  assert.equal(mobileReportDayKey('2026-08-24T17:05:00.000Z'), '2026-08-25');
  assert.equal(formatMobileReportTime('2026-08-24T17:05:09.000Z'), '00:05:09');
  assert.equal(formatMobileReportDateTime('2026-08-24T17:05:09.000Z', 'en'), '25 Aug 2026, 00:05:09');
  assert.equal(formatMobileReportDay('2026-08-25', 'en'), '25 Aug 2026');
  assert.equal(formatMobileReportDay('2026-08-25', 'th'), '25 ส.ค. 2569');
  assert.equal(formatMobileReportMonth('2026-08', 'en'), 'Aug 2026');
  assert.equal(formatMobileReportMonth('2026-08', 'th'), 'ส.ค. 2569');
  assert.deepEqual(savedJobDayKeys(jobs), ['2026-08-25', '2026-08-24']);
  assert.deepEqual(savedJobsForDay(jobs, '2026-08-24').map(job => job.id), ['finish', 'load', 'cancelled']);
  assert.deepEqual(savedJobsForDay(jobs, '2026-08-25').map(job => job.id), ['finish']);
});

test('end-of-day summary counts completed and cancelled jobs and totals recorded time', () => {
  assert.equal(durationSeconds('01:30:00'), 5400);
  assert.equal(durationSeconds('15:00'), 900);
  assert.equal(formatReportDuration(6309), '01:45:09');
  assert.deepEqual(summarizeSavedJobs(jobs), { total: 3, completed: 2, cancelled: 1, durationSeconds: 6300 });
});

test('a daily report retains repeated jobs of the same mode as separate entries', () => {
  const repeatedLoads = [
    { ...jobs[1], id: 'load-1', startTime: '2026-08-24T02:00:00.000Z', endTime: '2026-08-24T02:10:00.000Z' },
    { ...jobs[1], id: 'load-2', startTime: '2026-08-24T03:00:00.000Z', endTime: '2026-08-24T03:20:00.000Z' },
  ];
  assert.deepEqual(savedJobsForDay(repeatedLoads, '2026-08-24').map(job => job.id), ['load-2', 'load-1']);
  assert.equal(summarizeSavedJobs(repeatedLoads).total, 2);
});
