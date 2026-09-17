import { mkdir, open, readFile, rename, stat, chmod, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

async function acquireWriterLock(dataDir) {
  const lockFile = join(dataDir, 'writer.lock');
  const owner = { pid: process.pid, instanceId: randomUUID(), startedAt: new Date().toISOString() };
  let handle;
  try { handle = await open(lockFile, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let previous;
    try { previous = JSON.parse(await readFile(lockFile, 'utf8')); } catch {}
    let active = true;
    if (Number.isInteger(previous?.pid) && previous.pid > 0) {
      try { process.kill(previous.pid, 0); } catch (cause) { if (cause.code === 'ESRCH') active = false; }
    }
    if (active) throw new Error('Gateway data directory already has a writer lock; another instance may be running');
    // Never automatically unlink a stale lock: two services recovering at once
    // could otherwise remove the other service's newly acquired writer lock.
    throw new Error('Gateway has a stale writer.lock. Confirm the previous process has stopped, then remove writer.lock before restarting');
  }
  try { await handle.writeFile(JSON.stringify(owner)); await handle.sync(); }
  catch (error) { await handle.close(); await unlink(lockFile).catch(() => {}); throw error; }
  await handle.close();
  return async () => {
    try {
      const current = JSON.parse(await readFile(lockFile, 'utf8'));
      if (current.instanceId === owner.instanceId) await unlink(lockFile);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
}

// The journal is private, fsynced before a packet is acknowledged, and compacted
// through a complete replacement file. A failed write must never become an ACK.
export async function createJournalStore({ dataDir, maxPackets = 2000, maxDevices = 256, maxRetainedBytes = 8 * 1024 * 1024, maxJournalBytes = 32 * 1024 * 1024 }) {
  if (!dataDir) throw new Error('HOWEN_GATEWAY_DATA_DIR is required');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await chmod(dataDir, 0o700);
  const releaseWriterLock = await acquireWriterLock(dataDir);
  try {
  const file = join(dataDir, 'events.ndjson');
  let state = { devices: Object.create(null), packets: [], receivedPackets: 0, sentPackets: 0, decodeErrors: 0 };
  let bytes = 0;
  let retainedBytes = 0;
  let queue = Promise.resolve();
  let failure = null;
  let closed = false;

  function trim() {
    while (state.packets.length > maxPackets || retainedBytes > maxRetainedBytes) {
      const removed = state.packets.pop();
      if (!removed) break;
      retainedBytes -= Buffer.byteLength(JSON.stringify(removed));
    }
  }
  function apply(event) {
    if (event.type === 'checkpoint') {
      state = event.state;
      state.devices = Object.assign(Object.create(null), state.devices);
      retainedBytes = state.packets.reduce((sum, packet) => sum + Buffer.byteLength(JSON.stringify(packet)), 0);
      trim();
      return;
    }
    if (event.device) {
      const id = event.device.deviceId;
      if (!Object.hasOwn(state.devices, id) && Object.keys(state.devices).length >= maxDevices) throw new Error('Device retention limit reached');
      Object.defineProperty(state.devices, id, { value: event.device, configurable: true, writable: true, enumerable: true });
    }
    if (event.packet) {
      state.packets.unshift(event.packet);
      retainedBytes += Buffer.byteLength(JSON.stringify(event.packet));
      if (event.packet.direction === 'inbound') state.receivedPackets++;
      else state.sentPackets++;
      trim();
    }
    if (event.type === 'decode-error') state.decodeErrors++;
  }

  try {
    const info = await stat(file);
    if (info.size > Math.max(maxJournalBytes * 2, 64 * 1024 * 1024)) throw new Error('Gateway journal exceeds safe replay limit');
    await chmod(file, 0o600);
    const content = await readFile(file, 'utf8');
    const lines = content.split('\n');
    // A crash can leave only the final line incomplete. Do not accept damaged
    // complete lines, because skipping them could silently change telemetry.
    const completeLines = lines.slice(0, -1);
    for (const line of completeLines) if (line) apply(JSON.parse(line));
    bytes = info.size;
    for (const device of Object.values(state.devices)) {
      device.connected = false;
      device.disconnectedAt ||= new Date().toISOString();
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  async function replaceJournal() {
    const temporary = join(dataDir, 'events.next.ndjson');
    const serialized = `${JSON.stringify({ type: 'checkpoint', state })}\n`;
    const handle = await open(temporary, 'w', 0o600);
    try { await handle.writeFile(serialized); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, file);
    bytes = Buffer.byteLength(serialized);
  }
  // Repair a possible partial final write before accepting fresh events. Also
  // persist the offline state after a restart rather than replaying it as live.
  await replaceJournal();

  return {
    get state() { return state; },
    get status() { return { status: failure ? 'error' : 'ok', error: failure ? 'Journal write failed; intake stopped.' : null, journalBytes: bytes, retainedBytes }; },
    limits: { maxPackets, maxDevices, maxRetainedBytes },
    append(event) {
      const run = queue.then(async () => {
        if (closed) throw new Error('Journal is closed');
        if (failure) throw failure;
        if (event.device && !Object.hasOwn(state.devices, event.device.deviceId) && Object.keys(state.devices).length >= maxDevices) throw new Error('Device retention limit reached');
        const serialized = `${JSON.stringify(event)}\n`;
        try {
          if (bytes + Buffer.byteLength(serialized) > maxJournalBytes) await replaceJournal();
          const handle = await open(file, 'a', 0o600);
          try { await handle.writeFile(serialized); await handle.sync(); } finally { await handle.close(); }
          bytes += Buffer.byteLength(serialized);
          apply(event);
        } catch (error) { failure = error; throw error; }
      });
      queue = run.catch(() => {});
      return run;
    },
    async close() { await queue; closed = true; await releaseWriterLock(); },
  };
  } catch (error) { await releaseWriterLock(); throw error; }
}
