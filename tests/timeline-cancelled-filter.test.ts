import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isTimelineReport, timelineReportMatchesFilters } from '../web/lib/timeline-filter.ts';

const allModes = new Set(['Load', 'Unload']);

test('timeline shows completed jobs and hides cancelled jobs by default', () => {
  const filters = { showCompleted: true, showCancelled: false, selectedModes: allModes };
  assert.equal(timelineReportMatchesFilters({ mode: 'Load', status: 'Completed' }, filters), true);
  assert.equal(timelineReportMatchesFilters({ mode: 'Load', status: 'Cancelled' }, filters), false);
});

test('legacy timeline filters cannot reintroduce cancelled jobs', () => {
  const included = { showCompleted: true, showCancelled: true, selectedModes: allModes };
  const cancelledOnly = { showCompleted: false, showCancelled: true, selectedModes: allModes };
  assert.equal(timelineReportMatchesFilters({ mode: 'Load', status: 'Completed' }, included), true);
  assert.equal(timelineReportMatchesFilters({ mode: 'Load', status: 'Cancelled' }, included), false);
  assert.equal(timelineReportMatchesFilters({ mode: 'Load', status: 'Completed' }, cancelledOnly), false);
  assert.equal(timelineReportMatchesFilters({ mode: 'Load', status: 'Cancelled' }, cancelledOnly), false);
});

test('timeline job type checkboxes can combine modes', () => {
  const filters = { showCompleted: true, showCancelled: true, selectedModes: new Set(['Unload']) };
  assert.equal(timelineReportMatchesFilters({ mode: 'Load', status: 'Completed' }, filters), false);
  assert.equal(timelineReportMatchesFilters({ mode: 'Unload', status: 'Completed' }, filters), true);
  assert.equal(timelineReportMatchesFilters({ mode: 'Unload', status: 'Cancelled' }, filters), false);
});

test('vehicle checks remain timeline activities while cancelled refueling is excluded', () => {
  const rows = [
    { mode: 'Vehicle check', status: 'Completed' },
    { mode: 'Refuel', status: 'Cancelled' },
    { mode: 'Refuel', status: 'Completed' },
  ];
  assert.deepEqual(rows.filter(isTimelineReport).map(row => row.mode), ['Vehicle check', 'Refuel']);
  const filters = { selectedModes: new Set(['Vehicle check']) };
  assert.deepEqual(rows.filter(row => timelineReportMatchesFilters(row, filters)).map(row => row.mode), ['Vehicle check']);
});

test('embedded and standalone timelines exclude cancelled jobs and offer job-type filters', async () => {
  const source = await readFile(new URL('../web/app/timeline-dashboard.jsx', import.meta.url), 'utf8');
  assert.match(source, /if \(!isTimelineReport\(report\)\) continue;/);
  assert.match(source, /filterJobs: 'Filter jobs'/);
  assert.match(source, /filterJobs: 'กรองงาน'/);
  assert.doesNotMatch(source, /type="checkbox" checked=\{showCancelled\}/);
  assert.match(source, /reportableOperations\.map\(action =>/);
  assert.match(source, /params\.append\('timelineMode', mode\)/);
});
