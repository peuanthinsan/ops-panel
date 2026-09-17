import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createFrameDecoder, encodeFrame } from './protocol.mjs';

export const SIMULATED_DEVICE_ID = 'SIM-HOWEN-001';

function localTime(date = new Date()) {
  const local = new Date(date.getTime() + 420 * 60000);
  return Buffer.from([local.getUTCFullYear() - 2000, local.getUTCMonth() + 1, local.getUTCDate(), local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds()]);
}
function timeText(date = new Date()) { return new Date(date.getTime() + 420 * 60000).toISOString().slice(0, 19).replace('T', ' '); }
function sessionPrefix(sessionId) {
  const value = Buffer.from(`${sessionId}\0`);
  if (value.length > 255) throw new Error('Simulator session ID is too long');
  return Buffer.concat([Buffer.from([value.length]), value]);
}

// This producer writes the documented binary fields explicitly. It does not
// inject HTTP fixtures into the dashboard or use the decoder to make telemetry.
export function encodeSimulatedStatus({ sessionId = 'simulation', lat = 13.7563, lng = 100.5018, speedKph = 12.5, acc = true, inputBits = 0, fuelBalanceRaw = null, emergency = false, gpsValid = true, time = new Date() } = {}) {
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) throw new RangeError('Simulator coordinates are outside their valid range');
  if (!Number.isFinite(speedKph) || speedKph < 0 || Math.round(speedKph * 100) > 65535) throw new RangeError('Simulator speed is outside its wire range');
  if (!Number.isInteger(inputBits) || inputBits < 0 || inputBits > 65535) throw new RangeError('Simulator input bits must be a 16-bit unsigned integer');
  const hasFuel = fuelBalanceRaw != null;
  if (hasFuel && (!Number.isInteger(fuelBalanceRaw) || fuelBalanceRaw < 0 || fuelBalanceRaw > 65535)) throw new RangeError('Simulator fuel balance must be a raw 16-bit unsigned integer');
  if (!(time instanceof Date) || !Number.isFinite(time.getTime())) throw new TypeError('Simulator time must be a valid Date');
  const status = Buffer.alloc(44 + (hasFuel ? 3 : 0));
  localTime(time).copy(status, 0);
  status.writeUInt16LE(0x105 | (hasFuel ? 0x10 : 0), 6); // GPS, basic, optional fuel, alarm status.
  let offset = 8;
  status[offset++] = (lng < 0 ? 2 : 0) | (lat < 0 ? 16 : 0);
  status[offset++] = gpsValid ? 1 : 0;
  localTime(time).copy(status, offset); offset += 6;
  status[offset++] = 45;
  status[offset++] = 12;
  status.writeUInt16LE(Math.round(speedKph * 100), offset); offset += 2;
  status.writeUInt16LE(0, offset); offset += 2;
  status.writeUInt16LE(9, offset); offset += 2;
  for (const coordinate of [lng, lat]) {
    // Round before splitting degrees/minutes so a value near a degree boundary
    // carries into the degree field instead of emitting the invalid 60 minutes.
    const scaled = Math.round(Math.abs(coordinate) * 600000);
    const degrees = Math.floor(scaled / 600000);
    status[offset++] = degrees;
    status.writeUInt32LE(scaled - degrees * 600000, offset); offset += 4;
  }
  status[offset++] = acc ? 1 : 0;
  status[offset++] = 0;
  status.writeUInt16LE(0, offset); offset += 2;
  if (hasFuel) {
    status[offset++] = 2; // Fuel balance exists; no consumption field follows.
    status.writeUInt16LE(fuelBalanceRaw, offset); offset += 2;
  }
  status.writeUInt32LE(8 | (emergency ? 64 : 0), offset); offset += 4;
  status.writeUInt16LE(inputBits, offset); offset += 2;
  return Buffer.concat([sessionPrefix(sessionId), status.subarray(0, offset)]);
}

export function encodeSimulatedAlarm({ sessionId = 'simulation', active = true, eventId = randomUUID(), startedAt, ec = '4', det = { ch: '1', num: '22' }, ...telemetry } = {}) {
  const now = telemetry.time ?? new Date();
  const alarm = { dtu: timeText(now), st: timeText(startedAt ?? now), et: active ? '' : timeText(now), ec: String(ec), det, uuid: eventId };
  const json = Buffer.from(`${JSON.stringify(alarm)}\0`);
  const length = Buffer.alloc(4); length.writeUInt32LE(json.length);
  const prefix = sessionPrefix(sessionId);
  const status = encodeSimulatedStatus({ sessionId, ...telemetry }).subarray(prefix.length);
  return Buffer.concat([prefix, length, json, status]);
}

export function createHowenSimulator({ host = '127.0.0.1', port = 6608, deviceId = SIMULATED_DEVICE_ID, intervalMs = 1000, autoEmit = true, ackTimeoutMs = 5000, onProgress = () => {} } = {}) {
  if (!deviceId.startsWith('SIM-')) throw new Error('The simulator requires a SIM- device identifier');
  if (!Number.isFinite(ackTimeoutMs) || ackTimeoutMs <= 0) throw new RangeError('Simulator ACK timeout must be positive');
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new RangeError('Simulator interval must be positive');
  const sessionId = `sim-${randomUUID()}`;
  const decoder = createFrameDecoder({ maxPayloadBytes: 65536 });
  const stats = { deviceId, registered: false, statusSubscribed: false, alarmSubscribed: false, statusesSent: 0, alarmsSent: 0, statusAcks: 0, alarmAcks: 0, heartbeatAcks: 0, ready: false };
  let socket;
  let timer;
  let tick = 0;
  let ended = false;
  let failure = null;
  let eventId = randomUUID();
  let eventStartedAt = new Date();
  let statusSessionId;
  let alarmSessionId;
  const readyWaiters = new Set();
  const pendingAcks = new Map();
  const sendQueues = new Map();
  let emitting = false;
  let position = { lat: 13.7563, lng: 100.5023 };

  function rejectWaiters(error) {
    for (const waiter of readyWaiters) { clearTimeout(waiter.timer); waiter.reject(error); }
    readyWaiters.clear();
    for (const waiter of pendingAcks.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
    pendingAcks.clear();
  }
  function fail(error) {
    if (ended) return;
    failure ??= error;
    clearInterval(timer);
    rejectWaiters(failure);
    socket?.destroy();
  }
  function assertConnected() {
    if (ended) throw new Error('Simulator stopped');
    if (failure) throw failure;
    if (!socket || socket.destroyed) throw new Error('Simulator is not connected');
  }
  function send(type, payload = null) {
    assertConnected();
    socket.write(encodeFrame(type, payload), (error) => { if (error) fail(error); });
  }
  function ready(timeoutMs = 5000) {
    try { assertConnected(); } catch (error) { return Promise.reject(error); }
    if (stats.ready) return Promise.resolve({ ...stats });
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new RangeError('Simulator ready timeout must be positive'));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: setTimeout(() => {
        readyWaiters.delete(waiter);
        reject(new Error('Timed out waiting for simulator registration and subscriptions'));
      }, timeoutMs) };
      readyWaiters.add(waiter);
    });
  }
  function sendAcknowledged(type, ackType, buildPayload, counter) {
    const previous = sendQueues.get(type) ?? Promise.resolve();
    const operation = previous.then(async () => {
      await ready();
      assertConnected();
      const payload = buildPayload();
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject, timer: setTimeout(() => {
          // ACKs carry no correlation ID. Close after a timeout so a late ACK
          // cannot accidentally acknowledge the next queued packet of this kind.
          fail(new Error(`Timed out waiting for Howen ACK 0x${ackType.toString(16)}`));
        }, ackTimeoutMs) };
        pendingAcks.set(ackType, waiter);
        try { send(type, payload); stats[counter]++; }
        catch (error) { clearTimeout(waiter.timer); pendingAcks.delete(ackType); reject(error); }
      });
    });
    // Keep the internal queue handled even if a caller chooses not to await yet.
    sendQueues.set(type, operation.catch(() => {}));
    return operation;
  }
  const sendStatus = (telemetry = {}) => sendAcknowledged(0x1041, 0x4041,
    () => encodeSimulatedStatus({ ...telemetry, sessionId: statusSessionId }), 'statusesSent');
  const sendAlarm = (options = {}) => sendAcknowledged(0x1051, 0x4051,
    () => encodeSimulatedAlarm({ ...options, sessionId: alarmSessionId }), 'alarmsSent');

  async function emit() {
    if (emitting || ended || failure) return;
    emitting = true;
    try {
      const inputActive = tick % 6 < 3;
      const speedKph = tick % 8 < 4 ? 12.5 : 0;
      if (speedKph > 0) position = { lat: 13.7563 + Math.sin(tick / 12) * 0.0005, lng: 100.5018 + Math.cos(tick / 12) * 0.0005 };
      const telemetry = { ...position, speedKph, acc: tick % 12 < 9, inputBits: inputActive ? 1 : 0 };
      await sendStatus(telemetry);
      if (tick % 3 === 0) {
        if (inputActive) { eventId = randomUUID(); eventStartedAt = new Date(); }
        await sendAlarm({ ...telemetry, active: inputActive, eventId, startedAt: eventStartedAt });
      }
      if (tick % 5 === 0) send(0x0001);
      tick++;
      onProgress({ ...stats });
    } catch (error) { fail(error); }
    finally { emitting = false; }
  }
  return {
    stats,
    get error() { return failure; },
    ready,
    sendStatus,
    sendAlarm,
    async start() {
      if (socket || ended) throw new Error('Simulator can only be started once');
      socket = net.createConnection({ host, port });
      socket.setNoDelay(true);
      socket.on('error', fail);
      socket.on('close', () => { clearInterval(timer); if (!ended) fail(new Error('Gateway closed the simulator connection')); });
      socket.on('data', (chunk) => {
        try {
          for (const frame of decoder.push(chunk)) {
            if (frame.type === 0x4001) {
              const payload = JSON.parse(frame.payload.toString('utf8').replace(/\0$/, ''));
              if (String(payload.err) !== '0' || payload.ss !== sessionId) throw new Error('Registration acknowledgement is invalid');
              stats.registered = true;
            } else if (frame.type === 0x4040 || frame.type === 0x4050) {
              const payload = JSON.parse(frame.payload.toString('utf8').replace(/\0$/, ''));
              if (!payload.ss || !payload.ct || String(payload.rt) !== '0') throw new Error('Gateway did not request continuous telemetry');
              if (frame.type === 0x4040) { stats.statusSubscribed = true; statusSessionId = payload.ss; send(0x1040, { ss: payload.ss, err: '0' }); }
              else {
                if (String(payload.ei) !== '1' || String(payload.ack) !== '1') throw new Error('Alarm subscription must include status and acknowledgements');
                stats.alarmSubscribed = true; alarmSessionId = payload.ss; send(0x1050, { ss: payload.ss, err: '0' });
              }
            } else if (frame.type === 0x4041) stats.statusAcks++;
            else if (frame.type === 0x4051) stats.alarmAcks++;
            else if (frame.type === 0x0001) stats.heartbeatAcks++;
            const waiter = pendingAcks.get(frame.type);
            if (waiter) {
              clearTimeout(waiter.timer); pendingAcks.delete(frame.type);
              waiter.resolve({ messageType: frame.type === 0x4041 ? '0x1041' : '0x1051', ackType: `0x${frame.type.toString(16)}`, acknowledged: true });
            }
            if (!stats.ready && stats.registered && stats.statusSubscribed && stats.alarmSubscribed) {
              stats.ready = true;
              for (const readyWaiter of readyWaiters) { clearTimeout(readyWaiter.timer); readyWaiter.resolve({ ...stats }); }
              readyWaiters.clear();
              if (autoEmit) { void emit(); timer = setInterval(() => { void emit(); }, intervalMs); }
            }
          }
          onProgress({ ...stats });
        } catch (error) { fail(error); }
      });
      await new Promise((resolve, reject) => {
        const cleanup = () => { clearTimeout(connectTimer); socket.off('connect', connected); socket.off('error', rejected); socket.off('close', closed); };
        const connected = () => { cleanup(); resolve(); };
        const rejected = (error) => { cleanup(); reject(error); };
        const closed = () => rejected(failure ?? new Error('Simulator connection closed before connecting'));
        const connectTimer = setTimeout(() => { const error = new Error('Timed out connecting simulator to gateway'); fail(error); rejected(error); }, ackTimeoutMs);
        socket.once('connect', connected); socket.once('error', rejected); socket.once('close', closed);
      });
      send(0x1001, { ss: sessionId, dn: deviceId, dtu: timeText(), dt: '0x4000', gmt: '+07:00', ver: 'SIMULATION', manufacturer: 'Howen protocol simulator', simulation: true });
      return stats;
    },
    async stop() {
      ended = true; clearInterval(timer);
      rejectWaiters(new Error('Simulator stopped'));
      if (socket && !socket.destroyed) await new Promise((resolve) => { socket.once('close', resolve); socket.end(); setTimeout(() => socket.destroy(), 1000).unref(); });
      return { ...stats };
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => { const index = args.indexOf(`--${name}`); return index < 0 ? fallback : args[index + 1]; };
  const simulator = createHowenSimulator({ host: arg('host', '127.0.0.1'), port: Number(arg('port', 6608)), deviceId: arg('device-id', SIMULATED_DEVICE_ID) });
  const seconds = Number(arg('duration', 120));
  let shutdown = false;
  const stop = async () => {
    if (shutdown) return; shutdown = true;
    const stats = await simulator.stop();
    process.stdout.write(`${JSON.stringify({ source: 'SIMULATION', ...stats })}\n`);
    if (simulator.error || !stats.ready || !stats.statusAcks || !stats.alarmAcks) process.exitCode = 1;
  };
  simulator.start().then(() => {
    process.stdout.write(`SIMULATION: ${simulator.stats.deviceId} connected to ${arg('host', '127.0.0.1')}:${arg('port', 6608)}\n`);
    if (seconds > 0) setTimeout(stop, seconds * 1000);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
  }).catch(() => { process.stderr.write('Simulator could not connect to the gateway.\n'); process.exitCode = 1; });
}
