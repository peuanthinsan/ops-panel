import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeReportSpeedSeries, normalizeSpeedSamples, speedChartPoints, speedDomainMaximum, speedLinePath } from '../web/lib/speed-timeline.ts';

function closeTo(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 0.001, `${actual} should be close to ${expected}`);
}

test('GPS speed samples become an ascending Bangkok-time series in km/h', () => {
  const points = normalizeSpeedSamples([
    { id: 'later', capturedAt: '2026-08-25T01:00:00.000Z', deviceGps: { speedMps: 20 } },
    { id: 'missing', capturedAt: '2026-08-25T00:45:00.000Z', deviceGps: { speedMps: null } },
    { id: 'earlier', capturedAt: '2026-08-25T00:30:00.000Z', deviceGps: { speedMps: 10 } },
  ]);
  assert.deepEqual(points.map(point => point.id), ['earlier', 'later']);
  assert.equal(points[0].minute, 7 * 60 + 30);
  closeTo(points[0].speedKph, 36);
  closeTo(points[1].speedKph, 72);
});

test('speed geometry shares the report timeline window and produces a crisp path', () => {
  const points = normalizeSpeedSamples([
    { id: 'a', capturedAt: '2026-08-24T23:00:00.000Z', deviceGps: { speedMps: 10 } },
    { id: 'b', capturedAt: '2026-08-25T00:00:00.000Z', deviceGps: { speedMps: 30 } },
  ]);
  const maximum = speedDomainMaximum([points]);
  assert.equal(maximum, 120);
  const chart = speedChartPoints(points, { startMinute: 6 * 60, endMinute: 24 * 60, width: 900, height: 72, maxSpeed: maximum });
  closeTo(chart[0].x, 0);
  closeTo(chart[1].x, 50);
  assert.match(speedLinePath(chart), /^M0\.00,.* L50\.00,/);
});

test('single-point jobs merge into one chronological vehicle speed line', () => {
  const earlier = normalizeSpeedSamples([{ id: 'a', capturedAt: '2026-08-25T00:30:00.000Z', deviceGps: { speedMps: 10 } }]);
  const later = normalizeSpeedSamples([{ id: 'b', capturedAt: '2026-08-25T01:00:00.000Z', deviceGps: { speedMps: 20 } }]);
  const merged = mergeReportSpeedSeries([
    { reportId: 'later-job', points: later },
    { reportId: 'earlier-job', points: earlier },
  ]);
  assert.deepEqual(merged.map(point => [point.reportId, point.id]), [
    ['earlier-job', 'a'],
    ['later-job', 'b'],
  ]);
  assert.match(speedLinePath(speedChartPoints(merged)), /^M.* L/);
});
