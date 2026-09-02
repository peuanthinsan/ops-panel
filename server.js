import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHttpAdapterUrl } from './lib/adapter-url.mjs';
import { songdeeApiHealth } from './lib/api-contract.mjs';
import { queryLocalDeviceJobs } from './lib/device-job-history.mjs';
import { localReportFacets, queryLocalReports } from './lib/local-report-query.mjs';
import { fetchDataFmDriverIdentity, fetchDataFmGpsHistory } from './web/lib/server/data-fm-gps.mjs';
import { DEFAULT_GPS_PAIR_TOLERANCE_MS, pairExternalGpsSources } from './web/lib/server/external-gps.mjs';
import { evaluateRouteDeviation, normalizeRoutePath, parseRouteAnchors } from './web/lib/route-deviation.mjs';
import { createServerJobId } from './web/lib/server/job-id.mjs';
import { annotateWorkPeriods } from './web/lib/work-periods.mjs';

const port = process.env.PORT || 4000;
const maximumJsonBodyBytes = 64 * 1024;
const seedReports = [
  { id: 'OPS-1042', vehicleNumber: '74-1286', deviceId: 'demo-android-001', driverName: 'Somchai Prasert', driverId: 'DRV-0142', mode: 'Load', startTime: '2026-08-18T08:14:00+07:00', endTime: '2026-08-18T09:02:00+07:00', duration: '48:00', gps: 'No GPS point', status: 'Completed', gpsLookupStatus: 'no_data', gpsLookupMessage: 'No GPS point has been matched yet.' },
  { id: 'OPS-1041', vehicleNumber: '74-2219', deviceId: 'demo-android-002', driverName: 'Narin Suksan', driverId: 'DRV-0098', mode: 'Unload', startTime: '2026-08-18T07:46:00+07:00', endTime: '2026-08-18T08:31:00+07:00', duration: '45:00', gps: 'No GPS point', status: 'Completed', gpsLookupStatus: 'no_data', gpsLookupMessage: 'No GPS point has been matched yet.' },
  { id: 'OPS-1040', vehicleNumber: '74-0904', deviceId: 'demo-android-003', driverName: 'Preecha K.', driverId: 'DRV-0215', mode: 'Refuel', startTime: '2026-08-18T07:18:00+07:00', endTime: '2026-08-18T07:32:00+07:00', duration: '14:00', gps: 'No GPS point', status: 'Completed', gpsLookupStatus: 'no_data', gpsLookupMessage: 'No GPS point has been matched yet.' }
];
const allowedModes = new Set(['Load', 'Stop vehicle', 'Unload', 'Break', 'Vehicle check', 'Refuel', 'Vehicle wash', 'Park overnight', 'Finish work']);
function validRequiredText(value, maxLength) {
  const result = String(value || '').trim();
  return result && result.length <= maxLength ? result : null;
}
function optionalText(value, maxLength) {
  const result = String(value || '').trim();
  return result || null;
}
function formatDurationMs(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
const dataFile = process.env.SONGDEE_DATA_FILE
  ? path.resolve(process.env.SONGDEE_DATA_FILE)
  : path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'songdee-data.json');
function loadState() {
  try { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); } catch { return {}; }
}
const stored = loadState();
const reports = Array.isArray(stored.reports) ? stored.reports : [...seedReports];
const activeJobs = Array.isArray(stored.activeJobs) ? stored.activeJobs : [];
const jobRoutes = Array.isArray(stored.jobRoutes) ? stored.jobRoutes : [];
const workPeriodRoutes = Array.isArray(stored.workPeriodRoutes) ? stored.workPeriodRoutes : [];
let routeDeviationSettings = stored.routeDeviationSettings || { distanceKm: 0.5, durationSeconds: 60 };
const deviceBindings = Array.isArray(stored.deviceBindings) ? stored.deviceBindings : [];
const bindingHistory = Array.isArray(stored.bindingHistory)
  ? stored.bindingHistory
  : deviceBindings.map(binding => ({ ...binding, boundAt: new Date(0).toISOString(), unboundAt: null }));
let deviceConfig = stored.deviceConfig || deviceBindings[0] || null;
let driverIdentity = stored.driverIdentity || null;
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) { return `scrypt:${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`; }
function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128) return false;
  try { const [, salt, expectedHex] = String(encoded).split(':'); const actual = crypto.scryptSync(password, salt, 64); const expected = Buffer.from(expectedHex, 'hex'); return expected.length === actual.length && crypto.timingSafeEqual(actual, expected); } catch { return false; }
}
let adminPasswordHash = stored.adminPasswordHash || hashPassword(process.env.SONGDEE_ADMIN_PASSWORD || 'songdee-setup');
const adminSessions = new Map();
const adminSessionLifetimeMs = 12 * 60 * 60 * 1000;
const driverIdentityApiUrl = process.env.SONGDEE_DRIVER_IDENTITY_API_URL || '';
const gpsMotionApiUrl = process.env.SONGDEE_GPS_MOTION_API_URL || '';
const deviceGpsApiUrl = process.env.SONGDEE_DEVICE_GPS_API_URL || '';
const deviceGpsApiToken = process.env.SONGDEE_DEVICE_GPS_API_TOKEN || '';
const fmsGpsApiUrl = process.env.SONGDEE_FMS_GPS_API_URL || gpsMotionApiUrl;
const fmsGpsApiToken = process.env.SONGDEE_FMS_GPS_API_TOKEN || '';
const dataFmOptions = {
  baseUrl: process.env.SONGDEE_DATA_FM_BASE_URL || process.env.FLEET_DATA_FM_BASE_URL,
  username: process.env.SONGDEE_DATA_FM_USERNAME || process.env.FLEET_DATA_FM_USERNAME,
  password: process.env.SONGDEE_DATA_FM_PASSWORD || process.env.FLEET_DATA_FM_PASSWORD,
  timeZone: process.env.SONGDEE_DATA_FM_TIME_ZONE || process.env.FLEET_DATA_FM_TIME_ZONE,
  allowHttp: true,
};
const dataFmEnvironmentSelected = Boolean(dataFmOptions.username || dataFmOptions.password);
const saveState = () => {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const temporaryFile = `${dataFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify({ reports, activeJobs, jobRoutes, workPeriodRoutes, routeDeviationSettings, deviceBindings, bindingHistory, deviceConfig, driverIdentity, gpsSyncSamples, adminPasswordHash }, null, 2));
  fs.renameSync(temporaryFile, dataFile);
};
function openBindingHistory(binding, boundAt = new Date().toISOString()) {
  if (bindingHistory.some(item => item.deviceId === binding.deviceId && item.vehicleNumber === binding.vehicleNumber && !item.unboundAt)) return;
  bindingHistory.push({ ...binding, boundAt, unboundAt: null });
}
function closeBindingHistory(deviceId, unboundAt = new Date().toISOString()) {
  for (let index = bindingHistory.length - 1; index >= 0; index -= 1) {
    if (bindingHistory[index].deviceId === deviceId && !bindingHistory[index].unboundAt) {
      bindingHistory[index].unboundAt = unboundAt;
      return;
    }
  }
}
function wasBindingValidAt(deviceId, vehicleNumber, occurredAtMs) {
  const matchingHistory = bindingHistory.filter(item => item.deviceId === deviceId && item.vehicleNumber === vehicleNumber);
  if (!matchingHistory.length) return deviceBindings.some(item => item.deviceId === deviceId && item.vehicleNumber === vehicleNumber);
  return matchingHistory.some(item => {
    const boundAtMs = Date.parse(item.boundAt);
    const unboundAtMs = item.unboundAt ? Date.parse(item.unboundAt) : Number.POSITIVE_INFINITY;
    return Number.isFinite(boundAtMs) && occurredAtMs >= boundAtMs && occurredAtMs < unboundAtMs;
  });
}
function sameJobStart(existing, input) {
  return existing.vehicleNumber === input.vehicleNumber
    && existing.deviceId === input.deviceId
    && existing.mode === input.mode
    && existing.startTime === input.startTime
    && (existing.driverName || null) === input.driverName
    && (existing.driverId || null) === input.driverId;
}
function removeActiveJob(id) {
  const index = activeJobs.findIndex(item => item.id === id);
  if (index >= 0) activeJobs.splice(index, 1);
}
function isCancelledReport(report) { return report.status === 'Cancelled'; }
function gpsLookupState(reconciliation) {
  const deviceSource = reconciliation?.deviceSource || {};
  if (reconciliation?.gpsSync) {
    if (reconciliation.pairStatus === 'paired') return { status: 'paired', gps: 'GPS paired', message: 'GPS points matched by time.' };
    if (reconciliation.pairStatus === 'fms_delayed') return { status: 'partial', gps: 'GPS partially paired', message: deviceSource.message || 'GPS was found; FMS coverage is partial.' };
    return { status: 'device_only', gps: 'GPS matched', message: deviceSource.message || 'GPS point matched.' };
  }
  if (deviceSource.status === 'no_time_match' || deviceSource.status === 'received') return { status: 'no_data', gps: 'No GPS point', message: deviceSource.message || 'No GPS point was found inside the time window.' };
  if (deviceSource.status === 'not_configured') return { status: 'lookup_unavailable', gps: 'GPS unavailable', message: deviceSource.message || 'GPS lookup is not configured.' };
  return { status: 'lookup_failed', gps: 'GPS lookup failed', message: deviceSource.message || 'GPS lookup failed.' };
}
function applyGpsLookupResult(report, reconciliation) {
  const state = gpsLookupState(reconciliation);
  const providerDriverName = String(reconciliation?.driverIdentity?.driverName || '').trim().slice(0, 180) || null;
  const providerDriverId = String(reconciliation?.driverIdentity?.driverId || '').trim().slice(0, 180) || null;
  report.status = 'Completed';
  report.gps = state.gps;
  report.gpsLookupStatus = state.status;
  report.gpsLookupMessage = state.message;
  if (!report.driverName && providerDriverName) report.driverName = providerDriverName;
  if (!report.driverId && providerDriverId) report.driverId = providerDriverId;
  delete report.gpsSyncStatus;
  delete report.gpsSyncMessage;
}
const gpsSyncSamples = Array.isArray(stored.gpsSyncSamples) ? stored.gpsSyncSamples : [];
function reportWithGpsSummary(report) {
  const startTimeMs = Date.parse(report.startTime);
  const endTimeMs = Date.parse(report.endTime);
  const samples = gpsSyncSamples.filter(sample => {
    const capturedAtMs = Date.parse(sample.capturedAt);
    return sample.jobId === report.id || (
      !sample.jobId
      && sample.vehicleNumber === report.vehicleNumber
      && sample.deviceId === report.deviceId
      && Number.isFinite(capturedAtMs)
      && capturedAtMs >= startTimeMs
      && capturedAtMs <= endTimeMs
    );
  }).sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  const lastSample = samples[0];
  const offsets = samples
    .filter(sample => sample.positionDeltaM != null)
    .map(sample => Number(sample.positionDeltaM))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const middle = Math.floor(offsets.length / 2);
  const medianPositionDeltaM = offsets.length
    ? offsets.length % 2 ? offsets[middle] : (offsets[middle - 1] + offsets[middle]) / 2
    : null;
  return {
    ...report,
    deviceGpsSamples: samples.length,
    fmsGpsSamples: samples.filter(sample => sample.fmsStatus === 'received').length,
    pairedGpsSamples: samples.filter(sample => sample.pairStatus === 'paired').length,
    attentionGpsSamples: samples.filter(sample => ['device_only', 'fms_delayed', 'fms_received'].includes(sample.pairStatus)).length,
    lastDeviceLatitude: lastSample?.deviceGps?.latitude ?? null,
    lastDeviceLongitude: lastSample?.deviceGps?.longitude ?? null,
    lastFmsLatitude: lastSample?.fmsNormalized?.latitude ?? null,
    lastFmsLongitude: lastSample?.fmsNormalized?.longitude ?? null,
    lastGpsCapturedAt: lastSample?.capturedAt ?? null,
    medianPositionDeltaM,
  };
}
function matchesGpsSample(sample, input) {
  return sample.vehicleNumber === input.vehicleNumber
    && sample.deviceId === input.deviceId
    && sample.capturedAt === input.capturedAt
    && sample.deviceGps?.latitude === input.latitude
    && sample.deviceGps?.longitude === input.longitude
    && sample.deviceGps?.accuracy === input.accuracy
    && (sample.deviceGps?.speedMps ?? null) === input.speedMps
    && (sample.deviceGps?.headingDegrees ?? null) === input.headingDegrees;
}

function findJobIdForSample(vehicleNumber, deviceId, capturedAtMs) {
  const active = activeJobs.filter(job => job.vehicleNumber === vehicleNumber
    && job.deviceId === deviceId
    && Date.parse(job.startTime) <= capturedAtMs)
    .sort((left, right) => Date.parse(right.startTime) - Date.parse(left.startTime))[0];
  if (active) return active.id;
  const completed = reports.filter(report => report.vehicleNumber === vehicleNumber
    && report.deviceId === deviceId
    && capturedAtMs >= Date.parse(report.startTime)
    && capturedAtMs <= Date.parse(report.endTime))
    .sort((left, right) => Date.parse(right.startTime) - Date.parse(left.startTime))[0];
  return completed?.id || null;
}

function linkGpsSamplesToJob(job, endTime = null) {
  const startTimeMs = Date.parse(job.startTime);
  const endTimeMs = endTime ? Date.parse(endTime) : Date.now();
  for (const sample of gpsSyncSamples) {
    const capturedAtMs = Date.parse(sample.capturedAt);
    if (!sample.jobId
      && sample.vehicleNumber === job.vehicleNumber
      && sample.deviceId === job.deviceId
      && capturedAtMs >= startTimeMs
      && capturedAtMs <= endTimeMs) sample.jobId = job.id;
  }
}
function configuredGpsPairToleranceMs() {
  const configured = Number(process.env.SONGDEE_GPS_PAIR_TOLERANCE_SECONDS);
  return Number.isFinite(configured) && configured > 0 && configured <= 900
    ? Math.round(configured * 1000)
    : DEFAULT_GPS_PAIR_TOLERANCE_MS;
}

async function fetchExternalGpsSource({ endpoint, token, sourceName, vehicleNumber, targetAt, toleranceMs }) {
  if (!endpoint) return { status: 'not_configured', payload: null, message: `${sourceName} adapter is not configured.` };
  const upstream = parseHttpAdapterUrl(endpoint);
  if (!upstream) return { status: 'unavailable', payload: null, message: `${sourceName} adapter URL is invalid.` };
  const targetMs = Date.parse(targetAt);
  upstream.searchParams.set('vehicleNumber', vehicleNumber);
  upstream.searchParams.set('capturedAt', targetAt);
  upstream.searchParams.set('from', new Date(targetMs - toleranceMs).toISOString());
  upstream.searchParams.set('to', new Date(targetMs + toleranceMs).toISOString());
  try {
    const response = await fetch(upstream, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { status: 'unavailable', payload: null, message: `${sourceName} API returned HTTP ${response.status}.` };
    return { status: 'received', payload: await response.json(), message: `${sourceName} response received.` };
  } catch {
    return { status: 'unavailable', payload: null, message: `${sourceName} API unavailable.` };
  }
}

async function fetchDeviceGpsSource({ vehicleNumber, targetAt, toleranceMs }) {
  if (dataFmEnvironmentSelected) {
    return fetchDataFmGpsHistory({ ...dataFmOptions, vehicleNumber, targetAt, toleranceMs });
  }
  return fetchExternalGpsSource({ endpoint: deviceGpsApiUrl, token: deviceGpsApiToken, sourceName: 'GPS device server', vehicleNumber, targetAt, toleranceMs });
}

async function reconcileExternalGpsForJob(job, targetAt) {
  const toleranceMs = configuredGpsPairToleranceMs();
  const [deviceSource, fmsSource] = await Promise.all([
    fetchDeviceGpsSource({ vehicleNumber: job.vehicleNumber, targetAt, toleranceMs }),
    fetchExternalGpsSource({ endpoint: fmsGpsApiUrl, token: fmsGpsApiToken, sourceName: 'Howen FMS GPS', vehicleNumber: job.vehicleNumber, targetAt, toleranceMs }),
  ]);
  const pairing = pairExternalGpsSources(deviceSource.payload, fmsSource.payload, targetAt, toleranceMs);
  if (!pairing.deviceGps) {
    const deviceStatus = deviceSource.status === 'received' ? 'no_time_match' : deviceSource.status;
    return {
      gpsSync: null,
      driverIdentity: deviceSource.driverIdentity || null,
      deviceSource: { status: deviceStatus, message: deviceStatus === 'no_time_match' ? deviceSource.message || 'No GPS fix was found inside the time window.' : deviceSource.message },
      fmsSource: { status: fmsSource.status, message: fmsSource.message },
      pairStatus: pairing.pairStatus,
      toleranceMs,
    };
  }
  const deviceGps = pairing.deviceGps;
  const fmsGps = pairing.fmsGps;
  const fmsStatus = fmsGps ? 'received' : fmsSource.status === 'received' ? 'unavailable' : fmsSource.status;
  const pairStatus = fmsGps ? 'paired' : fmsStatus === 'not_configured' ? 'device_only' : 'fms_delayed';
  const sampleId = `GPS-${crypto.createHash('sha256').update(`${job.id}\0${deviceGps.capturedAt}`).digest('hex').slice(0, 40)}`;
  const existing = gpsSyncSamples.find(sample => sample.id === sampleId);
  const sample = existing || { id: sampleId };
  const preserveReceivedFms = existing?.fmsStatus === 'received' && fmsStatus !== 'received';
  Object.assign(sample, {
    jobId: job.id,
    vehicleNumber: job.vehicleNumber,
    deviceId: job.deviceId,
    capturedAt: deviceGps.capturedAt,
    deviceGps: {
      latitude: deviceGps.latitude,
      longitude: deviceGps.longitude,
      accuracy: deviceGps.accuracy,
      speedMps: deviceGps.speedMps,
      headingDegrees: deviceGps.headingDegrees,
    },
  });
  if (!preserveReceivedFms) Object.assign(sample, {
    fmsGps: fmsGps?.raw || null,
    fmsNormalized: fmsGps ? { capturedAt: fmsGps.capturedAt, latitude: fmsGps.latitude, longitude: fmsGps.longitude, speedMps: fmsGps.speedMps } : null,
    fmsStatus,
    fmsMessage: fmsGps ? 'Time-matched Howen FMS sample received.' : fmsSource.status === 'received' ? 'Howen FMS returned no fix inside the time window.' : fmsSource.message,
    pairStatus,
    positionDeltaM: pairing.positionDeltaM,
    timeDeltaMs: pairing.timeDeltaMs,
    syncedAt: new Date().toISOString(),
  });
  if (!existing) gpsSyncSamples.unshift(sample);
  if (gpsSyncSamples.length > 10000) gpsSyncSamples.length = 10000;
  saveState();
  return {
    gpsSync: sample,
    driverIdentity: deviceSource.driverIdentity || null,
    deviceSource: { status: deviceSource.status, message: deviceSource.message },
    fmsSource: { status: fmsSource.status, message: fmsSource.message },
    pairStatus,
    toleranceMs,
  };
}
function gpsSampleResponse(sample, fallbackJobId = null) {
  return {
    id: sample.id,
    jobId: sample.jobId || fallbackJobId,
    capturedAt: sample.capturedAt,
    deviceGps: sample.deviceGps,
    fmsGps: sample.fmsStatus === 'received' ? sample.fmsNormalized || null : null,
    fmsStatus: sample.fmsStatus,
    fmsMessage: sample.fmsMessage,
    positionDeltaM: sample.positionDeltaM ?? null,
    timeDeltaMs: sample.timeDeltaMs ?? null,
    pairStatus: sample.pairStatus || (sample.fmsStatus === 'received' ? 'fms_received' : sample.fmsStatus === 'not_configured' ? 'device_only' : 'fms_delayed'),
    syncedAt: sample.syncedAt,
  };
}

function gpsPage(searchParams) {
  const pageSize = Math.min(200, Math.max(1, Math.trunc(Number(searchParams.get('pageSize'))) || 100));
  const page = Math.max(1, Math.trunc(Number(searchParams.get('page'))) || 1);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function jobGpsDetail(report, searchParams) {
  const { page, pageSize, offset } = gpsPage(searchParams);
  const summaryReport = reportWithGpsSummary(report);
  const samples = gpsSyncSamples.filter(sample => sample.jobId === report.id || (
    !sample.jobId
    && sample.vehicleNumber === report.vehicleNumber
    && sample.deviceId === report.deviceId
    && Date.parse(sample.capturedAt) >= Date.parse(report.startTime)
    && Date.parse(sample.capturedAt) <= Date.parse(report.endTime)
  )).sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  const pageSamples = samples.slice(offset, offset + pageSize).map(sample => gpsSampleResponse(sample, report.id));
  const route = report.routeName
    ? jobRoutes.find(item => item.routeName.toLowerCase() === report.routeName.toLowerCase()) || null
    : null;
  const routeDeviation = route ? evaluateRouteDeviation(samples, route.anchors, routeDeviationSettings) : null;
  return {
    report,
    gpsSummary: {
      deviceSamples: summaryReport.deviceGpsSamples,
      fmsSamples: summaryReport.fmsGpsSamples,
      pairedSamples: summaryReport.pairedGpsSamples,
      attentionSamples: summaryReport.attentionGpsSamples,
      lastCapturedAt: summaryReport.lastGpsCapturedAt,
      medianPositionDeltaM: summaryReport.medianPositionDeltaM,
    },
    samples: pageSamples,
    route,
    routeDeviation,
    routeDeviationSettings,
    pageInfo: {
      page,
      pageSize,
      total: samples.length,
      totalPages: Math.max(1, Math.ceil(samples.length / pageSize)),
      start: pageSamples.length ? offset + 1 : 0,
      end: offset + pageSamples.length,
    },
  };
}

function workPeriodGpsDetail(reportId, searchParams) {
  const annotated = annotateWorkPeriods(reports);
  const anchorReport = annotated.find(report => report.id === reportId);
  if (!anchorReport) return null;
  const periodReports = annotated
    .filter(report => report.workPeriodId === anchorReport.workPeriodId && sameVehicle(report.vehicleNumber, anchorReport.vehicleNumber))
    .sort((left, right) => Date.parse(left.startTime) - Date.parse(right.startTime) || String(left.id).localeCompare(String(right.id)));
  const periodReportIds = new Set(periodReports.map(report => report.id));
  const periodStartMs = Date.parse(anchorReport.workPeriodStartTime || anchorReport.startTime);
  const periodEndMs = anchorReport.workPeriodEndTime ? Date.parse(anchorReport.workPeriodEndTime) : Number.POSITIVE_INFINITY;
  const periodSamples = gpsSyncSamples.filter(sample => {
    if (sample.jobId) return periodReportIds.has(sample.jobId);
    const capturedAtMs = Date.parse(sample.capturedAt);
    return sameVehicle(sample.vehicleNumber, anchorReport.vehicleNumber)
      && Number.isFinite(capturedAtMs)
      && capturedAtMs >= periodStartMs
      && capturedAtMs <= periodEndMs;
  }).sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt) || String(left.id).localeCompare(String(right.id)));
  const { page, pageSize, offset } = gpsPage(searchParams);
  const pageSamples = periodSamples.slice(offset, offset + pageSize).map(sample => gpsSampleResponse(sample));
  return {
    workPeriod: {
      workPeriodId: anchorReport.workPeriodId,
      vehicleNumber: anchorReport.vehicleNumber,
      startTime: anchorReport.workPeriodStartTime || anchorReport.startTime,
      endTime: anchorReport.workPeriodEndTime || null,
      complete: Boolean(anchorReport.workPeriodComplete),
      anchorReportId: reportId,
    },
    reports: periodReports,
    samples: pageSamples,
    pageInfo: {
      page,
      pageSize,
      total: periodSamples.length,
      totalPages: Math.max(1, Math.ceil(periodSamples.length / pageSize)),
      start: pageSamples.length ? offset + 1 : 0,
      end: offset + pageSamples.length,
      hasNextPage: offset + pageSamples.length < periodSamples.length,
    },
  };
}

function routeInput(input, existingId = null) {
  const routeName = validRequiredText(input.routeName, 120);
  const googleMapsUrl = validRequiredText(input.googleMapsUrl, 2000);
  let parsed;
  try { parsed = new URL(googleMapsUrl || ''); } catch { return { error: 'googleMapsUrl must be a valid Google Maps link' }; }
  const hostname = parsed.hostname.toLowerCase();
  const isGoogleMapsHost = hostname === 'maps.app.goo.gl' || hostname === 'google.com' || /^([a-z0-9-]+\.)?google\.[a-z]{2,}(?:\.[a-z]{2,})?$/.test(hostname);
  if (!routeName || !googleMapsUrl || !isGoogleMapsHost || (!hostname.includes('goo.gl') && !parsed.pathname.toLowerCase().includes('maps'))) {
    return { error: 'googleMapsUrl must be a Google Maps link' };
  }
  const duplicate = jobRoutes.find(item => item.routeName.toLowerCase() === routeName.toLowerCase() && item.id !== existingId);
  if (duplicate) return { error: 'A route with this name already exists.', status: 409 };
  const routePath = normalizeRoutePath(input.routePath);
  return { routeName, googleMapsUrl, anchors: routePath.length >= 2 ? routePath : parseRouteAnchors(googleMapsUrl) };
}

function activeRouteName(value) {
  const requested = optionalText(value, 120);
  if (!requested) return null;
  return jobRoutes.find(item => item.routeName.toLowerCase() === requested.toLowerCase())?.routeName || undefined;
}

function sameVehicle(left, right) {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function workPeriodForReport(reportId) {
  return annotateWorkPeriods(reports).find(report => report.id === reportId) || null;
}

function workPeriodForIncomingJob({ id, vehicleNumber, mode, startTime }) {
  const probeId = `__work-period-route-${id || crypto.randomUUID()}`;
  return annotateWorkPeriods([...reports, {
    id: probeId,
    vehicleNumber,
    mode,
    status: 'Active',
    startTime,
    endTime: startTime,
  }]).find(report => report.id === probeId) || null;
}

function inheritedWorkPeriodRouteName({ id, vehicleNumber, mode, startTime }) {
  const period = workPeriodForIncomingJob({ id, vehicleNumber, mode, startTime });
  if (!period?.workPeriodId) return null;
  return workPeriodRoutes.find(item => item.workPeriodId === period.workPeriodId && sameVehicle(item.vehicleNumber, vehicleNumber))?.routeName || null;
}

function assignRouteToWorkPeriod(reportId, routeName) {
  const selected = workPeriodForReport(reportId);
  if (!selected?.workPeriodId) return null;
  const annotated = annotateWorkPeriods(reports);
  const periodReports = annotated.filter(report => report.workPeriodId === selected.workPeriodId && sameVehicle(report.vehicleNumber, selected.vehicleNumber));
  const reportIds = periodReports.map(report => report.id);
  for (const report of reports) if (reportIds.includes(report.id)) report.routeName = routeName || null;

  const periodStart = Date.parse(selected.workPeriodStartTime || selected.startTime);
  const periodEnd = selected.workPeriodEndTime ? Date.parse(selected.workPeriodEndTime) : Number.POSITIVE_INFINITY;
  let activeJobsUpdated = 0;
  for (const job of activeJobs) {
    const startedAt = Date.parse(job.startTime);
    if (sameVehicle(job.vehicleNumber, selected.vehicleNumber)
      && Number.isFinite(startedAt)
      && startedAt >= periodStart
      && startedAt <= periodEnd) {
      job.routeName = routeName || null;
      activeJobsUpdated += 1;
    }
  }

  const assignmentIndex = workPeriodRoutes.findIndex(item => item.workPeriodId === selected.workPeriodId && sameVehicle(item.vehicleNumber, selected.vehicleNumber));
  if (routeName) {
    const assignment = { workPeriodId: selected.workPeriodId, vehicleNumber: selected.vehicleNumber, routeName, updatedAt: new Date().toISOString() };
    if (assignmentIndex >= 0) workPeriodRoutes[assignmentIndex] = assignment;
    else workPeriodRoutes.push(assignment);
  } else if (assignmentIndex >= 0) {
    workPeriodRoutes.splice(assignmentIndex, 1);
  }
  return { report: reports.find(report => report.id === reportId) || null, reportIds, activeJobsUpdated, workPeriodId: selected.workPeriodId };
}

const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.SONGDEE_CORS_ORIGIN || '*', 'Access-Control-Allow-Headers': 'Content-Type, x-admin-token, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Cache-Control': 'no-store', 'Vary': 'Origin' }); res.end(JSON.stringify(body)); };
class RequestBodyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
async function readJsonBody(req) {
  const buffers = [];
  let bytes = 0;
  let oversized = false;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes <= maximumJsonBodyBytes) buffers.push(buffer);
    else oversized = true;
  }
  if (oversized) throw new RequestBodyError(413, 'Request body is too large');
  try { return JSON.parse(Buffer.concat(buffers, bytes).toString('utf8') || '{}'); }
  catch { throw new RequestBodyError(400, 'Invalid JSON payload'); }
}
function sendBodyError(res, error) {
  return send(res, error instanceof RequestBodyError ? error.status : 400, {
    error: error instanceof RequestBodyError ? error.message : 'Invalid JSON payload',
  });
}
const isAdmin = req => { const token = req.headers['x-admin-token']; const expiresAt = adminSessions.get(token); if (!expiresAt) return false; if (expiresAt <= Date.now()) { adminSessions.delete(token); return false; } return true; };
const server = http.createServer(async (req, res) => {
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maximumJsonBodyBytes) {
    return send(res, 413, { error: 'Request body is too large' });
  }
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.url === '/api/health') return send(res, 200, songdeeApiHealth());
  if (req.url === '/api/admin/login' && req.method === 'POST') {
    try { const input = await readJsonBody(req); if (!verifyPassword(String(input.password || ''), adminPasswordHash)) return send(res, 401, { error: 'Invalid password' }); const token = crypto.randomUUID(); adminSessions.set(token, Date.now() + adminSessionLifetimeMs); if (adminSessions.size > 1000) adminSessions.delete(adminSessions.keys().next().value); return send(res, 200, { token, expiresIn: adminSessionLifetimeMs }); }
    catch (error) { return sendBodyError(res, error); }
  }
  if (req.url?.startsWith('/api/admin/reports/') && req.method === 'GET') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Admin login required' });
    const target = new URL(req.url, 'http://localhost');
    const workPeriodGpsMatch = target.pathname.match(/^\/api\/admin\/reports\/([^/]+)\/work-period-gps$/);
    if (workPeriodGpsMatch) {
      const reportId = decodeURIComponent(workPeriodGpsMatch[1]);
      if (!/^[a-zA-Z0-9._:-]+$/.test(reportId)) return send(res, 400, { error: 'A valid report id is required' });
      const detail = workPeriodGpsDetail(reportId, target.searchParams);
      if (!detail) return send(res, 404, { error: 'Report not found' });
      return send(res, 200, detail);
    }
    const match = target.pathname.match(/^\/api\/admin\/reports\/([^/]+)\/gps$/);
    if (match) {
      const reportId = decodeURIComponent(match[1]);
      if (!/^[a-zA-Z0-9._:-]+$/.test(reportId)) return send(res, 400, { error: 'A valid report id is required' });
      const report = reports.find(item => item.id === reportId);
      if (!report) return send(res, 404, { error: 'Report not found' });
      return send(res, 200, jobGpsDetail(report, target.searchParams));
    }
  }
  if (req.url?.startsWith('/api/reports') && req.method === 'GET') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Admin login required' });
    const query = new URL(req.url, 'http://localhost').searchParams;
    return send(res, 200, queryLocalReports(reports.map(reportWithGpsSummary), deviceBindings, query));
  }
  if (req.url === '/api/admin/reports/facets' && req.method === 'GET') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Admin login required' });
    return send(res, 200, { facets: localReportFacets(reports) });
  }
  if (req.url === '/api/admin/job-routes' && req.method === 'GET') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Admin login required' });
    return send(res, 200, { routes: jobRoutes, settings: routeDeviationSettings });
  }
  if (req.url?.startsWith('/api/admin/job-route-options') && req.method === 'GET') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Admin login required' });
    const query = new URL(req.url, 'http://localhost').searchParams;
    const search = String(query.get('q') || '').trim().toLowerCase().slice(0, 120);
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(query.get('limit'))) || 50));
    const offset = Math.min(100_000, Math.max(0, Math.trunc(Number(query.get('offset'))) || 0));
    const matches = jobRoutes
      .filter(route => route.active !== false && (!search || route.routeName.toLowerCase().includes(search)))
      .sort((left, right) => {
        const leftName = left.routeName.toLowerCase(); const rightName = right.routeName.toLowerCase();
        const rank = name => name === search ? 0 : name.startsWith(search) ? 1 : 2;
        return rank(leftName) - rank(rightName) || leftName.localeCompare(rightName) || left.routeName.localeCompare(right.routeName);
      });
    return send(res, 200, {
      routes: matches.slice(offset, offset + limit).map(({ id, routeName }) => ({ id, routeName })),
      hasMore: matches.length > offset + limit,
    });
  }
  if (req.url === '/api/admin/job-routes' && req.method === 'POST') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Admin login required' });
    try {
      const input = await readJsonBody(req);
      const normalized = routeInput(input);
      if (normalized.error) return send(res, normalized.status || 400, { error: normalized.error });
      const route = { id: `ROUTE-${crypto.randomUUID()}`, ...normalized, active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      jobRoutes.push(route); saveState(); return send(res, 201, { route });
    } catch (error) { return sendBodyError(res, error); }
  }
  if (req.url === '/api/admin/job-route-settings' && req.method === 'PUT') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Admin login required' });
    try {
      const input = await readJsonBody(req);
      const distanceKm = Number(input.distanceKm); const durationSeconds = Number(input.durationSeconds);
      if (!Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > 50 || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 86400) return send(res, 400, { error: 'Invalid route deviation settings' });
      routeDeviationSettings = { distanceKm, durationSeconds: Math.round(durationSeconds) }; saveState(); return send(res, 200, { settings: routeDeviationSettings });
    } catch (error) { return sendBodyError(res, error); }
  }
  if (req.url?.startsWith('/api/admin/job-routes/') && ['PUT', 'DELETE'].includes(req.method)) {
    if (!isAdmin(req)) return send(res, 401, { error: 'Admin login required' });
    const routeId = decodeURIComponent(new URL(req.url, 'http://localhost').pathname.split('/').at(-1) || '');
    const index = jobRoutes.findIndex(item => item.id === routeId);
    if (index < 0) return send(res, 404, { error: 'Route not found' });
    if (req.method === 'DELETE') {
      if ([...activeJobs, ...reports, ...workPeriodRoutes].some(job => String(job.routeName || '').toLowerCase() === jobRoutes[index].routeName.toLowerCase())) return send(res, 409, { error: 'This route is assigned to a job. Reassign saved jobs or finish active jobs before deleting it.' });
      jobRoutes.splice(index, 1); saveState(); return send(res, 200, { ok: true });
    }
    try {
      const normalized = routeInput(await readJsonBody(req), routeId);
      if (normalized.error) return send(res, normalized.status || 400, { error: normalized.error });
      const previousRouteName = jobRoutes[index].routeName;
      jobRoutes[index] = { ...jobRoutes[index], ...normalized, active: true, updatedAt: new Date().toISOString() };
      if (previousRouteName.toLowerCase() !== normalized.routeName.toLowerCase()) {
        for (const job of [...activeJobs, ...reports]) if (String(job.routeName || '').toLowerCase() === previousRouteName.toLowerCase()) job.routeName = normalized.routeName;
        for (const assignment of workPeriodRoutes) if (String(assignment.routeName || '').toLowerCase() === previousRouteName.toLowerCase()) assignment.routeName = normalized.routeName;
      }
      saveState(); return send(res, 200, { route: jobRoutes[index] });
    } catch (error) { return sendBodyError(res, error); }
  }
  const localReportRouteMatch = new URL(req.url || '/', 'http://localhost').pathname.match(/^\/api\/admin\/reports\/([^/]+)\/route$/);
  if (localReportRouteMatch && req.method === 'PUT') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Admin login required' });
    try {
      const report = reports.find(item => item.id === decodeURIComponent(localReportRouteMatch[1]));
      if (!report) return send(res, 404, { error: 'Report not found' });
      const input = await readJsonBody(req); const routeName = activeRouteName(input.routeName);
      if (input.routeName && routeName === undefined) return send(res, 409, { error: 'The selected route is no longer available. Refresh routes and choose again.' });
      const scope = input.scope || 'job';
      if (!['job', 'work_period'].includes(scope)) return send(res, 400, { error: 'scope must be job or work_period' });
      if (scope === 'work_period') {
        const assignment = assignRouteToWorkPeriod(report.id, routeName || null);
        if (!assignment) return send(res, 409, { error: 'This job does not have a work period yet.' });
        saveState(); return send(res, 200, { ...assignment, scope });
      }
      report.routeName = routeName || null; saveState(); return send(res, 200, { report, reportIds: [report.id], activeJobsUpdated: 0, scope });
    } catch (error) { return sendBodyError(res, error); }
  }
  if (req.url?.startsWith('/api/device-config') && req.method === 'GET') {
    const deviceId = new URL(req.url, 'http://localhost').searchParams.get('deviceId');
    const matched = deviceId ? deviceBindings.find(item => item.deviceId === deviceId) : null;
    return send(res, 200, { deviceConfig: matched || null });
  }
  if (req.url?.startsWith('/api/device-jobs') && req.method === 'GET') {
    const query = new URL(req.url, 'http://localhost').searchParams;
    const deviceId = query.get('deviceId') || '';
    const vehicleNumber = query.get('vehicleNumber') || '';
    const binding = deviceBindings.find(item => item.deviceId === deviceId);
    if (!binding || binding.vehicleNumber !== vehicleNumber) return send(res, 409, { error: 'Vehicle and device binding does not match.', code: 'DEVICE_BINDING_MISMATCH' });
    return send(res, 200, queryLocalDeviceJobs(reports, deviceId, vehicleNumber, query));
  }
  if (req.url?.startsWith('/api/job-routes') && req.method === 'GET') {
    const query = new URL(req.url, 'http://localhost').searchParams;
    const deviceId = query.get('deviceId') || '';
    if (!deviceBindings.some(binding => binding.deviceId === deviceId)) return send(res, 409, { error: 'Device binding does not match.', code: 'DEVICE_BINDING_MISMATCH' });
    const search = String(query.get('q') || '').trim().toLowerCase().slice(0, 120);
    const limit = Math.min(100, Math.max(1, Math.trunc(Number(query.get('limit'))) || 50));
    const offset = Math.min(100_000, Math.max(0, Math.trunc(Number(query.get('offset'))) || 0));
    const matches = jobRoutes
      .filter(route => route.active !== false && (!search || route.routeName.toLowerCase().includes(search)))
      .sort((left, right) => {
        const leftName = left.routeName.toLowerCase(); const rightName = right.routeName.toLowerCase();
        const rank = name => name === search ? 0 : name.startsWith(search) ? 1 : 2;
        return rank(leftName) - rank(rightName) || leftName.localeCompare(rightName) || left.routeName.localeCompare(right.routeName);
      });
    return send(res, 200, {
      routes: matches.slice(offset, offset + limit).map(({ id, routeName }) => ({ id, routeName })),
      hasMore: matches.length > offset + limit,
    });
  }
  if (req.url === '/api/device-config' && req.method === 'POST') {
    try { const input = await readJsonBody(req); const vehicleNumber = validRequiredText(input.vehicleNumber, 80); const deviceId = validRequiredText(input.deviceId, 180); if (!vehicleNumber || !deviceId) return send(res, 400, { error: 'vehicleNumber and deviceId are required and must be within their size limits' }); const existingDevice = deviceBindings.find(item => item.deviceId === deviceId); if (existingDevice?.vehicleNumber === vehicleNumber) return send(res, 200, { deviceConfig: existingDevice, deduplicated: true }); if (existingDevice) return send(res, 409, { error: 'Device is already connected; change it from the admin dashboard.' }); deviceConfig = { vehicleNumber, deviceId }; deviceBindings.push(deviceConfig); openBindingHistory(deviceConfig); saveState(); return send(res, 200, { deviceConfig }); }
    catch (error) { return sendBodyError(res, error); }
  }
  if (req.url === '/api/device-config/rebind' && req.method === 'POST') {
    try {
      const input = await readJsonBody(req);
      const vehicleNumber = validRequiredText(input.vehicleNumber, 80);
      const deviceId = validRequiredText(input.deviceId, 180);
      if (!vehicleNumber || !deviceId) return send(res, 400, { error: 'vehicleNumber and deviceId are required and must be within their size limits' });
      if (!verifyPassword(String(input.password || ''), adminPasswordHash)) return send(res, 401, { error: 'Invalid password' });
      const index = deviceBindings.findIndex(item => item.deviceId === deviceId);
      if (index < 0) return send(res, 404, { error: 'Device binding not found' });
      const previous = deviceBindings[index];
      if (previous.vehicleNumber !== vehicleNumber && activeJobs.some(item => item.deviceId === deviceId)) {
        return send(res, 409, { error: 'Finish or cancel the active job before changing this vehicle binding.' });
      }
      const next = { vehicleNumber, deviceId };
      if (previous.vehicleNumber !== vehicleNumber) {
        closeBindingHistory(deviceId);
        openBindingHistory(next);
      }
      deviceBindings[index] = next;
      if (deviceConfig?.deviceId === deviceId) deviceConfig = next;
      saveState();
      return send(res, 200, { deviceConfig: next });
    } catch (error) { return sendBodyError(res, error); }
  }
  if (req.url?.startsWith('/api/driver-identity') && req.method === 'GET') {
    const query = new URL(req.url, 'http://localhost').searchParams;
    const deviceId = query.get('deviceId') || null;
    const requestedVehicleNumber = String(query.get('vehicleNumber') || '').trim();
    const binding = deviceId ? deviceBindings.find(item => item.deviceId === deviceId) : null;
    const vehicleNumber = binding?.vehicleNumber || null;
    if (requestedVehicleNumber && requestedVehicleNumber !== vehicleNumber) {
      return send(res, 200, { driverIdentity: null, vehicleNumber, deviceId, sourceStatus: 'binding_changed' });
    }
    if (!vehicleNumber || !deviceId) return send(res, 200, { driverIdentity: null, vehicleNumber, deviceId });
    if (!driverIdentityApiUrl && dataFmEnvironmentSelected) {
      const result = await fetchDataFmDriverIdentity({ ...dataFmOptions, vehicleNumber });
      return send(res, 200, { driverIdentity: result.driverIdentity, vehicleNumber, deviceId, sourceStatus: result.status });
    }
    if (!driverIdentityApiUrl) return send(res, 200, { driverIdentity: null, vehicleNumber, deviceId });
    const upstream = parseHttpAdapterUrl(driverIdentityApiUrl);
    if (!upstream) return send(res, 200, { driverIdentity: null, vehicleNumber, deviceId, sourceStatus: 'misconfigured' });
    upstream.searchParams.set('vehicleNumber', vehicleNumber);
    upstream.searchParams.set('deviceId', deviceId);
    try {
      const response = await fetch(upstream, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return send(res, 200, { driverIdentity: null, vehicleNumber, deviceId, sourceStatus: response.status });
      return send(res, 200, { driverIdentity: await response.json(), vehicleNumber, deviceId });
    } catch { return send(res, 200, { driverIdentity: null, vehicleNumber, deviceId, sourceStatus: 'unavailable' }); }
  }
  if (req.url?.startsWith('/api/vehicle-motion') && req.method === 'GET') {
    const query = new URL(req.url, 'http://localhost').searchParams;
    const deviceId = query.get('deviceId') || null;
    const binding = deviceId ? deviceBindings.find(item => item.deviceId === deviceId) : null;
    const vehicleNumber = binding?.vehicleNumber || null;
    if (!gpsMotionApiUrl || !vehicleNumber || !deviceId) return send(res, 200, { moving: null, speed: null, vehicleNumber, deviceId, sourceStatus: 'not_configured' });
    const upstream = parseHttpAdapterUrl(gpsMotionApiUrl);
    if (!upstream) return send(res, 200, { moving: null, speed: null, vehicleNumber, deviceId, sourceStatus: 'misconfigured' });
    upstream.searchParams.set('vehicleNumber', vehicleNumber);
    upstream.searchParams.set('deviceId', deviceId);
    try {
      const response = await fetch(upstream, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return send(res, 200, { moving: null, speed: null, vehicleNumber, deviceId, sourceStatus: 'unavailable' });
      return send(res, 200, { ...(await response.json()), vehicleNumber, deviceId, sourceStatus: 'configured' });
    } catch { return send(res, 200, { moving: null, speed: null, vehicleNumber, deviceId, sourceStatus: 'unavailable' }); }
  }
  if (req.url === '/api/job-starts' && req.method === 'POST') {
    try {
        const input = await readJsonBody(req);
        const id = String(input.id || '').trim();
        const vehicleNumber = validRequiredText(input.vehicleNumber, 80);
        const deviceId = validRequiredText(input.deviceId, 180);
        const mode = validRequiredText(input.mode, 80);
        const startTimeMs = Date.parse(String(input.startTime || ''));
        const driverName = optionalText(input.driverName, 180);
        const driverId = optionalText(input.driverId, 180);
        const completed = reports.find(item => item.id === id);
        const existing = activeJobs.find(item => item.id === id);
        const requestedRouteName = activeRouteName(input.routeName);
        if (input.routeName && requestedRouteName === undefined && !completed && !existing) return send(res, 409, { error: 'The selected route is no longer available. Refresh routes and choose again.' });
        const inheritedRouteName = completed || existing ? null : inheritedWorkPeriodRouteName({ id, vehicleNumber, mode, startTime: new Date(startTimeMs).toISOString() });
        const routeName = completed?.routeName || existing?.routeName || inheritedRouteName || requestedRouteName;
        if (!id || id.length > 180 || !/^[a-zA-Z0-9._:-]+$/.test(id)) return send(res, 400, { error: 'A valid id is required' });
        if (!vehicleNumber || !deviceId || !allowedModes.has(mode) || !Number.isFinite(startTimeMs)) return send(res, 400, { error: 'A valid vehicleNumber, deviceId, mode, and startTime are required' });
        if ((driverName?.length || 0) > 180 || (driverId?.length || 0) > 180) return send(res, 400, { error: 'driverName and driverId must be 180 characters or fewer' });
        if (!wasBindingValidAt(deviceId, vehicleNumber, startTimeMs)) return send(res, 409, { error: 'Vehicle and device were not connected when this job started.' });
        const normalized = { id, vehicleNumber, deviceId, driverName, driverId, mode, routeName: routeName || null, startTime: new Date(startTimeMs).toISOString() };
        if (completed) {
          if (!sameJobStart(completed, normalized)) return send(res, 409, { error: 'Job id is already used by different data.' });
          removeActiveJob(id);
          linkGpsSamplesToJob(completed, completed.endTime);
          saveState();
          return send(res, 200, { jobStart: null, closed: true, deduplicated: true });
        }
        if (existing) {
          if (!sameJobStart(existing, normalized)) return send(res, 409, { error: 'Job id is already used by different data.' });
          linkGpsSamplesToJob(existing);
          saveState();
          return send(res, 200, { jobStart: existing, deduplicated: true });
        }
        if (activeJobs.some(item => item.deviceId === deviceId)) {
          return send(res, 409, { error: 'Device already has an active job.' });
        }
        const jobStart = { ...normalized, status: 'Active', createdAt: new Date().toISOString() };
        activeJobs.unshift(jobStart);
        linkGpsSamplesToJob(jobStart);
        saveState();
        return send(res, 201, { jobStart });
    } catch (error) { return sendBodyError(res, error); }
  }
  if (req.url === '/api/job-gps-sync' && req.method === 'POST') {
    try {
      const input = await readJsonBody(req);
      const jobId = validRequiredText(input.jobId, 180);
      const vehicleNumber = validRequiredText(input.vehicleNumber, 80);
      const deviceId = validRequiredText(input.deviceId, 180);
      const targetAtMs = Date.parse(String(input.targetAt || ''));
      if (!jobId || !/^[a-zA-Z0-9._:-]+$/.test(jobId) || !vehicleNumber || !deviceId || !Number.isFinite(targetAtMs)) {
        return send(res, 400, { error: 'A valid jobId, vehicleNumber, deviceId, and targetAt are required' });
      }
      const job = activeJobs.find(item => item.id === jobId) || reports.find(item => item.id === jobId);
      if (!job) return send(res, 404, { error: 'Job not found' });
      if (job.vehicleNumber !== vehicleNumber || job.deviceId !== deviceId) {
        return send(res, 409, { error: 'Job does not belong to this vehicle and Android device.' });
      }
      if (job.status === 'Cancelled') return send(res, 409, { error: 'Cancelled jobs do not require GPS lookup' });
      const startMs = Date.parse(job.startTime);
      const endMs = job.endTime ? Date.parse(job.endTime) : Date.now() + DEFAULT_GPS_PAIR_TOLERANCE_MS;
      if (targetAtMs < startMs || targetAtMs > endMs) {
        return send(res, 409, { error: 'GPS reconciliation time is outside the job window.' });
      }
      const gpsReconciliation = await reconcileExternalGpsForJob(job, new Date(targetAtMs).toISOString());
      if (job.endTime) {
        applyGpsLookupResult(job, gpsReconciliation);
        saveState();
      }
      return send(res, 200, { ...gpsReconciliation, ...(job.endTime ? { report: job } : {}) });
    } catch (error) { return sendBodyError(res, error); }
  }
  if (req.url === '/api/gps-sync' && req.method === 'POST') {
    return send(res, 410, { error: 'Tablet GPS ingestion has been removed; use job GPS reconciliation.' });
  }
  if (req.url === '/api/admin/device-config' && req.method === 'POST') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Admin login required' });
    try { const input = await readJsonBody(req); const deviceId = validRequiredText(input.deviceId, 180); const vehicleNumber = validRequiredText(input.vehicleNumber, 80); if (!vehicleNumber || !deviceId) return send(res, 400, { error: 'vehicleNumber and deviceId are required and must be within their size limits' }); const index = deviceBindings.findIndex(item => item.deviceId === deviceId); const previous = index >= 0 ? deviceBindings[index] : null; if (previous && previous.vehicleNumber !== vehicleNumber && activeJobs.some(item => item.deviceId === deviceId)) return send(res, 409, { error: 'Finish or cancel the active job before changing this vehicle binding.' }); const next = { vehicleNumber, deviceId }; if (previous && previous.vehicleNumber !== vehicleNumber) closeBindingHistory(deviceId); if (index >= 0) deviceBindings[index] = next; else deviceBindings.push(next); if (!previous || previous.vehicleNumber !== vehicleNumber) openBindingHistory(next); if (deviceConfig?.deviceId === deviceId || !deviceConfig) deviceConfig = next; saveState(); return send(res, 200, { deviceConfig: next, deviceBindings }); }
    catch (error) { return sendBodyError(res, error); }
  }
  if (req.url === '/api/admin/device-config' && req.method === 'DELETE') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Admin login required' });
    try {
        const input = await readJsonBody(req);
        const deviceId = validRequiredText(input.deviceId, 180);
        if (!deviceId) return send(res, 400, { error: 'deviceId is required' });
        const index = deviceBindings.findIndex(item => item.deviceId === deviceId);
        if (index < 0) return send(res, 404, { error: 'Device binding not found' });
        if (activeJobs.some(item => item.deviceId === deviceId)) return send(res, 409, { error: 'Finish or cancel the active job before removing this vehicle binding.' });
        closeBindingHistory(deviceId);
        deviceBindings.splice(index, 1);
        if (deviceConfig?.deviceId === deviceId) deviceConfig = deviceBindings[0] || null;
        saveState();
        return send(res, 200, { deviceBindings, deviceConfig });
    } catch (error) { return sendBodyError(res, error); }
  }
  if (req.url === '/api/admin/device-bindings' && req.method === 'GET') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Admin login required' });
    const enriched = deviceBindings.map(binding => ({
      ...binding,
      lastActivityAt: reports.filter(report => report.deviceId === binding.deviceId)
        .map(report => report.endTime || report.startTime).filter(Boolean)
        .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null,
    }));
    return send(res, 200, { deviceBindings: enriched });
  }
  if (req.url === '/api/admin/device-credentials/reset' && req.method === 'POST') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Admin login required' });
    try {
      const input = await readJsonBody(req);
      const deviceId = validRequiredText(input.deviceId, 180);
      if (!deviceId || !deviceBindings.some(binding => binding.deviceId === deviceId)) return send(res, 404, { error: 'Device binding not found' });
      return send(res, 200, { ok: true, deviceAuth: { keyId: null, enrolled: false, enforced: false } });
    } catch (error) { return sendBodyError(res, error); }
  }
  if (req.url === '/api/admin/password' && req.method === 'POST') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Admin login required' });
    try {
        const input = await readJsonBody(req);
        const currentPassword = String(input.currentPassword || '');
        const newPassword = String(input.newPassword || '');
        if (!verifyPassword(currentPassword, adminPasswordHash)) return send(res, 400, { error: 'Current admin password is incorrect' });
        if (newPassword.length < 12 || newPassword.length > 128) return send(res, 400, { error: 'New admin password must be 12 to 128 characters' });
        if (newPassword === currentPassword) return send(res, 400, { error: 'New admin password must be different' });
        adminPasswordHash = hashPassword(newPassword);
        saveState();
        adminSessions.clear();
        return send(res, 200, { ok: true });
    } catch (error) { return sendBodyError(res, error); }
  }
  if (req.url === '/api/admin/reports/retry' && req.method === 'POST') {
    if (!isAdmin(req)) return send(res, 401, { error: 'Admin login required' });
    try {
        const input = await readJsonBody(req);
        const reportId = String(input.reportId || '').trim();
        if (!reportId) return send(res, 400, { error: 'reportId is required' });
        const report = reports.find(item => item.id === reportId);
        if (!report) return send(res, 404, { error: 'Report not found' });
        if (isCancelledReport(report)) return send(res, 409, { error: 'Cancelled jobs do not require GPS lookup' });
        const gpsReconciliation = await reconcileExternalGpsForJob(report, report.endTime);
        applyGpsLookupResult(report, gpsReconciliation);
        saveState();
        return send(res, 200, { report, gpsReconciliation });
    } catch (error) { return sendBodyError(res, error); }
  }
  if (req.url === '/api/reports' && req.method === 'POST') {
    try {
        const input = await readJsonBody(req);
        const requestedId = String(input.id || '').trim();
        const vehicleNumber = validRequiredText(input.vehicleNumber, 80);
        const deviceId = validRequiredText(input.deviceId, 180);
        const mode = validRequiredText(input.mode, 80);
        const startTimeMs = Date.parse(String(input.startTime || ''));
        const endTimeMs = Date.parse(String(input.endTime || ''));
        const driverName = optionalText(input.driverName, 180);
        const driverId = optionalText(input.driverId, 180);
        if (!vehicleNumber || !deviceId || !allowedModes.has(mode) || !Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs)) return send(res, 400, { error: 'A valid vehicleNumber, deviceId, mode, startTime, and endTime are required' });
        if ((driverName?.length || 0) > 180 || (driverId?.length || 0) > 180) return send(res, 400, { error: 'driverName and driverId must be 180 characters or fewer' });
        if (requestedId && (requestedId.length > 180 || !/^[a-zA-Z0-9._:-]+$/.test(requestedId))) return send(res, 400, { error: 'id must contain only letters, numbers, dots, underscores, colons, or hyphens' });
        if (endTimeMs < startTimeMs) return send(res, 400, { error: 'endTime must be after startTime' });
        const reportId = requestedId || createServerJobId(deviceId, mode, startTimeMs);
        const existing = reports.find(item => item.id === reportId) || null;
        const activeReportJob = activeJobs.find(item => item.id === reportId);
        const requestedRouteName = activeRouteName(input.routeName);
        if (input.routeName && requestedRouteName === undefined && !existing && !activeReportJob) return send(res, 409, { error: 'The selected route is no longer available. Refresh routes and choose again.' });
        const inheritedRouteName = existing || activeReportJob ? null : inheritedWorkPeriodRouteName({ id: reportId, vehicleNumber, mode, startTime: new Date(startTimeMs).toISOString() });
        const routeName = existing?.routeName || activeReportJob?.routeName || inheritedRouteName || requestedRouteName;
        if (!wasBindingValidAt(deviceId, vehicleNumber, startTimeMs)) return send(res, 409, { error: 'Vehicle and device were not connected when this job started.' });
        const cancelled = input.status === 'Cancelled';
        const normalizedStartTime = new Date(startTimeMs).toISOString();
        if (existing) {
          const sameJob = existing.vehicleNumber === vehicleNumber
            && existing.deviceId === deviceId
            && existing.mode === mode
            && existing.startTime === normalizedStartTime
            && existing.endTime === new Date(endTimeMs).toISOString()
            && (existing.driverName || null) === driverName
            && (existing.driverId || null) === driverId
            && isCancelledReport(existing) === cancelled;
          if (!sameJob) return send(res, 409, { error: 'Report id is already used by a different job.' });
          removeActiveJob(existing.id);
          linkGpsSamplesToJob(existing, existing.endTime);
          saveState();
          return send(res, 200, { report: existing, deduplicated: true });
        }
        const report = {
          id: reportId,
          vehicleNumber,
          deviceId,
          driverName,
          driverId,
          mode,
          routeName: routeName || null,
          startTime: normalizedStartTime,
          endTime: new Date(endTimeMs).toISOString(),
          duration: formatDurationMs(endTimeMs - startTimeMs),
          gps: cancelled ? 'Not applicable' : 'Pending GPS lookup',
          status: cancelled ? 'Cancelled' : 'Completed',
          gpsLookupStatus: cancelled ? 'not_applicable' : 'pending',
          gpsLookupMessage: cancelled ? 'Cancelled job recorded.' : 'Waiting for GPS lookup.',
        };
        reports.unshift(report);
        removeActiveJob(report.id);
        linkGpsSamplesToJob(report, report.endTime);
        saveState();
        return send(res, 201, { report, gpsLookup: { status: report.gpsLookupStatus, message: report.gpsLookupMessage } });
    } catch (error) { return sendBodyError(res, error); }
  }
  send(res, 404, { error: 'Not found' });
});
server.listen(port, () => console.log(`Songdee Fleet Ops API listening on http://localhost:${port}`));
