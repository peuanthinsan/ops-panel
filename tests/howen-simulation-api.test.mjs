import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { createHowenGateway } from '../gateway/server.mjs';
import { createSseParser } from '../web/app/gateway-stream.mjs';

const apiKey = 'test-only-simulation-api-private-key';
const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
async function until(predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for simulation state');
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}
async function setup(t, overrides = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'howen-simulation-api-'));
  const gateway = createHowenGateway({ env: {}, apiKey, dataDir: join(folder, 'gateway'), tcpPort: 0, httpPort: 0, enableSimulation: true, simulatedDevices: ['SIM-HOWEN-001'], streamIntervalMs: 100, simulationStepDelayMs: 0, ...overrides });
  t.after(async () => { await gateway.stop(); await rm(folder, { recursive: true, force: true }); });
  const addresses = await gateway.start();
  return { gateway, folder, addresses, base: `http://127.0.0.1:${addresses.http.port}` };
}
const post = (base, body, requestHeaders = headers) => fetch(`${base}/simulation`, { method: 'POST', headers: requestHeaders, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('stop during gateway startup waits for acquired listeners and releases the writer lock', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'howen-start-stop-'));
  const gateway = createHowenGateway({ env: {}, apiKey, dataDir: folder, tcpPort: 0, httpPort: 0, enableSimulation: true, simulatedDevices: ['SIM-HOWEN-001'] });
  t.after(async () => { await gateway.stop(); await rm(folder, { recursive: true, force: true }); });
  const starting = gateway.start();
  const stopping = gateway.stop();
  const addresses = await starting;
  await stopping;
  assert.equal(gateway.snapshot().gateway.status, 'stopped');
  await assert.rejects(readFile(join(folder, 'writer.lock')), error => error.code === 'ENOENT');
  await assert.rejects(fetch(`http://127.0.0.1:${addresses.http.port}/health`));
  await gateway.start();
  assert.equal(gateway.snapshot().gateway.status, 'listening');
});

test('simulation is opt-in and requires loopback plus an explicitly labelled simulator', async t => {
  const options = { env: {}, apiKey, dataDir: '/unused', enableSimulation: true };
  assert.throws(() => createHowenGateway(options), /simulation lab requires/);
  assert.throws(() => createHowenGateway({ ...options, tcpHost: '0.0.0.0', allowedDevices: ['SIM-HOWEN-001'], simulatedDevices: ['SIM-HOWEN-001'] }), /simulation lab requires/);
  assert.throws(() => createHowenGateway({ ...options, allowedDevices: ['REAL-1'], simulatedDevices: ['SIM-HOWEN-001'] }), /simulation lab requires/);
  const { gateway, base } = await setup(t, { enableSimulation: false });
  assert.equal(gateway.snapshot().simulation.enabled, false);
  assert.equal((await post(base, { action: 'run', scenarioId: 'all', confirmationMode: 'driver' })).status, 403);
  assert.equal((await post(base, { action: 'stop' }, { 'Content-Type': 'application/json' })).status, 401);
});

test('private simulation controls reject malformed, oversized and arbitrary commands', async t => {
  const { base, gateway } = await setup(t);
  for (const command of ['{', 'null', '[]', { action: 'unknown' }, { action: 'run', scenarioId: 'unknown', confirmationMode: 'driver' }, { action: 'run', scenarioId: 'all', confirmationMode: 'invalid' }, { action: 'stop', host: 'remote.invalid' }]) {
    assert.equal((await post(base, command)).status, 400);
  }
  assert.equal((await post(base, JSON.stringify({ action: 'stop', padding: 'x'.repeat(5000) }))).status, 413);
  assert.equal(gateway.snapshot().simulation.status, 'idle');
});

test('concurrent runs are rejected and stopping closes the simulator without writing jobs', async t => {
  const { base, gateway } = await setup(t, { simulationStepDelayMs: 100 });
  assert.equal((await post(base, { action: 'run', scenarioId: 'all', confirmationMode: 'input' })).status, 200);
  assert.equal((await post(base, { action: 'run', scenarioId: 'sos', confirmationMode: 'input' })).status, 409);
  assert.equal((await post(base, { action: 'stop' })).status, 200);
  assert.equal(gateway.snapshot().simulation.status, 'stopped');
  await until(() => gateway.snapshot().gateway.connectedDevices === 0);
});

test('all 11 scenarios run through authenticated Ops controls and stream real TCP evidence', { timeout: 30000 }, async t => {
  const { gateway, folder, addresses } = await setup(t);
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const dataFile = join(folder, 'ops.json');
  const child = spawn(process.execPath, ['server.js'], { cwd: new URL('../', import.meta.url), stdio: 'ignore', env: {
    ...process.env, HOST: '127.0.0.1', PORT: String(port), SONGDEE_DATA_FILE: dataFile,
    SONGDEE_ADMIN_PASSWORD: 'simulation-local-test-only',
    HOWEN_GATEWAY_URL: `http://127.0.0.1:${addresses.http.port}`, HOWEN_GATEWAY_API_KEY: apiKey,
  } });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended; } });
  const base = `http://127.0.0.1:${port}`;
  await until(async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } });
  const path = `${base}/api/admin/gateway/simulation`;
  const command = JSON.stringify({ action: 'run', scenarioId: 'all', confirmationMode: 'driver' });
  assert.equal((await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: command })).status, 401);
  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'simulation-local-test-only' }) });
  const adminHeaders = { 'Content-Type': 'application/json', 'x-admin-token': (await login.json()).token };
  const stateBefore = await readFile(dataFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  const controller = new AbortController();
  const response = await fetch(`${base}/api/admin/gateway/events`, { headers: adminHeaders, signal: controller.signal });
  assert.equal(response.status, 200);
  let latest;
  const parser = createSseParser(event => { if (event.event === 'snapshot') latest = JSON.parse(event.data); });
  const reader = response.body.getReader();
  const consume = (async () => { try { for (;;) { const next = await reader.read(); if (next.done) break; parser.push(next.value); } } catch (error) { if (!controller.signal.aborted) throw error; } })();
  t.after(async () => { controller.abort(); await consume; });
  const run = await fetch(path, { method: 'POST', headers: adminHeaders, body: command });
  assert.equal(run.status, 200);
  await until(() => ['completed', 'failed'].includes(latest?.simulation?.status));
  const simulation = latest.simulation;
  assert.equal(simulation.status, 'completed', JSON.stringify(simulation));
  assert.equal(simulation.summary.total, 11);
  assert.equal(simulation.summary.passed, 11, JSON.stringify(simulation.results));
  assert.equal(simulation.summary.failed, 0);
  assert.equal(simulation.results.length, 11);
  assert.ok(simulation.results.every(result => result.status === 'passed'));
  assert.ok(simulation.events.some(event => event.source === 'howen-tcp' && event.packetId));
  assert.ok(simulation.events.some(event => event.source === 'simulation-app'));
  assert.ok(simulation.events.some(event => event.source === 'simulation-media'));
  assert.ok(latest.packets.some(packet => packet.messageType === '0x1051'));
  assert.ok(latest.packets.every(packet => packet.simulated === true));
  assert.equal(JSON.stringify(latest).includes(apiKey), false);
  assert.equal(gateway.snapshot().gateway.decodeErrors, 0);
  const stateAfter = await readFile(dataFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  assert.equal(stateAfter, stateBefore, 'Simulation must not create or mutate operational job data');
});
