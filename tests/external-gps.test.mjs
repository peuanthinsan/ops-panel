import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nearestExternalGpsPoint,
  normalizeExternalGpsPoints,
  pairExternalGpsSources,
} from '../web/lib/server/external-gps.mjs';

test('normalizes common GPS server and Howen position envelopes', () => {
  const points = normalizeExternalGpsPoints({ data: { positions: [
    { gpsTime: '2026-08-20T01:00:07Z', lat: '13.7563', lng: 100.5018, speedKph: 36, course: 92 },
  ] } });
  assert.equal(points.length, 1);
  assert.deepEqual({ ...points[0], raw: undefined }, {
    capturedAt: '2026-08-20T01:00:07.000Z',
    latitude: 13.7563,
    longitude: 100.5018,
    accuracy: null,
    speedMps: 10,
    headingDegrees: 92,
    raw: undefined,
  });
});

test('chooses the nearest GPS fix inside the configured time window', () => {
  const payload = { positions: [
    { capturedAt: '2026-08-20T01:00:00Z', latitude: 13, longitude: 100 },
    { capturedAt: '2026-08-20T01:01:04Z', latitude: 14, longitude: 101 },
  ] };
  assert.equal(nearestExternalGpsPoint(payload, '2026-08-20T01:00:58Z')?.latitude, 14);
  assert.equal(nearestExternalGpsPoint(payload, '2026-08-20T01:03:00Z'), null);
});

test('pairs independent GPS device and FMS fixes by GPS time', () => {
  const result = pairExternalGpsSources(
    [{ capturedAt: '2026-08-20T01:00:02Z', latitude: 13.7563, longitude: 100.5018 }],
    [{ gpsTime: '2026-08-20T01:00:09Z', lat: 13.7564, lon: 100.5019 }],
    '2026-08-20T01:00:00Z',
  );
  assert.equal(result.pairStatus, 'paired');
  assert.equal(result.timeDeltaMs, 7000);
  assert.ok(result.positionDeltaM > 0);
});

test('does not invent a pair when either external source is outside the time window', () => {
  const deviceMissing = pairExternalGpsSources([], [], '2026-08-20T01:00:00Z');
  assert.equal(deviceMissing.pairStatus, 'device_delayed');
  const fmsMissing = pairExternalGpsSources(
    [{ capturedAt: '2026-08-20T01:00:00Z', latitude: 13, longitude: 100 }],
    [{ capturedAt: '2026-08-20T01:03:00Z', latitude: 13, longitude: 100 }],
    '2026-08-20T01:00:00Z',
  );
  assert.equal(fmsMissing.pairStatus, 'device_only');
});
