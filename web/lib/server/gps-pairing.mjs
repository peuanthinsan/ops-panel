const EARTH_RADIUS_METERS = 6_371_008.8;

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

function candidateRecords(payload) {
  const root = record(payload);
  if (!root) return [];
  const candidates = [root];
  for (const key of ['position', 'gps', 'location', 'data', 'result']) {
    const nested = record(root[key]);
    if (nested) candidates.push(nested);
  }
  return candidates;
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
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

export function normalizeFmsGpsPayload(payload) {
  const candidates = candidateRecords(payload);
  const latitude = firstNumber(candidates, ['latitude', 'lat']);
  const longitude = firstNumber(candidates, ['longitude', 'lng', 'lon', 'long']);
  const explicitMps = firstNumber(candidates, ['speedMps', 'speed_mps', 'metersPerSecond']);
  const explicitKph = firstNumber(candidates, ['speedKph', 'speedKmh', 'speed_kph', 'speed_kmh', 'kmh']);
  const speedMps = explicitMps != null ? explicitMps : explicitKph != null ? explicitKph / 3.6 : null;
  const capturedAt = firstDate(candidates, ['capturedAt', 'captured_at', 'recordedAt', 'recorded_at', 'timestamp', 'gpsTime']);
  return {
    capturedAt,
    latitude: latitude != null && latitude >= -90 && latitude <= 90 ? latitude : null,
    longitude: longitude != null && longitude >= -180 && longitude <= 180 ? longitude : null,
    speedMps: speedMps != null && speedMps >= 0 ? speedMps : null,
  };
}

export function distanceMeters(leftLatitude, leftLongitude, rightLatitude, rightLongitude) {
  const values = [leftLatitude, leftLongitude, rightLatitude, rightLongitude].map(finiteNumber);
  if (values.some(value => value == null)) return null;
  const [lat1, lon1, lat2, lon2] = values;
  const radians = degrees => degrees * Math.PI / 180;
  const latitudeDelta = radians(lat2 - lat1);
  const longitudeDelta = radians(lon2 - lon1);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function gpsPairingMetadata(device, fmsStatus, fmsPayload) {
  const normalized = normalizeFmsGpsPayload(fmsPayload);
  const deviceCapturedAt = new Date(device.capturedAt);
  const fmsCapturedAt = normalized.capturedAt ? new Date(normalized.capturedAt) : null;
  const timeDeltaMs = Number.isFinite(deviceCapturedAt.getTime()) && fmsCapturedAt && Number.isFinite(fmsCapturedAt.getTime())
    ? Math.abs(fmsCapturedAt.getTime() - deviceCapturedAt.getTime())
    : null;
  const positionDeltaM = normalized.latitude != null && normalized.longitude != null
    ? distanceMeters(device.latitude, device.longitude, normalized.latitude, normalized.longitude)
    : null;
  const pairStatus = fmsStatus === 'received'
    ? positionDeltaM == null ? 'fms_received' : 'paired'
    : fmsStatus === 'not_configured' ? 'device_only' : 'fms_delayed';
  return {
    pairStatus,
    fmsCapturedAt: normalized.capturedAt,
    fmsLatitude: normalized.latitude,
    fmsLongitude: normalized.longitude,
    fmsSpeedMps: normalized.speedMps,
    positionDeltaM: positionDeltaM == null ? null : Math.round(positionDeltaM * 10) / 10,
    timeDeltaMs,
  };
}
