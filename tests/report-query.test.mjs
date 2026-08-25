import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReportQuery, parseReportSort } from '../web/lib/report-query.mjs';

test('report query parameters are bounded, parameterized, and preserve multi-column sorting', () => {
  const params = new URLSearchParams({
    page: '2', pageSize: '999', search: "truck' OR true --", startDate: '2026-08-01', endDate: '2026-08-19',
    vehicle: '70-1234', sort: 'vehicleNumber:asc,startTime:desc,invalid:asc,status:desc',
  });
  params.append('vehicle', '74-0904');
  params.append('status', 'Completed');
  params.append('status', 'Cancelled');
  const query = buildReportQuery(params);
  assert.equal(query.page, 2);
  assert.equal(query.pageSize, 100);
  assert.equal(query.offset, 100);
  assert.deepEqual(query.sorts, [
    { key: 'vehicleNumber', direction: 'asc' },
    { key: 'startTime', direction: 'desc' },
    { key: 'status', direction: 'desc' },
  ]);
  assert.doesNotMatch(query.whereSql, /OR true/);
  assert.equal(query.values.at(-1), "%truck' OR true --%");
  assert.match(query.whereSql, /Asia\/Bangkok/);
  assert.match(query.whereSql, /lower\(report\.vehicle_number\) = ANY\(\$3::text\[\]\)/);
  assert.deepEqual(query.values[2], ['70-1234', '74-0904']);
  assert.deepEqual(query.values[3], ['Completed', 'Cancelled']);
});

test('GPS coverage and top speed are valid column sorts', () => {
  assert.deepEqual(parseReportSort('gpsCoverage:desc,topSpeed:asc').map(({ key, direction }) => ({ key, direction })), [
    { key: 'gpsCoverage', direction: 'DESC' },
    { key: 'topSpeed', direction: 'ASC' },
  ]);
});

test('unsafe report sort fields fall back to newest first', () => {
  assert.deepEqual(parseReportSort('created_at;drop table:asc').map(({ key, direction }) => ({ key, direction })), [
    { key: 'startTime', direction: 'DESC' },
  ]);
});
