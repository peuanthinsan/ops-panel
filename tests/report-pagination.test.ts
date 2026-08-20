import assert from 'node:assert/strict';
import test from 'node:test';
import { paginateReports } from '../lib/report-pagination.ts';

test('report pagination keeps large fleet history bounded and clamps stale pages', () => {
  const reports = Array.from({ length: 123 }, (_, index) => `OPS-${index + 1}`);
  const first = paginateReports(reports, 1, 50);
  assert.deepEqual({ page: first.page, pages: first.totalPages, start: first.start, end: first.end }, { page: 1, pages: 3, start: 1, end: 50 });
  assert.deepEqual(first.items.slice(0, 2), ['OPS-1', 'OPS-2']);

  const last = paginateReports(reports, 99, 50);
  assert.deepEqual({ page: last.page, pages: last.totalPages, start: last.start, end: last.end }, { page: 3, pages: 3, start: 101, end: 123 });
  assert.equal(last.items.length, 23);
});

test('empty report history has a stable first page and zero range', () => {
  assert.deepEqual(paginateReports([], 4, 50), { items: [], page: 1, totalPages: 1, start: 0, end: 0 });
});
