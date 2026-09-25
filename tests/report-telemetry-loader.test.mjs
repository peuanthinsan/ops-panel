import assert from 'node:assert/strict';
import test from 'node:test';
import { createReportTelemetryLoader } from '../web/lib/report-telemetry-loader.mjs';

const request = id => ({ id, key: JSON.stringify([id, 'TRUCK', 'start', 'end']) });
const received = value => ({ status: 'received', samples: [{ totalFuel: value }] });
const tick = () => new Promise(resolve => setImmediate(resolve));

function deferredTransport() {
  const calls = [];
  return {
    calls,
    fetch: (id, { signal }) => new Promise((resolve, reject) => {
      calls.push({ id, signal, resolve, reject });
      signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    }),
  };
}

test('jobs list and timeline share active telemetry without one unmount cancelling the other', async () => {
  const transport = deferredTransport();
  const loader = createReportTelemetryLoader(transport.fetch);
  const jobs = loader.subscribe(request('A'));
  const timeline = loader.subscribe(request('A'));
  await tick();
  assert.equal(transport.calls.length, 1);
  jobs.release();
  await tick();
  assert.equal(transport.calls[0].signal.aborted, false);
  transport.calls[0].resolve(received(0));
  assert.deepEqual(await timeline.promise, received(0));
  timeline.release();
  const cached = loader.subscribe(request('A'));
  assert.deepEqual(await cached.promise, received(0));
  assert.equal(transport.calls.length, 1);
});

test('all consumers share a two-request limit and obsolete queued work never starts', async () => {
  const transport = deferredTransport();
  const loader = createReportTelemetryLoader(transport.fetch);
  const jobs = ['A', 'B', 'C'].map(id => loader.subscribe(request(id)));
  const timelineC = loader.subscribe(request('C'));
  const obsolete = loader.subscribe(request('D'));
  obsolete.release();
  await tick();
  assert.deepEqual(transport.calls.map(call => call.id), ['A', 'B']);
  jobs[2].release();
  transport.calls[0].resolve(received(1));
  await tick();
  assert.deepEqual(transport.calls.map(call => call.id), ['A', 'B', 'C']);
  transport.calls[1].resolve(received(2));
  transport.calls[2].resolve(received(3));
  await Promise.all([...jobs, timelineC, obsolete].map(subscription => subscription.promise));
  assert.deepEqual(transport.calls.map(call => call.id), ['A', 'B', 'C']);
  for (const subscription of [...jobs, timelineC]) subscription.release();
});

test('last consumer aborts active work, while immediate remount preserves the shared request', async () => {
  const transport = deferredTransport();
  const loader = createReportTelemetryLoader(transport.fetch);
  const first = loader.subscribe(request('A'));
  await tick();
  first.release();
  const remount = loader.subscribe(request('A'));
  await tick();
  assert.equal(transport.calls.length, 1);
  assert.equal(transport.calls[0].signal.aborted, false);
  remount.release();
  await tick();
  assert.equal(transport.calls[0].signal.aborted, true);
  assert.equal((await remount.promise).status, 'unavailable');
  assert.equal(loader.peek(request('A').key), undefined);
  const retry = loader.subscribe(request('A'));
  await tick();
  assert.equal(transport.calls.length, 2);
  transport.calls[1].resolve(received(10));
  assert.deepEqual(await retry.promise, received(10));
  retry.release();
});

test('successful cache expires and remains bounded; failed or invalid responses can retry', async () => {
  let now = 0;
  let count = 0;
  const loader = createReportTelemetryLoader(async () => {
    count++;
    return received(count);
  }, { now: () => now, cacheLifetimeMs: 60, maxCacheEntries: 2 });
  async function read(id) {
    const subscription = loader.subscribe(request(id));
    const data = await subscription.promise;
    subscription.release();
    return data;
  }
  await read('A');
  await read('B');
  assert.equal(count, 2);
  assert.deepEqual(await read('A'), received(1));
  await read('C');
  assert.equal(loader.peek(request('A').key), undefined);
  now = 60;
  assert.equal(loader.peek(request('B').key), undefined);
  await read('B');
  assert.equal(count, 4);

  let attempts = 0;
  const failingLoader = createReportTelemetryLoader(async () => {
    attempts++;
    if (attempts === 1) throw new Error('Network error');
    if (attempts === 2) return { status: 'received' };
    return received(0);
  });
  for (const expected of ['unavailable', 'unavailable', 'received']) {
    const subscription = failingLoader.subscribe(request('A'));
    assert.equal((await subscription.promise).status, expected);
    subscription.release();
  }
  assert.equal(attempts, 3);
});
