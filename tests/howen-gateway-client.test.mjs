import test from 'node:test';
import assert from 'node:assert/strict';
import { createHowenGatewayClient } from '../web/lib/server/howen-gateway.mjs';

const env = { HOWEN_GATEWAY_API_KEY: 'test-only-gateway-key-123456789', HOWEN_GATEWAY_URL: 'http://127.0.0.1:4066' };
const snapshot = { source: 'howen', gateway: { status: 'listening' }, devices: [], packets: [] };

test('unconfigured gateway reports setup state without a network request', async () => {
  const client = createHowenGatewayClient({ env: {}, fetchImpl: () => assert.fail('unexpected fetch') });
  assert.equal((await client.snapshot()).configured, false);
  await assert.rejects(client.events(), /not configured/);
});

test('gateway bridge sends service key in a header and never forwards admin input', async () => {
  const client = createHowenGatewayClient({ env, fetchImpl: async (url, options) => {
    assert.equal(url.href, 'http://127.0.0.1:4066/snapshot');
    assert.equal(options.headers.Authorization, `Bearer ${env.HOWEN_GATEWAY_API_KEY}`);
    assert.equal(options.redirect, 'manual');
    return Response.json(snapshot);
  } });
  assert.deepEqual(await client.snapshot(), { ...snapshot, configured: true });
});

test('gateway service address cannot expose its key to a remote host or redirect', async () => {
  for (const address of ['https://example.com', 'http://127.0.0.1:4066/private', 'http://name:secret@localhost:4066', 'http://localhost:4066?key=x']) {
    const client = createHowenGatewayClient({ env: { ...env, HOWEN_GATEWAY_URL: address }, fetchImpl: () => assert.fail('unexpected fetch') });
    await assert.rejects(client.snapshot(), /loopback/);
  }
  const redirected = createHowenGatewayClient({ env, fetchImpl: async () => new Response('', { status: 302, headers: { Location: 'https://example.com' } }) });
  await assert.rejects(redirected.snapshot(), /unavailable/);
});

test('upstream errors and invalid snapshots remain generic and do not leak response bodies', async () => {
  for (const response of [new Response('private diagnostic secret', { status: 401 }), Response.json({ source: 'vss' }), new Response('private invalid json')]) {
    const client = createHowenGatewayClient({ env, fetchImpl: async () => response });
    await assert.rejects(client.snapshot(), error => !error.message.includes('private') && error.status === 503);
  }
});

test('gateway connect deadline aborts requests without leaking transport errors', async () => {
  const client = createHowenGatewayClient({ env, connectTimeoutMs: 10, fetchImpl: async (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('private address/token')), { once: true });
  }) });
  await assert.rejects(client.snapshot(), /Could not reach the local Howen gateway/);
});

test('SSE preserves streaming headers and cancellation aborts the upstream connection', async () => {
  let signal;
  const bytes = new TextEncoder().encode('event: snapshot\ndata: {}\n\n');
  const client = createHowenGatewayClient({ env, fetchImpl: async (_, options) => {
    signal = options.signal;
    return new Response(new ReadableStream({ start(c) { c.enqueue(bytes); } }), { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  const response = await client.events();
  assert.equal(response.headers.get('X-Accel-Buffering'), 'no');
  assert.match(response.headers.get('Cache-Control'), /no-transform/);
  const reader = response.body.getReader();
  assert.deepEqual((await reader.read()).value, bytes);
  await reader.cancel();
  assert.equal(signal.aborted, true);
});

test('ordinary JSON cannot be mistaken for a healthy live event stream', async () => {
  const client = createHowenGatewayClient({ env, fetchImpl: async () => Response.json(snapshot) });
  await assert.rejects(client.events(), /did not provide an event stream/);
});

test('simulation controls forward only allowlisted commands over private authenticated HTTP', async () => {
  let calls = 0;
  const client = createHowenGatewayClient({ env, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url.pathname, '/simulation');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, `Bearer ${env.HOWEN_GATEWAY_API_KEY}`);
    assert.deepEqual(JSON.parse(options.body), { action: 'run', scenarioId: 'all', confirmationMode: 'driver' });
    return Response.json({ ...snapshot, simulation: { enabled: true, status: 'running' } });
  } });
  assert.equal((await client.simulation({ action: 'run', scenarioId: 'all', confirmationMode: 'driver' })).simulation.status, 'running');
  for (const command of [null, [], { action: 'erase' }, { action: 'run', scenarioId: 'real-truck', confirmationMode: 'driver' }, { action: 'run', scenarioId: 'all', confirmationMode: 'ignition' }, { action: 'stop', deviceId: 'TRUCK-1' }, { action: 'run', scenarioId: 'all', confirmationMode: 'input', url: 'http://evil.invalid' }]) {
    await assert.rejects(client.simulation(command), error => error.status === 400);
  }
  assert.equal(calls, 1);
});

test('disabled or concurrent simulation errors preserve status without exposing upstream text', async () => {
  for (const status of [400, 403, 409, 413]) {
    const client = createHowenGatewayClient({ env, fetchImpl: async () => new Response('private test secret', { status }) });
    await assert.rejects(client.simulation({ action: 'stop' }), error => error.status === status && !error.message.includes('private test secret'));
  }
});
