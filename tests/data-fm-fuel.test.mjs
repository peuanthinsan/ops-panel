import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchDataFmFuelHistory,
  parseDataFmFuelDateTime,
  resetDataFmTokenCacheForTests,
} from '../web/lib/server/data-fm-gps.mjs';

const config = {
  baseUrl: 'https://www.data-fm.com',
  username: 'fuel-test-user',
  password: 'fuel-test-password',
  timeZone: 'Asia/Bangkok',
  vehicleNumber: '700-2187',
  fromAt: '2026-09-24T00:00:00.000Z',
  toAt: '2026-09-24T01:00:00.000Z',
  nowMs: Date.parse('2026-09-24T02:00:00.000Z'),
};

const jsonResponse = value => new Response(JSON.stringify(value));
const row = (datetime = '24/09/2026 7:00:00', values = {}) => ({ vehicleno: config.vehicleNumber, datetime, speed: 0, totalfuel: 400, ...values });
const rowsResponse = rows => jsonResponse({ vResponseCode: 0, vTotalRecords: rows.length, vData: rows });

function fixtureFetch(fuelResponse) {
  const requests = [];
  return {
    requests,
    fetchImpl: async (value, options) => {
      const url = new URL(value);
      requests.push(url);
      if (url.pathname.endsWith('/GetToken')) return jsonResponse({ vResponseCode: 0, token: 'fuel-secret-token' });
      if (url.pathname.endsWith('/GetMasterVehicleList')) return rowsResponse([{ vehicleno: config.vehicleNumber }]);
      return typeof fuelResponse === 'function' ? fuelResponse(url, options) : rowsResponse(fuelResponse);
    },
  };
}

test('parses fuel timestamps with the configured source timezone and rejects invalid calendar times', () => {
  assert.equal(parseDataFmFuelDateTime('24/09/2026 7:01:02', 'Asia/Bangkok'), '2026-09-24T00:01:02.000Z');
  assert.equal(parseDataFmFuelDateTime('24/09/2026 14:48:07', 'Asia/Bangkok'), '2026-09-24T07:48:07.000Z');
  assert.equal(parseDataFmFuelDateTime('31/09/2026 7:01:02', 'Asia/Bangkok'), null);
  assert.equal(parseDataFmFuelDateTime('24/09/2026 25:01:02', 'Asia/Bangkok'), null);
  assert.equal(parseDataFmFuelDateTime('2026.09.24 07:01:02', 'Asia/Bangkok'), null);
});

test('fetches sorted fuel and speed on a shared timestamp, preserving zero, null, and the raw fuel scale', async () => {
  resetDataFmTokenCacheForTests();
  const { fetchImpl, requests } = fixtureFetch([
    row('24/09/2026 7:10:00', { speed: '42.5', totalfuel: '400' }),
    row('24/09/2026 7:00:00', { speed: 0, totalfuel: 0 }),
    row('24/09/2026 7:20:00', { speed: -1, totalfuel: null }),
    row('24/09/2026 7:30:00', { speed: false, totalfuel: ' ' }),
    row('24/09/2026 7:40:00', { speed: 'n/a', totalfuel: -3 }),
    row('24/09/2026 7:50:00', { speed: 'Infinity', totalfuel: 'NaN' }),
  ]);
  const result = await fetchDataFmFuelHistory({ ...config, fetchImpl });
  assert.equal(result.status, 'received');
  assert.equal(result.source, 'data-fm');
  assert.equal(result.fuelUnit, null);
  assert.deepEqual(result.samples.map(({ capturedAt, speedKph, totalFuel }) => ({ capturedAt, speedKph, totalFuel })), [
    { capturedAt: '2026-09-24T00:00:00.000Z', speedKph: 0, totalFuel: 0 },
    { capturedAt: '2026-09-24T00:10:00.000Z', speedKph: 42.5, totalFuel: 400 },
    { capturedAt: '2026-09-24T00:20:00.000Z', speedKph: null, totalFuel: null },
    { capturedAt: '2026-09-24T00:30:00.000Z', speedKph: null, totalFuel: null },
    { capturedAt: '2026-09-24T00:40:00.000Z', speedKph: null, totalFuel: null },
    { capturedAt: '2026-09-24T00:50:00.000Z', speedKph: null, totalFuel: null },
  ]);
  assert.equal(new Set(result.samples.map(sample => sample.id)).size, 6);
  assert.equal(requests[1].pathname, '/Api/VTService.svc/GetFuelStatus');
  assert.equal(requests[1].searchParams.get('fromdatetime'), '2026.09.24 07:00:00');
  assert.equal(requests[1].searchParams.get('todatetime'), '2026.09.24 08:00:00');
  assert.equal(requests[1].searchParams.get('vehicleno'), config.vehicleNumber);
  assert.equal(requests[1].searchParams.get('jtoken'), 'fuel-secret-token');
});

test('supports inclusive 24-hour segments, removes duplicate boundaries, and clips the original range', async () => {
  resetDataFmTokenCacheForTests();
  const { fetchImpl, requests } = fixtureFetch(url => url.searchParams.get('fromdatetime') === '2026.09.24 07:00:00'
    ? rowsResponse([row('24/09/2026 7:00:00'), row('25/09/2026 7:00:00')])
    : rowsResponse([row('25/09/2026 7:00:00'), row('25/09/2026 8:00:00'), row('25/09/2026 8:00:01')]));
  const result = await fetchDataFmFuelHistory({ ...config, toAt: '2026-09-25T01:00:00.000Z', fetchImpl });
  assert.equal(result.status, 'received');
  assert.equal(result.samples.length, 3);
  assert.deepEqual(requests.slice(1).map(url => [url.searchParams.get('fromdatetime'), url.searchParams.get('todatetime')]), [
    ['2026.09.24 07:00:00', '2026.09.25 07:00:00'],
    ['2026.09.25 07:00:00', '2026.09.25 08:00:00'],
  ]);
});

test('accepts empty and string-encoded record arrays with confirmed record counts', async () => {
  for (const vResponseCode of [0, 6]) {
    resetDataFmTokenCacheForTests();
    const { fetchImpl } = fixtureFetch(() => jsonResponse({ vResponseCode, vTotalRecords: '0', vData: '[]' }));
    const result = await fetchDataFmFuelHistory({ ...config, fetchImpl });
    assert.equal(result.status, 'received');
    assert.deepEqual(result.samples, []);
  }
  resetDataFmTokenCacheForTests();
  const { fetchImpl } = fixtureFetch(() => jsonResponse({ VRESPONSECODE: '0', VTOTALRECORDS: '1', VDATA: JSON.stringify([row()]) }));
  assert.equal((await fetchDataFmFuelHistory({ ...config, fetchImpl })).samples.length, 1);
});

test('requests and returns a sample for a single-instant event', async () => {
  resetDataFmTokenCacheForTests();
  const { fetchImpl, requests } = fixtureFetch([row()]);
  const result = await fetchDataFmFuelHistory({ ...config, toAt: config.fromAt, fetchImpl });
  assert.equal(result.status, 'received');
  assert.equal(result.samples.length, 1);
  assert.equal(requests[1].searchParams.get('fromdatetime'), requests[1].searchParams.get('todatetime'));
});

test('retries valid no-data responses with the canonical fleet name and preserves the requested label', async () => {
  resetDataFmTokenCacheForTests();
  const requests = [];
  const fetchImpl = async value => {
    const url = new URL(value);
    requests.push(url);
    if (url.pathname.endsWith('/GetToken')) return jsonResponse({ vResponseCode: 0, token: 'fuel-secret-token' });
    if (url.pathname.endsWith('/GetMasterVehicleList')) return rowsResponse([{ vehicleno: 'Ford T' }]);
    if (url.searchParams.get('vehicleno') === 'FORD T') return jsonResponse({ vResponseCode: 6, vTotalRecords: 0, vData: '[]' });
    return rowsResponse([row('24/09/2026 7:00:00', { vehicleno: 'Ford T' })]);
  };
  const result = await fetchDataFmFuelHistory({ ...config, vehicleNumber: 'FORD T', fetchImpl });
  assert.equal(result.status, 'received');
  assert.equal(result.samples.length, 1);
  assert.match(result.samples[0].id, /^data-fm-fuel:FORD T:/);
  const fuelRequests = requests.filter(url => url.pathname.endsWith('/GetFuelStatus'));
  assert.deepEqual(fuelRequests.map(url => url.searchParams.get('vehicleno')), ['FORD T', 'Ford T']);
  assert.equal(fuelRequests[0].searchParams.get('fromdatetime'), fuelRequests[1].searchParams.get('fromdatetime'));
  assert.equal(fuelRequests[0].searchParams.get('todatetime'), fuelRequests[1].searchParams.get('todatetime'));
  assert.equal(requests.filter(url => url.pathname.endsWith('/GetMasterVehicleList')).length, 1);
});

test('bounds canonical lookup and retry to once across multi-day no-data results', async () => {
  resetDataFmTokenCacheForTests();
  const requests = [];
  const fetchImpl = async url => {
    requests.push(url);
    if (url.pathname.endsWith('/GetToken')) return jsonResponse({ vResponseCode: 0, token: 'fuel-secret-token' });
    if (url.pathname.endsWith('/GetMasterVehicleList')) return rowsResponse([{ vehicleno: 'Ford T' }]);
    return jsonResponse({ vResponseCode: 6, vTotalRecords: 0, vData: [] });
  };
  const result = await fetchDataFmFuelHistory({ ...config, vehicleNumber: 'FORD T', toAt: '2026-09-25T01:00:00Z', fetchImpl });
  assert.equal(result.status, 'received');
  assert.deepEqual(result.samples, []);
  assert.equal(requests.filter(url => url.pathname.endsWith('/GetMasterVehicleList')).length, 1);
  assert.deepEqual(requests.filter(url => url.pathname.endsWith('/GetFuelStatus')).map(url => url.searchParams.get('vehicleno')), ['FORD T', 'Ford T', 'Ford T']);
});

test('does not look up canonical names for malformed no-data responses or successful empty responses', async () => {
  for (const payload of [
    { vResponseCode: 6, vTotalRecords: 1, vData: [] },
    { vResponseCode: 6, vTotalRecords: 0, vData: 'bad-json' },
    { vResponseCode: 0, vTotalRecords: 0, vData: [] },
  ]) {
    resetDataFmTokenCacheForTests();
    const { fetchImpl, requests } = fixtureFetch(() => jsonResponse(payload));
    const result = await fetchDataFmFuelHistory({ ...config, vehicleNumber: 'FORD T', fetchImpl });
    assert.equal(result.status, payload.vResponseCode === 0 ? 'received' : 'unavailable');
    assert.equal(requests.length, 2);
  }
});

test('keeps canonical lookup under the original overall request deadline', async () => {
  resetDataFmTokenCacheForTests();
  const fetchImpl = async url => {
    if (url.pathname.endsWith('/GetToken')) return jsonResponse({ vResponseCode: 0, token: 'fuel-secret-token' });
    if (url.pathname.endsWith('/GetMasterVehicleList')) return new Promise(() => {});
    return jsonResponse({ vResponseCode: 6, vTotalRecords: 0, vData: [] });
  };
  const start = Date.now();
  const result = await fetchDataFmFuelHistory({ ...config, vehicleNumber: 'FORD T', timeoutMs: 25, fetchImpl });
  assert.equal(result.status, 'unavailable');
  assert.match(result.message, /timed out/);
  assert.ok(Date.now() - start < 1_000);
});

test('rejects malformed, incomplete, wrong-vehicle, and invalid-timestamp responses without partial samples', async () => {
  for (const payload of [
    {},
    { vResponseCode: 0, vTotalRecords: 1, vData: 'not-json' },
    { vResponseCode: 0, vTotalRecords: 1, vData: {} },
    { vResponseCode: 0, vTotalRecords: 2, vData: [row()] },
    { vResponseCode: 0, vData: [row()] },
    { vResponseCode: 0, vTotalRecords: -1, vData: [] },
    { vResponseCode: 0, vTotalRecords: false, vData: [] },
    { vResponseCode: 0, vTotalRecords: 2, vData: [row(), row('24/09/2026 7:01:00', { vehicleno: 'OTHER' })] },
    { vResponseCode: 0, vTotalRecords: 2, vData: [row(), row('not-a-date')] },
    { vResponseCode: 6, vTotalRecords: 1, vData: [row()] },
  ]) {
    resetDataFmTokenCacheForTests();
    const { fetchImpl } = fixtureFetch(() => jsonResponse(payload));
    const result = await fetchDataFmFuelHistory({ ...config, fetchImpl });
    assert.equal(result.status, 'unavailable', JSON.stringify(payload));
    assert.deepEqual(result.samples, []);
  }
});

test('drops all prior segments when a later segment fails', async () => {
  resetDataFmTokenCacheForTests();
  let segment = 0;
  const { fetchImpl } = fixtureFetch(() => ++segment === 1 ? rowsResponse([row()]) : jsonResponse({ vResponseCode: 7 }));
  const result = await fetchDataFmFuelHistory({ ...config, toAt: '2026-09-25T01:00:00.000Z', fetchImpl });
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.samples, []);
  assert.match(result.message, /request limit/);
});

test('refreshes a rejected token once and bounds repeated token rejections', async () => {
  for (const alwaysReject of [false, true]) {
    resetDataFmTokenCacheForTests();
    let tokens = 0;
    let historyRequests = 0;
    const fetchImpl = async url => {
      if (url.pathname.endsWith('/GetToken')) return jsonResponse({ vResponseCode: 0, token: `token-${++tokens}` });
      historyRequests++;
      return alwaysReject || historyRequests === 1 ? jsonResponse({ vResponseCode: 1 }) : rowsResponse([row()]);
    };
    const result = await fetchDataFmFuelHistory({ ...config, fetchImpl });
    assert.equal(result.status, alwaysReject ? 'unavailable' : 'received');
    assert.equal(tokens, 2);
    assert.equal(historyRequests, 2);
  }
});

test('validates configuration and range before requesting and never silently truncates long ranges', async () => {
  resetDataFmTokenCacheForTests();
  const fetchImpl = async () => { assert.fail('invalid requests must not fetch'); };
  const missing = await fetchDataFmFuelHistory({ ...config, password: '', fetchImpl });
  assert.equal(missing.status, 'not_configured');
  for (const overrides of [
    { baseUrl: 'http://www.data-fm.com' }, { timeZone: 'invalid/zone' }, { vehicleNumber: '' },
    { fromAt: 'invalid' }, { toAt: '2026-09-23T00:00:00Z' }, { toAt: '2026-10-02T00:00:00Z' }, { timeoutMs: 0 },
  ]) assert.equal((await fetchDataFmFuelHistory({ ...config, ...overrides, fetchImpl })).status, 'unavailable');
});

test('deduplicates concurrent and recent range reads and separates credential configurations', async () => {
  resetDataFmTokenCacheForTests();
  const { fetchImpl, requests } = fixtureFetch([row()]);
  const results = await Promise.all(Array.from({ length: 4 }, () => fetchDataFmFuelHistory({ ...config, fetchImpl })));
  assert.ok(results.every(result => result.status === 'received'));
  assert.equal(requests.length, 2);
  await fetchDataFmFuelHistory({ ...config, fetchImpl, nowMs: config.nowMs + 29_999 });
  assert.equal(requests.length, 2);
  await fetchDataFmFuelHistory({ ...config, fetchImpl, nowMs: config.nowMs + 30_000 });
  assert.equal(requests.length, 3);
  await fetchDataFmFuelHistory({ ...config, password: 'new-secret-password', fetchImpl, nowMs: config.nowMs + 30_001 });
  assert.equal(requests.length, 5);
});

test('evicts older completed ranges after the bounded cache fills', async () => {
  resetDataFmTokenCacheForTests();
  const { fetchImpl, requests } = fixtureFetch([]);
  for (let index = 0; index < 33; index++) {
    await fetchDataFmFuelHistory({ ...config, vehicleNumber: `TRUCK-${index}`, fetchImpl });
  }
  assert.equal(requests.length, 34);
  await fetchDataFmFuelHistory({ ...config, vehicleNumber: 'TRUCK-0', fetchImpl });
  assert.equal(requests.length, 35);
});

test('sanitizes transport errors and bounds the whole request even when a transport ignores abort', async () => {
  resetDataFmTokenCacheForTests();
  const failure = await fetchDataFmFuelHistory({ ...config, fetchImpl: async url => { throw new Error(`Failed ${url}`); } });
  assert.equal(failure.status, 'unavailable');
  assert.doesNotMatch(failure.message, /fuel-test-password|username=|https:/);

  resetDataFmTokenCacheForTests();
  const start = Date.now();
  const timeout = await fetchDataFmFuelHistory({ ...config, timeoutMs: 25, fetchImpl: () => new Promise(() => {}) });
  assert.equal(timeout.status, 'unavailable');
  assert.match(timeout.message, /timed out/);
  assert.ok(Date.now() - start < 1_000);
});
