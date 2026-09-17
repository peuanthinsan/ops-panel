import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeSnapshotStream, createSseParser, MAX_GATEWAY_EVENT_BYTES, reconnectDelay, waitForReconnect } from '../web/app/gateway-stream.mjs';

const encoder = new TextEncoder();
const snapshot = { source: 'howen', gateway: { status: 'listening' }, devices: [], packets: [] };
const snapshotEvent = `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;

test('SSE parser handles every byte split of UTF-8, CRLF and coalesced events', () => {
  const input = encoder.encode('\uFEFF: heartbeat\r\nevent: snapshot\r\ndata: {"device":"รถหนึ่ง"}\r\n\r\ndata: next\n\n');
  for (let offset = 0; offset <= input.length; offset += 1) {
    const events = [];
    const parser = createSseParser(event => events.push(event));
    parser.push(input.subarray(0, offset));
    parser.push(input.subarray(offset));
    parser.finish();
    assert.deepEqual(events, [
      { event: 'snapshot', data: '{"device":"รถหนึ่ง"}' },
      { event: 'message', data: 'next' },
    ], `split at byte ${offset}`);
  }
});

test('SSE parser joins multiple data lines, ignores control fields and resets event type', () => {
  const events = [];
  const parser = createSseParser(event => events.push(event));
  parser.push('event: snapshot\rid: 12\rretry: 5\rdata: first\rdata:second\r\r: comment\r\ndata\r\n\r\n');
  assert.deepEqual(events, [{ event: 'snapshot', data: 'first\nsecond' }, { event: 'message', data: '' }]);
});

test('an incomplete final event is not emitted as a snapshot', () => {
  const events = [];
  const parser = createSseParser(event => events.push(event));
  parser.push('event: snapshot\ndata: {"partial":');
  parser.finish();
  assert.deepEqual(events, []);
  assert.throws(() => parser.push('1}\n\n'), /closed/);
});

test('event memory is bounded by UTF-8 bytes across chunks, including comments', () => {
  assert.equal(MAX_GATEWAY_EVENT_BYTES, 16 * 1024 * 1024);
  const parser = createSseParser(() => {}, { maxEventBytes: 32 });
  parser.push('data: ');
  assert.throws(() => parser.push('รถ'.repeat(5)), error => error.code === 'event-too-large');
  const commentParser = createSseParser(() => {}, { maxEventBytes: 12 });
  assert.throws(() => commentParser.push(`:${'x'.repeat(12)}`), error => error.code === 'event-too-large');
  let count = 0;
  const bounded = createSseParser(() => { count += 1; }, { maxEventBytes: 10 });
  bounded.push('data: 1\n\n'.repeat(100));
  assert.equal(count, 100, 'completed events release the per-event budget');
});

test('snapshot stream uses header authentication and releases its reader at EOF', async () => {
  const received = [];
  const body = new ReadableStream({ start(controller) {
    const data = encoder.encode(`: keepalive\n\nevent: ignored\ndata: no-json-required\n\n${snapshotEvent}`);
    for (let index = 0; index < data.length; index += 7) controller.enqueue(data.subarray(index, index + 7));
    controller.close();
  } });
  let request;
  await consumeSnapshotStream({
    url: 'https://example.test/api/admin/gateway/events', token: 'test-admin', signal: new AbortController().signal,
    onSnapshot(value) { received.push(value); },
    async fetchImpl(url, options) { request = { url, options }; return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } }); },
  });
  assert.equal(request.url, 'https://example.test/api/admin/gateway/events');
  assert.equal(request.options.headers['x-admin-token'], 'test-admin');
  assert.equal(request.options.headers.Accept, 'text/event-stream');
  assert.equal(request.options.cache, 'no-store');
  assert.deepEqual(received, [snapshot]);
  assert.equal(body.locked, false);
});

test('aborting a pending read cancels the stream and releases its reader', async () => {
  const controller = new AbortController();
  let cancellations = 0;
  let opened;
  const ready = new Promise(resolve => { opened = resolve; });
  const body = new ReadableStream({ cancel() { cancellations += 1; } });
  const reading = consumeSnapshotStream({
    url: '/api/admin/gateway/events', token: 'test-admin', signal: controller.signal,
    onSnapshot() { assert.fail('No snapshot should arrive'); }, onOpen: opened,
    fetchImpl: async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
  });
  await ready;
  controller.abort();
  await assert.rejects(reading, error => error.name === 'AbortError');
  assert.equal(cancellations, 1);
  assert.equal(body.locked, false);
});

test('401 is surfaced distinctly so the UI expires the session without reconnecting', async () => {
  await assert.rejects(consumeSnapshotStream({
    url: '/api/admin/gateway/events', signal: new AbortController().signal, onSnapshot() {},
    fetchImpl: async () => new Response('Unauthorized', { status: 401 }),
  }), error => error.code === 401 && /session has expired/i.test(error.message));
});

test('invalid stream responses and malformed snapshots fail closed and release readers', async () => {
  await assert.rejects(consumeSnapshotStream({
    url: '/api/admin/gateway/events', signal: new AbortController().signal, onSnapshot() {},
    fetchImpl: async () => new Response('<html/>', { headers: { 'Content-Type': 'text/html' } }),
  }), error => error.code === 'invalid-response');
  for (const payload of ['not json', JSON.stringify({ source: 'vss', devices: [], packets: [] })]) {
    const body = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(`event: snapshot\ndata: ${payload}\n\n`)); } });
    await assert.rejects(consumeSnapshotStream({
      url: '/api/admin/gateway/events', signal: new AbortController().signal, onSnapshot() { assert.fail('Invalid snapshot'); },
      fetchImpl: async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    }), error => error.code === 'invalid-snapshot');
    assert.equal(body.locked, false);
  }
});

test('disconnect backoff is bounded to 1–10 seconds and pending retries are cancellable', async () => {
  assert.deepEqual([0, 1, 2, 3, 4, 20].map(reconnectDelay), [1000, 2000, 4000, 8000, 10000, 10000]);
  const controller = new AbortController();
  const pending = waitForReconnect(10000, controller.signal);
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
});
