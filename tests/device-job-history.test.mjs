import assert from 'node:assert/strict';
import test from 'node:test';
import { queryLocalDeviceJobs } from '../lib/device-job-history.mjs';

function params(values = {}) {
  return new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)]));
}

const history = Array.from({ length: 12_050 }, (_, index) => {
  const start = new Date(Date.UTC(2020, 0, 1) + (index * 60_000));
  const end = new Date(start.getTime() + ((index % 90) + 1) * 1_000);
  return {
    id: `job-${String(index).padStart(5, '0')}`,
    vehicleNumber: index % 2 ? 'Ford T' : 'FORD T',
    deviceId: 'tablet-lifetime',
    driverName: `Driver ${index % 40}`,
    driverId: `D-${index % 40}`,
    mode: index % 2 ? 'Load' : 'Unload',
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    duration: `00:${String((index % 90) + 1).padStart(2, '0')}`,
    status: index % 7 ? 'Completed' : 'Cancelled',
  };
});

test('device history pages through every matching job without a total-record ceiling', () => {
  const first = queryLocalDeviceJobs(history, 'tablet-lifetime', 'ford t', params());
  assert.equal(first.jobs.length, 50);
  assert.equal(first.pageInfo.total, 12_050);
  assert.equal(first.pageInfo.totalPages, 241);
  assert.equal(first.pageInfo.hasNextPage, true);

  const last = queryLocalDeviceJobs(history, 'tablet-lifetime', 'FORD T', params({ page: 241 }));
  assert.equal(last.jobs.length, 50);
  assert.equal(last.pageInfo.end, 12_050);
  assert.equal(last.pageInfo.hasNextPage, false);
  assert.equal(new Set([...first.jobs, ...last.jobs].map(job => job.id)).size, 100);
});

test('device history applies search, status, activity, and sorting before pagination and totals', () => {
  const searched = queryLocalDeviceJobs(history, 'tablet-lifetime', 'Ford T', params({ search: 'job-12049' }));
  assert.deepEqual(searched.jobs.map(job => job.id), ['job-12049']);
  assert.equal(searched.summary.total, 1);

  const cancelledLoads = queryLocalDeviceJobs(history, 'tablet-lifetime', 'Ford T', params({ mode: 'Load', status: 'cancelled', sort: 'oldest' }));
  assert.ok(cancelledLoads.summary.total > 50);
  assert.ok(cancelledLoads.jobs.every(job => job.mode === 'Load' && job.status === 'Cancelled'));
  assert.ok(Date.parse(cancelledLoads.jobs[0].endTime) <= Date.parse(cancelledLoads.jobs.at(-1).endTime));

  const target = history[500];
  const range = queryLocalDeviceJobs(history, 'tablet-lifetime', 'Ford T', params({
    from: new Date(Date.parse(target.startTime) - 500).toISOString(),
    to: new Date(Date.parse(target.endTime) + 500).toISOString(),
  }));
  assert.ok(range.jobs.some(job => job.id === target.id));
  assert.ok(range.jobs.every(job => Date.parse(job.endTime) >= Date.parse(target.startTime) - 500
    && Date.parse(job.startTime) <= Date.parse(target.endTime) + 500));
});
