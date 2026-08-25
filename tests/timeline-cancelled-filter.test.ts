import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { timelineReportMatchesFilters } from '../web/lib/timeline-filter.ts';

const allModes = new Set(['Load', 'Unload']);

test('timeline shows completed jobs and hides cancelled jobs by default', () => {
  const filters = { showCompleted: true, showCancelled: false, selectedModes: allModes };
  assert.equal(timelineReportMatchesFilters({ mode: 'Load', status: 'Completed' }, filters), true);
  assert.equal(timelineReportMatchesFilters({ mode: 'Load', status: 'Cancelled' }, filters), false);
});

test('timeline status checkboxes can include or isolate cancelled jobs', () => {
  const included = { showCompleted: true, showCancelled: true, selectedModes: allModes };
  const cancelledOnly = { showCompleted: false, showCancelled: true, selectedModes: allModes };
  assert.equal(timelineReportMatchesFilters({ mode: 'Load', status: 'Completed' }, included), true);
  assert.equal(timelineReportMatchesFilters({ mode: 'Load', status: 'Cancelled' }, included), true);
  assert.equal(timelineReportMatchesFilters({ mode: 'Load', status: 'Completed' }, cancelledOnly), false);
  assert.equal(timelineReportMatchesFilters({ mode: 'Load', status: 'Cancelled' }, cancelledOnly), true);
});

test('timeline job type checkboxes can combine modes', () => {
  const filters = { showCompleted: true, showCancelled: true, selectedModes: new Set(['Unload']) };
  assert.equal(timelineReportMatchesFilters({ mode: 'Load', status: 'Completed' }, filters), false);
  assert.equal(timelineReportMatchesFilters({ mode: 'Unload', status: 'Cancelled' }, filters), true);
});

test('timeline presents bilingual status and job-type checkbox filters', async () => {
  const source = await readFile(new URL('../web/app/timeline-dashboard.jsx', import.meta.url), 'utf8');
  assert.match(source, /const \[showCompleted, setShowCompleted\] = useState\(true\)/);
  assert.match(source, /const \[showCancelled, setShowCancelled\] = useState\(false\)/);
  assert.match(source, /filterJobs: 'Filter jobs'/);
  assert.match(source, /filterJobs: 'กรองงาน'/);
  assert.match(source, /type="checkbox" checked=\{showCompleted\}/);
  assert.match(source, /type="checkbox" checked=\{showCancelled\}/);
  assert.match(source, /reportableOperations\.map\(action =>/);
  assert.match(source, /params\.append\('timelineMode', mode\)/);
});
