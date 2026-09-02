import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

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
      if (response.ok) return;
    } catch { /* Server may still be starting. */ }
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

test('route rename, active-job deletion guard, completion retry, reassignment, and deletion form one safe lifecycle', async t => {
  const port = await freePort();
  const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'songdee-route-contract-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(port), SONGDEE_DATA_FILE: path.join(fixtureDirectory, 'data.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode == null) child.kill('SIGTERM'); });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child);

  const login = await jsonRequest(baseUrl, '/api/admin/login', {
    method: 'POST', body: JSON.stringify({ password: 'songdee-setup' }),
  });
  assert.equal(login.response.status, 200);
  const adminHeaders = { 'x-admin-token': String(login.body.token) };

  const createdRoute = await jsonRequest(baseUrl, '/api/admin/job-routes', {
    method: 'POST', headers: adminHeaders, body: JSON.stringify({
      routeName: 'N21',
      googleMapsUrl: 'https://www.google.co.th/maps/dir/Start/Finish/data=!4m4!1d100.50!2d13.70!1d101.10!2d16.30',
    }),
  });
  assert.equal(createdRoute.response.status, 201);
  const routeId = String(createdRoute.body.route.id);

  const binding = await jsonRequest(baseUrl, '/api/device-config', {
    method: 'POST', body: JSON.stringify({ vehicleNumber: '74-1286', deviceId: 'route-device-001' }),
  });
  assert.equal(binding.response.status, 200);

  const startTime = new Date().toISOString();
  const job = {
    id: 'OPS-route-contract-001', vehicleNumber: '74-1286', deviceId: 'route-device-001',
    mode: 'Load', routeName: 'N21', startTime,
  };
  const started = await jsonRequest(baseUrl, '/api/job-starts', { method: 'POST', body: JSON.stringify(job) });
  assert.equal(started.response.status, 201);
  assert.equal(started.body.jobStart.routeName, 'N21');

  const blockedDelete = await jsonRequest(baseUrl, `/api/admin/job-routes/${routeId}`, { method: 'DELETE', headers: adminHeaders });
  assert.equal(blockedDelete.response.status, 409);

  const renamed = await jsonRequest(baseUrl, `/api/admin/job-routes/${routeId}`, {
    method: 'PUT', headers: adminHeaders, body: JSON.stringify({
      routeName: 'N21 Phetchabun',
      googleMapsUrl: createdRoute.body.route.googleMapsUrl,
    }),
  });
  assert.equal(renamed.response.status, 200);

  const adminRouteSearch = await jsonRequest(baseUrl, '/api/admin/job-route-options?q=phet&limit=1', { headers: adminHeaders });
  assert.equal(adminRouteSearch.response.status, 200);
  assert.deepEqual(adminRouteSearch.body.routes, [{ id: routeId, routeName: 'N21 Phetchabun' }]);
  assert.equal(adminRouteSearch.body.hasMore, false);

  const deviceRouteSearch = await jsonRequest(baseUrl, '/api/job-routes?deviceId=route-device-001&q=N21&limit=1');
  assert.equal(deviceRouteSearch.response.status, 200);
  assert.deepEqual(deviceRouteSearch.body.routes, [{ id: routeId, routeName: 'N21 Phetchabun' }]);

  const report = { ...job, endTime: new Date(Date.parse(startTime) + 1_000).toISOString() };
  const completed = await jsonRequest(baseUrl, '/api/reports', { method: 'POST', body: JSON.stringify(report) });
  assert.equal(completed.response.status, 201);
  assert.equal(completed.body.report.routeName, 'N21 Phetchabun');

  const retried = await jsonRequest(baseUrl, '/api/reports', { method: 'POST', body: JSON.stringify(report) });
  assert.equal(retried.response.status, 200);
  assert.equal(retried.body.deduplicated, true);
  assert.equal(retried.body.report.routeName, 'N21 Phetchabun');

  const unassigned = await jsonRequest(baseUrl, `/api/admin/reports/${job.id}/route`, {
    method: 'PUT', headers: adminHeaders, body: JSON.stringify({ routeName: null }),
  });
  assert.equal(unassigned.response.status, 200);
  assert.equal(unassigned.body.report.routeName, null);

  const deleted = await jsonRequest(baseUrl, `/api/admin/job-routes/${routeId}`, { method: 'DELETE', headers: adminHeaders });
  assert.equal(deleted.response.status, 200);
});

test('a work-period route applies to existing jobs and is inherited until Finish work', async t => {
  const port = await freePort();
  const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'songdee-work-period-route-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(port), SONGDEE_DATA_FILE: path.join(fixtureDirectory, 'data.json') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode == null) child.kill('SIGTERM'); });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child);

  const login = await jsonRequest(baseUrl, '/api/admin/login', {
    method: 'POST', body: JSON.stringify({ password: 'songdee-setup' }),
  });
  const adminHeaders = { 'x-admin-token': String(login.body.token) };
  const route = await jsonRequest(baseUrl, '/api/admin/job-routes', {
    method: 'POST', headers: adminHeaders, body: JSON.stringify({
      routeName: 'N8',
      googleMapsUrl: 'https://www.google.co.th/maps/dir/Start/Finish/data=!4m4!1d100.50!2d13.70!1d101.10!2d16.30',
    }),
  });
  assert.equal(route.response.status, 201);

  const binding = await jsonRequest(baseUrl, '/api/device-config', {
    method: 'POST', body: JSON.stringify({ vehicleNumber: '69-8617', deviceId: 'work-period-device-001' }),
  });
  assert.equal(binding.response.status, 200);

  const baseTime = Date.now() + 10_000;
  const timestamp = (offsetMs: number) => new Date(baseTime + offsetMs).toISOString();
  const existingReports = [
    { id: 'OPS-work-period-load', mode: 'Load', startTime: timestamp(0), endTime: timestamp(60_000) },
    { id: 'OPS-work-period-refuel', mode: 'Refuel', startTime: timestamp(90_000), endTime: timestamp(150_000) },
  ];
  for (const report of existingReports) {
    const saved = await jsonRequest(baseUrl, '/api/reports', {
      method: 'POST', body: JSON.stringify({ ...report, vehicleNumber: '69-8617', deviceId: 'work-period-device-001' }),
    });
    assert.equal(saved.response.status, 201);
    assert.equal(saved.body.report.routeName, null);
  }

  const applied = await jsonRequest(baseUrl, '/api/admin/reports/OPS-work-period-refuel/route', {
    method: 'PUT', headers: adminHeaders, body: JSON.stringify({ routeName: 'N8', scope: 'work_period' }),
  });
  assert.equal(applied.response.status, 200);
  assert.equal(applied.body.scope, 'work_period');
  assert.deepEqual(applied.body.reportIds.sort(), existingReports.map(report => report.id).sort());
  assert.equal(applied.body.report.routeName, 'N8');

  const started = await jsonRequest(baseUrl, '/api/job-starts', {
    method: 'POST', body: JSON.stringify({
      id: 'OPS-work-period-unload', vehicleNumber: '69-8617', deviceId: 'work-period-device-001', mode: 'Unload', startTime: timestamp(180_000),
    }),
  });
  assert.equal(started.response.status, 201);
  assert.equal(started.body.jobStart.routeName, 'N8');

  const completed = await jsonRequest(baseUrl, '/api/reports', {
    method: 'POST', body: JSON.stringify({
      id: 'OPS-work-period-unload', vehicleNumber: '69-8617', deviceId: 'work-period-device-001', mode: 'Unload', startTime: timestamp(180_000), endTime: timestamp(240_000),
    }),
  });
  assert.equal(completed.response.status, 201);
  assert.equal(completed.body.report.routeName, 'N8');

  const finished = await jsonRequest(baseUrl, '/api/reports', {
    method: 'POST', body: JSON.stringify({
      id: 'OPS-work-period-finish', vehicleNumber: '69-8617', deviceId: 'work-period-device-001', mode: 'Finish work', startTime: timestamp(270_000), endTime: timestamp(300_000),
    }),
  });
  assert.equal(finished.response.status, 201);
  assert.equal(finished.body.report.routeName, 'N8');

  const nextPeriod = await jsonRequest(baseUrl, '/api/reports', {
    method: 'POST', body: JSON.stringify({
      id: 'OPS-next-period-load', vehicleNumber: '69-8617', deviceId: 'work-period-device-001', mode: 'Load', startTime: timestamp(330_000), endTime: timestamp(390_000),
    }),
  });
  assert.equal(nextPeriod.response.status, 201);
  assert.equal(nextPeriod.body.report.routeName, null);
});
