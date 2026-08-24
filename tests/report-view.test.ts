import assert from 'node:assert/strict';
import test from 'node:test';
import { compareReports, formatReportCoordinate, formatReportDateTime, formatReportDuration, reportDateKey, searchableReportText } from '../lib/report-view.ts';

test('report dates are grouped by the Thailand operating day, not UTC', () => {
  assert.equal(reportDateKey('2026-08-17T18:30:00.000Z'), '2026-08-18');
  assert.match(formatReportDateTime('2026-08-17T18:30:00.000Z', 'en'), /18 Aug 2026/);
  assert.match(formatReportDateTime('2026-08-17T18:30:09.000Z', 'en'), /01:30:09|1:30:09/);
});

test('report search includes identifiers, timing, duration, and GPS details', () => {
  const text = searchableReportText({
    id: 'OPS-101', vehicleNumber: '74-1286', deviceId: 'tablet-9', driverName: 'Driver A',
    driverId: 'D-44', mode: 'Load', startTime: '2026-08-18T01:00:00.000Z',
    endTime: '2026-08-18T01:48:00.000Z', duration: '48m', status: 'Completed',
    gps: 'Data-FM matched', gpsLookupStatus: 'device_only', gpsLookupMessage: 'Data-FM GPS point matched',
    deviceGpsSamples: 8, fmsGpsSamples: 7, lastDeviceLatitude: 13.7564, lastDeviceLongitude: 100.5019,
  }, 'en');
  for (const value of ['ops-101', 'tablet-9', 'd-44', '48m', 'device_only', 'data-fm gps point matched', '13.7564', '13.75640', '100.5019', '100.50190']) {
    assert.match(text, new RegExp(value));
  }
});

test('duration sorting uses elapsed time rather than display strings', () => {
  const short = { startTime: '2026-08-18T01:00:00Z', endTime: '2026-08-18T01:09:00Z', duration: '09:00' };
  const long = { startTime: '2026-08-18T01:00:00Z', endTime: '2026-08-18T02:00:00Z', duration: '01:00:00' };
  assert.ok(compareReports(short, long, 'duration', 'asc') < 0);
  assert.ok(compareReports(short, long, 'duration', 'desc') > 0);
});

test('report duration is always displayed as unambiguous hours, minutes, and seconds', () => {
  assert.equal(formatReportDuration('2026-08-24T09:45:00.000Z', '2026-08-24T09:45:20.000Z', '00:20'), '00:00:20');
  assert.equal(formatReportDuration('2026-08-24T09:00:00.000Z', '2026-08-24T10:03:00.000Z', '01:03:00'), '01:03:00');
  assert.equal(formatReportDuration(null, null, '00:20'), '00:00:20');
  assert.equal(formatReportDuration(null, null, '48m'), '48m');
});

test('missing GPS coordinates stay missing instead of becoming zero coordinates', () => {
  assert.equal(formatReportCoordinate(null), null);
  assert.equal(formatReportCoordinate(undefined), null);
  assert.equal(formatReportCoordinate(''), null);
  assert.equal(formatReportCoordinate(0), '0.00000');
  assert.equal(formatReportCoordinate(13.7564), '13.75640');
});
