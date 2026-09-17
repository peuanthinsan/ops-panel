import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeofenceSource } from '../web/lib/server/geofence-source.mjs';

const apiEnv = { SONGDEE_DATA_FM_BASE_URL: 'https://data-fm.example', SONGDEE_DATA_FM_USERNAME: 'api-user', SONGDEE_DATA_FM_PASSWORD: 'api-password' };
const fmsEnv = { SONGDEE_FMS_BASE_URL: 'https://fms.example/SDFMSV20/', SONGDEE_FMS_USERNAME: 'web-user', SONGDEE_FMS_PASSWORD: 'web-password' };
const response = (value, init) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' }, ...init });
const tokenResponse = token => response({ vResponseCode: 0, token });
const rowsResponse = (rows, total = rows.length) => response({ vResponseCode: 0, vData: rows, vTotalRecords: total });
function apiSource(rows, overrides = {}) {
  return createGeofenceSource({ env: apiEnv, fetchImpl: async url => url.pathname.endsWith('/GetToken') ? tokenResponse('test-session-token') : rowsResponse(rows), ...overrides });
}

test('no configured source means no network requests, including Spark', async () => {
  const source = createGeofenceSource({ env: { SPARK_BASE_URL: 'https://spark.example', SPARK_API_KEY: 'spark-secret' }, fetchImpl: () => assert.fail('Network request without an authorized source') });
  const snapshot = await source.getGeofenceSnapshot();
  assert.equal(snapshot.configured, false);
  assert.deepEqual(snapshot.fences, []);
  assert.equal(snapshot.coverage.complete, false);
  assert.ok(snapshot.sources.every(source => source.status === 'unconfigured'));
});

test('Data-FM sends the verified query parameters and retains all 1,205 rows with a 60-second cache', async () => {
  let time = Date.UTC(2026, 8, 17);
  const calls = [];
  const rows = Array.from({ length: 1205 }, (_, i) => ({ geofenceid: i, 'Geofence Name': `Fence ${i}`, 'Shape Type': 'unknown' }));
  const source = apiSource(rows, { now: () => time, fetchImpl: async (url, options) => {
    calls.push({ url: new URL(url), options });
    return url.pathname.endsWith('/GetToken') ? tokenResponse('test-session-token') : response({ vResponseCode: '0', vTotalRecords: '1205', vData: JSON.stringify(rows) });
  } });
  const first = await source.getGeofenceSnapshot();
  assert.deepEqual(first.coverage, { total: 1205, returned: 1205, complete: true });
  assert.equal(first.fences.at(-1).name, 'Fence 1204');
  assert.equal(first.fences.at(-1).id, 'data-fm:1204');
  assert.deepEqual([...calls[0].url.searchParams.entries()], [['username', 'api-user'], ['Password', 'api-password']]);
  assert.equal(calls[1].url.pathname, '/Api/VTService.svc/GetGeofenceInfo');
  assert.deepEqual([...calls[1].url.searchParams.entries()], [['jtoken', 'test-session-token']]);
  assert.ok(calls.every(call => call.options.redirect === 'manual' && call.options.method === 'GET'));
  first.fences.pop();
  assert.equal((await source.getGeofenceSnapshot()).fences.length, 1205);
  assert.equal(calls.length, 2);
  time += 60_001;
  await source.getGeofenceSnapshot();
  assert.equal(calls.length, 3);
});

test('Data-FM response code 4 is an error, never a successful empty catalog', async () => {
  const source = apiSource([], { fetchImpl: async url => url.pathname.endsWith('/GetToken') ? tokenResponse('test-session-token') : response({ vResponseCode: 4, vTotalRecords: 0, vData: '[]', error: 'api-password test-session-token' }) });
  const snapshot = await source.getGeofenceSnapshot();
  assert.equal(snapshot.configured, true);
  assert.equal(snapshot.sources[0].status, 'error');
  assert.match(snapshot.sources[0].error, /server exception.*code 4/);
  assert.deepEqual(snapshot.coverage, { total: null, returned: 0, complete: false });
  assert.doesNotMatch(JSON.stringify(snapshot), /api-password|test-session-token/);
});

test('expired Data-FM token is refreshed once and repeated rejection enters cooldown', async () => {
  let logins = 0;
  let reads = 0;
  const source = apiSource([], { fetchImpl: async url => {
    if (url.pathname.endsWith('/GetToken')) return tokenResponse(`test-session-${++logins}`);
    reads++;
    return response({ vResponseCode: 1, vData: '[]' });
  } });
  const first = await source.getGeofenceSnapshot();
  assert.equal(first.sources[0].status, 'error');
  assert.equal(logins, 2);
  assert.equal(reads, 2);
  const second = await source.getGeofenceSnapshot();
  assert.match(second.sources[0].error, /temporarily paused/);
  assert.equal(logins, 2);
  assert.equal(reads, 2);
});

test('failed token login is bounded by cooldown and successful refresh returns rows', async () => {
  let time = 1_000_000;
  let calls = 0;
  const source = apiSource([], { now: () => time, fetchImpl: async () => { calls++; return response({ vResponseCode: 5, token: 'do-not-accept' }); } });
  assert.match((await source.getGeofenceSnapshot()).sources[0].error, /authentication failed/);
  await source.getGeofenceSnapshot();
  assert.equal(calls, 1);
  time += 180_001;
  await source.getGeofenceSnapshot();
  assert.equal(calls, 2);
  let reads = 0;
  let logins = 0;
  const refresh = apiSource([], { fetchImpl: async url => url.pathname.endsWith('/GetToken') ? tokenResponse(`session-${++logins}`) : ++reads === 1 ? response({ vResponseCode: 1 }) : rowsResponse([{ name: 'Recovered' }]) });
  assert.equal((await refresh.getGeofenceSnapshot()).fences[0].name, 'Recovered');
  assert.equal(logins, 2);
});

test('partial responses retain rows and report incomplete coverage; malformed arrays are errors', async () => {
  const partial = apiSource([], { fetchImpl: async url => url.pathname.endsWith('/GetToken') ? tokenResponse('test-session-token') : rowsResponse([{ id: 1 }, { id: 2 }], 8) });
  const snapshot = await partial.getGeofenceSnapshot();
  assert.deepEqual(snapshot.coverage, { total: 8, returned: 2, complete: false });
  assert.equal(snapshot.sources[0].status, 'error');
  const malformed = apiSource([], { fetchImpl: async url => url.pathname.endsWith('/GetToken') ? tokenResponse('test-session-token') : response({ vResponseCode: 0, vTotalRecords: 0, vData: 'not-json' }) });
  assert.equal((await malformed.getGeofenceSnapshot()).sources[0].status, 'error');
});

test('explicit valid circles render, invalid or ambiguous geometry retains the source record', async () => {
  const rows = [
    { geofence_id: 'a', 'Geofence Name': 'Circle', 'Shape Type': 'Circle', Latitude: '13.7', Longitude: '100.5', Radius: '250', enabled: '1' },
    { guid: 'b', shapeType: 'Circle', latitude: 100, longitude: 13, radius: 250 },
    { id: 'c', shapeType: 'Circle', latitude: '', longitude: false, radius: -1 },
    { id: 'd', shapeType: 'Polygon', shapeCoordinates: '[[13.7,100.5],[13.8,100.5],[13.8,100.6]]' },
    { id: 'e', shapeType: 'Polygon', points: [{ lat: 13, lng: 100 }, { lat: 14, lng: 100 }, { lat: 14, lng: 101 }] },
    { id: 'f', geometry: { type: 'Polygon', coordinates: [[[100, 13], [100, 14], [101, 14], [100, 13]]] } },
    { id: 'g', type: 'Polygon', coordinates: [[[100, 13], [100, 14], [101, 14], [100, 13]]] },
    'unrecognized primitive row',
  ];
  const { fences } = await apiSource(rows).getGeofenceSnapshot();
  assert.equal(fences.length, rows.length);
  assert.deepEqual(fences[0].geometry, { type: 'circle', center: { lat: 13.7, lng: 100.5 }, radiusMeters: 250 });
  assert.equal(fences[0].enabled, true);
  for (const index of [1, 2, 3, 7]) { assert.equal(fences[index].geometry, null); assert.ok(fences[index].warnings.length); assert.deepEqual(fences[index].raw, rows[index]); }
  for (const index of [4, 5, 6]) assert.equal(fences[index].geometry.type, 'polygon');
  assert.deepEqual(fences[5].geometry.paths[0][0], { lat: 13, lng: 100 });
});

test('raw diagnostics redact credentials, embedded JSON, headers and cookies', async () => {
  const row = { id: 1, description: 'api-password test-session-token', password: 'nested-secret', nested: { authorization: 'Bearer secret', headers: [['x-custom', 'sensitive-value']], cookies: 'session-value' }, embedded: '{"password":"secret","name":"okay","headers":[["custom","sensitive-value"]]}' };
  const snapshot = await apiSource([row]).getGeofenceSnapshot();
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /api-password|test-session-token|nested-secret|sensitive-value|session-value|Bearer secret/);
  assert.equal(snapshot.fences[0].raw.nested.headers, '[redacted]');
  assert.match(snapshot.fences[0].raw.embedded, /redacted/);
});

test('missing IDs are stable across key ordering and duplicate IDs do not lose rows', async () => {
  const a = await apiSource([{ name: 'A', category: 'Depot' }, { id: 'same' }, { id: 'same' }]).getGeofenceSnapshot();
  const b = await apiSource([{ category: 'Depot', name: 'A' }]).getGeofenceSnapshot();
  assert.equal(a.fences[0].id, b.fences[0].id);
  assert.notEqual(a.fences[1].id, a.fences[2].id);
  assert.equal(a.fences.length, 3);
});

function fmsFixture({ login = [{ loginstatus: 1 }], dataHref = '/SDFMSV20/list/GetListData', headers = true, origin = 'https://fms.example', cookieDomain = '', now } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: new URL(url), options });
    assert.equal(url.origin, origin);
    assert.equal(options.redirect, 'manual');
    if (url.pathname === '/SDFMSV20/') return new Response('<a id="jQCheckLogin" href="/SDFMSV20/login/isValidLogin"></a>', { headers: { 'Set-Cookie': `session=web-session-secret; Path=/SDFMSV20; Secure; HttpOnly${cookieDomain ? `; Domain=${cookieDomain}` : ''}` } });
    assert.equal(options.headers.Cookie, 'session=web-session-secret');
    if (url.pathname.endsWith('/isValidLogin')) return response(login);
    if (url.pathname.endsWith('/MasterList')) return new Response(`<a href="${dataHref}" id="jQGetListData"></a>${headers ? '<a id="jQGetListHeader" href="/SDFMSV20/list/GetListHeader"></a>' : ''}`);
    if (url.pathname.endsWith('/GetListHeader')) return response([{ colid: 'col1', colname: 'Geofence Name' }, { colid: 'col2', colname: 'Shape Type' }, { colid: 'col3', colname: 'Latitude' }, { colid: 'col4', colname: 'Longitude' }, { colid: 'col5', colname: 'Radius' }]);
    if (url.pathname.endsWith('/GetListData')) return response(JSON.stringify([{ vt_recordid: 7, col1: 'Depot', col2: 'Circle', col3: 13, col4: 100, col5: 55, notes: 'web-session-secret web-password' }]));
    assert.fail(`Unexpected endpoint: ${url.pathname}`);
  };
  return { calls, source: createGeofenceSource({ env: { ...apiEnv, ...fmsEnv, SONGDEE_FMS_BASE_URL: `${origin}/SDFMSV20/` }, fetchImpl, ...(now ? { now } : {}) }) };
}

test('configured FMS takes precedence and follows only the verified read sequence with its cookie jar', async () => {
  const { calls, source } = fmsFixture({ login: JSON.stringify([{ loginstatus: '1' }]) });
  const snapshot = await source.getGeofenceSnapshot();
  assert.deepEqual(calls.map(call => call.url.pathname), ['/SDFMSV20/', '/SDFMSV20/login/isValidLogin', '/SDFMSV20/MasterList', '/SDFMSV20/list/GetListHeader', '/SDFMSV20/list/GetListData']);
  assert.equal(calls[1].options.method, 'POST');
  assert.deepEqual([...new URLSearchParams(calls[1].options.body)], [['username', 'web-user'], ['password', 'web-password']]);
  assert.equal(calls[1].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(calls[1].options.headers['X-Requested-With'], 'XMLHttpRequest');
  assert.equal(calls[2].url.search, '?pModuleId=10');
  assert.deepEqual(JSON.parse(calls[3].options.body), { pModuleId: '10' });
  assert.deepEqual(JSON.parse(calls[4].options.body), { itemid: '10' });
  assert.deepEqual(snapshot.coverage, { total: 1, returned: 1, complete: true });
  assert.equal(snapshot.fences[0].id, 'fms:7');
  assert.equal(snapshot.fences[0].name, 'Depot');
  assert.equal(snapshot.fences[0].geometry.radiusMeters, 55);
  assert.equal(snapshot.sources[0].id, 'fms');
  assert.doesNotMatch(JSON.stringify(snapshot), /web-session-secret|web-password/);
});

test('empty and rejected FMS login results never grant access or trigger retry storms', async () => {
  for (const login of [[], '', [{ loginstatus: 0, loginmsg: 'No match for LoginId and/or Password' }], [{ loginstatus: null }]]) {
    const { calls, source } = fmsFixture({ login });
    const snapshot = await source.getGeofenceSnapshot();
    assert.equal(snapshot.configured, true);
    assert.equal(snapshot.sources[0].status, 'error');
    assert.equal(snapshot.sources[0].complete, false);
    assert.equal(snapshot.sources[0].fetchedAt, null);
    assert.deepEqual(snapshot.fences, []);
    assert.deepEqual(snapshot.coverage, { total: null, returned: 0, complete: false });
    assert.equal(calls.length, 2);
    const repeated = await source.getGeofenceSnapshot();
    assert.equal(repeated.sources[0].status, 'error');
    assert.match(repeated.sources[0].error, /temporarily paused/);
    assert.equal(repeated.coverage.complete, false);
    assert.equal(calls.length, 2);
  }
});

test('rejected FMS web login retries only after the three-minute cooldown expires', async () => {
  let time = 1_000_000;
  const { calls, source } = fmsFixture({ login: [{ loginstatus: '0', loginmsg: 'No match for LoginId and/or Password' }], now: () => time });
  const first = await source.getGeofenceSnapshot();
  assert.match(first.sources[0].error, /authentication failed/);
  time += 179_999;
  assert.match((await source.getGeofenceSnapshot()).sources[0].error, /temporarily paused/);
  assert.equal(calls.length, 2);
  time += 2;
  const retried = await source.getGeofenceSnapshot();
  assert.match(retried.sources[0].error, /authentication failed/);
  assert.equal(retried.coverage.complete, false);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => !call.url.pathname.includes('MasterList')));
});

test('FMS accepts a parent-domain session cookie without sending requests outside the configured origin', async () => {
  const { calls, source } = fmsFixture({ origin: 'https://portal.fms.example', cookieDomain: '.fms.example' });
  const snapshot = await source.getGeofenceSnapshot();
  assert.equal(snapshot.sources[0].status, 'ok');
  assert.equal(snapshot.coverage.complete, true);
  assert.ok(calls.every(call => call.url.origin === 'https://portal.fms.example'));
});

test('FMS refuses external, mutating and app-escaping list anchors', async () => {
  for (const dataHref of ['https://evil.example/SDFMSV20/list/GetListData', '/SDFMSV20/list/DeleteListData', '/SDFMSV20/%2e%2e/secret', '/SDFMSV20/list/GetListData?action=delete']) {
    const { calls, source } = fmsFixture({ dataHref });
    const snapshot = await source.getGeofenceSnapshot();
    assert.equal(snapshot.sources[0].status, 'error');
    assert.equal(calls.length, 3);
  }
});

test('redirects, oversized responses, malformed configuration and fetch messages stay safe', async () => {
  const cases = [
    () => new Response('', { status: 302, headers: { Location: 'https://evil.example' } }),
    () => new Response('{}', { headers: { 'Content-Length': String(17 * 1024 * 1024) } }),
    () => { throw new Error('https://data-fm.example?Password=api-password'); },
  ];
  for (const fetchImpl of cases) {
    const snapshot = await apiSource([], { fetchImpl }).getGeofenceSnapshot();
    assert.equal(snapshot.sources[0].status, 'error');
    assert.doesNotMatch(JSON.stringify(snapshot), /api-password|evil.example/);
  }
  const invalid = apiSource([], { env: { ...apiEnv, SONGDEE_DATA_FM_BASE_URL: 'https://user:api-password@data-fm.example' }, fetchImpl: () => assert.fail('Invalid configuration requested') });
  assert.equal((await invalid.getGeofenceSnapshot()).sources[0].status, 'error');
});
