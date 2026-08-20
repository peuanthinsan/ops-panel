import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpsSampleId, GPS_SYNC_INTERVAL_MS } from '../lib/gps-sample.ts';

test('device and FMS GPS synchronization is scheduled every 60 seconds', () => {
  assert.equal(GPS_SYNC_INTERVAL_MS, 60_000);
});

test('the same device sample keeps the same retry-safe id', () => {
  const capturedAt = '2026-08-18T08:30:00.000Z';
  assert.equal(createGpsSampleId('4c459d9abcd9237c', capturedAt), createGpsSampleId('4c459d9abcd9237c', capturedAt));
});

test('different capture times receive different ids', () => {
  assert.notEqual(
    createGpsSampleId('4c459d9abcd9237c', '2026-08-18T08:30:00.000Z'),
    createGpsSampleId('4c459d9abcd9237c', '2026-08-18T08:31:00.000Z'),
  );
});

test('device ids are sanitized for the server id contract', () => {
  assert.match(createGpsSampleId('device / 1', '2026-08-18T08:30:00.000Z'), /^GPS-device___1-\d+$/);
});

test('invalid sample identity data is rejected', () => {
  assert.throws(() => createGpsSampleId('', '2026-08-18T08:30:00.000Z'), /deviceId/);
  assert.throws(() => createGpsSampleId('device-1', 'not-a-date'), /capturedAt/);
});
