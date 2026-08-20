import assert from 'node:assert/strict';
import test from 'node:test';
import { SongdeeApiError } from '../lib/api-error.ts';
import { flushPendingGpsSamples } from '../lib/gps-delivery.ts';
import type { DeviceGpsSample } from '../lib/gps-sample.ts';

function sample(id: string): DeviceGpsSample {
  return {
    id,
    vehicleNumber: '74-1286',
    deviceId: 'android-101',
    capturedAt: '2026-08-18T08:00:00.000Z',
    latitude: 13.7563,
    longitude: 100.5018,
    accuracy: 5,
  };
}

function operations(
  pending: DeviceGpsSample[],
  send: (value: DeviceGpsSample) => Promise<unknown>,
) {
  const removed: string[] = [];
  const permanent: Array<{ id: string; message: string }> = [];
  return {
    removed,
    permanent,
    value: {
      list: async (limit: number) => pending.slice(0, limit),
      send,
      remove: async (id: string) => { removed.push(id); },
      markPermanentFailure: async (id: string, message: string) => { permanent.push({ id, message }); },
      isRetryable: (error: unknown) => !(error instanceof SongdeeApiError) || error.retryable,
      errorMessage: (error: unknown) => error instanceof Error ? error.message : 'Permanent API rejection',
    },
  };
}

test('persisted GPS samples flush without requiring a current binding or location capture', async () => {
  const fixture = operations([sample('GPS-1'), sample('GPS-2')], async () => ({ ok: true }));
  const result = await flushPendingGpsSamples(fixture.value, 5);

  assert.deepEqual(result, { delivered: 2, permanentFailures: 0, stoppedOnRetryableFailure: false });
  assert.deepEqual(fixture.removed, ['GPS-1', 'GPS-2']);
  assert.deepEqual(fixture.permanent, []);
});

test('a retryable GPS failure preserves order and stops the current flush', async () => {
  const sent: string[] = [];
  const fixture = operations([sample('GPS-1'), sample('GPS-2')], async value => {
    sent.push(value.id);
    throw new SongdeeApiError(503, 'FMS unavailable');
  });
  const result = await flushPendingGpsSamples(fixture.value, 5);

  assert.deepEqual(result, { delivered: 0, permanentFailures: 0, stoppedOnRetryableFailure: true });
  assert.deepEqual(sent, ['GPS-1']);
  assert.deepEqual(fixture.removed, []);
  assert.deepEqual(fixture.permanent, []);
});

test('a permanent GPS rejection is retained as a diagnostic while later samples continue', async () => {
  const fixture = operations([sample('GPS-bad'), sample('GPS-good')], async value => {
    if (value.id === 'GPS-bad') throw new SongdeeApiError(409, 'binding conflict');
    return { ok: true };
  });
  const result = await flushPendingGpsSamples(fixture.value, 5);

  assert.deepEqual(result, { delivered: 1, permanentFailures: 1, stoppedOnRetryableFailure: false });
  assert.deepEqual(fixture.removed, ['GPS-good']);
  assert.deepEqual(fixture.permanent, [{ id: 'GPS-bad', message: 'binding conflict' }]);
});
