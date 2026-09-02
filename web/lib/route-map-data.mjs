const UNKNOWN_JOB_ID = '__unassigned_gps__';

// A 20 m radius absorbs ordinary GPS jitter beneath a map dot at street-level
// zoom without combining distinct nearby stops. Raw fix coordinates stay intact.
export const GPS_LOCATION_STACK_RADIUS_METERS = 20;
const EARTH_RADIUS_METERS = 6_371_008.8;

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

function optionalNumber(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function capturedAtIso(value) {
  if (value == null || String(value).trim() === '') return null;
  if (typeof value === 'string') return value;
  const timestamp = capturedAtValue(value);
  return timestamp == null ? null : new Date(timestamp).toISOString();
}

function locationKey(point) {
  return `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`;
}

function radians(value) {
  return value * Math.PI / 180;
}

function distanceMeters(left, right) {
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const leftLatitude = radians(left.latitude);
  const rightLatitude = radians(right.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)));
}

function compareGpsPoints(left, right) {
  if (left.capturedAtMs == null && right.capturedAtMs == null) return left.sourceIndex - right.sourceIndex;
  if (left.capturedAtMs == null) return 1;
  if (right.capturedAtMs == null) return -1;
  return left.capturedAtMs - right.capturedAtMs || left.sourceIndex - right.sourceIndex;
}

function compareGpsLocations(left, right) {
  return left.latitude - right.latitude
    || left.longitude - right.longitude
    || compareGpsPoints(left, right)
    || left.sampleId.localeCompare(right.sampleId);
}

export function normalizeGpsSample(sample) {
  const latitude = coordinate(sample?.deviceGps?.latitude ?? sample?.latitude ?? sample?.lat);
  const longitude = coordinate(sample?.deviceGps?.longitude ?? sample?.longitude ?? sample?.lng);
  if (latitude == null || longitude == null) return null;

  const suppliedJobId = String(sample?.jobId ?? sample?.reportId ?? '').trim();
  const jobId = suppliedJobId || UNKNOWN_JOB_ID;
  const rawCapturedAt = sample?.capturedAt;
  return {
    latitude,
    longitude,
    capturedAt: capturedAtIso(rawCapturedAt),
    capturedAtMs: capturedAtValue(rawCapturedAt),
    jobId,
    sampleId: String(sample?.id || ''),
    accuracy: optionalNumber(sample?.deviceGps?.accuracy ?? sample?.accuracy),
    speedMps: optionalNumber(sample?.deviceGps?.speedMps ?? sample?.speedMps),
    headingDegrees: optionalNumber(sample?.deviceGps?.headingDegrees ?? sample?.headingDegrees),
    pairStatus: String(sample?.pairStatus || '').trim() || null,
  };
}

function groupGpsPointsByLocation(points, selectedJobId) {
  const clusters = [];

  // Coordinate ordering makes the anchor and cluster id deterministic even when
  // the provider returns the same fixes in a different order.
  for (const point of points.toSorted(compareGpsLocations)) {
    let closestCluster = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const cluster of clusters) {
      const distance = distanceMeters(cluster, point);
      if (distance <= GPS_LOCATION_STACK_RADIUS_METERS && distance < closestDistance) {
        closestCluster = cluster;
        closestDistance = distance;
      }
    }

    if (closestCluster) {
      closestCluster.points.push(point);
      continue;
    }

    const key = locationKey(point);
    clusters.push({
      id: `gps-location:${key}`,
      key,
      latitude: point.latitude,
      longitude: point.longitude,
      points: [point],
    });
  }

  return clusters.map(cluster => {
    const chronologicalPoints = cluster.points.toSorted(compareGpsPoints);
    const jobIds = [...new Set(
      chronologicalPoints
        .map(point => point.jobId)
        .filter(jobId => jobId !== UNKNOWN_JOB_ID),
    )];
    return {
      ...cluster,
      points: chronologicalPoints,
      count: chronologicalPoints.length,
      jobIds,
      jobCount: jobIds.length,
      selected: Boolean(selectedJobId) && chronologicalPoints.some(point => point.jobId === selectedJobId),
    };
  }).toSorted((left, right) => compareGpsPoints(left.points[0], right.points[0]) || left.key.localeCompare(right.key));
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
  const chronologicalPoints = trailPoints.toSorted(compareGpsPoints);

  return {
    groups: orderedGroups,
    points,
    trailPoints: chronologicalPoints,
    locationClusters: groupGpsPointsByLocation(chronologicalPoints, selectedId),
    jobCount: orderedGroups.filter(group => group.linked).length,
    pointCount: points.length,
    selectedPointCount,
  };
}
