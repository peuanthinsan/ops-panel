import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SONGDEE_API_CONTRACT_VERSION } from '../lib/api-contract.mjs';

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}

async function waitForHealth(baseUrl: string, child: ChildProcess) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode != null) throw new Error(`API server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response.json();
    } catch { /* The child may still be starting. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('API server did not become ready');
}

async function jsonRequest(baseUrl: string, route: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  return { response, body: await response.json() };
}

async function chunkedJsonRequest(baseUrl: string, route: string, payload: string) {
  const target = new URL(route, baseUrl);
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
    }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { raw += chunk; });
      response.on('end', () => resolve({ status: response.statusCode || 0, body: JSON.parse(raw || '{}') }));
    });
    request.once('error', reject);
    const midpoint = Math.floor(payload.length / 2);
    request.write(payload.slice(0, midpoint));
    request.end(payload.slice(midpoint));
  });
}

test('local API preserves bindings, paired GPS, active starts, and retry-safe completed/cancelled reports', async t => {
  const port = await freePort();
  const fmsPort = await freePort();
  const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'songdee-ops-contract-'));
  const dataFile = path.join(fixtureDirectory, 'data.json');
  const fmsRequests: Array<{ vehicleNumber: string | null; deviceId: string | null; capturedAt: string | null }> = [];
  const deviceGpsRequests: Array<{ vehicleNumber: string | null; capturedAt: string | null }> = [];
  const driverRequests: Array<{ vehicleNumber: string | null; deviceId: string | null }> = [];
  const motionRequests: Array<{ vehicleNumber: string | null; deviceId: string | null }> = [];
  let fmsPositionShouldSucceed = true;
  const fmsServer = http.createServer(async (request, response) => {
    const upstream = new URL(request.url || '/', `http://127.0.0.1:${fmsPort}`);
    const query = upstream.searchParams;
    const received = {
      vehicleNumber: query.get('vehicleNumber'),
      deviceId: query.get('deviceId'),
      capturedAt: query.get('capturedAt'),
    };
    if (upstream.pathname === '/driver') {
      driverRequests.push({ vehicleNumber: received.vehicleNumber, deviceId: received.deviceId });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ driverName: 'Driver One', driverId: 'DRV-001' }));
      return;
    }
    if (upstream.pathname === '/motion') {
      motionRequests.push({ vehicleNumber: received.vehicleNumber, deviceId: received.deviceId });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ moving: true, speed: 12 }));
      return;
    }
    if (upstream.pathname === '/device-position') {
      deviceGpsRequests.push({ vehicleNumber: received.vehicleNumber, capturedAt: received.capturedAt });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ latitude: 13.757, longitude: 100.502, speedKph: 36, heading: 92, capturedAt: received.capturedAt }));
      return;
    }
    fmsRequests.push(received);
    response.writeHead(fmsPositionShouldSucceed ? 200 : 503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(fmsPositionShouldSucceed
      ? { latitude: 13.7563, longitude: 100.5018, speedKph: 39.6, ...received }
      : { error: 'FMS temporarily unavailable' }));
  });
  await new Promise<void>((resolve, reject) => fmsServer.listen(fmsPort, '127.0.0.1', resolve).once('error', reject));
  t.after(() => new Promise<void>(resolve => fmsServer.close(() => resolve())));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      SONGDEE_DATA_FILE: dataFile,
      SONGDEE_DRIVER_IDENTITY_API_URL: `http://127.0.0.1:${fmsPort}/driver`,
      SONGDEE_DEVICE_GPS_API_URL: `http://127.0.0.1:${fmsPort}/device-position`,
      SONGDEE_FMS_GPS_API_URL: `http://127.0.0.1:${fmsPort}/position`,
      SONGDEE_GPS_MOTION_API_URL: `http://127.0.0.1:${fmsPort}/motion`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode == null) child.kill('SIGTERM'); });
  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await waitForHealth(baseUrl, child);
  assert.deepEqual(health, {
    ok: true,
    service: 'songdee-fleet-ops',
    apiContractVersion: SONGDEE_API_CONTRACT_VERSION,
  });

  const oversized = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'x'.repeat(70_000) }),
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: 'Request body is too large' });

  const chunkedOversized = await chunkedJsonRequest(
    baseUrl,
    '/api/admin/login',
    JSON.stringify({ password: 'x'.repeat(70_000) }),
  );
  assert.equal(chunkedOversized.status, 413);
  assert.deepEqual(chunkedOversized.body, { error: 'Request body is too large' });

  const initial = await jsonRequest(baseUrl, '/api/device-config', {
    method: 'POST', body: JSON.stringify({ vehicleNumber: '74-1286', deviceId: 'android-device-001' }),
  });
  assert.equal(initial.response.status, 200);

  const repeatedInitial = await jsonRequest(baseUrl, '/api/device-config', {
    method: 'POST', body: JSON.stringify({ vehicleNumber: '74-1286', deviceId: 'android-device-001' }),
  });
  assert.equal(repeatedInitial.response.status, 200);
  assert.equal(repeatedInitial.body.deduplicated, true);
  assert.deepEqual(repeatedInitial.body.deviceConfig, { vehicleNumber: '74-1286', deviceId: 'android-device-001' });

  const rejectedTabletRebind = await jsonRequest(baseUrl, '/api/device-config/rebind', {
    method: 'POST', body: JSON.stringify({ vehicleNumber: '74-9000', deviceId: 'android-device-001', password: 'wrong-password' }),
  });
  assert.equal(rejectedTabletRebind.response.status, 401);

  const tabletRebind = await jsonRequest(baseUrl, '/api/device-config/rebind', {
    method: 'POST', body: JSON.stringify({ vehicleNumber: '74-9000', deviceId: 'android-device-001', password: 'songdee-setup' }),
  });
  assert.equal(tabletRebind.response.status, 200);
  assert.deepEqual(tabletRebind.body.deviceConfig, { vehicleNumber: '74-9000', deviceId: 'android-device-001' });

  const restoredTabletRebind = await jsonRequest(baseUrl, '/api/device-config/rebind', {
    method: 'POST', body: JSON.stringify({ vehicleNumber: '74-1286', deviceId: 'android-device-001', password: 'songdee-setup' }),
  });
  assert.equal(restoredTabletRebind.response.status, 200);

  const secondDeviceForVehicle = await jsonRequest(baseUrl, '/api/device-config', {
    method: 'POST', body: JSON.stringify({ vehicleNumber: '74-1286', deviceId: 'android-device-002' }),
  });
  assert.equal(secondDeviceForVehicle.response.status, 200);
  assert.deepEqual(secondDeviceForVehicle.body.deviceConfig, { vehicleNumber: '74-1286', deviceId: 'android-device-002' });

  const unscopedDriver = await jsonRequest(baseUrl, '/api/driver-identity');
  assert.equal(unscopedDriver.response.status, 200);
  assert.equal(unscopedDriver.body.driverIdentity, null);
  assert.equal(unscopedDriver.body.vehicleNumber, null);
  assert.equal(unscopedDriver.body.deviceId, null);
  assert.deepEqual(driverRequests, []);

  const identifiedDriver = await jsonRequest(baseUrl, '/api/driver-identity?deviceId=android-device-001&vehicleNumber=74-1286');
  assert.equal(identifiedDriver.response.status, 200);
  assert.deepEqual(identifiedDriver.body.driverIdentity, { driverName: 'Driver One', driverId: 'DRV-001' });
  assert.deepEqual(driverRequests, [{ vehicleNumber: '74-1286', deviceId: 'android-device-001' }]);

  const staleDriverLookup = await jsonRequest(baseUrl, '/api/driver-identity?deviceId=android-device-001&vehicleNumber=74-9999');
  assert.equal(staleDriverLookup.response.status, 200);
  assert.equal(staleDriverLookup.body.driverIdentity, null);
  assert.equal(staleDriverLookup.body.sourceStatus, 'binding_changed');
  assert.deepEqual(driverRequests, [{ vehicleNumber: '74-1286', deviceId: 'android-device-001' }]);

  const unscopedMotion = await jsonRequest(baseUrl, '/api/vehicle-motion');
  assert.equal(unscopedMotion.response.status, 200);
  assert.equal(unscopedMotion.body.sourceStatus, 'not_configured');
  assert.equal(unscopedMotion.body.vehicleNumber, null);
  assert.equal(unscopedMotion.body.deviceId, null);
  assert.deepEqual(motionRequests, []);

  const vehicleMotion = await jsonRequest(baseUrl, '/api/vehicle-motion?deviceId=android-device-001');
  assert.equal(vehicleMotion.response.status, 200);
  assert.equal(vehicleMotion.body.moving, true);
  assert.equal(vehicleMotion.body.speed, 12);
  assert.equal(vehicleMotion.body.sourceStatus, 'configured');
  assert.deepEqual(motionRequests, [{ vehicleNumber: '74-1286', deviceId: 'android-device-001' }]);

  const duplicate = await jsonRequest(baseUrl, '/api/device-config', {
    method: 'POST', body: JSON.stringify({ vehicleNumber: '74-1287', deviceId: 'android-device-001' }),
  });
  assert.equal(duplicate.response.status, 409);

  const rejectedTabletGps = await jsonRequest(baseUrl, '/api/gps-sync', { method: 'POST', body: '{}' });
  assert.equal(rejectedTabletGps.response.status, 410);

  const login = await jsonRequest(baseUrl, '/api/admin/login', {
    method: 'POST', body: JSON.stringify({ password: 'songdee-setup' }),
  });
  assert.equal(login.response.status, 200);
  const adminHeaders = { 'x-admin-token': String(login.body.token) };

  const adminAddedDeviceForVehicle = await jsonRequest(baseUrl, '/api/admin/device-config', {
    method: 'POST', headers: adminHeaders, body: JSON.stringify({ vehicleNumber: '74-1286', deviceId: 'android-device-003' }),
  });
  assert.equal(adminAddedDeviceForVehicle.response.status, 200);
  assert.equal(adminAddedDeviceForVehicle.body.deviceBindings.filter((binding: { vehicleNumber: string }) => binding.vehicleNumber === '74-1286').length, 3);

  const startTime = new Date().toISOString();
  const endTime = new Date(Date.now() + 1_000).toISOString();
  const jobStart = {
    id: 'OPS-contract-001', vehicleNumber: '74-1286', deviceId: 'android-device-001',
    driverName: 'Driver One', driverId: 'DRV-001', mode: 'Load', startTime,
  };
  const started = await jsonRequest(baseUrl, '/api/job-starts', { method: 'POST', body: JSON.stringify(jobStart) });
  assert.equal(started.response.status, 201);
  assert.equal(started.body.jobStart.status, 'Active');

  const activeTabletRebind = await jsonRequest(baseUrl, '/api/device-config/rebind', {
    method: 'POST', body: JSON.stringify({ vehicleNumber: '74-9001', deviceId: 'android-device-001', password: 'songdee-setup' }),
  });
  assert.equal(activeTabletRebind.response.status, 409);

  const gpsTargetAt = new Date(Date.parse(startTime) + 500).toISOString();
  const inJobGps = await jsonRequest(baseUrl, '/api/job-gps-sync', { method: 'POST', body: JSON.stringify({ ...jobStart, jobId: jobStart.id, targetAt: gpsTargetAt }) });
  assert.equal(inJobGps.response.status, 200);
  assert.equal(inJobGps.body.gpsSync.jobId, jobStart.id);
  assert.equal(inJobGps.body.gpsSync.pairStatus, 'paired');
  assert.deepEqual(inJobGps.body.gpsSync.deviceGps, { latitude: 13.757, longitude: 100.502, accuracy: null, speedMps: 10, headingDegrees: 92 });
  assert.deepEqual(deviceGpsRequests, [{ vehicleNumber: '74-1286', capturedAt: gpsTargetAt }]);
  assert.deepEqual(fmsRequests, [{ vehicleNumber: '74-1286', deviceId: null, capturedAt: gpsTargetAt }]);

  fmsPositionShouldSucceed = false;
  const transientFmsRetry = await jsonRequest(baseUrl, '/api/job-gps-sync', { method: 'POST', body: JSON.stringify({ ...jobStart, jobId: jobStart.id, targetAt: gpsTargetAt }) });
  assert.equal(transientFmsRetry.response.status, 200);
  assert.equal(transientFmsRetry.body.gpsSync.fmsStatus, 'received');
  assert.equal(transientFmsRetry.body.gpsSync.pairStatus, 'paired');
  fmsPositionShouldSucceed = true;

  const duplicateStart = await jsonRequest(baseUrl, '/api/job-starts', { method: 'POST', body: JSON.stringify(jobStart) });
  assert.equal(duplicateStart.response.status, 200);
  assert.equal(duplicateStart.body.deduplicated, true);

  const conflictingStart = await jsonRequest(baseUrl, '/api/job-starts', {
    method: 'POST', body: JSON.stringify({ ...jobStart, mode: 'Unload' }),
  });
  assert.equal(conflictingStart.response.status, 409);

  const secondActiveStart = await jsonRequest(baseUrl, '/api/job-starts', {
    method: 'POST', body: JSON.stringify({ ...jobStart, id: 'OPS-contract-concurrent' }),
  });
  assert.equal(secondActiveStart.response.status, 409);
  assert.equal(secondActiveStart.body.error, 'Device already has an active job.');

  const activeReassignment = await jsonRequest(baseUrl, '/api/admin/device-config', {
    method: 'POST', headers: adminHeaders, body: JSON.stringify({ vehicleNumber: '74-9999', deviceId: 'android-device-001' }),
  });
  assert.equal(activeReassignment.response.status, 409);

  const report = {
    ...jobStart, endTime,
  };
  const created = await jsonRequest(baseUrl, '/api/reports', { method: 'POST', body: JSON.stringify(report) });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.report.gpsLookupStatus, 'pending');
  assert.equal(created.body.report.deviceId, 'android-device-001');

  const gpsDetail = await jsonRequest(baseUrl, `/api/admin/reports/${jobStart.id}/gps`, { headers: adminHeaders });
  assert.equal(gpsDetail.response.status, 200);
  assert.equal(gpsDetail.body.report.id, jobStart.id);
  assert.equal(gpsDetail.body.gpsSummary.deviceSamples, 1);
  assert.equal(gpsDetail.body.gpsSummary.pairedSamples, 1);
  assert.ok(Number(gpsDetail.body.gpsSummary.medianPositionDeltaM) > 0);
  assert.equal(gpsDetail.body.samples[0].jobId, jobStart.id);
  assert.equal(gpsDetail.body.samples[0].pairStatus, 'paired');

  const retriedReport = await jsonRequest(baseUrl, '/api/admin/reports/retry', {
    method: 'POST', headers: adminHeaders, body: JSON.stringify({ reportId: jobStart.id }),
  });
  assert.equal(retriedReport.response.status, 200);
  assert.equal(retriedReport.body.report.gpsLookupStatus, 'paired');
  assert.equal(retriedReport.body.gpsReconciliation.deviceSource.status, 'received');
  assert.equal(retriedReport.body.gpsReconciliation.pairStatus, 'paired');

  const closedStart = await jsonRequest(baseUrl, '/api/job-starts', { method: 'POST', body: JSON.stringify(jobStart) });
  assert.equal(closedStart.response.status, 200);
  assert.equal(closedStart.body.closed, true);

  const deduplicated = await jsonRequest(baseUrl, '/api/reports', { method: 'POST', body: JSON.stringify(report) });
  assert.equal(deduplicated.response.status, 200);
  assert.equal(deduplicated.body.deduplicated, true);

  const deviceHistory = await jsonRequest(baseUrl, '/api/device-jobs?deviceId=android-device-001&vehicleNumber=74-1286&page=1&pageSize=1&search=OPS-contract-001');
  assert.equal(deviceHistory.response.status, 200);
  assert.deepEqual(deviceHistory.body.jobs.map((item: { id: string }) => item.id), ['OPS-contract-001']);
  assert.equal(deviceHistory.body.pageInfo.total, 1);
  assert.equal(deviceHistory.body.pageInfo.hasNextPage, false);
  assert.equal(deviceHistory.body.summary.completed, 1);
  assert.deepEqual(deviceHistory.body.facets.months.length, 1);

  const conflicting = await jsonRequest(baseUrl, '/api/reports', {
    method: 'POST', body: JSON.stringify({ ...report, endTime: new Date(Date.now() + 5_000).toISOString() }),
  });
  assert.equal(conflicting.response.status, 409);

  const reassigned = await jsonRequest(baseUrl, '/api/admin/device-config', {
    method: 'POST', headers: adminHeaders, body: JSON.stringify({ vehicleNumber: '74-9999', deviceId: 'android-device-001' }),
  });
  assert.equal(reassigned.response.status, 200);

  const reassignedState = JSON.parse(await readFile(dataFile, 'utf8'));
  const previousAssignment = reassignedState.bindingHistory.find((item: { vehicleNumber: string; unboundAt: string | null }) => item.vehicleNumber === '74-1286' && item.unboundAt);
  const currentAssignment = reassignedState.bindingHistory.find((item: { vehicleNumber: string; boundAt: string; unboundAt: string | null }) => item.vehicleNumber === '74-9999' && !item.unboundAt);
  assert.ok(previousAssignment?.unboundAt);
  assert.ok(currentAssignment?.boundAt);

  const delayedCancelled = await jsonRequest(baseUrl, '/api/reports', {
    method: 'POST',
    body: JSON.stringify({ ...report, id: 'OPS-contract-002', status: 'Cancelled' }),
  });
  assert.equal(delayedCancelled.response.status, 201);
  assert.equal(delayedCancelled.body.report.status, 'Cancelled');
  assert.equal(delayedCancelled.body.report.gpsLookupStatus, 'not_applicable');
  const cancelledLookup = await jsonRequest(baseUrl, '/api/job-gps-sync', {
    method: 'POST', body: JSON.stringify({ jobId: 'OPS-contract-002', vehicleNumber: '74-1286', deviceId: 'android-device-001', targetAt: delayedCancelled.body.report.endTime }),
  });
  assert.equal(cancelledLookup.response.status, 409);
  assert.equal(cancelledLookup.body.error, 'Cancelled jobs do not require GPS lookup');

  const reports = await jsonRequest(baseUrl, '/api/reports', { headers: adminHeaders });
  assert.equal(reports.response.status, 200);
  assert.equal(reports.body.reports.filter((item: { id: string }) => item.id.startsWith('OPS-contract-')).length, 2);
  const completedReport = reports.body.reports.find((item: { id: string }) => item.id === jobStart.id);
  assert.equal(completedReport.deviceGpsSamples, 2);
  assert.equal(completedReport.fmsGpsSamples, 2);
  assert.equal(completedReport.pairedGpsSamples, 2);
  assert.equal(completedReport.attentionGpsSamples, 0);
  assert.equal(completedReport.lastDeviceLatitude, 13.757);
  assert.equal(completedReport.lastDeviceLongitude, 100.502);

  const persisted = JSON.parse(await readFile(dataFile, 'utf8'));
  assert.ok(persisted.bindingHistory.some((item: { vehicleNumber: string; unboundAt: string | null }) => item.vehicleNumber === '74-1286' && item.unboundAt));
  assert.equal(persisted.gpsSyncSamples.some((item: { jobId: string; fmsStatus: string }) => item.jobId === jobStart.id && item.fmsStatus === 'received'), true);
  assert.equal(persisted.activeJobs.some((item: { id: string }) => item.id === jobStart.id), false);
});

test('local API never treats the tablet as a GPS source when external adapters are absent', async t => {
  const port = await freePort();
  const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'songdee-ops-device-gps-'));
  const dataFile = path.join(fixtureDirectory, 'data.json');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      SONGDEE_DATA_FILE: dataFile,
      SONGDEE_DEVICE_GPS_API_URL: '',
      SONGDEE_FMS_GPS_API_URL: '',
      SONGDEE_GPS_MOTION_API_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode == null) child.kill('SIGTERM'); });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child);

  const binding = { vehicleNumber: 'DEVICE-GPS-01', deviceId: 'android-device-gps-only' };
  const connected = await jsonRequest(baseUrl, '/api/device-config', {
    method: 'POST', body: JSON.stringify(binding),
  });
  assert.equal(connected.response.status, 200);

  const rejected = await jsonRequest(baseUrl, '/api/gps-sync', { method: 'POST', body: '{}' });
  assert.equal(rejected.response.status, 410);

  const startTime = new Date().toISOString();
  const job = { id: 'OPS-device-only-contract', ...binding, mode: 'Load', startTime };
  const started = await jsonRequest(baseUrl, '/api/job-starts', { method: 'POST', body: JSON.stringify(job) });
  assert.equal(started.response.status, 201);
  const reconciliation = await jsonRequest(baseUrl, '/api/job-gps-sync', {
    method: 'POST', body: JSON.stringify({ jobId: job.id, ...binding, targetAt: startTime }),
  });
  assert.equal(reconciliation.response.status, 200);
  assert.equal(reconciliation.body.gpsSync, null);
  assert.equal(reconciliation.body.deviceSource.status, 'not_configured');

  const login = await jsonRequest(baseUrl, '/api/admin/login', {
    method: 'POST', body: JSON.stringify({ password: 'songdee-setup' }),
  });
  assert.equal(login.response.status, 200);
  const report = { ...job, endTime: new Date(Date.parse(startTime) + 1_000).toISOString() };
  const completed = await jsonRequest(baseUrl, '/api/reports', { method: 'POST', body: JSON.stringify(report) });
  assert.equal(completed.response.status, 201);
  assert.equal(completed.body.report.status, 'Completed');
  assert.equal(completed.body.report.gpsLookupStatus, 'pending');
  const completedLookup = await jsonRequest(baseUrl, '/api/job-gps-sync', {
    method: 'POST', body: JSON.stringify({ jobId: job.id, ...binding, targetAt: report.endTime }),
  });
  assert.equal(completedLookup.response.status, 200);
  assert.equal(completedLookup.body.report.gpsLookupStatus, 'lookup_unavailable');
  assert.match(completedLookup.body.report.gpsLookupMessage, /not configured/);
  const detail = await jsonRequest(baseUrl, `/api/admin/reports/${report.id}/gps`, {
    headers: { 'x-admin-token': String(login.body.token) },
  });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.gpsSummary.deviceSamples, 0);

  const persisted = JSON.parse(await readFile(dataFile, 'utf8'));
  assert.deepEqual(persisted.gpsSyncSamples, []);
});
