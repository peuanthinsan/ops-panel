import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GPS_LOCATION_STACK_RADIUS_METERS,
  groupGpsSamplesByJob,
  normalizeGpsSample,
} from '../web/lib/route-map-data.mjs';

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

test('eight jobs at two truthful locations form two clusters without losing fixes', () => {
  const samples = Array.from({ length: 8 }, (_, index) => ({
    id: `fix-${index + 1}`,
    jobId: `job-${index + 1}`,
    capturedAt: `2026-09-02T04:00:${String(index).padStart(2, '0')}.000Z`,
    deviceGps: {
      latitude: index < 5 ? 13.700001 : 13.800001,
      longitude: index < 5 ? 100.500001 : 100.600001,
      accuracy: index + 1,
      speedMps: index,
      headingDegrees: index * 10,
    },
    pairStatus: index % 2 ? 'paired' : 'device_only',
  }));

  const result = groupGpsSamplesByJob(samples.toReversed(), 'job-7');

  assert.equal(result.locationClusters.length, 2);
  assert.deepEqual(result.locationClusters.map(cluster => cluster.count), [5, 3]);
  assert.deepEqual(result.locationClusters.map(cluster => cluster.jobCount), [5, 3]);
  assert.equal(result.locationClusters.flatMap(cluster => cluster.points).length, 8);
  assert.deepEqual(
    result.locationClusters.flatMap(cluster => cluster.points).map(point => point.sampleId),
    samples.map(point => point.id),
  );
  assert.equal(result.locationClusters[1].selected, true);
  assert.deepEqual(result.locationClusters[1].jobIds, ['job-6', 'job-7', 'job-8']);
  assert.equal(result.locationClusters[0].key, '13.700001,100.500001');
  assert.equal(result.locationClusters[0].id, 'gps-location:13.700001,100.500001');
});

test('location clusters retain chronological job fixes and map-detail metadata', () => {
  const result = groupGpsSamplesByJob([
    {
      id: 'later', jobId: 'job-repeat', capturedAt: '2026-09-02T04:00:10.000Z',
      deviceGps: { latitude: 13.7, longitude: 100.5, accuracy: '4.5', speedMps: '3', headingDegrees: '92' },
      pairStatus: 'paired',
    },
    {
      id: 'earlier', jobId: 'job-repeat', capturedAt: '2026-09-02T04:00:00.000Z',
      deviceGps: { latitude: 13.7, longitude: 100.5, accuracy: null, speedMps: 0, headingDegrees: 0 },
      pairStatus: 'device_only',
    },
  ], 'job-repeat');

  const [cluster] = result.locationClusters;
  assert.equal(cluster.count, 2);
  assert.equal(cluster.jobCount, 1);
  assert.deepEqual(cluster.jobIds, ['job-repeat']);
  assert.equal(cluster.selected, true);
  assert.deepEqual(cluster.points.map(point => point.sampleId), ['earlier', 'later']);
  assert.deepEqual(
    {
      capturedAt: cluster.points[1].capturedAt,
      capturedAtMs: cluster.points[1].capturedAtMs,
      accuracy: cluster.points[1].accuracy,
      speedMps: cluster.points[1].speedMps,
      headingDegrees: cluster.points[1].headingDegrees,
      pairStatus: cluster.points[1].pairStatus,
    },
    {
      capturedAt: '2026-09-02T04:00:10.000Z',
      capturedAtMs: Date.parse('2026-09-02T04:00:10.000Z'),
      accuracy: 4.5,
      speedMps: 3,
      headingDegrees: 92,
      pairStatus: 'paired',
    },
  );
});

test('unlinked fixes count in a location stack but not as linked jobs', () => {
  const result = groupGpsSamplesByJob([
    sample('linked', 'job-linked', '2026-09-02T04:00:00Z', 13.7, 100.5),
    sample('unlinked', null, '2026-09-02T04:00:01Z', 13.7, 100.5),
  ], 'job-linked');

  assert.equal(result.locationClusters.length, 1);
  assert.equal(result.locationClusters[0].count, 2);
  assert.deepEqual(result.locationClusters[0].jobIds, ['job-linked']);
  assert.equal(result.locationClusters[0].jobCount, 1);
  assert.equal(result.locationClusters[0].selected, true);
});

test('nearby non-identical fixes within the visual marker radius share one stack', () => {
  const result = groupGpsSamplesByJob([
    sample('near-a', 'job-a', '2026-09-02T04:00:01Z', 13.700000, 100.500000),
    sample('near-b', 'job-b', '2026-09-02T04:00:00Z', 13.700100, 100.500050),
  ]);

  assert.equal(GPS_LOCATION_STACK_RADIUS_METERS, 20);
  assert.equal(result.locationClusters.length, 1);
  assert.equal(result.locationClusters[0].count, 2);
  assert.deepEqual(result.locationClusters[0].points.map(point => point.sampleId), ['near-b', 'near-a']);
  assert.deepEqual(
    result.locationClusters[0].points.map(point => [point.latitude, point.longitude]),
    [[13.700100, 100.500050], [13.700000, 100.500000]],
  );
  assert.equal(result.locationClusters[0].key, '13.700000,100.500000');
});

test('clearly separate fixes outside the visual marker radius remain distinct', () => {
  const result = groupGpsSamplesByJob([
    sample('far-a', 'job-a', '2026-09-02T04:00:00Z', 13.700000, 100.500000),
    sample('far-b', 'job-b', '2026-09-02T04:00:01Z', 13.700300, 100.500000),
  ]);

  assert.equal(result.locationClusters.length, 2);
  assert.deepEqual(
    result.locationClusters.map(cluster => cluster.key),
    ['13.700000,100.500000', '13.700300,100.500000'],
  );
  assert.deepEqual(result.locationClusters.map(cluster => cluster.count), [1, 1]);
});

test('visual stack anchors and ids are deterministic when provider order changes', () => {
  const fixes = [
    sample('north', 'job-a', '2026-09-02T04:00:02Z', 13.700100, 100.500050),
    sample('anchor', 'job-b', '2026-09-02T04:00:01Z', 13.700000, 100.500000),
    sample('separate', 'job-c', '2026-09-02T04:00:00Z', 13.701000, 100.501000),
  ];

  const forward = groupGpsSamplesByJob(fixes).locationClusters;
  const reversed = groupGpsSamplesByJob(fixes.toReversed()).locationClusters;
  assert.deepEqual(forward.map(cluster => cluster.id), reversed.map(cluster => cluster.id));
  assert.deepEqual(forward.map(cluster => cluster.key), reversed.map(cluster => cluster.key));
});

test('invalid non-string capture times stay sortable without throwing', () => {
  const result = groupGpsSamplesByJob([
    sample('valid', 'job-a', new Date('2026-09-02T04:00:00Z'), 13.7, 100.5),
    sample('invalid', 'job-b', new Date(Number.NaN), 13.8, 100.6),
  ]);

  assert.deepEqual(result.trailPoints.map(point => point.sampleId), ['valid', 'invalid']);
  assert.equal(result.trailPoints[0].capturedAt, '2026-09-02T04:00:00.000Z');
  assert.equal(result.trailPoints[1].capturedAt, null);
  assert.equal(result.trailPoints[1].capturedAtMs, null);
});
