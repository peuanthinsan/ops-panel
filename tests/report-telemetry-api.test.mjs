import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const credentials = { username: 'telemetry-test-user', password: 'telemetry-test-password', token: 'telemetry-test-private-token' };
const adminPassword = 'telemetry-test-admin-password';
const report = {
  id: 'OPS-telemetry', vehicleNumber: 'TEST-100', deviceId: 'telemetry-test-device',
  mode: 'Load', status: 'Completed', startTime: '2026-09-24T00:45:38+07:00',
  endTime: '2026-09-24T00:50:38+07:00', gpsSamples: 0,
};

async function freePort() {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function fixture(t, { reports = [report], configured = true, fuelResponse } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'songdee-report-telemetry-'));
  const dataFile = path.join(directory, 'data.json');
  const requests = [];
  let child;
  let upstream;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    if (upstream?.listening) {
      upstream.closeAllConnections();
      await new Promise(resolve => upstream.close(resolve));
    }
    await rm(directory, { recursive: true, force: true });
  });
  await writeFile(dataFile, JSON.stringify({ reports, activeJobs: [], gpsSyncSamples: [], deviceBindings: [] }));
  upstream = http.createServer((request, response) => {
    const target = new URL(request.url, 'http://127.0.0.1');
    requests.push(target);
    response.setHeader('Content-Type', 'application/json');
    if (target.pathname === '/Api/VTService.svc/GetToken') {
      response.end(JSON.stringify({ vResponseCode: 0, token: credentials.token }));
    } else if (target.pathname === '/Api/VTService.svc/GetFuelStatus') {
      const result = fuelResponse?.(target) || { vResponseCode: 0, vTotalRecords: 0, vData: '[]' };
      response.statusCode = result.httpStatus || 200;
      response.end(JSON.stringify(result));
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'Unexpected upstream endpoint' }));
    }
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('../', import.meta.url),
    stdio: 'ignore',
    env: {
      ...process.env, NODE_ENV: 'development', PORT: String(port),
      SONGDEE_DATA_FILE: dataFile, SONGDEE_ADMIN_PASSWORD: adminPassword,
      SONGDEE_DATA_FM_BASE_URL: `http://127.0.0.1:${upstream.address().port}`,
      SONGDEE_DATA_FM_USERNAME: configured ? credentials.username : '',
      SONGDEE_DATA_FM_PASSWORD: configured ? credentials.password : '',
      SONGDEE_DATA_FM_TIME_ZONE: 'Asia/Bangkok',
      FLEET_DATA_FM_USERNAME: '', FLEET_DATA_FM_PASSWORD: '',
    },
  });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Telemetry API fixture exited with code ${child.exitCode}`);
    try { ready = (await fetch(`${base}/api/health`)).ok; } catch { /* Startup in progress. */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(ready, true, 'Telemetry API fixture should become ready');
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: adminPassword }),
  });
  assert.equal(login.status, 200);
  const headers = { 'x-admin-token': (await login.json()).token };
  async function telemetry(id = report.id, query = '', authenticated = true) {
    const response = await fetch(`${base}/api/admin/reports/${id}/telemetry${query}`, { headers: authenticated ? headers : {} });
    return { response, body: await response.json() };
  }
  return { base, headers, requests, telemetry };
}

function assertPublicResponse(body) {
  const serialized = JSON.stringify(body);
  for (const secret of Object.values(credentials)) assert.equal(serialized.includes(secret), false);
  for (const forbidden of ['tank2analog', 'drivername', 'latitude', 'longitude', 'jtoken', 'raw']) {
    assert.equal(serialized.toLowerCase().includes(`"${forbidden}"`), false);
  }
}

test('report telemetry requires admin and uses the saved report vehicle and period even without GPS samples', async t => {
  const fixtureRows = [
    { datetime: '24/09/2026 0:45:37', speed: 99, totalfuel: 99 },
    { datetime: '24/09/2026 0:45:38', speed: '0', totalfuel: '0' },
    { datetime: '24/09/2026 0:47:00', speed: null, totalfuel: '2.11', tank2analog: 1.89, drivername: 'private-driver', jtoken: credentials.token },
    { datetime: '24/09/2026 0:50:38', speed: '30.5', totalfuel: null },
    { datetime: '24/09/2026 0:50:39', speed: 99, totalfuel: 99 },
  ].map(row => ({ vehicleno: report.vehicleNumber, ...row }));
  const app = await fixture(t, { fuelResponse: () => ({ vResponseCode: 0, vTotalRecords: fixtureRows.length, vData: JSON.stringify(fixtureRows) }) });
  assert.equal((await app.telemetry(report.id, '', false)).response.status, 401);
  assert.equal((await app.telemetry('OPS-missing')).response.status, 404);
  assert.equal(app.requests.length, 0, 'Rejected requests must not contact Data-FM');

  const result = await app.telemetry(report.id, '?vehicleNumber=OTHER&vehicleno=OTHER&fromAt=2020-01-01&toAt=2030-01-01');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.reportId, report.id);
  assert.equal(result.body.source, 'data-fm');
  assert.equal(result.body.fuelUnit, null);
  assert.equal(result.body.status, 'received', result.body.message);
  assert.equal(Date.parse(result.body.fromAt), Date.parse(report.startTime));
  assert.equal(Date.parse(result.body.toAt), Date.parse(report.endTime));
  assert.deepEqual(result.body.samples.map(({ capturedAt, speedKph, totalFuel }) => ({ capturedAt, speedKph, totalFuel })), [
    { capturedAt: '2026-09-23T17:45:38.000Z', speedKph: 0, totalFuel: 0 },
    { capturedAt: '2026-09-23T17:47:00.000Z', speedKph: null, totalFuel: 2.11 },
    { capturedAt: '2026-09-23T17:50:38.000Z', speedKph: 30.5, totalFuel: null },
  ]);
  for (const sample of result.body.samples) {
    assert.deepEqual(Object.keys(sample).sort(), ['capturedAt', 'id', 'speedKph', 'totalFuel']);
    assert.equal(typeof sample.id, 'string');
    assert.ok(sample.id);
  }
  const fuelRequests = app.requests.filter(request => request.pathname.endsWith('/GetFuelStatus'));
  assert.equal(fuelRequests.length, 1);
  assert.equal(fuelRequests[0].searchParams.get('vehicleno'), report.vehicleNumber);
  assert.equal(fuelRequests[0].searchParams.get('fromdatetime'), '2026.09.24 00:45:38');
  assert.equal(fuelRequests[0].searchParams.get('todatetime'), '2026.09.24 00:50:38');
  assert.equal(fuelRequests[0].searchParams.get('jtoken'), credentials.token);
  assertPublicResponse(result.body);
});

test('report telemetry rejects invalid and excessive saved periods without upstream requests and accepts zero duration', async t => {
  const reports = [
    { ...report, id: 'OPS-invalid', startTime: 'not-a-date' },
    { ...report, id: 'OPS-missing-end', endTime: null },
    { ...report, id: 'OPS-reversed', endTime: '2026-09-23T00:45:38+07:00' },
    { ...report, id: 'OPS-long', endTime: '2026-10-02T00:45:38+07:00' },
    { ...report, id: 'OPS-instant', endTime: report.startTime },
  ];
  const app = await fixture(t, { reports, fuelResponse: () => ({ vResponseCode: 0, vTotalRecords: 1, vData: [{ vehicleno: report.vehicleNumber, datetime: '24/09/2026 0:45:38', speed: 0, totalfuel: 400 }] }) });
  for (const savedReport of reports.slice(0, -1)) {
    const { response, body } = await app.telemetry(savedReport.id);
    assert.equal(response.status, 200);
    assert.equal(body.status, 'unavailable', savedReport.id);
    assert.deepEqual(body.samples, []);
    assert.ok(body.message);
  }
  assert.equal(app.requests.length, 0);
  const instant = await app.telemetry('OPS-instant');
  assert.equal(instant.response.status, 200);
  assert.equal(instant.body.status, 'received', instant.body.message);
  assert.equal(instant.body.samples.length, 1);
  assert.equal(instant.body.samples[0].totalFuel, 400);
  const fuelRequest = app.requests.find(request => request.pathname.endsWith('/GetFuelStatus'));
  assert.equal(fuelRequest.searchParams.get('fromdatetime'), fuelRequest.searchParams.get('todatetime'));
});

test('report telemetry reports upstream failure explicitly without exposing vendor response data', async t => {
  const app = await fixture(t, { fuelResponse: () => ({
    httpStatus: 503, vResponseCode: 4, error: `${credentials.username}:${credentials.password}:${credentials.token}`,
    vTotalRecords: 1, vData: [{ vehicleno: report.vehicleNumber, datetime: '24/09/2026 0:45:38', speed: 0, totalfuel: 0 }],
  }) });
  const { response, body } = await app.telemetry();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'unavailable');
  assert.deepEqual(body.samples, []);
  assert.ok(body.message);
  assertPublicResponse(body);
});

test('report telemetry reports an unconfigured source without contacting upstream', async t => {
  const app = await fixture(t, { configured: false });
  const { response, body } = await app.telemetry();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'not_configured');
  assert.equal(body.source, 'data-fm');
  assert.equal(body.fuelUnit, null);
  assert.deepEqual(body.samples, []);
  assert.ok(body.message);
  assert.equal(app.requests.length, 0);
});

test('report telemetry preserves a verified empty upstream result as received', async t => {
  const app = await fixture(t);
  const { response, body } = await app.telemetry();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'received', body.message);
  assert.deepEqual(body.samples, []);
  assert.equal(app.requests.filter(request => request.pathname.endsWith('/GetFuelStatus')).length, 1);
  assertPublicResponse(body);
});
