import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLASSIC_REPORT_ROWS_PER_PAGE,
  classicActivityDurations,
  classicReportPages,
  normalizeReportStyle,
} from '../web/lib/report-classic.ts';

const date = '2026-09-09';
const windowStart = '2026-09-08T23:00:00.000Z';
const windowEnd = '2026-09-09T23:00:00.000Z';
const jobs = (count: number) => Array.from({ length: count }, (_, index) => ({
  id: `job-${index + 1}`,
  startTime: `2026-09-09T${String(7 + Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00+07:00`,
}));

test('Classic is the default report style and Modern requires an explicit choice', () => {
  for (const value of [undefined, null, '', 'classic', 'invalid', 'Modern', [], {}]) {
    assert.equal(normalizeReportStyle(value), 'classic');
  }
  assert.equal(normalizeReportStyle('modern'), 'modern');
});

test('an empty Classic report retains one complete 06:00–06:00 page', () => {
  assert.deepEqual(classicReportPages([], date), [{ rows: [], rowOffset: 0, windowStart, windowEnd }]);
});

test('Classic pages fit seven jobs and preserve every row and row offset', () => {
  for (const count of [1, 7, 8, 35, 38]) {
    const rows = jobs(count);
    const pages = classicReportPages(rows, date);
    assert.equal(pages.length, Math.ceil(count / CLASSIC_REPORT_ROWS_PER_PAGE));
    assert.deepEqual(pages.flatMap(page => page.rows), rows);
    assert.equal(new Set(pages.flatMap(page => page.rows)).size, count);
    pages.forEach((page, index) => {
      assert.equal(page.rowOffset, index * 7);
      assert.equal(page.windowStart, windowStart);
      assert.equal(page.windowEnd, windowEnd);
      assert.ok(page.rows.length <= 7);
    });
  }
});

test('wrapped Thai and English locations create counted pages without losing text', () => {
  const locationName = 'จุดรับสินค้า Bangkok distribution center '.repeat(9);
  const rows = jobs(7).map(row => ({ ...row, locationName }));
  const pages = classicReportPages(rows, date);
  assert.equal(pages.length, 7);
  assert.deepEqual(pages.flatMap(page => page.rows), rows);
  assert.deepEqual(pages.map(page => page.rowOffset), [0, 1, 2, 3, 4, 5, 6]);
  for (const page of pages) {
    assert.equal(page.windowStart, windowStart);
    assert.equal(page.windowEnd, windowEnd);
    assert.equal(page.rows[0].locationName, locationName);
  }
  assert.equal(classicReportPages(jobs(7), date).length, 1);
});

test('location coordinates reserve their additional printed line', () => {
  const rows = jobs(3).map(row => ({ ...row, locationName: 'ก'.repeat(160) }));
  assert.equal(classicReportPages(rows, date).length, 1);
  const withCoordinates = rows.map(row => ({ ...row, lastDeviceLatitude: 13.78, lastDeviceLongitude: 100.53 }));
  const pages = classicReportPages(withCoordinates, date);
  assert.deepEqual(pages.map(page => page.rows.length), [2, 1]);
  assert.deepEqual(pages.flatMap(page => page.rows), withCoordinates);
});

test('an individually oversized location is isolated and never truncated', () => {
  const rows = jobs(2).map((row, index) => ({ ...row, locationName: index === 0 ? 'ก'.repeat(4000) : 'Depot' }));
  const pages = classicReportPages(rows, date);
  assert.deepEqual(pages.map(page => page.rows.length), [1, 1]);
  assert.deepEqual(pages.flatMap(page => page.rows), rows);
  assert.equal(pages[0].rows[0].locationName.length, 4000);
});

test('overnight jobs before 06:00 stay in the preceding report window', () => {
  const rows = [
    { id: 'late', startTime: '2026-09-09T23:30:00+07:00', endTime: '2026-09-10T01:00:00+07:00' },
    { id: 'early', startTime: '2026-09-10T02:00:00+07:00', endTime: '2026-09-10T05:59:00+07:00' },
  ];
  const pages = classicReportPages(rows, '2026-09-10');
  assert.equal(pages.length, 1);
  assert.equal(pages[0].windowStart, windowStart);
  assert.equal(pages[0].windowEnd, windowEnd);
  assert.deepEqual(pages[0].rows, rows);
  assert.equal(classicReportPages([rows[1]], '2026-09-10')[0].windowStart, windowStart);
});

test('long jobs add chart-only pages without printing the same job again', () => {
  const rows = [{ id: 'long', startTime: '2026-09-09T07:00:00+07:00', endTime: '2026-09-11T07:00:00+07:00' }];
  const pages = classicReportPages(rows, date);
  assert.equal(pages.length, 3);
  assert.deepEqual(pages.map(page => page.rows.length), [1, 0, 0]);
  assert.deepEqual(pages.map(page => page.rowOffset), [0, 1, 1]);
  assert.deepEqual(pages.flatMap(page => page.rows), rows);
  assert.equal(pages[2].windowEnd, '2026-09-11T23:00:00.000Z');
});

test('06:00 end boundaries are exclusive and 06:00 start boundaries are inclusive', () => {
  const before = { id: 'before', startTime: '2026-09-09T07:00:00+07:00', endTime: '2026-09-10T06:00:00+07:00' };
  assert.equal(classicReportPages([before], date).length, 1);
  const atBoundary = { id: 'boundary', startTime: '2026-09-10T06:00:00+07:00', endTime: '2026-09-10T06:00:00+07:00' };
  const pages = classicReportPages([before, atBoundary], date);
  assert.deepEqual(pages.map(page => page.rows), [[before], [atBoundary]]);
  assert.equal(pages[1].windowStart, windowEnd);
});

test('multiple report windows and overflow pages retain original row order', () => {
  const rows = [...jobs(8), { id: 'next', startTime: '2026-09-10T07:00:00+07:00' }];
  const pages = classicReportPages(rows, date);
  assert.deepEqual(pages.map(page => page.rows.length), [7, 1, 1]);
  assert.deepEqual(pages.map(page => page.rowOffset), [0, 7, 8]);
  assert.deepEqual(pages.flatMap(page => page.rows), rows);
});

test('invalid and missing timestamps retain jobs and use a valid fallback window', () => {
  const rows = [{ id: 'invalid', startTime: 'invalid', endTime: 'invalid' }, { id: 'missing' }];
  assert.deepEqual(classicReportPages(rows, date), [{ rows, rowOffset: 0, windowStart, windowEnd }]);
  const fallback = classicReportPages(rows, 'invalid');
  assert.equal(fallback.length, 1);
  assert.ok(Number.isFinite(Date.parse(fallback[0].windowStart)));
  assert.deepEqual(fallback[0].rows, rows);
  const mixed = [rows[0], ...jobs(8), rows[1], { id: 'later', startTime: '2026-09-10T07:00:00+07:00' }];
  assert.deepEqual(classicReportPages(mixed, date).flatMap(page => page.rows), mixed);
});

test('Classic activity durations use actual modes and exclude cancellations', () => {
  const totals = classicActivityDurations([
    { mode: 'Load', startTime: '2026-09-09T07:00:00+07:00', endTime: '2026-09-09T07:01:00+07:00', duration: '09:00:00' },
    { mode: 'Load', duration: '00:02:00' },
    { mode: 'Load', duration: '02:00:00', status: 'Cancelled' },
    { mode: 'Unload', duration: '00:03:00' },
    { mode: 'Stop vehicle', duration: '00:04:00' },
    { mode: 'Break', duration: '05:00' },
    { mode: 'Park overnight', duration: '06:00:00' },
    { mode: 'Refuel', duration: '00:07:00' },
    { mode: 'Vehicle check', duration: '03:00:00' },
    { mode: 'Finish work', duration: '01:00:00' },
  ]);
  assert.deepEqual(totals, { load: 180, unload: 180, wait: null, break: 300, sleep: 21600, refuel: 420, park: 21840, drive: null });
});

test('unknown activity duration stays unavailable instead of producing a partial total', () => {
  const totals = classicActivityDurations([
    { mode: 'Load', duration: '00:02:00' },
    { mode: 'Load', duration: 'unknown' },
    { mode: 'Stop vehicle', startTime: 'invalid', endTime: null },
    { mode: 'Park overnight', duration: '01:00:00' },
    { mode: 'Unload', status: 'Cancelled' },
  ]);
  assert.equal(totals.load, null);
  assert.equal(totals.wait, null);
  assert.equal(totals.park, null);
  assert.equal(totals.sleep, 3600);
  assert.equal(totals.unload, 0);
  assert.equal(totals.drive, null);
  assert.deepEqual(classicActivityDurations([]), { load: 0, unload: 0, wait: null, break: 0, sleep: 0, refuel: 0, park: 0, drive: null });
});
