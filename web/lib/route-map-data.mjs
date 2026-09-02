const UNKNOWN_JOB_ID = '__unassigned_gps__';

function coordinate(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function capturedAtValue(value) {
  if (value == null || String(value).trim() === '') return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareGpsPoints(left, right) {
  if (left.capturedAt == null && right.capturedAt == null) return left.sourceIndex - right.sourceIndex;
  if (left.capturedAt == null) return 1;
  if (right.capturedAt == null) return -1;
  return left.capturedAt - right.capturedAt || left.sourceIndex - right.sourceIndex;
}

export function normalizeGpsSample(sample) {
  const latitude = coordinate(sample?.deviceGps?.latitude ?? sample?.latitude ?? sample?.lat);
  const longitude = coordinate(sample?.deviceGps?.longitude ?? sample?.longitude ?? sample?.lng);
  if (latitude == null || longitude == null) return null;

  const suppliedJobId = String(sample?.jobId ?? sample?.reportId ?? '').trim();
  const jobId = suppliedJobId || UNKNOWN_JOB_ID;
  return {
    latitude,
    longitude,
    capturedAt: capturedAtValue(sample?.capturedAt),
    jobId,
    sampleId: String(sample?.id || ''),
  };
}

export function groupGpsSamplesByJob(samples = [], selectedJobId = '') {
  const selectedId = String(selectedJobId || '').trim();
  const groupsByJob = new Map();
  const trailPoints = [];

  for (let index = 0; index < samples.length; index += 1) {
    const point = normalizeGpsSample(samples[index]);
    if (!point) continue;
    const entry = { ...point, sourceIndex: index };
    trailPoints.push(entry);
    const group = groupsByJob.get(entry.jobId) || { jobId: entry.jobId, points: [] };
    group.points.push(entry);
    groupsByJob.set(entry.jobId, group);
  }

  const groups = [...groupsByJob.values()].map(group => ({
    ...group,
    linked: group.jobId !== UNKNOWN_JOB_ID,
    selected: Boolean(selectedId) && group.jobId === selectedId,
    points: group.points.toSorted(compareGpsPoints),
  }));
  const orderedGroups = [
    ...groups.filter(group => !group.selected),
    ...groups.filter(group => group.selected),
  ];
  const points = orderedGroups.flatMap(group => group.points);
  const selectedPointCount = orderedGroups.find(group => group.selected)?.points.length || 0;

  return {
    groups: orderedGroups,
    points,
    trailPoints: trailPoints.toSorted(compareGpsPoints),
    jobCount: orderedGroups.filter(group => group.linked).length,
    pointCount: points.length,
    selectedPointCount,
  };
}
