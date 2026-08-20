import assert from 'node:assert/strict';
import test from 'node:test';
import { distanceMeters, gpsPairingMetadata, normalizeFmsGpsPayload } from '../web/lib/server/gps-pairing.mjs';

test('normalizes common contract-neutral FMS GPS shapes', () => {
  assert.deepEqual(normalizeFmsGpsPayload({ data: {
    lat: '13.7563', lng: 100.5018, speedKph: 36, timestamp: '2026-08-19T01:00:07Z',
  } }), {
    latitude: 13.7563,
    longitude: 100.5018,
    speedMps: 10,
    capturedAt: '2026-08-19T01:00:07.000Z',
  });
});

test('paired source metadata records time and position deltas', () => {
  const result = gpsPairingMetadata({
    capturedAt: '2026-08-19T01:00:00.000Z', latitude: 13.7563, longitude: 100.5018,
  }, 'received', {
    latitude: 13.7564, longitude: 100.5019, speedMps: 8, capturedAt: '2026-08-19T01:00:07.000Z',
  });
  assert.equal(result.pairStatus, 'paired');
  assert.equal(result.timeDeltaMs, 7000);
  assert.ok(result.positionDeltaM > 0 && result.positionDeltaM < 20);
  assert.equal(result.fmsSpeedMps, 8);
});

test('received raw payloads remain distinguishable from unavailable FMS data', () => {
  assert.equal(gpsPairingMetadata({ capturedAt: '2026-08-19T01:00:00Z', latitude: 1, longitude: 1 }, 'received', { vendor: 'opaque' }).pairStatus, 'fms_received');
  assert.equal(gpsPairingMetadata({ capturedAt: '2026-08-19T01:00:00Z', latitude: 1, longitude: 1 }, 'not_configured', null).pairStatus, 'device_only');
  assert.equal(gpsPairingMetadata({ capturedAt: '2026-08-19T01:00:00Z', latitude: 1, longitude: 1 }, 'unavailable', null).pairStatus, 'fms_delayed');
});

test('distance calculation is stable and rejects missing coordinates', () => {
  assert.equal(distanceMeters(13.7, 100.5, 13.7, 100.5), 0);
  assert.equal(distanceMeters(null, 100.5, 13.7, 100.5), null);
});
