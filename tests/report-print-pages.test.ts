import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DAILY_REPORT_CONTINUATION_JOB_LIMIT,
  DAILY_REPORT_FIRST_PAGE_JOB_LIMIT,
  paginateDailyReportJobs,
} from '../web/lib/report-print-pages.ts';
import { REPORT_MODE_COLORS } from '../web/lib/report-mode-meta.ts';

test('daily print pagination preserves every job in order', () => {
  const jobs = Array.from({ length: 19 }, (_, index) => ({ id: `job-${index + 1}` }));
  const pages = paginateDailyReportJobs(jobs);
  const printedJobs = [...pages.firstPage, ...pages.continuationPages.flat()];

  assert.equal(pages.firstPage.length, DAILY_REPORT_FIRST_PAGE_JOB_LIMIT);
  assert.equal(pages.continuationPages.length, 1);
  assert.equal(pages.continuationPages[0].length, 11);
  assert.equal(pages.totalPages, 2);
  assert.deepEqual(printedJobs, jobs);
});

test('daily print pagination adds as many continuation pages as needed', () => {
  const total = DAILY_REPORT_FIRST_PAGE_JOB_LIMIT + (DAILY_REPORT_CONTINUATION_JOB_LIMIT * 2) + 3;
  const jobs = Array.from({ length: total }, (_, index) => index);
  const pages = paginateDailyReportJobs(jobs);

  assert.deepEqual(pages.continuationPages.map(page => page.length), [14, 14, 3]);
  assert.equal(pages.totalPages, 4);
  assert.deepEqual([...pages.firstPage, ...pages.continuationPages.flat()], jobs);
});

test('the timeline exposes a distinct legend color for every mode 1–9', () => {
  assert.deepEqual(Object.keys(REPORT_MODE_COLORS), [
    'Load',
    'Stop vehicle',
    'Unload',
    'Break',
    'Vehicle check',
    'Refuel',
    'Vehicle wash',
    'Park overnight',
    'Finish work',
  ]);
  assert.equal(new Set(Object.values(REPORT_MODE_COLORS)).size, 9);
});
