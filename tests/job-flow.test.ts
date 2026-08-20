import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobId, decideAction, idleJobSnapshot, isActionUnavailable, jobInitiatedAt, reportDriver, snapshotDriver } from '../lib/job-flow.ts';

test('an idle driver can select any mode', () => {
  const idle = idleJobSnapshot();
  assert.deepEqual(decideAction('1', idle), { type: 'confirm_start' });
  assert.deepEqual(decideAction('3', idle), { type: 'confirm_start' });
  assert.equal(isActionUnavailable(idle, '1'), false);
  assert.equal(isActionUnavailable(idle, '9'), true);
});

test('selecting a mode locks every other mode while keeping Done available', () => {
  const waiting = { selected: '1', startedAt: null, awaitingMovement: true };
  assert.equal(isActionUnavailable(waiting, '1'), true);
  assert.equal(isActionUnavailable(waiting, '2'), true);
  assert.equal(isActionUnavailable(waiting, '8'), true);
  assert.equal(isActionUnavailable(waiting, '9'), false);
});

test('Done can finish while waiting for vehicle movement', () => {
  assert.deepEqual(decideAction('9', { selected: '1', startedAt: null, awaitingMovement: true }), { type: 'confirm_finish' });
});

test('Done finishes an active job and every mode remains blocked', () => {
  const active = { selected: '1', startedAt: 1_723_942_800_000, awaitingMovement: false };
  assert.deepEqual(decideAction('9', active), { type: 'confirm_finish' });
  assert.deepEqual(decideAction('3', active), { type: 'blocked', reason: 'job_in_progress' });
  assert.equal(isActionUnavailable(active, '1'), true);
  assert.equal(isActionUnavailable(active, '9'), false);
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
  assert.match(first, /^OPS-device-101-1-\d+$/);
  assert.equal(jobInitiatedAt(first), 1_787_041_800_000);
  assert.equal(jobInitiatedAt('OPS-legacy'), null);
});
