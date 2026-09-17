import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHowenGateway } from '../gateway/server.mjs';
import { createHowenSimulator } from '../gateway/simulator.mjs';
import { createSseParser } from '../web/app/gateway-stream.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function until(predicate, timeout = 8000) {
  const untilTime = Date.now() + timeout;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > untilTime) throw new Error('Timed out waiting for the gateway flow');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('real TCP telemetry reaches the protected Ops snapshot and SSE routes without VSS', { timeout: 15000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'howen-ops-e2e-'));
  const key = 'test-only-howen-ops-key-long-enough';
  const gateway = createHowenGateway({ env: {}, apiKey: key, dataDir: join(folder, 'gateway'), tcpPort: 0, httpPort: 0, simulatedDevices: ['SIM-HOWEN-001'], streamIntervalMs: 100 });
  t.after(async () => { await gateway.stop(); await rm(folder, { recursive: true, force: true }); });
  const addresses = await gateway.start();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: root, stdio: 'ignore', env: {
    ...process.env, HOST: '127.0.0.1', PORT: String(port),
    SONGDEE_DATA_FILE: join(folder, 'ops.json'), SONGDEE_ADMIN_PASSWORD: 'test-local-password', SONGDEE_CORS_ORIGIN: '',
    HOWEN_GATEWAY_URL: `http://127.0.0.1:${addresses.http.port}`, HOWEN_GATEWAY_API_KEY: key,
    HOWEN_VSS_BASE_URL: '', HOWEN_VSS_USERNAME: '', HOWEN_VSS_PASSWORD: '',
  } });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended; }
  });
  await until(async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } });
  for (const path of ['snapshot', 'events']) assert.equal((await fetch(`${base}/api/admin/gateway/${path}`)).status, 401);
  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-local-password' }) });
  assert.equal(login.status, 200);
  const headers = { 'x-admin-token': (await login.json()).token, Origin: 'http://dashboard.example.invalid' };
  const initial = await (await fetch(`${base}/api/admin/gateway/snapshot`, { headers })).json();
  assert.equal(initial.source, 'howen');
  assert.equal(initial.devices.length, 0);
  const controller = new AbortController();
  const stream = await fetch(`${base}/api/admin/gateway/events`, { headers, signal: controller.signal });
  assert.equal(stream.status, 200);
  assert.equal(stream.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(stream.headers.get('X-Accel-Buffering'), 'no');
  assert.match(stream.headers.get('Content-Type'), /text\/event-stream/);
  let latest = null;
  const parser = createSseParser(event => { if (event.event === 'snapshot') latest = JSON.parse(event.data); });
  const reader = stream.body.getReader();
  const consume = (async () => { try { for (;;) { const next = await reader.read(); if (next.done) break; parser.push(next.value); } } catch (error) { if (!controller.signal.aborted) throw error; } })();
  t.after(async () => { controller.abort(); await consume; });
  const simulator = createHowenSimulator({ port: addresses.tcp.port, intervalMs: 100 });
  t.after(() => simulator.stop());
  await simulator.start();
  await until(() => latest?.devices?.[0]?.telemetry?.gps?.valid && latest.packets.some(packet => packet.messageType === '0x4051'));
  assert.equal(latest.devices[0].deviceId, 'SIM-HOWEN-001');
  assert.equal(latest.devices[0].simulated, true);
  assert.equal(typeof latest.devices[0].telemetry.acc, 'boolean');
  assert.equal(latest.devices[0].telemetry.inputs.length, 16);
  assert.ok(latest.packets.some(packet => packet.raw.headerHex.startsWith('4801')));
  assert.equal(JSON.stringify(latest).includes(key), false);
  await simulator.stop();
  await until(() => latest.devices[0].connected === false);
  assert.ok(latest.packets.length > 0);
  controller.abort(); await consume;
});
