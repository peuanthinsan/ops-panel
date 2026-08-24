import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReportQuery, parseReportSort } from '../web/lib/report-query.mjs';

test('report query parameters are bounded, parameterized, and preserve multi-column sorting', () => {
  const query = buildReportQuery(new URLSearchParams({
    page: '2', pageSize: '999', search: "truck' OR true --", startDate: '2026-08-01', endDate: '2026-08-19',
    vehicle: '70-1234', sort: 'vehicleNumber:asc,startTime:desc,invalid:asc,status:desc',
  }));
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
  assert.match(query.whereSql, /lower\(report\.vehicle_number\) = lower\(\$3\)/);
});

test('unsafe report sort fields fall back to newest first', () => {
  assert.deepEqual(parseReportSort('created_at;drop table:asc').map(({ key, direction }) => ({ key, direction })), [
    { key: 'startTime', direction: 'DESC' },
  ]);
});
