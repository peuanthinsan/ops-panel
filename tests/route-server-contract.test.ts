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
