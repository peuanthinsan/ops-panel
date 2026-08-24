import assert from 'node:assert/strict';
import test from 'node:test';
import { filterAndSortMobileJobs, mobileJobMonthKeys, type MobileJobQuery } from '../lib/mobile-job-query.ts';
import type { SavedJob } from '../lib/saved-jobs.ts';

const baseQuery: MobileJobQuery = {
  dayKey: null,
  endAt: null,
  startAt: null,
  monthKey: null,
  mode: null,
  search: '',
  sort: 'newest',
  status: 'all',
};

function job(index: number, overrides: Partial<SavedJob> = {}): SavedJob {
  const end = new Date(Date.UTC(2026, 7 + Math.floor(index / 240), 1 + (index % 24), index % 24, index % 60, index % 60));
  const start = new Date(end.getTime() - ((index % 180) + 1) * 1000);
  return {
    id: `job-${String(index).padStart(4, '0')}`,
    vehicleNumber: 'FORD T',
    deviceId: 'tablet-01',
    driverName: `Driver ${index % 18}`,
    driverId: `DRV-${index % 18}`,
    mode: index % 2 ? 'Load' : 'Unload',
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    duration: `00:${String((index % 180) + 1).padStart(2, '0')}`,
    ...overrides,
  };
}

test('mobile history filters hundreds of jobs by month, mode, status, and search', () => {
  const jobs = Array.from({ length: 720 }, (_, index) => job(index));
  jobs[319] = job(319, { driverName: 'SOMCHAI UNIQUE', mode: 'Load', pendingUpload: true });
  jobs[320] = job(320, { status: 'Cancelled' });

  assert.equal(filterAndSortMobileJobs(jobs, baseQuery).length, 720);
  assert.deepEqual(mobileJobMonthKeys(jobs), ['2026-10', '2026-09', '2026-08']);
  assert.deepEqual(filterAndSortMobileJobs(jobs, { ...baseQuery, search: 'somchai unique' }).map(item => item.id), ['job-0319']);
  assert.ok(filterAndSortMobileJobs(jobs, { ...baseQuery, monthKey: '2026-09' }).every(item => item.endTime.startsWith('2026-09')));
  assert.ok(filterAndSortMobileJobs(jobs, { ...baseQuery, mode: 'Unload' }).every(item => item.mode === 'Unload'));
  assert.deepEqual(filterAndSortMobileJobs(jobs, { ...baseQuery, status: 'pending' }).map(item => item.id), ['job-0319']);
  assert.deepEqual(filterAndSortMobileJobs(jobs, { ...baseQuery, status: 'cancelled' }).map(item => item.id), ['job-0320']);
});

test('mobile history supports oldest, longest duration, and activity sorting', () => {
  const jobs = [
    job(1, { id: 'load-new', mode: 'Load', duration: '00:20' }),
    job(0, { id: 'unload-old', mode: 'Unload', duration: '03:00' }),
  ];
  assert.deepEqual(filterAndSortMobileJobs(jobs, { ...baseQuery, sort: 'oldest' }).map(item => item.id), ['unload-old', 'load-new']);
  assert.deepEqual(filterAndSortMobileJobs(jobs, { ...baseQuery, sort: 'duration_desc' }).map(item => item.id), ['unload-old', 'load-new']);
  assert.deepEqual(filterAndSortMobileJobs(jobs, { ...baseQuery, sort: 'mode_asc' }).map(item => item.id), ['load-new', 'unload-old']);
});

test('Thai mode names and report identifiers are searchable', () => {
  const jobs = [job(1, { id: 'OPS-REPORT-ABC', mode: 'Load' })];
  assert.equal(filterAndSortMobileJobs(jobs, { ...baseQuery, search: 'ขึ้นสินค้า' }).length, 1);
  assert.equal(filterAndSortMobileJobs(jobs, { ...baseQuery, search: 'report-abc' }).length, 1);
});
