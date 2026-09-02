import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobId, decideAction, idleJobSnapshot, isActionUnavailable, jobInitiatedAt, reportDriver, snapshotDriver } from '../lib/job-flow.ts';

test('an idle driver can select any mode', () => {
  const idle = idleJobSnapshot();
  assert.deepEqual(decideAction('1', idle), { type: 'confirm_start' });
  assert.deepEqual(decideAction('3', idle), { type: 'confirm_start' });
  assert.deepEqual(decideAction('9', idle), { type: 'confirm_day_end' });
  assert.equal(isActionUnavailable(idle, '1'), false);
  assert.equal(isActionUnavailable(idle, '9'), false);
});

test('selecting a job keeps only that job available as its off toggle', () => {
  const waiting = { selected: '1', startedAt: null, awaitingMovement: true };
  assert.equal(isActionUnavailable(waiting, '1'), false);
  assert.equal(isActionUnavailable(waiting, '2'), true);
  assert.equal(isActionUnavailable(waiting, '8'), true);
  assert.equal(isActionUnavailable(waiting, '9'), true);
  assert.deepEqual(decideAction('1', waiting), { type: 'confirm_finish' });
  assert.deepEqual(decideAction('9', waiting), { type: 'blocked', reason: 'job_in_progress' });
});

test('the selected job can turn off while waiting for vehicle movement', () => {
  assert.deepEqual(decideAction('1', { selected: '1', startedAt: null, awaitingMovement: true }), { type: 'confirm_finish' });
});

test('the selected job can turn off after movement and every other job remains blocked', () => {
  const active = { selected: '1', startedAt: 1_723_942_800_000, awaitingMovement: false };
  assert.deepEqual(decideAction('1', active), { type: 'confirm_finish' });
  assert.deepEqual(decideAction('3', active), { type: 'blocked', reason: 'job_in_progress' });
  assert.equal(isActionUnavailable(active, '1'), false);
  assert.equal(isActionUnavailable(active, '9'), true);
});

test('option 9 opens the immediate end-of-day confirmation instead of starting a moving job', () => {
  const idle = idleJobSnapshot();
  assert.deepEqual(decideAction('9', idle), { type: 'confirm_day_end' });
  // A legacy restored option-9 job can still be safely completed.
  const active = { selected: '9', startedAt: 1_723_942_800_000, awaitingMovement: false };
  assert.deepEqual(decideAction('9', active), { type: 'confirm_finish' });
  assert.equal(isActionUnavailable(active, '9'), false);
  assert.equal(isActionUnavailable(active, '1'), true);
});

test('after finish or cancellation, an idle snapshot can select another job', () => {
  const reset = idleJobSnapshot();
  assert.deepEqual(decideAction('3', reset), { type: 'confirm_start' });
  assert.equal(isActionUnavailable(reset, '3'), false);
});

test('a report keeps the driver captured when the job started', () => {
  const startDriver = snapshotDriver({ driverName: 'Driver A', driverId: 'A-101' });
  const currentDriver = { driverName: 'Driver B', driverId: 'B-202' };
  assert.deepEqual(reportDriver(startDriver, currentDriver), { driverName: 'Driver A', driverId: 'A-101' });
});

test('an older active job without a driver snapshot uses the current driver', () => {
  assert.deepEqual(reportDriver(null, { driverName: 'Driver A', driverId: 'A-101' }), { driverName: 'Driver A', driverId: 'A-101' });
});

test('a job keeps a deterministic retry-safe report id', () => {
  const first = createJobId('device-101', '1', 1_787_041_800_000);
  const retry = createJobId('device-101', '1', 1_787_041_800_000);
  assert.equal(first, retry);
  assert.match(first, /^JOB-20260818-[0-9A-F]{12}$/);
  assert.equal(jobInitiatedAt(first), null);
  assert.equal(jobInitiatedAt('OPS-legacy'), null);
});

test('repeating the same job mode creates a separate record each time it is started', () => {
  const first = createJobId('device-101', '1', 1_787_041_800_000);
  const second = createJobId('device-101', '1', 1_787_042_100_000);
  assert.notEqual(first, second);
  assert.equal(jobInitiatedAt(first), null);
  assert.equal(jobInitiatedAt(second), null);
});

test('the report id shows the Bangkok date while its short SHA distinguishes exact times and jobs', () => {
  const initiatedAt = 1_787_041_801_489;
  const firstDevice = createJobId('device-101', '1', initiatedAt);
  const secondDevice = createJobId('device-202', '1', initiatedAt);
  const secondAction = createJobId('device-101', '2', initiatedAt);
  const nextMillisecond = createJobId('device-101', '1', initiatedAt + 1);

  assert.match(firstDevice, /^JOB-20260818-[0-9A-F]{12}$/);
  assert.notEqual(firstDevice, secondDevice);
  assert.notEqual(firstDevice, secondAction);
  assert.notEqual(firstDevice, nextMillisecond);
  assert.equal(
    createJobId('3936fdce325c1631', '9', 1_788_323_501_489),
    'JOB-20260902-DB2D7A8C4E44',
  );
});

test('initiation time recovery remains compatible with existing report ids', () => {
  assert.equal(jobInitiatedAt('OPS-device-101-1-1787041800489'), 1_787_041_800_489);
  assert.equal(jobInitiatedAt('OPS-20260818-153001.489-ABCDEF123456'), 1_787_041_801_489);
  assert.equal(jobInitiatedAt('JOB-20260231-ABCDEF123456'), null);
  assert.equal(jobInitiatedAt('OPS-12345678-1234-1234567890123'), null);
});
