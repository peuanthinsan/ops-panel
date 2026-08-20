import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeSavedJobs } from '../lib/saved-jobs.ts';

const binding = { vehicleNumber: '700-4172', deviceId: 'tablet-01' };

function job(id: string, endTime: string, overrides = {}) {
  return { id, ...binding, driverName: null, driverId: null, mode: 'Load', startTime: '2026-08-20T03:00:00.000Z', endTime, duration: '10:00', ...overrides };
}

test('saved jobs are restricted to the bound vehicle/device and local uploads override server copies', () => {
  const result = mergeSavedJobs(binding, [
    job('remote', '2026-08-20T04:00:00.000Z'),
    job('other-device', '2026-08-20T06:00:00.000Z', { deviceId: 'tablet-02' }),
  ], [
    { report: job('remote', '2026-08-20T05:00:00.000Z'), uploadFailed: false },
    { report: job('failed', '2026-08-20T04:30:00.000Z'), uploadFailed: true },
  ]);
  assert.deepEqual(result.map(item => item.id), ['remote', 'failed']);
  assert.equal(result[0].pendingUpload, true);
  assert.equal(result[1].uploadFailed, true);
});
