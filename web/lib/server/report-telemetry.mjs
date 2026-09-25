import { fetchDataFmFuelHistory } from './data-fm-gps.mjs';

// The caller authenticates the admin and resolves the saved report. Query-string
// vehicle numbers and time windows never determine the upstream request.
export async function getReportTelemetry(report, { env = process.env, fetchHistory = fetchDataFmFuelHistory } = {}) {
  const start = Date.parse(report?.startTime || '');
  const end = Date.parse(report?.endTime || '');
  const vehicleNumber = String(report?.vehicleNumber || '').trim();
  const context = {
    reportId: report?.id,
    fromAt: Number.isFinite(start) ? new Date(start).toISOString() : null,
    toAt: Number.isFinite(end) ? new Date(end).toISOString() : null,
    source: 'data-fm',
    fuelUnit: null,
  };
  if (!vehicleNumber || !Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return { ...context, status: 'unavailable', samples: [], message: 'A saved vehicle and valid report time window are required.' };
  }
  const result = await fetchHistory({
    baseUrl: env.SONGDEE_DATA_FM_BASE_URL || env.FLEET_DATA_FM_BASE_URL,
    username: env.SONGDEE_DATA_FM_USERNAME || env.FLEET_DATA_FM_USERNAME,
    password: env.SONGDEE_DATA_FM_PASSWORD || env.FLEET_DATA_FM_PASSWORD,
    timeZone: env.SONGDEE_DATA_FM_TIME_ZONE || env.FLEET_DATA_FM_TIME_ZONE,
    allowHttp: env.NODE_ENV !== 'production',
    vehicleNumber,
    fromAt: context.fromAt,
    toAt: context.toAt,
  });
  return { ...result, ...context };
}
