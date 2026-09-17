export const MAX_GATEWAY_EVENT_BYTES = 16 * 1024 * 1024;

export class GatewayStreamError extends Error {
  constructor(message, code = 'stream-error') {
    super(message);
    this.name = 'GatewayStreamError';
    this.code = code;
  }
}

/** Incremental SSE framing. Only a blank line completes an event. */
export function createSseParser(onEvent, { maxEventBytes = MAX_GATEWAY_EVENT_BYTES } = {}) {
  if (!Number.isSafeInteger(maxEventBytes) || maxEventBytes < 1) throw new RangeError('Invalid SSE event limit');
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let line = '';
  let eventType = '';
  let data = [];
  let bytes = 0;
  let skipLf = false;
  let firstChunk = true;
  let ended = false;

  function add(text) {
    bytes += encoder.encode(text).byteLength;
    if (bytes > maxEventBytes) throw new GatewayStreamError('Gateway event exceeds the allowed size.', 'event-too-large');
    line += text;
  }
  function completeLine() {
    if (!line) {
      const event = data.length ? { event: eventType || 'message', data: data.join('\n') } : null;
      eventType = ''; data = []; bytes = 0;
      if (event) onEvent(event);
    } else if (!line.startsWith(':')) {
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') eventType = value;
      if (field === 'data') data.push(value);
    }
    line = '';
  }
  function process(text) {
    if (!text) return;
    if (firstChunk) { firstChunk = false; if (text[0] === '\uFEFF') text = text.slice(1); }
    let start = 0;
    if (skipLf) { skipLf = false; if (text[0] === '\n') start = 1; }
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (character !== '\r' && character !== '\n') continue;
      add(text.slice(start, index));
      // Count delimiters as well as fields, so many short lines remain bounded.
      bytes += 1;
      if (bytes > maxEventBytes) throw new GatewayStreamError('Gateway event exceeds the allowed size.', 'event-too-large');
      completeLine();
      if (character === '\r') {
        if (text[index + 1] === '\n') index += 1;
        else if (index === text.length - 1) skipLf = true;
      }
      start = index + 1;
    }
    add(text.slice(start));
  }
  return {
    push(chunk) {
      if (ended) throw new GatewayStreamError('The gateway parser is closed.');
      process(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }));
    },
    finish() {
      if (ended) return;
      process(decoder.decode());
      // An incomplete final event is discarded, never treated as a snapshot.
      ended = true; line = ''; data = []; eventType = ''; bytes = 0;
    },
  };
}

function cancelled() {
  const error = new Error('Gateway connection cancelled');
  error.name = 'AbortError';
  return error;
}

export function reconnectDelay(attempt) {
  return Math.min(10000, 1000 * (2 ** Math.min(Math.max(0, attempt), 4)));
}

export function waitForReconnect(delay, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(cancelled()); return; }
    const abort = () => { clearTimeout(timer); reject(cancelled()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, delay);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** One authenticated connection; the caller owns reconnect and session expiry. */
export async function consumeSnapshotStream({ url, token, signal, onSnapshot, onOpen, fetchImpl = fetch, maxEventBytes }) {
  if (signal.aborted) throw cancelled();
  const response = await fetchImpl(url, {
    method: 'GET', cache: 'no-store', signal,
    headers: { Accept: 'text/event-stream', ...(token ? { 'x-admin-token': token } : {}) },
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new GatewayStreamError(response.status === 401 ? 'Your admin session has expired.' : `Gateway connection unavailable (HTTP ${response.status}).`, response.status);
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new GatewayStreamError('The gateway did not return an event stream.', 'invalid-response');
  }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  const parser = createSseParser(({ event, data }) => {
    if (event !== 'snapshot' || signal.aborted) return;
    let snapshot;
    try { snapshot = JSON.parse(data); }
    catch { throw new GatewayStreamError('The gateway returned an invalid snapshot.', 'invalid-snapshot'); }
    if (snapshot?.source !== 'howen' || !Array.isArray(snapshot.devices) || !Array.isArray(snapshot.packets)) {
      throw new GatewayStreamError('The gateway returned an unexpected snapshot.', 'invalid-snapshot');
    }
    onSnapshot(snapshot);
  }, { maxEventBytes });
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw cancelled();
    onOpen?.();
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (signal.aborted) throw cancelled();
      if (done) { parser.finish(); break; }
      parser.push(value);
    }
    if (signal.aborted) throw cancelled();
  } finally {
    signal.removeEventListener('abort', abort);
    try { await reader.cancel(); } catch { /* Preserve the original connection error. */ }
    reader.releaseLock();
  }
}
