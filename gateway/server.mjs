import net from 'node:net';
import http from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createFrameDecoder, decodePacket, encodeFrame } from './protocol.mjs';
import { createJournalStore } from './store.mjs';
import { createSimulationLab } from './simulation-lab.mjs';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const SUBSCRIPTION = { gps: { ct: '0x1FF', rt: '0' }, alarms: { ct: '0x1FF', rt: '0', ei: '1', ack: '1' } };
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
const list = (value) => Array.isArray(value) ? value : String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
const digest = (value) => createHash('sha256').update(value).digest();
const boundedObject = (value, limit) => Buffer.byteLength(JSON.stringify(value ?? null)) <= limit ? value : { truncated: true, reason: 'Field exceeds diagnostic retention limit' };
const boundedWarnings = (warnings) => (warnings ?? []).slice(0, 16).map((warning) => String(warning).slice(0, 256));

export function createHowenGateway(options = {}) {
  const env = options.env ?? process.env;
  const tcpHost = options.tcpHost ?? env.HOWEN_GATEWAY_TCP_HOST ?? '127.0.0.1';
  const tcpPort = Number(options.tcpPort ?? env.HOWEN_GATEWAY_TCP_PORT ?? 6608);
  const httpPort = Number(options.httpPort ?? env.HOWEN_GATEWAY_HTTP_PORT ?? 4066);
  const apiKey = options.apiKey ?? env.HOWEN_GATEWAY_API_KEY;
  const dataDir = options.dataDir ?? env.HOWEN_GATEWAY_DATA_DIR;
  const allowedDevices = new Set(list(options.allowedDevices ?? env.HOWEN_GATEWAY_ALLOWED_DEVICES));
  const simulatedDevices = new Set(list(options.simulatedDevices ?? env.HOWEN_GATEWAY_SIMULATED_DEVICES));
  const simulationEnabled = options.enableSimulation ?? env.HOWEN_GATEWAY_ENABLE_SIMULATION === '1';
  const simulationDeviceId = 'SIM-HOWEN-001';
  const maxDevices = Math.min(256, Math.max(1, Number(options.maxDevices ?? 256)));
  const maxConnections = Math.min(512, Math.max(1, Number(options.maxConnections ?? 256)));
  const maxPayloadBytes = Math.min(65536, Math.max(512, Number(options.maxPayloadBytes ?? 65536)));
  const idleTimeoutMs = Number(options.idleTimeoutMs ?? 180000);
  const streamIntervalMs = Number(options.streamIntervalMs ?? 300);
  if (typeof apiKey !== 'string' || apiKey.length < 24) throw new Error('HOWEN_GATEWAY_API_KEY must contain at least 24 characters');
  if (!dataDir) throw new Error('HOWEN_GATEWAY_DATA_DIR is required');
  if (!LOOPBACK.has(tcpHost) && !allowedDevices.size) throw new Error('A device allowlist is required for a non-loopback TCP listener');
  if (options.httpHost && options.httpHost !== '127.0.0.1') throw new Error('The diagnostics HTTP listener must remain on loopback');
  if ([...simulatedDevices].some((id) => !id.startsWith('SIM-'))) throw new Error('Configured simulation identifiers must begin with SIM-');
  if (![tcpPort, httpPort].every((port) => Number.isInteger(port) && port >= 0 && port <= 65535)) throw new Error('Gateway ports must be valid integers');
  if (simulationEnabled && (!LOOPBACK.has(tcpHost) || !simulatedDevices.has(simulationDeviceId) || (allowedDevices.size && !allowedDevices.has(simulationDeviceId)))) {
    throw new Error('The simulation lab requires a loopback TCP listener and SIM-HOWEN-001 admitted and labelled simulated');
  }
  const expectedDigest = digest(apiKey);
  const sessions = new Map();
  const connections = new Set();
  const streams = new Set();
  let store;
  let tcpServer;
  let httpServer;
  let startedAt = null;
  let status = 'stopped';
  let streamTimer = null;
  let heartbeatTimer = null;
  let addresses = null;
  let stopping = false;
  let stopPromise = null;
  let startPromise = null;
  let dirty = false;
  let simulationLab;

  function snapshot() {
    const state = store?.state ?? { devices: {}, packets: [], receivedPackets: 0, sentPackets: 0, decodeErrors: 0 };
    const result = {
      source: 'howen', generatedAt: new Date().toISOString(),
      simulation: simulationLab?.snapshot() ?? { enabled: false, status: 'disabled' },
      gateway: {
        status: store?.status.status === 'error' ? 'error' : status, startedAt,
        tcpHost, tcpPort: addresses?.tcp.port ?? tcpPort,
        connectedDevices: sessions.size, receivedPackets: state.receivedPackets, sentPackets: state.sentPackets, decodeErrors: state.decodeErrors,
        storage: store?.status ?? { status: 'unavailable' }, subscription: SUBSCRIPTION,
      },
      devices: Object.values(state.devices).map((device) => ({ ...device, connected: sessions.has(device.deviceId) })).sort((a, b) => (b.lastReceivedAt || '').localeCompare(a.lastReceivedAt || '')),
      packets: [],
      retention: { maxPackets: store?.limits.maxPackets ?? 2000, retainedPackets: state.packets.length, returnedPackets: 0, truncated: false, deviceDetailsTruncated: false, maxDevices, maxSnapshotBytes: MAX_SNAPSHOT_BYTES },
    };
    if (Buffer.byteLength(JSON.stringify(result)) + 1024 > MAX_SNAPSHOT_BYTES) {
      result.devices = result.devices.map((device) => ({ ...device, diagnostics: { truncated: true, reason: 'Device details exceed snapshot size limit; inspect packet history.' } }));
      result.retention.deviceDetailsTruncated = true;
    }
    // Measure each packet once. Repeatedly serializing a full snapshot while
    // trimming it would make a busy fleet's stream expensive to deliver.
    let available = MAX_SNAPSHOT_BYTES - Buffer.byteLength(JSON.stringify(result)) - 1024;
    for (const packet of state.packets.slice(0, 200)) {
      const size = Buffer.byteLength(JSON.stringify(packet)) + 1;
      if (size > available) break;
      result.packets.push(packet); available -= size;
    }
    result.retention.returnedPackets = result.packets.length;
    result.retention.truncated = result.packets.length < state.packets.length;
    return result;
  }
  function publish() { dirty = true; }
  function writeStream(client, message) {
    if (client.response.destroyed) { streams.delete(client); return; }
    if (client.blocked) { client.pending = true; return; }
    client.blocked = !client.response.write(message);
  }
  function flushStreams() {
    if (!dirty || !streams.size) return;
    dirty = false;
    const message = `event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`;
    for (const client of streams) writeStream(client, message);
  }
  function storageFailure() {
    status = 'error';
    for (const context of connections) context.socket.destroy();
    publish();
  }
  async function persist(event) {
    try { await store.append(event); publish(); }
    catch (error) { storageFailure(); throw error; }
  }
  function raw(frame) {
    const payload = frame.payload;
    return { headerHex: frame.frame.subarray(0, frame.frame.length - payload.length).toString('hex'), payloadHex: payload.subarray(0, 16384).toString('hex'), payloadLength: payload.length, truncated: payload.length > 16384 };
  }
  async function logPacket(context, frame, direction, parsed) {
    const now = new Date().toISOString();
    const deviceId = context.deviceId ?? null;
    const packet = { id: randomUUID(), deviceId, direction, messageType: parsed.messageType, kind: parsed.kind, receivedAt: now, occurredAt: parsed.occurredAt ?? null, summary: parsed.summary, decoded: boundedObject(parsed.decoded, 65536), raw: raw(frame), warnings: parsed.warnings ?? [], simulated: simulatedDevices.has(deviceId) };
    let device = deviceId ? store.state.devices[deviceId] : null;
    if (device) {
      device = structuredClone(device);
      device.counters[direction === 'inbound' ? 'received' : 'sent']++;
      device.latestPacketId = packet.id;
      if (direction === 'inbound') device.lastReceivedAt = now;
      const telemetry = parsed.kind === 'status' ? parsed.decoded : parsed.decoded?.status;
      if (direction === 'inbound' && telemetry && typeof telemetry === 'object') {
        device.telemetryTimestamps ??= {};
        device.telemetryReceivedAt = now;
        if (telemetry.deviceTime && (!device.telemetryObservedAt || telemetry.deviceTime >= device.telemetryObservedAt)) device.telemetryObservedAt = telemetry.deviceTime;
        for (const field of ['gps', 'acc', 'inputs']) {
          if (telemetry[field] == null) continue;
          const observedAt = field === 'gps' ? telemetry.gps.capturedAt ?? telemetry.deviceTime : telemetry.deviceTime;
          const previousTime = device.telemetryTimestamps[field]?.observedAt;
          if (observedAt && previousTime && observedAt < previousTime) {
            packet.warnings.push(`Delayed ${field} retained in history; latest telemetry unchanged`);
            continue;
          }
          device.telemetry[field] = telemetry[field];
          device.telemetryTimestamps[field] = { receivedAt: now, observedAt: observedAt ?? null };
        }
        device.diagnostics = boundedObject({ ...device.diagnostics, ...telemetry.diagnostics }, 8192);
        device.warnings = boundedWarnings(packet.warnings);
      }
    }
    await persist({ type: 'packet', packet, ...(device ? { device } : {}) });
  }
  async function send(context, type, payload = null) {
    if (context.socket.destroyed || stopping) return;
    const buffer = encodeFrame(type, payload);
    const decoder = createFrameDecoder({ maxPayloadBytes });
    const frame = decoder.push(buffer)[0];
    await logPacket(context, frame, 'outbound', decodePacket(frame, { timeZoneOffsetMinutes: context.timeZoneOffsetMinutes }));
    if (context.socket.destroyed) return;
    if (context.socket.writableLength + buffer.length > 256 * 1024) { context.socket.destroy(); return; }
    await new Promise((resolve, reject) => {
      const onError = (error) => { context.socket.off('error', onError); reject(error); };
      context.socket.once('error', onError);
      context.socket.write(buffer, (error) => { context.socket.off('error', onError); if (error) reject(error); else resolve(); });
    });
  }
  async function handleFrame(context, frame) {
    if (context.socket.destroyed || stopping) return;
    const parsed = decodePacket(frame, { timeZoneOffsetMinutes: context.timeZoneOffsetMinutes });
    if (frame.type === 0x1001) {
      const registration = parsed.decoded;
      const deviceId = registration?.deviceId ?? registration?.dn;
      const sessionId = registration?.sessionId ?? registration?.ss;
      if (typeof deviceId !== 'string' || !deviceId.trim() || deviceId.length > 128 || /[\x00-\x1f]/.test(deviceId)) throw new Error('Invalid device identifier');
      if (typeof sessionId !== 'string' || !sessionId.trim() || Buffer.byteLength(sessionId) > 254 || /[\x00-\x1f]/.test(sessionId)) throw new Error('Invalid registration session');
      if (allowedDevices.size && !allowedDevices.has(deviceId)) throw new Error('Device is not allowed');
      if (context.deviceId && context.deviceId !== deviceId) throw new Error('Device identity cannot change on a connection');
      if (!Object.hasOwn(store.state.devices, deviceId) && Object.keys(store.state.devices).length >= maxDevices) throw new Error('Device capacity reached');
      const previous = sessions.get(deviceId);
      context.deviceId = deviceId;
      context.sessionId = sessionId;
      context.timeZoneOffsetMinutes = registration.timeZoneOffsetMinutes ?? 420;
      sessions.set(deviceId, context);
      if (previous && previous !== context) previous.socket.destroy();
      clearTimeout(context.registrationTimer);
      const old = store.state.devices[deviceId];
      const now = new Date().toISOString();
      await persist({ type: 'device', device: { deviceId, connected: true, simulated: simulatedDevices.has(deviceId), registeredAt: now, lastReceivedAt: now, disconnectedAt: null, registration: boundedObject(registration, 4096), telemetry: old?.telemetry ?? { gps: null, acc: null, inputs: null }, telemetryTimestamps: old?.telemetryTimestamps ?? {}, telemetryReceivedAt: old?.telemetryReceivedAt ?? null, telemetryObservedAt: old?.telemetryObservedAt ?? null, diagnostics: old?.diagnostics ?? {}, warnings: boundedWarnings(parsed.warnings), counters: old?.counters ?? { received: 0, sent: 0 }, latestPacketId: old?.latestPacketId ?? null } });
      await logPacket(context, frame, 'inbound', parsed);
      await send(context, 0x4001, { ss: registration.ss ?? registration.sessionId, err: '0' });
      context.statusSessionId = randomUUID();
      context.alarmSessionId = randomUUID();
      await send(context, 0x4040, { ss: context.statusSessionId, ...SUBSCRIPTION.gps });
      await send(context, 0x4050, { ss: context.alarmSessionId, ...SUBSCRIPTION.alarms });
      return;
    }
    if (!context.deviceId) throw new Error('Device must register before sending telemetry');
    if (sessions.get(context.deviceId) !== context) return;
    if ((frame.type === 0x1041 && parsed.decoded?.sessionId !== context.statusSessionId)
      || (frame.type === 0x1051 && parsed.decoded?.sessionId !== context.alarmSessionId)) parsed.warnings.push('Packet session differs from the active subscription');
    await logPacket(context, frame, 'inbound', parsed);
    if (parsed.summary.startsWith('Malformed ') || parsed.decoded?.complete === false || parsed.decoded?.status?.complete === false) await persist({ type: 'decode-error' });
    if (frame.type === 0x0001) await send(context, 0x0001);
    if (frame.type === 0x1041) await send(context, 0x4041);
    if (frame.type === 0x1051) await send(context, 0x4051);
  }
  function handleConnection(socket) {
    if (connections.size >= maxConnections || stopping || store.status.status !== 'ok') { socket.destroy(); return; }
    const context = { socket, decoder: createFrameDecoder({ maxPayloadBytes }), deviceId: null, timeZoneOffsetMinutes: 420, queue: Promise.resolve(), closed: false };
    connections.add(context);
    socket.setNoDelay(true);
    socket.setTimeout(idleTimeoutMs, () => socket.destroy());
    context.registrationTimer = setTimeout(() => { if (!context.deviceId) socket.destroy(); }, 15000);
    context.registrationTimer.unref();
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      socket.pause();
      context.queue = context.queue.then(async () => {
        if (context.closed || socket.destroyed) return;
        if (chunk.length + context.decoder.bufferedBytes > 256 * 1024) throw new Error('Receive queue exceeds limit');
        const frames = context.decoder.push(chunk);
        if (frames.length > 512) throw new Error('Receive packet count exceeds limit');
        for (const frame of frames) await handleFrame(context, frame);
      }).catch(async () => {
        try { if (store.status.status === 'ok') await persist({ type: 'decode-error' }); } catch {}
        socket.destroy();
      }).finally(() => { if (!socket.destroyed && !stopping) socket.resume(); });
    });
    socket.on('close', () => {
      clearTimeout(context.registrationTimer);
      context.closed = true;
      connections.delete(context);
      context.queue = context.queue.then(async () => {
        if (!context.deviceId || sessions.get(context.deviceId) !== context) return;
        sessions.delete(context.deviceId);
        const current = store.state.devices[context.deviceId];
        if (current && store.status.status === 'ok') await persist({ type: 'device', device: { ...current, connected: false, disconnectedAt: new Date().toISOString() } });
        publish();
      }).catch(() => {});
    });
  }
  async function handleRequest(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const provided = String(request.headers.authorization ?? '');
    if (!provided.startsWith('Bearer ') || !timingSafeEqual(digest(provided.slice(7)), expectedDigest)) {
      response.writeHead(401, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'Unauthorized' })); return;
    }
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/simulation' && request.method === 'POST') {
      const reply = (code, value) => { response.writeHead(code, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
      if (!simulationLab || stopping) { request.resume(); reply(403, { error: 'The simulation lab is disabled on this gateway.' }); return; }
      try {
        const chunks = [];
        let bytes = 0;
        let oversized = false;
        for await (const chunk of request) {
          bytes += chunk.length;
          if (bytes > 4096) oversized = true;
          else chunks.push(chunk);
        }
        if (oversized) { reply(413, { error: 'Simulation command is too large.' }); return; }
        let command;
        try { command = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { reply(400, { error: 'Invalid simulation command JSON.' }); return; }
        if (!command || Array.isArray(command) || typeof command !== 'object' || !['run', 'stop'].includes(command.action) || Object.keys(command).some(key => !['action', 'scenarioId', 'confirmationMode'].includes(key))) {
          reply(400, { error: 'Use a run or stop simulation command.' }); return;
        }
        if (command.action === 'stop') await simulationLab.stop();
        else simulationLab.start({ scenarioId: command.scenarioId, confirmationMode: command.confirmationMode });
        publish();
        reply(200, snapshot());
      } catch (error) {
        if (!response.headersSent && !response.destroyed) reply([400, 409].includes(error.status) ? error.status : 503, { error: error.status === 400 ? 'Choose a valid scenario and confirmation method.' : error.status === 409 ? 'A simulation is already running. Stop it before starting another.' : 'The simulation command could not be completed.' });
      }
      return;
    }
    if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }); response.end(); return; }
    if (pathname === '/snapshot' || pathname === '/health') {
      const value = snapshot();
      response.writeHead(pathname === '/health' && value.gateway.status !== 'listening' ? 503 : 200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(pathname === '/health' ? { source: 'howen', gateway: value.gateway } : value)); return;
    }
    if (pathname === '/events') {
      if (streams.size >= 64) { response.writeHead(503); response.end(); return; }
      response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      response.flushHeaders();
      const client = { response, blocked: false, pending: false };
      streams.add(client);
      writeStream(client, `event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);
      response.on('drain', () => {
        client.blocked = false;
        if (client.pending) { client.pending = false; writeStream(client, `event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`); }
      });
      response.on('close', () => streams.delete(client));
      response.on('error', () => streams.delete(client));
      return;
    }
    response.writeHead(404, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: 'Not found' }));
  }
  async function listen(server, port, host) {
    await new Promise((resolve, reject) => {
      const error = (cause) => { server.off('listening', ready); reject(cause); };
      const ready = () => { server.off('error', error); resolve(); };
      server.once('error', error); server.once('listening', ready); server.listen(port, host);
    });
    return server.address();
  }
  async function closeServer(server) {
    if (!server?.listening) return;
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); });
  }
  return {
    snapshot,
    get addresses() { return addresses; },
    start() {
      if (status !== 'stopped') return Promise.reject(new Error('Gateway is already started'));
      status = 'starting';
      stopping = false;
      stopPromise = null;
      startPromise = (async () => {
      try {
        store = await createJournalStore({ dataDir, maxDevices, maxPackets: options.maxPackets ?? 2000, maxRetainedBytes: options.maxRetainedBytes ?? 8 * 1024 * 1024, maxJournalBytes: options.maxJournalBytes ?? 32 * 1024 * 1024 });
        tcpServer = net.createServer(handleConnection);
        httpServer = http.createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 8192 }, handleRequest);
        httpServer.on('clientError', (_error, socket) => socket.destroy());
        const tcp = await listen(tcpServer, tcpPort, tcpHost);
        const diagnostic = await listen(httpServer, httpPort, '127.0.0.1');
        addresses = { tcp: { address: tcp.address, port: tcp.port }, http: { address: diagnostic.address, port: diagnostic.port } };
        if (simulationEnabled) simulationLab = createSimulationLab({ host: tcp.address, port: tcp.port, deviceId: simulationDeviceId, readSnapshot: snapshot, onChange: publish, ...(options.simulationStepDelayMs == null ? {} : { stepDelayMs: options.simulationStepDelayMs }) });
        startedAt = new Date().toISOString(); status = 'listening';
        tcpServer.on('error', storageFailure); httpServer.on('error', storageFailure);
        streamTimer = setInterval(flushStreams, Math.max(100, streamIntervalMs)); streamTimer.unref();
        heartbeatTimer = setInterval(() => { for (const client of streams) if (!client.blocked) writeStream(client, ': heartbeat\n\n'); }, 15000); heartbeatTimer.unref();
        return addresses;
      } catch (error) {
        stopping = true;
        await simulationLab?.close();
        for (const context of connections) context.socket.destroy();
        await Promise.all([closeServer(tcpServer), closeServer(httpServer)]);
        await store?.close(); status = 'stopped'; throw error;
      }
      })();
      return startPromise;
    },
    stop() {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        // Startup owns asynchronous lock/listener acquisition. A stop arriving
        // during it must wait for those resources before releasing them.
        if (status === 'starting') await startPromise.catch(() => {});
        stopping = true; status = 'stopping';
        await simulationLab?.close();
        clearInterval(streamTimer); clearInterval(heartbeatTimer);
        for (const client of streams) client.response.end(); streams.clear();
        const contexts = [...connections];
        for (const context of contexts) context.socket.destroy();
        await Promise.all([closeServer(tcpServer), closeServer(httpServer)]);
        // Socket close handlers append offline state after current packet work.
        await new Promise((resolve) => setImmediate(resolve));
        await Promise.all(contexts.map((context) => context.queue));
        await store?.close(); sessions.clear(); status = 'stopped';
      })();
      return stopPromise;
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const gateway = createHowenGateway();
  gateway.start().then((addresses) => {
    process.stdout.write(`Howen TCP gateway listening on ${addresses.tcp.address}:${addresses.tcp.port}; private diagnostics on 127.0.0.1:${addresses.http.port}\n`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => gateway.stop().then(() => process.exit(0), () => process.exit(1)));
  }).catch(() => { process.stderr.write('Howen gateway could not start. Check required configuration, ports, and data directory permissions.\n'); process.exitCode = 1; });
}
