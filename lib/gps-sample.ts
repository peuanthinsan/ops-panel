export type DeviceGpsSample = {
  id: string;
  vehicleNumber: string;
  deviceId: string;
  capturedAt: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speedMps?: number | null;
  headingDegrees?: number | null;
};

export const GPS_SYNC_INTERVAL_MS = 60_000;

export function createGpsSampleId(deviceId: string, capturedAt: string) {
  const capturedAtMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedAtMs)) throw new Error('capturedAt must be a valid date');
  const safeDeviceId = deviceId.trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96);
  if (!safeDeviceId) throw new Error('deviceId is required');
  return `GPS-${safeDeviceId}-${capturedAtMs}`;
}
