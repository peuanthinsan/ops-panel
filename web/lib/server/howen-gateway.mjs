import { isIP } from 'node:net';

const MAX_BYTES = 16 * 1024 * 1024;
const CONNECT_TIMEOUT_MS = 8000;
const SCENARIO_IDS = new Set(['all', 'loading', 'unloading', 'waiting', 'rest-break', 'vehicle-check', 'refuelling', 'car-wash', 'overnight-parking', 'job-complete', 'sos', 'snapshot']);
export const GATEWAY_STREAM_LIFETIME_MS = 5 * 60_000;

export class HowenGatewayError extends Error {
  constructor(message, status = 503) { super(message); this.name = 'HowenGatewayError'; this.status = status; }
}

function configuration(env) {
  const key = String(env.HOWEN_GATEWAY_API_KEY || '');
  const address = String(env.HOWEN_GATEWAY_URL || '');
  if (!key && !address) return null;
  if (key.length < 24 || /[\r\n]/.test(key)) throw new HowenGatewayError('Set HOWEN_GATEWAY_API_KEY to the gateway service key (at least 24 characters).');
  let url;
  try { url = new URL(address || 'http://127.0.0.1:4066'); } catch { throw new HowenGatewayError('HOWEN_GATEWAY_URL must identify the local gateway HTTP service.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'));
  if (!loopback || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new HowenGatewayError('HOWEN_GATEWAY_URL must be a loopback HTTP service origin without a path or credentials.');
  }
  return { url, key };
}

async function readBoundedJson(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw new HowenGatewayError('The Howen gateway returned an empty response.');
  let bytes = 0;
  const chunks = [];
  try {
    for (;;) {
      if (signal.aborted) throw new Error('aborted');
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new HowenGatewayError('The Howen gateway snapshot exceeds the response limit.');
      chunks.push(Buffer.from(value));
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (data?.source !== 'howen' || !Array.isArray(data.devices) || !Array.isArray(data.packets) || !data.gateway) {
      throw new HowenGatewayError('The local service did not return a Howen gateway snapshot.');
    }
    return data;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function createHowenGatewayClient({ env = process.env, fetchImpl = globalThis.fetch, connectTimeoutMs = CONNECT_TIMEOUT_MS, streamLifetimeMs = GATEWAY_STREAM_LIFETIME_MS } = {}) {
  async function connect(path, callerSignal, stream = false, command) {
    const config = configuration(env);
    if (!config) throw new HowenGatewayError('The Howen gateway service is not configured.');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (callerSignal?.aborted) cancel();
    else callerSignal?.addEventListener('abort', cancel, { once: true });
    let timer = setTimeout(cancel, connectTimeoutMs);
    const cleanup = () => { clearTimeout(timer); callerSignal?.removeEventListener('abort', cancel); };
    try {
      const response = await fetchImpl(new URL(path, config.url), {
        headers: { Authorization: `Bearer ${config.key}`, Accept: stream ? 'text/event-stream' : 'application/json', ...(command ? { 'Content-Type': 'application/json' } : {}) },
        ...(command ? { method: 'POST', body: JSON.stringify(command) } : {}),
        redirect: 'manual', cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok || response.redirected) {
        controller.abort();
        if (command && [400, 403, 409, 413].includes(response.status)) {
          const messages = { 400: 'Choose a valid simulation scenario and confirmation method.', 403: 'The simulation lab is disabled on this gateway.', 409: 'A simulation is already running. Stop it before starting another.', 413: 'The simulation command is too large.' };
          throw new HowenGatewayError(messages[response.status], response.status);
        }
        throw new HowenGatewayError(response.status === 401 || response.status === 403 ? 'The Ops API could not authenticate with the Howen gateway service.' : 'The Howen gateway service is unavailable.');
      }
      if (stream) {
        if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream') || !response.body) {
          controller.abort();
          throw new HowenGatewayError('The Howen gateway did not provide an event stream.');
        }
        clearTimeout(timer);
        // Periodically reconnect through the admin check; a stream never extends
        // an expired or revoked dashboard session indefinitely.
        timer = setTimeout(cancel, streamLifetimeMs);
      }
      return { response, controller, cleanup };
    } catch (error) {
      cleanup();
      if (error instanceof HowenGatewayError) throw error;
      throw new HowenGatewayError('Could not reach the local Howen gateway. Check that its service is running.');
    }
  }

  return {
    async simulation(command, signal) {
      if (!command || Array.isArray(command) || typeof command !== 'object' || Object.keys(command).some(key => !['action', 'scenarioId', 'confirmationMode'].includes(key)) || !['run', 'stop'].includes(command.action) || (command.action === 'run' && (!SCENARIO_IDS.has(command.scenarioId) || !['driver', 'input'].includes(command.confirmationMode)))) {
        throw new HowenGatewayError('Choose a valid simulation scenario and confirmation method.', 400);
      }
      const safeCommand = command.action === 'stop' ? { action: 'stop' } : { action: 'run', scenarioId: command.scenarioId, confirmationMode: command.confirmationMode };
      const connection = await connect('/simulation', signal, false, safeCommand);
      try { return { ...await readBoundedJson(connection.response, connection.controller.signal), configured: true }; }
      catch (error) {
        if (error instanceof HowenGatewayError) throw error;
        throw new HowenGatewayError('The simulation response could not be read.');
      } finally { connection.controller.abort(); connection.cleanup(); }
    },
    async snapshot(signal) {
      if (!configuration(env)) return { source: 'howen', configured: false, generatedAt: new Date().toISOString(), gateway: { status: 'unconfigured' }, devices: [], packets: [] };
      const connection = await connect('/snapshot', signal);
      try { return { ...await readBoundedJson(connection.response, connection.controller.signal), configured: true }; }
      catch (error) {
        if (error instanceof HowenGatewayError) throw error;
        throw new HowenGatewayError('The Howen gateway snapshot could not be read.');
      } finally { connection.controller.abort(); connection.cleanup(); }
    },
    async events(signal) {
      const connection = await connect('/events', signal, true);
      const reader = connection.response.body.getReader();
      let closed = false;
      const finish = () => {
        if (closed) return;
        closed = true;
        connection.controller.abort(); connection.cleanup();
        void reader.cancel().catch(() => {});
      };
      const stream = new ReadableStream({
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (done) { finish(); controller.close(); }
            else controller.enqueue(value);
          } catch { finish(); controller.error(new Error('Howen gateway stream disconnected.')); }
        },
        cancel: finish,
      });
      return new Response(stream, { headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, no-transform',
        'X-Accel-Buffering': 'no',
      } });
    },
  };
}

const client = createHowenGatewayClient();
export const getHowenGatewaySnapshot = signal => client.snapshot(signal);
export const getHowenGatewayEvents = signal => client.events(signal);
export const controlHowenSimulation = (command, signal) => client.simulation(command, signal);
