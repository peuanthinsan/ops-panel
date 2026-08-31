const EARTH_RADIUS_KM = 6371;

export function parseRouteAnchors(value) {
  const url = String(value || '').trim();
  if (!url) return [];
  let parsed;
  try { parsed = new URL(url); } catch { return []; }
  const text = `${parsed.pathname} ${parsed.search}`;
  const matches = [...text.matchAll(/(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/g)]
    .map(match => ({ latitude: Number(match[1]), longitude: Number(match[2]) }));
  const anchors = [];
  const encodedWaypoints = [...text.matchAll(/!1d(-?\d+(?:\.\d+)?)!2d(-?\d+(?:\.\d+)?)/g)]
    .map(match => ({ latitude: Number(match[2]), longitude: Number(match[1]) }));
  for (const match of (encodedWaypoints.length >= 2 ? encodedWaypoints : matches)) {
    const { latitude, longitude } = match;
    if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
      && !anchors.some(point => point.latitude === latitude && point.longitude === longitude)) {
      anchors.push({ latitude, longitude });
    }
  }
  return anchors.slice(0, 50);
}

export function normalizeRoutePath(value, maximumPoints = 2000) {
  if (!Array.isArray(value)) return [];
  const points = [];
  for (const item of value) {
    const latitude = Number(item?.latitude ?? item?.lat);
    const longitude = Number(item?.longitude ?? item?.lng);
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
      || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const previous = points.at(-1);
    if (!previous || previous.latitude !== latitude || previous.longitude !== longitude) {
      points.push({ latitude, longitude });
    }
  }
  const limit = Math.max(2, Math.min(5000, Math.floor(Number(maximumPoints) || 2000)));
  if (points.length <= limit) return points;
  return Array.from({ length: limit }, (_, index) => points[Math.round(index * (points.length - 1) / (limit - 1))]);
}

function toRadians(value) { return value * Math.PI / 180; }

function distanceBetween(a, b) {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}

function distanceToSegment(point, start, end) {
  const latScale = 111.32;
  const lonScale = 111.32 * Math.cos(toRadians((start.latitude + end.latitude + point.latitude) / 3));
  const px = (point.longitude - start.longitude) * lonScale;
  const py = (point.latitude - start.latitude) * latScale;
  const ex = (end.longitude - start.longitude) * lonScale;
  const ey = (end.latitude - start.latitude) * latScale;
  const lengthSquared = ex * ex + ey * ey;
  const ratio = lengthSquared ? Math.max(0, Math.min(1, (px * ex + py * ey) / lengthSquared)) : 0;
  return Math.hypot(px - ex * ratio, py - ey * ratio);
}

export function distanceToRoute(point, anchors) {
  if (!point || !Array.isArray(anchors) || anchors.length < 2) return null;
  let closest = Infinity;
  for (let index = 1; index < anchors.length; index += 1) {
    closest = Math.min(closest, distanceToSegment(point, anchors[index - 1], anchors[index]));
  }
  return Number.isFinite(closest) ? closest : null;
}

export function evaluateRouteDeviation(samples, anchors, { distanceKm = 0.5, durationSeconds = 60 } = {}) {
  if (!Array.isArray(anchors) || anchors.length < 2) {
    return { status: 'no_geometry', maxDistanceKm: 0, longestDurationSeconds: 0, samples: [], checkedSamples: 0, hasGeometry: false };
  }
  const ordered = (Array.isArray(samples) ? samples : [])
    .map(sample => ({
      ...sample,
      latitude: Number(sample.latitude ?? sample.deviceGps?.latitude),
      longitude: Number(sample.longitude ?? sample.deviceGps?.longitude),
      capturedAt: new Date(sample.capturedAt).getTime(),
    }))
    .filter(sample => Number.isFinite(sample.latitude) && Number.isFinite(sample.longitude) && Number.isFinite(sample.capturedAt))
    .sort((a, b) => a.capturedAt - b.capturedAt)
    .map(sample => ({ ...sample, distanceKm: distanceToRoute(sample, anchors) }));
  const thresholdKm = Number(distanceKm);
  const thresholdSeconds = Number(durationSeconds);
  let active = null;
  let longest = null;
  const close = () => {
    if (!active) return;
    const duration = Math.max(0, (active.lastAt - active.firstAt) / 1000);
    const candidate = { ...active, durationSeconds: duration };
    if (!longest || candidate.durationSeconds > longest.durationSeconds) longest = candidate;
    active = null;
  };
  for (const sample of ordered) {
    const offRoute = sample.distanceKm != null && sample.distanceKm > thresholdKm;
    if (!offRoute) { close(); continue; }
    if (active && (sample.capturedAt - active.lastAt) / 1000 > Math.max(120, thresholdSeconds * 2)) close();
    if (!active) active = { firstAt: sample.capturedAt, lastAt: sample.capturedAt, maxDistanceKm: sample.distanceKm, samples: 1 };
    else {
      active.lastAt = sample.capturedAt;
      active.maxDistanceKm = Math.max(active.maxDistanceKm, sample.distanceKm);
      active.samples += 1;
    }
  }
  close();
  return {
    status: longest && longest.durationSeconds >= thresholdSeconds ? 'deviated' : 'within_route',
    maxDistanceKm: longest?.maxDistanceKm ?? 0,
    longestDurationSeconds: longest?.durationSeconds ?? 0,
    samples: ordered.map(sample => ({
      capturedAt: new Date(sample.capturedAt).toISOString(),
      distanceKm: sample.distanceKm,
      offRoute: sample.distanceKm != null && sample.distanceKm > thresholdKm,
    })),
    checkedSamples: ordered.length,
    hasGeometry: Array.isArray(anchors) && anchors.length >= 2,
  };
}
