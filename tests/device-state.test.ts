import assert from 'node:assert/strict';
import test from 'node:test';
import { activeJobBelongsToBinding, deviceBindingKey, mobileStartupReady, parseStoredActiveJob, parseStoredBinding, recoverBindingFromActiveJob, shouldPreserveLocalBindingWithoutRemote } from '../lib/device-state.ts';

test('the control panel waits for active-job recovery for the exact current binding', () => {
  const binding = { vehicleNumber: '74-1286', deviceId: 'tablet-101' };
  assert.equal(mobileStartupReady(false, binding, null), false);
  assert.equal(mobileStartupReady(true, binding, null), false);
  assert.equal(mobileStartupReady(true, binding, deviceBindingKey(binding)), true);
  assert.equal(mobileStartupReady(true, { ...binding, vehicleNumber: '74-9999' }, deviceBindingKey(binding)), false);
  assert.equal(mobileStartupReady(true, null, null), true);
});

test('stored vehicle binding is trimmed and validated', () => {
  assert.deepEqual(parseStoredBinding('{"vehicleNumber":" 74-1286 ","deviceId":" tablet-101 "}'), {
    vehicleNumber: '74-1286',
    deviceId: 'tablet-101',
  });
  assert.equal(parseStoredBinding('{"vehicleNumber":"","deviceId":"tablet-101"}'), null);
  assert.equal(parseStoredBinding('{broken'), null);
});

test('stored active jobs allow only real modes and valid timing state', () => {
  assert.deepEqual(
    parseStoredActiveJob('{"vehicleNumber":"V1","deviceId":"D1","selected":"9","startedAt":100}'),
    { vehicleNumber: 'V1', deviceId: 'D1', selected: '9', startedAt: 100, driverName: null, driverId: null },
  );
  assert.equal(parseStoredActiveJob('{"vehicleNumber":"V1","deviceId":"D1","selected":"10","startedAt":100}'), null);
  assert.equal(parseStoredActiveJob('{"vehicleNumber":"V1","deviceId":"D1","selected":"1","startedAt":0}'), null);
  assert.equal(parseStoredActiveJob('{"closed":true}'), null);
  assert.deepEqual(
    parseStoredActiveJob('{"jobId":"OPS-1","vehicleNumber":"V1","deviceId":"D1","selected":"1","startedAt":0,"awaitingMovement":true,"driverName":" Driver A "}'),
    { jobId: 'OPS-1', vehicleNumber: 'V1', deviceId: 'D1', selected: '1', startedAt: 0, awaitingMovement: true, driverName: 'Driver A', driverId: null },
  );
});

test('stored active jobs preserve the selected route through restart', () => {
  assert.deepEqual(parseStoredActiveJob(JSON.stringify({
    vehicleNumber: 'V1', deviceId: 'D1', selected: '1', routeName: ' N21 ', startedAt: 100,
  })), {
    vehicleNumber: 'V1', deviceId: 'D1', selected: '1', routeName: 'N21', startedAt: 100,
    driverName: null, driverId: null,
  });
});

test('stored active jobs preserve an exact internal initiation time without requiring it from older records', () => {
  assert.deepEqual(parseStoredActiveJob(JSON.stringify({
    jobId: 'JOB-20260818-ABCDEF123456', vehicleNumber: 'V1', deviceId: 'D1', selected: '1',
    initiatedAt: 1_787_041_801_489, startedAt: 0, awaitingMovement: true,
  })), {
    jobId: 'JOB-20260818-ABCDEF123456', vehicleNumber: 'V1', deviceId: 'D1', selected: '1',
    initiatedAt: 1_787_041_801_489, startedAt: 0, awaitingMovement: true,
    driverName: null, driverId: null,
  });
  assert.equal(parseStoredActiveJob(JSON.stringify({
    jobId: 'JOB-20260818-ABCDEF123456', vehicleNumber: 'V1', deviceId: 'D1', selected: '1',
    initiatedAt: 0, startedAt: 0, awaitingMovement: true,
  })), null);
});

test('an active job preserves only the binding it started with during startup reconciliation', () => {
  const job = {
    jobId: 'OPS-1', vehicleNumber: '74-1286', deviceId: 'tablet-101', selected: '1', startedAt: 100,
  };
  assert.equal(activeJobBelongsToBinding(job, { vehicleNumber: '74-1286', deviceId: 'tablet-101' }), true);
  assert.equal(activeJobBelongsToBinding(job, { vehicleNumber: '74-9999', deviceId: 'tablet-101' }), false);
  assert.equal(activeJobBelongsToBinding(job, null), false);
  assert.equal(shouldPreserveLocalBindingWithoutRemote(job, { vehicleNumber: '74-1286', deviceId: 'tablet-101' }), true);
});

test('a job still waiting for movement rechecks the server binding before restoration', () => {
  const waitingJob = {
    jobId: 'OPS-2', vehicleNumber: '74-1286', deviceId: 'tablet-101', selected: '1', startedAt: 0, awaitingMovement: true,
  };
  assert.equal(activeJobBelongsToBinding(waitingJob, { vehicleNumber: '74-1286', deviceId: 'tablet-101' }), true);
  assert.equal(shouldPreserveLocalBindingWithoutRemote(waitingJob, { vehicleNumber: '74-1286', deviceId: 'tablet-101' }), false);
});

test('a durable final report restores the exact completion payload and preserves its historical binding', () => {
  const raw = JSON.stringify({
    jobId: 'OPS-restore-1',
    vehicleNumber: '74-1286',
    deviceId: 'tablet-101',
    selected: '1',
    startedAt: Date.parse('2026-08-18T01:00:00.000Z'),
    driverName: 'Driver One',
    driverId: 'DRV-001',
    pendingReport: {
      id: 'OPS-restore-1',
      vehicleNumber: '74-1286',
      deviceId: 'tablet-101',
      driverName: 'Driver One',
      driverId: 'DRV-001',
      mode: 'Load',
      startTime: '2026-08-18T01:00:00.000Z',
      endTime: '2026-08-18T01:10:00.000Z',
      duration: '10:00',
    },
  });
  const restored = parseStoredActiveJob(raw);
  assert.equal(restored?.pendingReport?.endTime, '2026-08-18T01:10:00.000Z');
  assert.equal(shouldPreserveLocalBindingWithoutRemote(restored, { vehicleNumber: '74-1286', deviceId: 'tablet-101' }), true);
});

test('a mismatched final report is ignored without discarding the recoverable active job', () => {
  const restored = parseStoredActiveJob(JSON.stringify({
    jobId: 'OPS-restore-2', vehicleNumber: '74-1286', deviceId: 'tablet-101', selected: '1', startedAt: 100,
    pendingReport: {
      id: 'OPS-restore-2', vehicleNumber: '74-9999', deviceId: 'tablet-101', driverName: null, driverId: null,
      mode: 'Load', startTime: new Date(100).toISOString(), endTime: new Date(200).toISOString(), duration: '00:00',
    },
  }));
  assert.equal(restored?.jobId, 'OPS-restore-2');
  assert.equal(restored?.pendingReport, undefined);
});

test('a cancellation made while waiting for movement survives restart with its original timestamp', () => {
  const cancelledAt = '2026-08-18T01:05:00.000Z';
  const restored = parseStoredActiveJob(JSON.stringify({
    jobId: 'OPS-waiting-cancel', vehicleNumber: '74-1286', deviceId: 'tablet-101', selected: '3', startedAt: 0, awaitingMovement: true,
    pendingReport: {
      id: 'OPS-waiting-cancel', vehicleNumber: '74-1286', deviceId: 'tablet-101', driverName: null, driverId: null,
      mode: 'Unload', startTime: cancelledAt, endTime: cancelledAt, duration: '00:00', status: 'Cancelled',
    },
  }));
  assert.equal(restored?.pendingReport?.status, 'Cancelled');
  assert.equal(restored?.pendingReport?.endTime, cancelledAt);
  assert.equal(shouldPreserveLocalBindingWithoutRemote(restored, { vehicleNumber: '74-1286', deviceId: 'tablet-101' }), true);
});

test('a started job reconstructs a missing binding without needing the network', () => {
  const job = {
    jobId: 'OPS-started', vehicleNumber: '74-1286', deviceId: 'tablet-101', selected: '1', startedAt: 100,
  };
  assert.deepEqual(recoverBindingFromActiveJob(job, null), { vehicleNumber: '74-1286', deviceId: 'tablet-101' });
  assert.equal(shouldPreserveLocalBindingWithoutRemote(job, recoverBindingFromActiveJob(job, null)), true);
});

test('an unstarted movement-pending job cannot reconstruct a binding without server verification', () => {
  const waitingJob = {
    jobId: 'OPS-waiting', vehicleNumber: '74-1286', deviceId: 'tablet-101', selected: '1', startedAt: 0, awaitingMovement: true,
  };
  assert.equal(recoverBindingFromActiveJob(waitingJob, null), null);
});

test('a durable pending cancellation may reconstruct its binding even if movement never started', () => {
  const pendingCancellation = parseStoredActiveJob(JSON.stringify({
    jobId: 'OPS-pending-cancel', vehicleNumber: '74-1286', deviceId: 'tablet-101', selected: '1', startedAt: 0, awaitingMovement: true,
    pendingReport: {
      id: 'OPS-pending-cancel', vehicleNumber: '74-1286', deviceId: 'tablet-101', driverName: null, driverId: null,
      mode: 'Load', startTime: '2026-08-18T01:05:00.000Z', endTime: '2026-08-18T01:05:00.000Z', duration: '00:00', status: 'Cancelled',
    },
  }));
  const recovered = recoverBindingFromActiveJob(pendingCancellation, null);
  assert.deepEqual(recovered, { vehicleNumber: '74-1286', deviceId: 'tablet-101' });
  assert.equal(shouldPreserveLocalBindingWithoutRemote(pendingCancellation, recovered), true);
});
