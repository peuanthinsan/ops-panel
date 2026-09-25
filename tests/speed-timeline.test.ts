import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeReportSpeedSeries, normalizeSpeedSamples, speedChartPoints, speedDomainMaximum, speedLinePath, reportTelemetryPoints, telemetryChartPoints, telemetryDomainMaximum, telemetryLinePath, telemetryMarkerPoints } from '../web/lib/speed-timeline.ts';

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

test('speed points use the full width of a timeline shorter than one minute', () => {
  const points = normalizeSpeedSamples([
    { id: 'first', capturedAt: '2026-08-31T03:14:09Z', deviceGps: { speedMps: 0 } },
    { id: 'last', capturedAt: '2026-08-31T03:14:15Z', deviceGps: { speedMps: 1 } },
  ]);
  const chart = speedChartPoints(points, { startMinute: points[0].minute, endMinute: points[1].minute });
  closeTo(chart[0].x, 0);
  closeTo(chart[1].x, 1000);
});

const telemetryTime = (seconds: number) => new Date(Date.parse('2026-08-25T16:59:00Z') + seconds * 1000).toISOString();
const reports = [{ id: 'report-a' }];

test('paired FMS readings preserve zero and missing values and take precedence over tablet speed', () => {
  const points = reportTelemetryPoints(reports, { 'report-a': { status: 'received', samples: [
    { id: 'later', capturedAt: telemetryTime(60), speedKph: null, totalFuel: '' },
    { id: 'start', capturedAt: telemetryTime(0), speedKph: 0, totalFuel: 0 },
    { id: 'invalid', capturedAt: 'bad date', speedKph: 99, totalFuel: 999 },
    { id: 'invalid-values', capturedAt: telemetryTime(120), speedKph: -1, totalFuel: 'Infinity' },
  ] } }, { 'report-a': [{ capturedAt: telemetryTime(0), deviceGps: { speedMps: 20 } }] });
  assert.deepEqual(points.map(point => [point.id, point.speedKph, point.totalFuel]), [['start', 0, 0], ['later', null, null], ['invalid-values', null, null]]);
  assert.ok(points.every(point => point.speedObserved && point.fuelObserved));
});

test('independent GPS fallback does not invent paired fuel or interrupt real fuel observations', () => {
  const points = reportTelemetryPoints(reports, { 'report-a': { status: 'received', samples: [
    { capturedAt: telemetryTime(0), speedKph: null, totalFuel: 300 },
    { capturedAt: telemetryTime(120), speedKph: null, totalFuel: 295 },
  ] } }, { 'report-a': [
    { capturedAt: telemetryTime(30), deviceGps: { speedMps: 10 } },
    { capturedAt: telemetryTime(90), deviceGps: { speedMps: 0 } },
  ] }, telemetryTime(0));
  assert.deepEqual(points.map(point => [point.speedKph, point.totalFuel]), [[null, 300], [36, null], [0, null], [null, 295]]);
  const chart = telemetryChartPoints(points, { startMinute: 0, endMinute: 2 });
  assert.equal((telemetryLinePath(chart, 'totalFuel').match(/L/g) || []).length, 1);
  assert.equal((telemetryLinePath(chart, 'speedKph').match(/L/g) || []).length, 1);
});

test('unavailable API leaves GPS speed and missing GPS observations as separate segments', () => {
  const points = reportTelemetryPoints(reports, { 'report-a': { status: 'unavailable', samples: [{ capturedAt: telemetryTime(0), speedKph: 120, totalFuel: 900 }] } }, { 'report-a': [
    { capturedAt: telemetryTime(0), deviceGps: { speedMps: 0 } },
    { capturedAt: telemetryTime(30), deviceGps: { speedMps: null } },
    { capturedAt: telemetryTime(60), deviceGps: { speedMps: 10 } },
  ] }, telemetryTime(0));
  assert.deepEqual(points.map(point => point.speedKph), [0, null, 36]);
  const chart = telemetryChartPoints(points, { startMinute: 0, endMinute: 1 });
  assert.equal(telemetryLinePath(chart, 'totalFuel'), '');
  assert.equal((telemetryLinePath(chart, 'speedKph').match(/M/g) || []).length, 2);
  assert.doesNotMatch(telemetryLinePath(chart, 'speedKph'), /L/);
});

test('speed and fuel have independent scales and share elapsed time through midnight', () => {
  const points = reportTelemetryPoints(reports, { 'report-a': { status: 'received', samples: [
    { capturedAt: telemetryTime(0), speedKph: 120, totalFuel: 400 },
    { capturedAt: telemetryTime(120), speedKph: 60, totalFuel: 100 },
  ] } }, {}, telemetryTime(0));
  assert.deepEqual(points.map(point => point.minute), [0, 2]);
  assert.equal(telemetryDomainMaximum(points, 'speedKph'), 120);
  assert.equal(telemetryDomainMaximum(points, 'totalFuel'), 400);
  const chart = telemetryChartPoints(points, { startMinute: 0, endMinute: 2, top: 0, bottom: 0, height: 100 });
  assert.deepEqual(chart.map(point => [point.x, point.speedY, point.fuelY]), [[0, 0, 0], [1000, 50, 75]]);
});

test('lines stop at missing readings, report boundaries and gaps over five minutes', () => {
  const points = reportTelemetryPoints(reports, { 'report-a': { status: 'received', samples: [
    { capturedAt: telemetryTime(0), speedKph: 10, totalFuel: 100 },
    { capturedAt: telemetryTime(30), speedKph: 20, totalFuel: null },
    { capturedAt: telemetryTime(60), speedKph: 30, totalFuel: 90 },
    { capturedAt: telemetryTime(361), speedKph: 40, totalFuel: 80 },
  ] } }, {}, telemetryTime(0));
  points.push({ ...points[3], id: 'next-report', reportId: 'report-b', sourceReportIds: ['report-b'], minute: 7, capturedAt: telemetryTime(420) });
  const chart = telemetryChartPoints(points);
  assert.equal((telemetryLinePath(chart, 'speedKph').match(/M/g) || []).length, 3);
  assert.equal((telemetryLinePath(chart, 'speedKph').match(/L/g) || []).length, 2);
  assert.equal((telemetryLinePath(chart, 'totalFuel').match(/M/g) || []).length, 4);
  assert.equal((telemetryLinePath(chart, 'totalFuel').match(/h0/g) || []).length, 4);
  assert.doesNotMatch(telemetryLinePath(chart, 'totalFuel'), /L/);
});

test('dense telemetry keeps every path reading and extrema with bounded marker count', () => {
  const samples = Array.from({ length: 1500 }, (_, index) => ({ id: String(index), capturedAt: telemetryTime(index * 30), speedKph: index === 701 ? 160 : index === 702 ? 0 : 40, totalFuel: index === 801 ? 500 : index === 802 ? 0 : 250 }));
  const chart = telemetryChartPoints(reportTelemetryPoints(reports, { 'report-a': { status: 'received', samples } }, {}, telemetryTime(0)));
  const markers = telemetryMarkerPoints(chart);
  assert.ok(markers.length <= 24);
  for (const id of ['0', '1499', '701', '702', '801', '802']) assert.ok(markers.some(point => point.id === id), `retains ${id}`);
  assert.equal((telemetryLinePath(chart, 'speedKph').match(/[ML]/g) || []).length, 1500);
  assert.equal((telemetryLinePath(chart, 'totalFuel').match(/[ML]/g) || []).length, 1500);
});

test('overlapping jobs share identical readings while distinct jobs and conflicting values stay separate', () => {
  const sample = (seconds: number, totalFuel = 300) => ({ capturedAt: telemetryTime(seconds), speedKph: 40, totalFuel });
  const overlapReports = [{ id: 'a' }, { id: 'b' }, { id: 'disjoint' }];
  const telemetry = {
    a: { status: 'received', samples: [sample(0), sample(30), sample(60)] },
    b: { status: 'received', samples: [sample(30), sample(60), sample(90)] },
    disjoint: { status: 'received', samples: [sample(120)] },
  };
  const points = reportTelemetryPoints(overlapReports, telemetry, {}, telemetryTime(0));
  assert.equal(points.length, 5);
  assert.deepEqual(points[1].sourceReportIds, ['a', 'b']);
  const path = telemetryLinePath(telemetryChartPoints(points), 'totalFuel');
  assert.equal((path.match(/M/g) || []).length, 2, 'one continuous overlap trace plus the disjoint job');
  assert.equal((path.match(/L/g) || []).length, 3);
  telemetry.b.samples[1] = sample(60, 299);
  const conflicting = reportTelemetryPoints(overlapReports, telemetry, {}, telemetryTime(0));
  assert.deepEqual(conflicting.filter(point => point.capturedAt === telemetryTime(60)).map(point => point.totalFuel), [300, 299]);
});
