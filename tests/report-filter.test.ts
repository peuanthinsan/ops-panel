import assert from 'node:assert/strict';
import test from 'node:test';
import { appendReportFilters, filterReports, reportFiltersFromSearchParams } from '../web/lib/report-filter.ts';

const reports = [
  { id: 'R1', vehicleNumber: '70-1234', deviceId: 'D1', driverName: 'Driver One', mode: 'Load', status: 'Completed', gpsLookupStatus: 'device_only', startTime: '2026-08-18T01:00:00.000Z', locationName: 'Warehouse A' },
  { id: 'R2', vehicleNumber: '74-0904', deviceId: 'D2', driverName: 'Driver Two', mode: 'Unload', status: 'Cancelled', gpsLookupStatus: 'not_applicable', startTime: '2026-08-19T02:00:00.000Z', locationName: 'Depot B' },
];

test('print filters preserve the dashboard search and every exact filter in the URL', () => {
  const params = appendReportFilters(new URLSearchParams({ lang: 'en' }), {
    search: 'Depot', startDate: '2026-08-19', endDate: '2026-08-19', vehicle: '74-0904',
    device: 'D2', driver: 'Driver Two', mode: 'Unload', status: 'Cancelled', gps: 'not_applicable',
  });
  assert.deepEqual(reportFiltersFromSearchParams(params), {
    search: 'Depot', startDate: '2026-08-19', endDate: '2026-08-19', vehicle: ['74-0904'],
    device: ['D2'], driver: ['Driver Two'], mode: ['Unload'], status: ['Cancelled'], gps: ['not_applicable'],
  });
});

test('print filters preserve repeated multi-select values', () => {
  const params = appendReportFilters(new URLSearchParams(), {
    vehicle: ['70-1234', '74-0904'], mode: ['Load', 'Unload'], status: ['Completed', 'Cancelled'],
  });
  assert.deepEqual(params.getAll('vehicle'), ['70-1234', '74-0904']);
  assert.deepEqual(reportFiltersFromSearchParams(params), {
    vehicle: ['70-1234', '74-0904'], mode: ['Load', 'Unload'], status: ['Completed', 'Cancelled'],
  });
});

test('the print dataset matches dashboard-style date, search, and exact filters', () => {
  assert.deepEqual(filterReports(reports, { search: 'warehouse' }, 'en').map(report => report.id), ['R1']);
  assert.deepEqual(filterReports(reports, { startDate: '2026-08-19', endDate: '2026-08-19' }, 'en').map(report => report.id), ['R2']);
  assert.deepEqual(filterReports(reports, { vehicle: '74-0904', status: 'Cancelled', gps: 'not_applicable' }, 'en').map(report => report.id), ['R2']);
  assert.deepEqual(filterReports(reports, { vehicle: ['70-1234', '74-0904'], mode: ['Load', 'Unload'] }, 'en').map(report => report.id), ['R1', 'R2']);
});

test('job date filters survive print URLs and select the actual Bangkok day within a work period', () => {
  const filters = {
    startDate: '2026-09-01', endDate: '2026-09-01', dateBasis: 'job', workPeriodId: 'P1',
  };
  const parsed = reportFiltersFromSearchParams(appendReportFilters(new URLSearchParams(), filters));
  assert.deepEqual(parsed, filters);
  const periodReports = [
    { id: 'before', startTime: '2026-08-31T16:59:59Z' },
    { id: 'first', startTime: '2026-08-31T17:00:00Z' },
    { id: 'last', startTime: '2026-09-01T16:59:59Z' },
    { id: 'after', startTime: '2026-09-01T17:00:00Z' },
  ].map(report => ({ ...report, workPeriodId: 'P1', workPeriodDate: '2026-08-31' }));
  assert.deepEqual(filterReports(periodReports, parsed, 'en').map(report => report.id), ['first', 'last']);
  assert.deepEqual(filterReports(periodReports, { ...filters, dateBasis: '' }, 'en'), []);
  assert.equal(filterReports(periodReports, { ...filters, startDate: '2026-08-31', endDate: '2026-09-02' }, 'en').length, 4);
});
