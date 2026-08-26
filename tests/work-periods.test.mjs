import assert from 'node:assert/strict';
import test from 'node:test';
import { annotateWorkPeriods, reportsForWorkDate, reportsForWorkPeriod } from '../web/lib/work-periods.mjs';

const reports = [
  { id: 'day-load', vehicleNumber: '70-1234', mode: 'Load', status: 'Completed', startTime: '2026-08-26T15:00:00.000Z', endTime: '2026-08-26T16:00:00.000Z' },
  { id: 'overnight-unload', vehicleNumber: '70-1234', mode: 'Unload', status: 'Completed', startTime: '2026-08-26T19:00:00.000Z', endTime: '2026-08-26T20:00:00.000Z' },
  { id: 'finish', vehicleNumber: '70-1234', mode: 'Finish work', status: 'Completed', startTime: '2026-08-26T20:05:00.000Z', endTime: '2026-08-26T20:05:00.000Z' },
  { id: 'next-load', vehicleNumber: '70-1234', mode: 'Load', status: 'Completed', startTime: '2026-08-27T07:00:00.000Z', endTime: '2026-08-27T08:00:00.000Z' },
  { id: 'other-vehicle', vehicleNumber: '80-9999', mode: 'Finish work', status: 'Completed', startTime: '2026-08-26T16:00:00.000Z', endTime: '2026-08-26T16:00:00.000Z' },
];

test('Finish work closes an arbitrary overnight work period without a time cutoff', () => {
  const annotated = annotateWorkPeriods(reports);
  const period = reportsForWorkPeriod(annotated, 'overnight-unload');

  assert.deepEqual(period.map(report => report.id), ['day-load', 'overnight-unload', 'finish']);
  assert.ok(period.every(report => report.workPeriodId === 'day-load'));
  assert.ok(period.every(report => report.workPeriodDate === '2026-08-26'));
  assert.ok(period.every(report => report.workPeriodComplete === true));
  assert.equal(annotated.find(report => report.id === 'next-load').workPeriodId, 'next-load');
  assert.equal(annotated.find(report => report.id === 'next-load').workPeriodComplete, false);
});

test('work-date selection includes after-midnight jobs but excludes the next work period', () => {
  assert.deepEqual(reportsForWorkDate(reports, '2026-08-26').map(report => report.id), [
    'day-load',
    'other-vehicle',
    'overnight-unload',
    'finish',
  ]);
});

test('a cancelled Finish work does not close the work period', () => {
  const annotated = annotateWorkPeriods([
    { id: 'load', vehicleNumber: '70-1234', mode: 'Load', status: 'Completed', startTime: '2026-08-26T10:00:00Z', endTime: '2026-08-26T11:00:00Z' },
    { id: 'cancelled-finish', vehicleNumber: '70-1234', mode: 'Finish work', status: 'Cancelled', startTime: '2026-08-26T12:00:00Z', endTime: '2026-08-26T12:00:00Z' },
  ]);
  assert.ok(annotated.every(report => report.workPeriodId === 'load'));
  assert.ok(annotated.every(report => report.workPeriodComplete === false));
});
