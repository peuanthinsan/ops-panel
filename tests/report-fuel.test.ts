import assert from 'node:assert/strict';
import test from 'node:test';
import { reportFuelReading } from '../web/lib/report-fuel.ts';
import type { RawTelemetrySample } from '../web/lib/speed-timeline.ts';

const report = { startTime: '2026-09-24T07:00:00+07:00', endTime: '2026-09-24T08:00:00+07:00' };
const sample = (capturedAt: string, totalFuel?: number | string | null): RawTelemetrySample => ({ capturedAt, totalFuel });

test('selects the latest valid fuel observation regardless of order or later speed-only readings', () => {
  const samples: RawTelemetrySample[] = [
    sample('2026-09-24T00:40:00Z', ' 123.45 '),
    { capturedAt: '2026-09-24T00:59:00Z', speedKph: 42, totalFuel: null },
    sample('2026-09-24T00:20:00Z', 300),
    { capturedAt: '2026-09-24T01:00:00Z', speedKph: 0 },
  ];
  const before = structuredClone(samples);
  assert.deepEqual(reportFuelReading(report, { status: 'received', samples }), {
    status: 'received', totalFuel: 123.45, capturedAt: '2026-09-24T00:40:00Z',
  });
  assert.deepEqual(samples, before);
});

test('preserves a genuine zero fuel reading while skipping empty and invalid readings', () => {
  const invalidValues = [null, undefined, '', ' ', '\t', 'NaN', 'Infinity', '-2', -1, Infinity, NaN, false, [], {}];
  const samples: RawTelemetrySample[] = [
    sample('2026-09-24T00:00:00Z', 400),
    sample('2026-09-24T00:01:00Z', '0'),
    ...invalidValues.map(value => ({ capturedAt: '2026-09-24T00:59:00Z', totalFuel: value } as RawTelemetrySample)),
  ];
  assert.deepEqual(reportFuelReading(report, { status: 'received', samples }), {
    status: 'received', totalFuel: 0, capturedAt: '2026-09-24T00:01:00Z',
  });
});

test('includes job boundaries and ignores invalid timestamps and readings outside the saved job', () => {
  const telemetry = { status: 'received', samples: [
    sample(report.startTime, 300), sample(report.endTime, 250),
    sample('2026-09-24T00:59:59Z', 260), sample('2026-09-23T23:59:59Z', 350),
    sample('2026-09-24T01:00:01Z', 200), sample('bad-time', 999), sample('', 888),
  ] };
  assert.deepEqual(reportFuelReading(report, telemetry), { status: 'received', totalFuel: 250, capturedAt: report.endTime });
  assert.deepEqual(reportFuelReading({ startTime: report.startTime, endTime: report.startTime }, telemetry), {
    status: 'received', totalFuel: 300, capturedAt: report.startTime,
  });
});

test('uses absolute timestamps across midnight and timezone offsets', () => {
  assert.deepEqual(reportFuelReading({ startTime: '2026-09-24T23:00:00+07:00', endTime: '2026-09-25T01:00:00+07:00' }, {
    status: 'received', samples: [sample('2026-09-25T00:30:00+07:00', 150), sample('2026-09-24T17:45:00Z', 100)],
  }), { status: 'received', totalFuel: 100, capturedAt: '2026-09-24T17:45:00Z' });
});

test('distinguishes loading, empty, unavailable, and unconfigured telemetry without exposing stale readings', () => {
  assert.deepEqual(reportFuelReading(report), { status: 'loading', totalFuel: null, capturedAt: null });
  assert.equal(reportFuelReading(report, undefined, false).status, 'no_fuel');
  assert.equal(reportFuelReading(report, null, false).status, 'no_fuel');
  assert.equal(reportFuelReading(report, { status: 'loading' }).status, 'loading');
  assert.equal(reportFuelReading(report, { status: 'loading' }, false).status, 'no_fuel');
  for (const samples of [undefined, [], [sample('2026-09-24T00:15:00Z', null)], [sample('2026-09-24T02:00:00Z', 50)]]) {
    assert.deepEqual(reportFuelReading(report, { status: 'received', samples }), { status: 'no_fuel', totalFuel: null, capturedAt: null });
  }
  for (const status of ['unavailable', 'not_configured', 'unexpected']) {
    assert.deepEqual(reportFuelReading(report, { status, samples: [sample(report.startTime, 400)] }), {
      status: status === 'not_configured' ? status : 'unavailable', totalFuel: null, capturedAt: null,
    });
  }
});

test('rejects incomplete, invalid, and reversed job bounds instead of attributing unrelated telemetry', () => {
  for (const bounds of [{}, { startTime: report.startTime }, { ...report, endTime: 'invalid' }, { startTime: report.endTime, endTime: report.startTime }]) {
    assert.deepEqual(reportFuelReading(bounds, { status: 'received', samples: [sample(report.startTime, 400)] }), {
      status: 'unavailable', totalFuel: null, capturedAt: null,
    });
    assert.equal(reportFuelReading(bounds).status, 'unavailable');
  }
});
