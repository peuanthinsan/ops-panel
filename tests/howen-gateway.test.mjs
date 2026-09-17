import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm, rename, mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHowenGateway } from '../gateway/server.mjs';
import { createJournalStore } from '../gateway/store.mjs';
import { createHowenSimulator, encodeSimulatedStatus } from '../gateway/simulator.mjs';
import { createFrameDecoder, encodeFrame } from '../gateway/protocol.mjs';

const apiKey = 'gateway-test-key-with-at-least-24-characters';
const headers = { Authorization: `Bearer ${apiKey}` };
async function until(predicate, message = 'condition', timeout = 5000) {
  const started = Date.now();
  while (!await predicate()) {
    if (Date.now() - started > timeout) throw new Error(`Timed out waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}
async function setup(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'howen-gateway-test-'));
  const gateway = createHowenGateway({ env: {}, dataDir, apiKey, tcpPort: 0, httpPort: 0, streamIntervalMs: 100, ...options });
  t.after(async () => { await gateway.stop(); await rm(dataDir, { recursive: true, force: true }); });
  const addresses = await gateway.start();
  return { gateway, addresses, dataDir, base: `http://127.0.0.1:${addresses.http.port}` };
}
async function connect(port) {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  const decoder = createFrameDecoder();
  const packets = [];
  socket.on('error', () => {});
  socket.on('data', (chunk) => packets.push(...decoder.push(chunk)));
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  return { socket, packets };
}
async function register(port, deviceId = 'TRUCK-1') {
  const client = await connect(port);
  client.socket.write(encodeFrame(0x1001, { dn: deviceId, ss: 'test-session', gmt: '+07:00', simulation: true }));
  await until(() => client.packets.some((frame) => frame.type === 0x4050), 'subscriptions');
  return client;
}

test('actual TCP simulator completes registration, subscriptions, binary GPS/I/O, alarms and live authenticated SSE', async (t) => {
  const { gateway, addresses, base } = await setup(t, { simulatedDevices: ['SIM-HOWEN-001'] });
  assert.equal((await fetch(`${base}/snapshot`)).status, 401);
  assert.equal((await fetch(`${base}/events`, { headers: { Authorization: 'Bearer incorrect-but-long-enough-key' } })).status, 401);
  const health = await fetch(`${base}/health`, { headers });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('access-control-allow-origin'), null);
  const controller = new AbortController();
  const stream = await fetch(`${base}/events`, { headers, signal: controller.signal });
  assert.match(stream.headers.get('content-type'), /event-stream/);
  const reader = stream.body.getReader();
  let streamText = '';
  const consume = (async () => { try { while (true) { const result = await reader.read(); if (result.done) break; streamText += Buffer.from(result.value).toString(); } } catch {} })();
  t.after(async () => { controller.abort(); await consume; });
  await until(() => streamText.includes('event: snapshot'), 'initial SSE snapshot');
  const simulator = createHowenSimulator({ port: addresses.tcp.port, intervalMs: 40 });
  t.after(() => simulator.stop());
  await simulator.start();
  await until(() => simulator.stats.statusAcks >= 4 && simulator.stats.alarmAcks >= 2 && simulator.stats.heartbeatAcks >= 1, 'wire acknowledgements');
  await until(() => streamText.includes('SIM-HOWEN-001') && streamText.includes('0x1041'), 'SSE telemetry update');
  const snapshot = await (await fetch(`${base}/snapshot`, { headers })).json();
  assert.equal(snapshot.source, 'howen');
  assert.equal(snapshot.devices.length, 1);
  const device = snapshot.devices[0];
  assert.equal(device.simulated, true);
  assert.equal(device.connected, true);
  assert.equal(device.telemetry.gps.valid, true);
  assert.ok(Math.abs(device.telemetry.gps.lat - 13.7563) < 0.001);
  assert.equal(typeof device.telemetry.acc, 'boolean');
  assert.equal(device.telemetry.inputs.length, 16);
  assert.ok(snapshot.packets.some((packet) => packet.kind === 'alarm' && packet.decoded.alarmState === 'start'));
  assert.ok(snapshot.packets.some((packet) => packet.kind === 'alarm' && packet.decoded.alarmState === 'end'));
  assert.ok(snapshot.packets.some((packet) => packet.direction === 'outbound' && packet.messageType === '0x4051'));
  const statusSubscription = snapshot.packets.find((packet) => packet.messageType === '0x4040');
  const alarmSubscription = snapshot.packets.find((packet) => packet.messageType === '0x4050');
  assert.ok(snapshot.packets.filter((packet) => packet.kind === 'status').every((packet) => packet.decoded.sessionId === statusSubscription.decoded.ss));
  assert.ok(snapshot.packets.filter((packet) => packet.kind === 'alarm').every((packet) => packet.decoded.sessionId === alarmSubscription.decoded.ss));
  const alarmStart = snapshot.packets.find((packet) => packet.kind === 'alarm' && packet.decoded.alarmState === 'start');
  const alarmEnd = snapshot.packets.find((packet) => packet.kind === 'alarm' && packet.decoded.alarmState === 'end');
  assert.equal(alarmStart.decoded.alarm.uuid, alarmEnd.decoded.alarm.uuid);
  assert.equal(alarmStart.decoded.alarm.st, alarmEnd.decoded.alarm.st);
  assert.ok(snapshot.packets.every((packet) => packet.raw.headerHex.startsWith('4801')));
  assert.equal(gateway.snapshot().gateway.decodeErrors, 0);
  await simulator.stop();
  await until(() => !gateway.snapshot().devices[0].connected, 'disconnect state');
});

test('restart preserves packet history and telemetry but marks prior devices offline', async (t) => {
  const { gateway, addresses, dataDir } = await setup(t, { simulatedDevices: ['SIM-HOWEN-001'] });
  const simulator = createHowenSimulator({ port: addresses.tcp.port, intervalMs: 100 });
  await simulator.start();
  await until(() => simulator.stats.statusAcks >= 1, 'first saved telemetry');
  const before = gateway.snapshot();
  await gateway.stop();
  await simulator.stop();
  const restarted = createHowenGateway({ env: {}, dataDir, apiKey, tcpPort: 0, httpPort: 0 });
  t.after(() => restarted.stop());
  await restarted.start();
  const after = restarted.snapshot();
  assert.equal(after.devices[0].connected, false);
  assert.equal(after.gateway.connectedDevices, 0);
  assert.deepEqual(after.devices[0].telemetry, before.devices[0].telemetry);
  assert.ok(after.packets.length >= before.packets.length);
  assert.ok(after.devices[0].disconnectedAt);
});

test('simulation flag is configured by operator, and device replacement stays connected', async (t) => {
  const { gateway, addresses } = await setup(t);
  const first = await register(addresses.tcp.port);
  t.after(() => first.socket.destroy());
  assert.equal(gateway.snapshot().devices[0].simulated, false);
  assert.ok(gateway.snapshot().packets.every((packet) => packet.simulated === false));
  const second = await register(addresses.tcp.port);
  t.after(() => second.socket.destroy());
  await until(() => first.socket.destroyed, 'replacement disconnect');
  assert.equal(gateway.snapshot().gateway.connectedDevices, 1);
  assert.equal(gateway.snapshot().devices[0].connected, true);
  second.socket.write(encodeFrame(0x1041, encodeSimulatedStatus({ sessionId: 'test-session', inputBits: 2 })));
  await until(() => second.packets.some((packet) => packet.type === 0x4041), 'replacement telemetry acknowledgement');
  assert.equal(gateway.snapshot().devices[0].telemetry.inputs[1].active, true);
});

test('unauthorized or oversized device traffic is rejected without creating a device', async (t) => {
  assert.throws(() => createHowenGateway({ apiKey, dataDir: '/tmp/unused', tcpHost: '0.0.0.0', env: {} }), /allowlist/);
  assert.throws(() => createHowenGateway({ apiKey, dataDir: '/tmp/unused', simulatedDevices: ['REAL-TRUCK'], env: {} }), /SIM-/);
  const { gateway, addresses } = await setup(t, { allowedDevices: ['ALLOWED'] });
  const denied = await connect(addresses.tcp.port);
  denied.socket.write(encodeFrame(0x1001, { dn: 'OTHER', ss: 'x' }));
  await until(() => denied.socket.destroyed, 'unlisted connection closed');
  assert.equal(gateway.snapshot().devices.length, 0);
  assert.equal(denied.packets.length, 0);
  const oversized = await connect(addresses.tcp.port);
  const header = Buffer.from([0x48, 1, 1, 0x10, 0, 0, 0, 0]); header.writeUInt32LE(1000000, 4);
  oversized.socket.write(header);
  await until(() => oversized.socket.destroyed, 'oversized frame rejected');
  assert.equal(gateway.snapshot().gateway.decodeErrors, 2);
});

test('storage failure closes intake without acknowledging undurable telemetry', async (t) => {
  const { gateway, addresses, dataDir } = await setup(t);
  const client = await register(addresses.tcp.port);
  await rename(join(dataDir, 'events.ndjson'), join(dataDir, 'events.saved.ndjson'));
  await mkdir(join(dataDir, 'events.ndjson'));
  const before = gateway.snapshot().gateway.receivedPackets;
  client.socket.write(encodeFrame(0x1041, encodeSimulatedStatus({ sessionId: 'test-session' })));
  await until(() => client.socket.destroyed, 'failed storage closes connection');
  assert.equal(client.packets.some((packet) => packet.type === 0x4041), false);
  assert.equal(gateway.snapshot().gateway.status, 'error');
  assert.equal(gateway.snapshot().gateway.storage.status, 'error');
  assert.equal(gateway.snapshot().gateway.receivedPackets, before);
  assert.equal(gateway.snapshot().devices[0].connected, false);
});

test('delayed binary telemetry stays in history without replacing newer GPS, ACC or I/O', async (t) => {
  const { gateway, addresses } = await setup(t);
  const client = await register(addresses.tcp.port);
  t.after(() => client.socket.destroy());
  const newer = new Date('2026-09-17T10:00:00Z');
  const older = new Date('2026-09-17T09:00:00Z');
  const subscription = client.packets.find((packet) => packet.type === 0x4040);
  const sessionId = JSON.parse(subscription.payload.toString().replace(/\0$/, '')).ss;
  client.socket.write(encodeFrame(0x1041, encodeSimulatedStatus({ sessionId, time: newer, lat: 14, acc: true, inputBits: 1 })));
  await until(() => client.packets.filter((packet) => packet.type === 0x4041).length === 1, 'new telemetry');
  client.socket.write(encodeFrame(0x1041, encodeSimulatedStatus({ sessionId, time: older, lat: 12, acc: false, inputBits: 0 })));
  await until(() => client.packets.filter((packet) => packet.type === 0x4041).length === 2, 'late telemetry acknowledgement');
  const snapshot = gateway.snapshot();
  const device = snapshot.devices[0];
  assert.equal(device.telemetry.gps.lat, 14);
  assert.equal(device.telemetry.acc, true);
  assert.equal(device.telemetry.inputs[0].active, true);
  assert.equal(device.telemetryTimestamps.gps.observedAt, newer.toISOString());
  assert.ok(snapshot.packets.some((packet) => packet.decoded?.gps?.lat === 12 && packet.warnings.some((warning) => warning.startsWith('Delayed gps'))));
  const receivedAt = device.telemetryReceivedAt;
  client.socket.write(encodeFrame(0x0001));
  await until(() => client.packets.some((packet) => packet.type === 0x0001), 'heartbeat acknowledgement');
  assert.equal(gateway.snapshot().devices[0].telemetryReceivedAt, receivedAt);
});

test('journal compaction retains bounded records and repairs only a partial final line', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'howen-store-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = await createJournalStore({ dataDir, maxPackets: 3, maxJournalBytes: 500 });
  for (let index = 0; index < 8; index++) await store.append({ type: 'packet', packet: { id: index, direction: 'inbound', content: 'test'.repeat(20) } });
  assert.equal(store.state.packets.length, 3);
  assert.equal(store.state.receivedPackets, 8);
  await store.close();
  await appendFile(join(dataDir, 'events.ndjson'), '{"type":"partial');
  const replay = await createJournalStore({ dataDir, maxPackets: 3, maxJournalBytes: 500 });
  assert.deepEqual(replay.state.packets.map((packet) => packet.id), [7, 6, 5]);
  assert.equal(replay.state.receivedPackets, 8);
  await replay.close();
  await appendFile(join(dataDir, 'events.ndjson'), 'bad complete line\n');
  await assert.rejects(createJournalStore({ dataDir }), SyntaxError);
});

test('snapshot reports truncation and stays below its byte bound with large retained packets', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'howen-snapshot-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = await createJournalStore({ dataDir });
  for (let index = 0; index < 145; index++) {
    await store.append({ type: 'packet', packet: { id: index, direction: 'inbound', decoded: { content: 'x'.repeat(16384) }, raw: { headerHex: '48010000', payloadHex: 'ff'.repeat(16384), truncated: true, payloadLength: 32768 } } });
  }
  await store.close();
  const gateway = createHowenGateway({ env: {}, dataDir, apiKey, tcpPort: 0, httpPort: 0 });
  t.after(() => gateway.stop());
  await gateway.start();
  const snapshot = gateway.snapshot();
  assert.equal(snapshot.retention.retainedPackets, 145);
  assert.equal(snapshot.retention.truncated, true);
  assert.ok(snapshot.retention.returnedPackets > 0);
  assert.ok(snapshot.retention.returnedPackets < 145);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) <= snapshot.retention.maxSnapshotBytes);
});

test('a second writer cannot replay or replace an active gateway journal', async (t) => {
  const { gateway, addresses, dataDir } = await setup(t);
  const client = await register(addresses.tcp.port);
  t.after(() => client.socket.destroy());
  const second = createHowenGateway({ env: {}, dataDir, apiKey, tcpPort: 0, httpPort: 0 });
  await assert.rejects(second.start(), /writer lock/);
  client.socket.write(encodeFrame(0x1041, encodeSimulatedStatus({ sessionId: 'test-session' })));
  await until(() => client.packets.some((packet) => packet.type === 0x4041), 'original gateway still accepts telemetry');
  assert.equal(gateway.snapshot().gateway.storage.status, 'ok');
});
