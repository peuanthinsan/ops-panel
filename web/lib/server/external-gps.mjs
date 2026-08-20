import { distanceMeters } from './gps-pairing.mjs';

export const DEFAULT_GPS_PAIR_TOLERANCE_MS = 60_000;

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function finiteNumber(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function valueFromAliases(source, aliases) {
  if (!source) return null;
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(source, alias)) return source[alias];
  }
  const normalized = new Map(Object.entries(source).map(([key, value]) => [key.toLowerCase(), value]));
  for (const alias of aliases) {
    if (normalized.has(alias.toLowerCase())) return normalized.get(alias.toLowerCase());
  }
  return null;
}

function candidateRecords(value) {
  const root = record(value);
  if (!root) return [];
  const candidates = [root];
  for (const key of ['position', 'gps', 'location', 'coordinates']) {
    const nested = record(root[key]);
    if (nested) candidates.push(nested);
  }
  return candidates;
}

function sourceRows(payload) {
  if (Array.isArray(payload)) return payload;
  const root = record(payload);
  if (!root) return [];
  for (const key of ['positions', 'samples', 'items', 'records', 'results', 'data']) {
    if (Array.isArray(root[key])) return root[key];
    const nested = record(root[key]);
    if (nested) {
      for (const nestedKey of ['positions', 'samples', 'items', 'records', 'results']) {
        if (Array.isArray(nested[nestedKey])) return nested[nestedKey];
      }
    }
  }
  return [root];
}

function firstNumber(candidates, aliases) {
  for (const candidate of candidates) {
    const value = finiteNumber(valueFromAliases(candidate, aliases));
    if (value != null) return value;
  }
  return null;
}

function firstDate(candidates, aliases) {
  for (const candidate of candidates) {
    const value = valueFromAliases(candidate, aliases);
    if (value == null || value === '') continue;
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return null;
}

export function normalizeExternalGpsPoint(value) {
  const candidates = candidateRecords(value);
  const latitude = firstNumber(candidates, ['latitude', 'lat']);
  const longitude = firstNumber(candidates, ['longitude', 'lng', 'lon', 'long']);
  const capturedAt = firstDate(candidates, [
    'capturedAt', 'captured_at', 'recordedAt', 'recorded_at', 'timestamp',
    'gpsTime', 'gps_time', 'positionTime', 'position_time', 'deviceTime', 'device_time',
  ]);
  const explicitMps = firstNumber(candidates, ['speedMps', 'speed_mps', 'metersPerSecond']);
  const explicitKph = firstNumber(candidates, ['speedKph', 'speedKmh', 'speed_kph', 'speed_kmh', 'kmh', 'speed']);
  const accuracy = firstNumber(candidates, ['accuracy', 'accuracyM', 'accuracy_m']);
  const headingDegrees = firstNumber(candidates, ['headingDegrees', 'heading', 'course', 'bearing']);
  if (latitude == null || latitude < -90 || latitude > 90
    || longitude == null || longitude < -180 || longitude > 180
    || !capturedAt) return null;
  return {
    capturedAt,
    latitude,
    longitude,
    accuracy: accuracy != null && accuracy >= 0 ? accuracy : null,
    speedMps: explicitMps != null && explicitMps >= 0
      ? explicitMps
      : explicitKph != null && explicitKph >= 0 ? explicitKph / 3.6 : null,
    headingDegrees: headingDegrees != null && headingDegrees >= 0 && headingDegrees <= 360 ? headingDegrees : null,
    raw: value,
  };
}

export function normalizeExternalGpsPoints(payload) {
  return sourceRows(payload)
    .map(normalizeExternalGpsPoint)
    .filter(Boolean)
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
}

export function nearestExternalGpsPoint(payload, targetAt, toleranceMs = DEFAULT_GPS_PAIR_TOLERANCE_MS) {
  const targetMs = Date.parse(targetAt);
  if (!Number.isFinite(targetMs) || !Number.isFinite(toleranceMs) || toleranceMs < 0) return null;
  let nearest = null;
  let nearestDeltaMs = Number.POSITIVE_INFINITY;
  for (const point of normalizeExternalGpsPoints(payload)) {
    const deltaMs = Math.abs(Date.parse(point.capturedAt) - targetMs);
    if (deltaMs < nearestDeltaMs) {
      nearest = point;
      nearestDeltaMs = deltaMs;
    }
  }
  return nearest && nearestDeltaMs <= toleranceMs ? { ...nearest, targetDeltaMs: nearestDeltaMs } : null;
}

export function pairExternalGpsSources(devicePayload, fmsPayload, targetAt, toleranceMs = DEFAULT_GPS_PAIR_TOLERANCE_MS) {
  const deviceGps = nearestExternalGpsPoint(devicePayload, targetAt, toleranceMs);
  if (!deviceGps) return { deviceGps: null, fmsGps: null, pairStatus: 'device_delayed', timeDeltaMs: null, positionDeltaM: null };
  const fmsGps = nearestExternalGpsPoint(fmsPayload, deviceGps.capturedAt, toleranceMs);
  if (!fmsGps) return { deviceGps, fmsGps: null, pairStatus: 'device_only', timeDeltaMs: null, positionDeltaM: null };
  const positionDelta = distanceMeters(deviceGps.latitude, deviceGps.longitude, fmsGps.latitude, fmsGps.longitude);
  return {
    deviceGps,
    fmsGps,
    pairStatus: 'paired',
    timeDeltaMs: Math.abs(Date.parse(fmsGps.capturedAt) - Date.parse(deviceGps.capturedAt)),
    positionDeltaM: positionDelta == null ? null : Math.round(positionDelta * 10) / 10,
  };
}
