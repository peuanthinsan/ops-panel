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
  baseUrl: process.env.SONGDEE_DATA_FM_BASE_URL,
  username: process.env.SONGDEE_DATA_FM_USERNAME,
  password: process.env.SONGDEE_DATA_FM_PASSWORD,
  timeZone: process.env.SONGDEE_DATA_FM_TIME_ZONE,
  allowHttp: true,
};
const dataFmEnvironmentSelected = Boolean(process.env.SONGDEE_DATA_FM_USERNAME || process.env.SONGDEE_DATA_FM_PASSWORD);
const saveState = () => {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const temporaryFile = `${dataFile}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify({ reports, activeJobs, deviceBindings, bindingHistory, deviceConfig, driverIdentity, gpsSyncSamples, adminPasswordHash }, null, 2));
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
  report.status = 'Completed';
  report.gps = state.gps;
  report.gpsLookupStatus = state.status;
  report.gpsLookupMessage = state.message;
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
    deviceSource: { status: deviceSource.status, message: deviceSource.message },
    fmsSource: { status: fmsSource.status, message: fmsSource.message },
    pairStatus,
    toleranceMs,
  };
}
function jobGpsDetail(report, searchParams) {
  const pageSize = Math.min(200, Math.max(1, Math.trunc(Number(searchParams.get('pageSize'))) || 100));
  const page = Math.max(1, Math.trunc(Number(searchParams.get('page'))) || 1);
  const summaryReport = reportWithGpsSummary(report);
  const samples = gpsSyncSamples.filter(sample => sample.jobId === report.id || (
    !sample.jobId
    && sample.vehicleNumber === report.vehicleNumber
    && sample.deviceId === report.deviceId
    && Date.parse(sample.capturedAt) >= Date.parse(report.startTime)
    && Date.parse(sample.capturedAt) <= Date.parse(report.endTime)
  )).sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  const offset = (page - 1) * pageSize;
  const pageSamples = samples.slice(offset, offset + pageSize).map(sample => ({
    id: sample.id,
    jobId: sample.jobId || report.id,
    capturedAt: sample.capturedAt,
    deviceGps: sample.deviceGps,
    fmsGps: sample.fmsStatus === 'received' ? sample.fmsNormalized || null : null,
    fmsStatus: sample.fmsStatus,
    fmsMessage: sample.fmsMessage,
    positionDeltaM: sample.positionDeltaM ?? null,
    timeDeltaMs: sample.timeDeltaMs ?? null,
    pairStatus: sample.pairStatus || (sample.fmsStatus === 'received' ? 'fms_received' : sample.fmsStatus === 'not_configured' ? 'device_only' : 'fms_delayed'),
    syncedAt: sample.syncedAt,
  }));
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

const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.SONGDEE_CORS_ORIGIN || '*', 'Access-Control-Allow-Headers': 'Content-Type, x-admin-token, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Cache-Control': 'no-store', 'Vary': 'Origin' }); res.end(JSON.stringify(body)); };
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
        if (!id || id.length > 180 || !/^[a-zA-Z0-9._:-]+$/.test(id)) return send(res, 400, { error: 'A valid id is required' });
        if (!vehicleNumber || !deviceId || !allowedModes.has(mode) || !Number.isFinite(startTimeMs)) return send(res, 400, { error: 'A valid vehicleNumber, deviceId, mode, and startTime are required' });
        if ((driverName?.length || 0) > 180 || (driverId?.length || 0) > 180) return send(res, 400, { error: 'driverName and driverId must be 180 characters or fewer' });
        if (!wasBindingValidAt(deviceId, vehicleNumber, startTimeMs)) return send(res, 409, { error: 'Vehicle and device were not connected when this job started.' });
        const normalized = { id, vehicleNumber, deviceId, driverName, driverId, mode, startTime: new Date(startTimeMs).toISOString() };
        const completed = reports.find(item => item.id === id);
        if (completed) {
          if (!sameJobStart(completed, normalized)) return send(res, 409, { error: 'Job id is already used by different data.' });
          removeActiveJob(id);
          linkGpsSamplesToJob(completed, completed.endTime);
          saveState();
          return send(res, 200, { jobStart: null, closed: true, deduplicated: true });
        }
        const existing = activeJobs.find(item => item.id === id);
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
        if (!wasBindingValidAt(deviceId, vehicleNumber, startTimeMs)) return send(res, 409, { error: 'Vehicle and device were not connected when this job started.' });
        const cancelled = input.status === 'Cancelled';
        const normalizedStartTime = new Date(startTimeMs).toISOString();
        const existing = requestedId ? reports.find(item => item.id === requestedId) : null;
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
          id: requestedId || `OPS-${crypto.randomUUID()}`,
          vehicleNumber,
          deviceId,
          driverName,
          driverId,
          mode,
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
