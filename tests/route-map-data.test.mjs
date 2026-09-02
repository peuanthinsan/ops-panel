import assert from 'node:assert/strict';
import test from 'node:test';
import { groupGpsSamplesByJob, normalizeGpsSample } from '../web/lib/route-map-data.mjs';

function sample(id, jobId, capturedAt, latitude, longitude) {
  return { id, jobId, capturedAt, deviceGps: { latitude, longitude } };
}

test('work-period GPS points stay grouped by job and the selected job is drawn last', () => {
  const result = groupGpsSamplesByJob([
    sample('selected-late', 'job-selected', '2026-09-02T04:00:20Z', 13.72, 100.52),
    sample('other', 'job-other', '2026-09-02T04:00:10Z', 13.71, 100.51),
    sample('selected-early', 'job-selected', '2026-09-02T04:00:00Z', 13.70, 100.50),
  ], 'job-selected');

  assert.deepEqual(result.groups.map(group => group.jobId), ['job-other', 'job-selected']);
  assert.equal(result.groups.at(-1).selected, true);
  assert.deepEqual(result.groups.at(-1).points.map(point => point.sampleId), ['selected-early', 'selected-late']);
  assert.deepEqual(result.trailPoints.map(point => point.sampleId), ['selected-early', 'other', 'selected-late']);
  assert.equal(result.jobCount, 2);
  assert.equal(result.pointCount, 3);
  assert.equal(result.selectedPointCount, 2);
});

test('the work-period trail is chronological across one-point jobs and stable for missing timestamps', () => {
  const result = groupGpsSamplesByJob([
    sample('unknown-time-a', 'job-c', null, 13.74, 100.54),
    sample('finish', 'job-finish', '2026-09-02T04:00:30Z', 13.73, 100.53),
    sample('load', 'job-load', '2026-09-02T04:00:00Z', 13.70, 100.50),
    sample('unload', 'job-unload', '2026-09-02T04:00:20Z', 13.72, 100.52),
    sample('unknown-time-b', 'job-d', 'not-a-date', 13.75, 100.55),
  ], 'job-unload');

  assert.deepEqual(
    result.trailPoints.map(point => point.sampleId),
    ['load', 'unload', 'finish', 'unknown-time-a', 'unknown-time-b'],
  );
  assert.equal(result.groups.every(group => group.points.length === 1), true);
  assert.equal(result.selectedPointCount, 1);
});

test('unlinked and invalid points never become selected-job points', () => {
  const result = groupGpsSamplesByJob([
    sample('selected', 'job-selected', '2026-09-02T04:00:00Z', 13.70, 100.50),
    sample('unlinked', null, '2026-09-02T04:00:05Z', 13.71, 100.51),
    sample('missing-latitude', 'job-selected', '2026-09-02T04:00:10Z', null, 100.52),
    sample('empty-longitude', 'job-selected', '2026-09-02T04:00:15Z', 13.72, ''),
  ], 'job-selected');

  assert.equal(result.pointCount, 2);
  assert.equal(result.selectedPointCount, 1);
  assert.equal(result.jobCount, 1);
  assert.equal(result.groups.filter(group => group.selected).length, 1);
  const unlinkedGroup = result.groups.find(group => !group.selected);
  assert.equal(unlinkedGroup.linked, false);
  assert.equal(unlinkedGroup.points[0].sampleId, 'unlinked');
  assert.equal(normalizeGpsSample({ deviceGps: { latitude: undefined, longitude: 100.5 } }), null);
});

test('a single selected GPS point remains a renderable group', () => {
  const result = groupGpsSamplesByJob([
    sample('only-fix', 'job-selected', '2026-09-02T04:00:00Z', '13.7001', '100.5001'),
  ], 'job-selected');

  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].points.length, 1);
  assert.deepEqual(
    { latitude: result.groups[0].points[0].latitude, longitude: result.groups[0].points[0].longitude },
    { latitude: 13.7001, longitude: 100.5001 },
  );
});
