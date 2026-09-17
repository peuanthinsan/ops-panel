import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createHowenSimulator, encodeSimulatedStatus, encodeSimulatedAlarm } from '../gateway/simulator.mjs';
import { createFrameDecoder, decodePacket, encodeFrame } from '../gateway/protocol.mjs';

const time = new Date('2026-09-17T07:00:00.000Z');
const decodeStatus = options => decodePacket({ type: 0x1041, payload: encodeSimulatedStatus({ time, ...options }) });
const decodeAlarm = options => decodePacket({ type: 0x1051, payload: encodeSimulatedAlarm({ time, ...options }) });

async function tcpPeer(t, { handshake = true, acknowledge = true, onFrame = () => {} } = {}) {
  const sockets = new Set();
  const frames = [];
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    const decoder = createFrameDecoder();
    socket.on('data', chunk => {
      for (const frame of decoder.push(chunk)) {
        const parsed = decodePacket(frame);
        frames.push({ ...frame, parsed });
        if (frame.type === 0x1001 && handshake) socket.write(Buffer.concat([
          encodeFrame(0x4001, { ss: parsed.decoded.ss, err: '0' }),
          encodeFrame(0x4040, { ss: 'server-status-session', ct: '0x1FF', rt: '0' }),
          encodeFrame(0x4050, { ss: 'server-alarm-session', ct: '0x1FF', rt: '0', ei: '1', ack: '1' }),
        ]));
        if (acknowledge && [0x1041, 0x1051, 1].includes(frame.type)) socket.write(encodeFrame(frame.type === 1 ? 1 : frame.type + 0x3000));
        onFrame(frame, socket);
      }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  return { port: server.address().port, frames, sockets };
}

async function manualSimulator(t, peer, options = {}) {
  const simulator = createHowenSimulator({ port: peer.port, autoEmit: false, ...options });
  t.after(() => simulator.stop());
  await simulator.start();
  await simulator.ready();
  return simulator;
}

test('simulated fuel is optional raw data; explicit zero and an increase survive the binary wire', () => {
  const absent = decodeStatus({});
  assert.equal(absent.decoded.diagnostics.fuel, undefined);
  for (const fuelBalanceRaw of [0, 240, 310, 65535]) {
    const result = decodeStatus({ fuelBalanceRaw });
    assert.equal(result.decoded.contentMask, 0x115);
    assert.equal(result.decoded.complete, true);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.decoded.diagnostics.fuel, { flags: 2, consumption: null, balanceRaw: fuelBalanceRaw, units: null });
  }
  assert.throws(() => encodeSimulatedStatus({ fuelBalanceRaw: -1 }), /fuel balance/);
  assert.throws(() => encodeSimulatedStatus({ fuelBalanceRaw: 1.5 }), /fuel balance/);
});

test('all 16 inputs are distinct and independent of ACC and the emergency alarm flag', () => {
  for (let channel = 1; channel <= 16; channel++) {
    const result = decodeStatus({ inputBits: 2 ** (channel - 1), acc: false });
    assert.equal(result.decoded.acc, false);
    assert.deepEqual(result.decoded.inputs.filter(input => input.active).map(input => input.channel), [channel]);
    assert.equal(result.decoded.diagnostics.alarms.emergency, false);
  }
  const simultaneous = decodeStatus({ inputBits: 3, emergency: true });
  assert.deepEqual(simultaneous.decoded.inputs.filter(input => input.active).map(input => input.channel), [1, 2]);
  assert.equal(simultaneous.decoded.diagnostics.alarms.emergency, true);
  assert.equal(decodeStatus({ emergency: false }).decoded.diagnostics.alarms.emergency, false);
});

test('invalid GPS stays invalid and coordinate rounding cannot emit a 60-minute field', () => {
  const invalid = decodeStatus({ lat: 13.75, lng: 100.5, speedKph: 0, gpsValid: false });
  assert.equal(invalid.decoded.gps.valid, false);
  assert.equal(invalid.decoded.gps.locationType, 0);
  assert.equal(invalid.decoded.gps.speedKph, 0);
  assert.equal(invalid.decoded.gps.lat, 13.75);
  const nearBoundary = decodeStatus({ lat: -13.9999999999, lng: 100.9999999999 });
  assert.equal(nearBoundary.decoded.gps.valid, true);
  assert.equal(nearBoundary.decoded.gps.lat, -14);
  assert.equal(nearBoundary.decoded.gps.lng, 101);
});

test('alarm code and details are explicit, preserve start/end identity, and include binary evidence', () => {
  const options = { ec: '5', det: { ch: '1' }, eventId: 'sos-fixture', startedAt: time, inputBits: 1, emergency: true, fuelBalanceRaw: 240 };
  const start = decodeAlarm(options);
  assert.equal(start.decoded.alarm.ec, '5');
  assert.deepEqual(start.decoded.alarm.det, { ch: '1' });
  assert.equal(start.decoded.alarmState, 'start');
  assert.equal(start.decoded.status.diagnostics.alarms.emergency, true);
  assert.equal(start.decoded.status.diagnostics.fuel.balanceRaw, 240);
  const end = decodeAlarm({ ...options, active: false, time: new Date(time.getTime() + 5000), emergency: false, inputBits: 0 });
  assert.equal(end.decoded.alarmState, 'end');
  assert.equal(end.decoded.alarm.uuid, start.decoded.alarm.uuid);
  assert.equal(end.decoded.alarm.st, start.decoded.alarm.st);
  assert.equal(end.decoded.endedAt, '2026-09-17T07:00:05.000Z');
  assert.equal(end.decoded.status.diagnostics.alarms.emergency, false);
  const custom = decodeAlarm({});
  assert.equal(custom.decoded.alarm.ec, '4');
  assert.deepEqual(custom.decoded.alarm.det, { ch: '1', num: '22' });
});

test('manual TCP mode emits only requested telemetry using gateway-issued subscription sessions', async t => {
  const peer = await tcpPeer(t);
  const simulator = await manualSimulator(t, peer);
  assert.equal(simulator.stats.ready, true);
  assert.equal(simulator.stats.statusesSent, 0);
  assert.equal(simulator.stats.alarmsSent, 0);
  const statusAck = await simulator.sendStatus({ time, sessionId: 'caller-must-not-override', lat: 14, lng: 101, speedKph: 0, acc: false, inputBits: 2, fuelBalanceRaw: 300 });
  assert.deepEqual(statusAck, { messageType: '0x1041', ackType: '0x4041', acknowledged: true });
  const alarmAck = await simulator.sendAlarm({ time, sessionId: 'caller-must-not-override', ec: '5', det: { ch: '1' }, emergency: true, inputBits: 1 });
  assert.deepEqual(alarmAck, { messageType: '0x1051', ackType: '0x4051', acknowledged: true });
  const status = peer.frames.find(frame => frame.type === 0x1041).parsed.decoded;
  const alarm = peer.frames.find(frame => frame.type === 0x1051).parsed.decoded;
  assert.equal(status.sessionId, 'server-status-session');
  assert.equal(alarm.sessionId, 'server-alarm-session');
  assert.equal(status.gps.lat, 14);
  assert.equal(status.inputs[1].active, true);
  assert.equal(status.diagnostics.fuel.balanceRaw, 300);
  assert.equal(alarm.alarm.ec, '5');
  assert.equal(simulator.stats.statusAcks, 1);
  assert.equal(simulator.stats.alarmAcks, 1);
  await simulator.stop();
  await assert.rejects(simulator.sendStatus({}), /stopped/);
});

test('manual sends serialize each ACK kind while status and alarms remain independently correlated', async t => {
  const active = new Map();
  let maxStatusActive = 0;
  let maxAlarmActive = 0;
  const timers = new Set();
  t.after(() => { for (const timer of timers) clearTimeout(timer); });
  const peer = await tcpPeer(t, { acknowledge: false, onFrame(frame, socket) {
    if (![0x1041, 0x1051].includes(frame.type)) return;
    active.set(frame.type, (active.get(frame.type) || 0) + 1);
    maxStatusActive = Math.max(maxStatusActive, active.get(0x1041) || 0);
    maxAlarmActive = Math.max(maxAlarmActive, active.get(0x1051) || 0);
    const timer = setTimeout(() => {
      timers.delete(timer);
      active.set(frame.type, active.get(frame.type) - 1);
      socket.write(encodeFrame(frame.type + 0x3000));
    }, frame.type === 0x1041 ? 25 : 5);
    timers.add(timer);
  } });
  const simulator = await manualSimulator(t, peer);
  const replies = await Promise.all([
    simulator.sendStatus({ inputBits: 1 }), simulator.sendStatus({ inputBits: 2 }), simulator.sendStatus({ inputBits: 4 }),
    simulator.sendAlarm({ ec: '5' }), simulator.sendAlarm({ ec: '18', det: { dt: '1' } }),
  ]);
  assert.equal(replies.every(reply => reply.acknowledged), true);
  assert.equal(maxStatusActive, 1);
  assert.equal(maxAlarmActive, 1);
  assert.equal(simulator.stats.statusesSent, 3);
  assert.equal(simulator.stats.statusAcks, 3);
  assert.equal(simulator.stats.alarmsSent, 2);
  assert.equal(simulator.stats.alarmAcks, 2);
  assert.deepEqual(peer.frames.filter(frame => frame.type === 0x1041).map(frame => frame.parsed.decoded.inputs.find(input => input.active).channel), [1, 2, 3]);
});

test('disconnect rejects pending and queued sends rather than reporting an unacknowledged success', async t => {
  const peer = await tcpPeer(t, { acknowledge: false, onFrame(frame, socket) { if (frame.type === 0x1041) socket.destroy(); } });
  const simulator = await manualSimulator(t, peer);
  const results = await Promise.allSettled([simulator.sendStatus({}), simulator.sendStatus({}), simulator.sendAlarm({})]);
  assert.equal(results.every(result => result.status === 'rejected'), true);
  assert.match(simulator.error.message, /closed/);
  assert.equal(simulator.stats.statusAcks, 0);
});

test('ACK timeout closes the connection and cannot reuse a late ACK for a queued send', async t => {
  const peer = await tcpPeer(t, { acknowledge: false });
  const simulator = await manualSimulator(t, peer, { ackTimeoutMs: 30 });
  const results = await Promise.allSettled([simulator.sendStatus({}), simulator.sendStatus({})]);
  assert.equal(results.every(result => result.status === 'rejected'), true);
  assert.match(simulator.error.message, /ACK 0x4041/);
  assert.equal(simulator.stats.statusesSent, 1);
  assert.equal(simulator.stats.statusAcks, 0);
});

test('ready has a deadline and stop rejects outstanding ready and packet waiters', async t => {
  const notReadyPeer = await tcpPeer(t, { handshake: false });
  const notReady = createHowenSimulator({ port: notReadyPeer.port, autoEmit: false });
  await notReady.start();
  await assert.rejects(notReady.ready(20), /registration and subscriptions/);
  const readyRejected = assert.rejects(notReady.ready(), /stopped/);
  await notReady.stop();
  await readyRejected;

  const peer = await tcpPeer(t, { acknowledge: false });
  const simulator = await manualSimulator(t, peer);
  const rejected = assert.rejects(simulator.sendStatus({}), /stopped/);
  await simulator.stop();
  await rejected;
  assert.equal(simulator.error, null);
});

test('automatic demo retains its handshake and keeps coordinates fixed while speed is zero', async t => {
  let enough;
  const received = new Promise(resolve => { enough = resolve; });
  const positions = [];
  const peer = await tcpPeer(t, { onFrame(frame) {
    if (frame.type !== 0x1041) return;
    positions.push(decodePacket(frame).decoded.gps);
    if (positions.length === 12) enough();
  } });
  const simulator = createHowenSimulator({ port: peer.port, intervalMs: 10 });
  t.after(() => simulator.stop());
  await simulator.start();
  await simulator.ready();
  const deadline = setTimeout(() => enough(new Error('Demo did not emit statuses')), 3000);
  const error = await received;
  clearTimeout(deadline);
  assert.equal(error, undefined);
  await simulator.stop();
  assert.ok(simulator.stats.statusAcks >= 11);
  assert.ok(simulator.stats.alarmAcks >= 3);
  assert.ok(simulator.stats.heartbeatAcks >= 1);
  const parked = positions.slice(4, 8);
  assert.equal(parked.every(gps => gps.speedKph === 0), true);
  for (const gps of parked) assert.deepEqual([gps.lat, gps.lng], [positions[3].lat, positions[3].lng]);
});
