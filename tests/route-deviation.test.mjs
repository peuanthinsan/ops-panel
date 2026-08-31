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

test('accepts regional Google Maps domains such as google.co.th', () => {
  const url = new URL('https://www.google.co.th/maps/dir/VL+BP+J28G%2B9MJ,+Lat+Khwang,+Ban+Pho,+Chachoengsao+24140/%E0%B8%9A%E0%B8%A3%E0%B8%B4%E0%B8%A9%E0%B8%B1%E0%B8%97+Toyota/@14.3536849,100.6781987,121793m/data=!3m1!1e3');
  assert.equal(url.hostname, 'www.google.co.th');
  assert.match(url.pathname, /^\/maps\/dir\//);
});

test('extracts route waypoints from Google Maps encoded place data', () => {
  const anchors = parseRouteAnchors('https://www.google.co.th/maps/dir/example/@14.35,100.67/data=!1m1!1d101.0266272!2d13.6159393!3m4!1m2!1d100.9632852!2d14.4764361');
  assert.deepEqual(anchors.slice(-2), [
    { latitude: 13.6159393, longitude: 101.0266272 },
    { latitude: 14.4764361, longitude: 100.9632852 },
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
