import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { fileURLToPath, URL as NodeUrl } from 'node:url';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseHttpAdapterUrl } from '../lib/adapter-url.mjs';

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

test('adapter configuration accepts only absolute HTTP and HTTPS URLs', () => {
  assert.equal(parseHttpAdapterUrl(''), null);
  assert.equal(parseHttpAdapterUrl('not a url'), null);
  assert.equal(parseHttpAdapterUrl('ftp://gps.example.test/report'), null);
  assert.equal(parseHttpAdapterUrl('/relative/adapter'), null);
  assert.equal(parseHttpAdapterUrl('https://gps.example.test/report')?.href, 'https://gps.example.test/report');
  assert.equal(parseHttpAdapterUrl(' http://127.0.0.1:4011/motion ')?.href, 'http://127.0.0.1:4011/motion');
  assert.equal(parseHttpAdapterUrl('http://gps.example.test/report', { allowHttp: false }), null);
});

test('local and production APIs degrade malformed adapter URLs without constructing them directly', async () => {
  const local = await readFile(fileURLToPath(new NodeUrl('../server.js', import.meta.url)), 'utf8');
  const production = await readFile(fileURLToPath(new NodeUrl('../web/lib/server/api.mjs', import.meta.url)), 'utf8');
  for (const source of [local, production]) {
    assert.match(source, /parseHttpAdapterUrl/);
    assert.match(source, /sourceStatus: 'misconfigured'/);
    assert.match(source, /adapter URL is invalid/);
  }
});

test('malformed adapter settings do not crash the local API or lose a completed report', async t => {
  const port = await freePort();
  const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), 'songdee-adapter-config-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      SONGDEE_DATA_FILE: path.join(fixtureDirectory, 'data.json'),
      SONGDEE_DRIVER_IDENTITY_API_URL: 'not-a-url',
      SONGDEE_GPS_MOTION_API_URL: 'not-a-url',
      SONGDEE_DEVICE_GPS_API_URL: 'not-a-url',
      SONGDEE_FMS_GPS_API_URL: 'not-a-url',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode == null) child.kill('SIGTERM'); });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child);

  const binding = { vehicleNumber: 'QA-ADAPTER-01', deviceId: 'android-adapter-01' };
  const connected = await jsonRequest(baseUrl, '/api/device-config', { method: 'POST', body: JSON.stringify(binding) });
  assert.equal(connected.response.status, 200);

  const driver = await jsonRequest(baseUrl, `/api/driver-identity?deviceId=${binding.deviceId}&vehicleNumber=${binding.vehicleNumber}`);
  assert.equal(driver.response.status, 200);
  assert.equal(driver.body.sourceStatus, 'misconfigured');

  const motion = await jsonRequest(baseUrl, `/api/vehicle-motion?deviceId=${binding.deviceId}`);
  assert.equal(motion.response.status, 200);
  assert.equal(motion.body.sourceStatus, 'misconfigured');

  const startTime = new Date().toISOString();
  const started = await jsonRequest(baseUrl, '/api/job-starts', {
    method: 'POST',
    body: JSON.stringify({ id: 'OPS-invalid-adapter', ...binding, mode: 'Load', startTime }),
  });
  assert.equal(started.response.status, 201);
  const gps = await jsonRequest(baseUrl, '/api/job-gps-sync', {
    method: 'POST',
    body: JSON.stringify({ jobId: 'OPS-invalid-adapter', ...binding, targetAt: startTime }),
  });
  assert.equal(gps.response.status, 200);
  assert.equal(gps.body.gpsSync, null);
  assert.equal(gps.body.deviceSource.status, 'unavailable');

  const report = await jsonRequest(baseUrl, '/api/reports', {
    method: 'POST',
    body: JSON.stringify({ id: 'OPS-invalid-adapter', ...binding, mode: 'Load', startTime, endTime: new Date(Date.parse(startTime) + 1_000).toISOString() }),
  });
  assert.equal(report.response.status, 201);
  assert.equal(report.body.report.gpsLookupStatus, 'pending');
  const completedLookup = await jsonRequest(baseUrl, '/api/job-gps-sync', {
    method: 'POST',
    body: JSON.stringify({ jobId: 'OPS-invalid-adapter', ...binding, targetAt: report.body.report.endTime }),
  });
  assert.equal(completedLookup.response.status, 200);
  assert.equal(completedLookup.body.report.gpsLookupStatus, 'lookup_failed');
  assert.match(completedLookup.body.report.gpsLookupMessage, /adapter URL is invalid/);

  const health = await jsonRequest(baseUrl, '/api/health');
  assert.equal(health.response.status, 200);
});
