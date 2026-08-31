import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRouteDeviation, parseRouteAnchors } from '../web/lib/route-deviation.mjs';

test('parses coordinate anchors from a Google Maps directions link', () => {
  const anchors = parseRouteAnchors('https://www.google.com/maps/dir/13.7563,100.5018/13.7367,100.5231');
  assert.deepEqual(anchors, [
    { latitude: 13.7563, longitude: 100.5018 },
    { latitude: 13.7367, longitude: 100.5231 },
  ]);
});

test('flags a GPS run that remains outside the route for the configured duration', () => {
  const anchors = [{ latitude: 13.7563, longitude: 100.5018 }, { latitude: 13.7563, longitude: 100.5118 }];
  const samples = [
    { capturedAt: '2026-08-31T01:00:00.000Z', latitude: 13.7563, longitude: 100.5020 },
    { capturedAt: '2026-08-31T01:01:00.000Z', latitude: 13.7663, longitude: 100.5020 },
    { capturedAt: '2026-08-31T01:03:00.000Z', latitude: 13.7663, longitude: 100.5020 },
  ];
  const result = evaluateRouteDeviation(samples, anchors, { distanceKm: 0.5, durationSeconds: 90 });
  assert.equal(result.status, 'deviated');
  assert.equal(result.longestDurationSeconds, 120);
});
