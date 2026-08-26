import assert from 'node:assert/strict';
import test from 'node:test';
import { localReportFacets, queryLocalReports } from '../lib/local-report-query.mjs';

const reports = [
  { id: 'R1', vehicleNumber: '10', deviceId: 'D1', driverName: 'Narin', mode: 'Load', status: 'Completed', gpsLookupStatus: 'device_only', startTime: '2026-08-18T01:00:00Z', endTime: '2026-08-18T02:00:00Z', deviceGpsSamples: 1 },
  { id: 'R1F', vehicleNumber: '10', deviceId: 'D1', driverName: 'Narin', mode: 'Finish work', status: 'Completed', gpsLookupStatus: 'device_only', startTime: '2026-08-18T10:00:00Z', endTime: '2026-08-18T10:00:00Z' },
  { id: 'R2', vehicleNumber: '2', deviceId: 'D2', driverName: 'Somchai', mode: 'Unload', status: 'Cancelled', gpsLookupStatus: 'not_applicable', startTime: '2026-08-19T01:00:00Z', endTime: '2026-08-19T01:30:00Z' },
  { id: 'R3', vehicleNumber: '10', deviceId: 'D1', driverName: 'Narin', mode: 'Break', status: 'Completed', gpsLookupStatus: 'pending', startTime: '2026-08-19T03:00:00Z', endTime: '2026-08-19T03:15:00Z', deviceGpsSamples: 10, fmsGpsSamples: 8, pairedGpsSamples: 8, attentionGpsSamples: 2 },
];

const fordReports = [
  { id: 'F1', vehicleNumber: 'FORD T', status: 'Completed', startTime: '2026-08-19T03:00:00Z', endTime: '2026-08-19T03:01:00Z' },
  { id: 'F2', vehicleNumber: 'Ford T', status: 'Completed', startTime: '2026-08-19T04:00:00Z', endTime: '2026-08-19T04:01:00Z' },
];

const multiDeviceBindings = [
  { vehicleNumber: 'FORD T', deviceId: 'D1' },
  { vehicleNumber: 'ford t', deviceId: 'D2' },
  { vehicleNumber: ' 74-1286 ', deviceId: 'D3' },
];

test('local dashboard query filters, sorts, summarizes, and paginates like production', () => {
  const result = queryLocalReports(reports, [
    { vehicleNumber: '10', deviceId: 'D1' },
    { vehicleNumber: '2', deviceId: 'D2' },
  ], new URLSearchParams({
    startDate: '2026-08-19', vehicle: '10', sort: 'duration:desc', pageSize: '1',
  }));
  assert.deepEqual(result.reports.map(report => report.id), ['R3']);
  assert.deepEqual(result.summary, {
    total: 1, activeVehicles: 1, queued: 1, cancelled: 0,
    gpsPaired: 0, gpsNeedsAttention: 0, gpsMatched: 1, deviceGpsSamples: 10,
    fmsGpsSamples: 8, pairedGpsSamples: 8, attentionGpsSamples: 2,
    fleetSize: 2,
  });
  assert.deepEqual(result.pageInfo, { page: 1, pageSize: 1, total: 1, totalPages: 1, start: 1, end: 1 });
});

test('local dashboard facets are complete and numerically sorted', () => {
  assert.deepEqual(localReportFacets(reports), {
    vehicles: ['2', '10'], devices: ['D1', 'D2'], drivers: ['Narin', 'Somchai'],
    statuses: ['Cancelled', 'Completed'],
    gpsStates: ['device_only', 'not_applicable', 'pending'],
  });
});

test('vehicle filters and facets treat casing variants as one fleet vehicle', () => {
  assert.deepEqual(localReportFacets(fordReports).vehicles, ['Ford T']);
  const result = queryLocalReports(fordReports, [], new URLSearchParams({ vehicle: 'FORD T' }));
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.activeVehicles, 1);
});

test('fleet size counts physical vehicles once when several devices share one vehicle', () => {
  const result = queryLocalReports(
    [{ id: 'R1', vehicleNumber: 'FORD T', status: 'Completed', startTime: '2026-08-19T03:00:00Z', endTime: '2026-08-19T03:01:00Z' }],
    multiDeviceBindings,
    new URLSearchParams(),
  );
  assert.equal(result.summary.activeVehicles, 1);
  assert.equal(result.summary.fleetSize, 2);
});

test('local dashboard query accepts repeated multi-select filters', () => {
  const params = new URLSearchParams({ startDate: '2026-08-18' });
  params.append('vehicle', '2');
  params.append('vehicle', '10');
  params.append('mode', 'Load');
  params.append('mode', 'Unload');
  const result = queryLocalReports(reports, [], params);
  assert.deepEqual(result.reports.map(report => report.id), ['R2', 'R1']);
});
