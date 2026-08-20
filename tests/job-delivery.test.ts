import assert from 'node:assert/strict';
import test from 'node:test';
import { SongdeeApiError } from '../lib/api-error.ts';
import { deliverJobReport } from '../lib/job-delivery.ts';
import type { JobReportInput } from '../lib/report.ts';

const report: JobReportInput = {
  id: 'OPS-delivery-001',
  vehicleNumber: '74-1286',
  deviceId: 'android-001',
  driverName: 'Driver One',
  driverId: 'DRV-001',
  mode: 'Load',
  startTime: '2026-08-18T01:00:00.000Z',
  endTime: '2026-08-18T01:10:00.000Z',
  duration: '10:00',
};

function operations(send: () => Promise<unknown>) {
  const calls: string[] = [];
  return {
    calls,
    value: {
      enqueue: async () => { calls.push('enqueue'); },
      send: async () => { calls.push('send'); return send(); },
      remove: async () => { calls.push('remove'); },
      markPermanentFailure: async () => { calls.push('mark-permanent'); },
      isRetryable: (error: unknown) => !(error instanceof SongdeeApiError) || error.retryable,
      errorMessage: (error: unknown) => error instanceof Error ? error.message : 'Permanent API rejection',
    },
  };
}

test('a delivered report is removed from the retry outbox', async () => {
  const fixture = operations(async () => ({}));
  assert.equal(await deliverJobReport(report, fixture.value), 'synced');
  assert.deepEqual(fixture.calls, ['enqueue', 'send', 'remove']);
});

test('a temporary failure remains enabled for background retry', async () => {
  const fixture = operations(async () => { throw new SongdeeApiError(503, 'temporarily unavailable'); });
  assert.equal(await deliverJobReport(report, fixture.value), 'queued');
  assert.deepEqual(fixture.calls, ['enqueue', 'send']);
});

test('a permanent rejection is retained as a disabled diagnostic record', async () => {
  const rejection = new SongdeeApiError(409, 'binding conflict');
  const fixture = operations(async () => { throw rejection; });
  await assert.rejects(deliverJobReport(report, fixture.value), rejection);
  assert.deepEqual(fixture.calls, ['enqueue', 'send', 'mark-permanent']);
});

test('a direct delivery still works when the local outbox cannot be opened', async () => {
  const calls: string[] = [];
  const result = await deliverJobReport(report, {
    enqueue: async () => { calls.push('enqueue'); throw new Error('database unavailable'); },
    send: async () => { calls.push('send'); },
    remove: async () => { calls.push('remove'); },
    markPermanentFailure: async () => { calls.push('mark-permanent'); },
    isRetryable: () => true,
    errorMessage: () => 'error',
  });
  assert.equal(result, 'synced');
  assert.deepEqual(calls, ['enqueue', 'send']);
});
