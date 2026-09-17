import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readVssConfiguration, createVssClient, VssClientError,
  normalizeVssDevice, normalizeVssAlarm, redactVssData, parseVssTime,
} from '../web/lib/server/vss-client.mjs';

const env = { HOWEN_VSS_BASE_URL: 'https://vss.example.invalid/', HOWEN_VSS_USERNAME: 'test-user', HOWEN_VSS_PASSWORD: 'test-password' };
const configuration = readVssConfiguration(env);
const response = (body, options) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...options });
const ok = (data) => response({ status: 10000, data });
const alarmWindow = { from: '2026-09-17T06:00:00.000Z', to: '2026-09-17T06:10:00.000Z' };
function mockClient(handler, options = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const call = { path: new URL(url).pathname, body: JSON.parse(init.body), init };
    calls.push(call);
    return handler(call, calls);
  };
  return { client: createVssClient({ configuration, fetchImpl, ...options }), calls };
}

test('configuration distinguishes absent from partial and never embeds values in errors', () => {
  assert.deepEqual(readVssConfiguration({}), { configured: false });
  assert.equal(configuration.baseUrl, 'https://vss.example.invalid');
  assert.equal(configuration.utcOffsetMinutes, 420);
  assert.throws(() => readVssConfiguration({ HOWEN_VSS_PASSWORD: 'do-not-display-me' }), (error) => error.code === 'configuration_invalid' && !error.message.includes('do-not-display-me'));
  for (const base of ['ftp://vss.example.invalid', 'https://user:private@vss.example.invalid', 'https://vss.example.invalid/?token=private']) {
    assert.throws(() => readVssConfiguration({ ...env, HOWEN_VSS_BASE_URL: base }), { code: 'configuration_invalid' });
  }
  assert.throws(() => readVssConfiguration({ ...env, HOWEN_VSS_UTC_OFFSET_MIN: 'Infinity' }), { code: 'configuration_invalid' });
  assert.equal(readVssConfiguration({ ...env, HOWEN_VSS_UTC_OFFSET_MIN: '0' }).utcOffsetMinutes, 0);
});

test('concurrent catalog and alarm reads share login, inject token in body, and disable redirects', async () => {
  const { client, calls } = mockClient(async (call) => {
    if (call.path.endsWith('login.action')) { await new Promise((resolve) => setTimeout(resolve, 5)); return ok({ token: 'private-token' }); }
    assert.equal(call.body.token, 'private-token');
    assert.equal(call.init.redirect, 'manual');
    assert.equal(call.init.cache, 'no-store');
    assert.equal(call.init.headers.Authorization, undefined);
    return ok({ dataList: [], totalCount: 0, pageNum: 1, pageCount: 500, fromCount: 0 });
  });
  await Promise.all([client.fetchCatalog(), client.fetchAlarmPage(alarmWindow)]);
  assert.equal(calls.filter((call) => call.path.endsWith('login.action')).length, 1);
  assert.deepEqual(calls[0].body, { username: 'test-user', password: 'test-password' });
});

test('expired sessions refresh once across concurrent calls and enforce session TTL', async () => {
  let clock = 0;
  let logins = 0;
  const { client } = mockClient(async (call) => {
    if (call.path.endsWith('login.action')) return ok({ token: `session-${++logins}` });
    if (call.body.token === 'session-1') return response({ status: 10023, msg: 'expired' });
    return ok({ dataList: [] });
  }, { now: () => clock });
  await Promise.all([client.fetchCatalog(), client.fetchAlarmPage(alarmWindow)]);
  assert.equal(logins, 2);
  clock = 480001;
  await client.fetchCatalog();
  assert.equal(logins, 3);
});

test('failed login enters cooldown and suppresses upstream credential-bearing messages', async () => {
  let clock = 0;
  const { client, calls } = mockClient(() => response({ status: 10001, msg: 'password=test-password token=private-token' }), { now: () => clock });
  await assert.rejects(client.fetchCatalog(), (error) => error instanceof VssClientError && error.code === 'login_failed' && !/test-password|private-token/.test(error.message));
  await assert.rejects(client.fetchCatalog(), { code: 'login_cooldown' });
  assert.equal(calls.length, 1);
  clock = 180001;
  await assert.rejects(client.fetchCatalog(), { code: 'login_failed' });
  assert.equal(calls.length, 2);
});

test('a repeatedly expired session stops after one relogin and then cools down', async () => {
  let logins = 0;
  const { client, calls } = mockClient((call) => call.path.endsWith('login.action') ? ok({ token: `s-${++logins}` }) : response({ status: 10023 }));
  await assert.rejects(client.fetchCatalog(), { code: 'api_rejected' });
  assert.equal(logins, 2);
  assert.equal(calls.length, 4);
  await assert.rejects(client.fetchCatalog(), { code: 'login_cooldown' });
});

test('catalog exhausts pages using observed totalCount without confusing totalNum page count', async () => {
  const { client, calls } = mockClient((call) => {
    if (call.path.endsWith('login.action')) return ok({ token: 't' });
    const n = call.body.pageNum;
    return ok({ dataList: n === 1 ? [{ deviceno: 'a' }, { deviceno: 'b' }] : [{ deviceno: 'c' }], totalCount: 3, totalNum: 2, pageNum: n, pageCount: 2, fromCount: (n - 1) * 2 });
  });
  assert.deepEqual((await client.fetchCatalog({ pageSize: 2 })).map((row) => row.deviceno), ['a', 'b', 'c']);
  assert.equal(calls.length, 3);
});

test('catalog supports a server-enforced smaller page size without skipping records', async () => {
  const { client } = mockClient((call) => {
    if (call.path.endsWith('login.action')) return ok({ token: 't' });
    const n = call.body.pageNum;
    return ok({ dataList: [{ deviceno: String(n) }], totalCount: 3, pageNum: n, pageCount: 1, fromCount: n - 1 });
  });
  assert.equal((await client.fetchCatalog({ pageSize: 500 })).length, 3);
});

test('catalog fails explicitly on capped, repeated, changing or incomplete pagination', async (t) => {
  await t.test('cap', async () => {
    const { client } = mockClient((call) => call.path.endsWith('login.action') ? ok({ token: 't' }) : ok({ dataList: [{ deviceno: String(call.body.pageNum) }], totalCount: 3 }));
    await assert.rejects(client.fetchCatalog({ pageSize: 1, maxPages: 2 }), { code: 'pagination_limit' });
  });
  await t.test('repeated', async () => {
    const { client } = mockClient((call) => call.path.endsWith('login.action') ? ok({ token: 't' }) : ok({ dataList: [{ deviceno: 'same' }] }));
    await assert.rejects(client.fetchCatalog({ pageSize: 1 }), { code: 'pagination_repeated' });
  });
  await t.test('changing total', async () => {
    const { client } = mockClient((call) => call.path.endsWith('login.action') ? ok({ token: 't' }) : ok({ dataList: [{ deviceno: String(call.body.pageNum) }], totalCount: call.body.pageNum + 1 }));
    await assert.rejects(client.fetchCatalog({ pageSize: 1 }), { code: 'pagination_changed' });
  });
  await t.test('empty before end', async () => {
    const { client } = mockClient((call) => call.path.endsWith('login.action') ? ok({ token: 't' }) : ok({ dataList: [], totalCount: 100 }));
    await assert.rejects(client.fetchCatalog(), { code: 'pagination_invalid' });
  });
  await t.test('missing list', async () => {
    const { client } = mockClient((call) => call.path.endsWith('login.action') ? ok({ token: 't' }) : ok({ totalCount: 100 }));
    await assert.rejects(client.fetchCatalog(), { code: 'response_invalid' });
  });
});

test('alarm pages retain descending source order, total and Bangkok query boundaries', async () => {
  const { client, calls } = mockClient((call) => call.path.endsWith('login.action') ? ok({ token: 't' }) : ok({ dataList: [{ guid: 'new' }, { guid: 'old' }], totalCount: 13151, pageCount: 2, pageNum: 2, fromCount: 2 }));
  const page = await client.fetchAlarmPage({ ...alarmWindow, page: 2, pageSize: 2 });
  assert.deepEqual(page, { records: [{ guid: 'new' }, { guid: 'old' }], total: 13151, hasMore: true });
  assert.deepEqual(calls[1].body, { beginTime: '2026-09-17 13:00:00', endTime: '2026-09-17 13:10:00', pageNum: 2, pageSize: 2, token: 't' });
  await assert.rejects(client.fetchAlarmPage({ from: '2026-09-17 13:00:00', to: alarmWindow.to }), { code: 'request_invalid' });
  await assert.rejects(client.fetchAlarmPage({ from: alarmWindow.to, to: alarmWindow.from }), { code: 'request_invalid' });
  assert.equal(calls.length, 2);
});

test('request failures reject redirects, oversized streaming bodies, invalid JSON and timeouts safely', async (t) => {
  await t.test('redirect', async () => {
    const { client } = mockClient(() => new Response('', { status: 302, headers: { location: 'https://attacker.invalid' } }));
    await assert.rejects(client.fetchCatalog(), { code: 'redirect_rejected' });
  });
  await t.test('stream size limit', async () => {
    const { client } = mockClient(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(200))); controller.close(); } })), { configuration: { ...configuration, maxResponseBytes: 100 } });
    await assert.rejects(client.fetchCatalog(), { code: 'response_too_large' });
  });
  await t.test('invalid JSON', async () => {
    const { client } = mockClient(() => new Response('password=never-log-this'));
    await assert.rejects(client.fetchCatalog(), (error) => error.code === 'response_invalid' && !error.message.includes('never-log-this'));
  });
  await t.test('timeout', async () => {
    const { client } = mockClient(() => new Promise(() => {}), { configuration: { ...configuration, timeoutMs: 10 } });
    await assert.rejects(client.fetchCatalog(), { code: 'timeout' });
  });
  await t.test('network message', async () => {
    const { client } = mockClient(() => { throw new Error('https://username:password@vss.invalid?token=private'); });
    await assert.rejects(client.fetchCatalog(), (error) => error.code === 'network_error' && !/username|password|private/.test(error.message));
  });
});

test('VSS timestamps use explicit offset, preserve UTC and reject missing or impossible dates', () => {
  assert.equal(parseVssTime('2026-09-17 13:21:26'), '2026-09-17T06:21:26.000Z');
  assert.equal(parseVssTime('2026-09-17 13:21:26', 0), '2026-09-17T13:21:26.000Z');
  assert.equal(parseVssTime('2026-09-17T13:21:26+07:00'), '2026-09-17T06:21:26.000Z');
  assert.equal(parseVssTime('2026-09-17T06:21:26.120Z'), '2026-09-17T06:21:26.120Z');
  assert.equal(parseVssTime(Date.parse('2026-09-17T06:21:26.120Z')), '2026-09-17T06:21:26.120Z');
  for (const source of [null, undefined, '', 0, 'NA', '2026-02-30 10:00:00', '2026-02-30T10:00:00Z', '2026-09-17', '9/17/2026 13:21']) assert.equal(parseVssTime(source), null);
});

test('device normalization uses observation times and maps configured alarm bits without assuming PTO', () => {
  const row = { deviceno: 'mdvr-1', inputnumber: 4, plateno: 'truck-1', deviceModel: 'Hero-ME41-04', appVersion: 'v1', latitude: 13, longitude: 100, speed: 0, satellites: 21, dtu: '2026-09-17 13:21:26', lastStatusJson: JSON.stringify({ basic: { key: '0' }, alarm: { input: '0xA' }, ext: { reportTime: Date.parse('2026-09-17T06:21:31.103Z') }, voltage: { vcc: '25.30' }, unknownSensor: { status: 17 } }) };
  const result = normalizeVssDevice(row, { receivedAt: '2026-09-17T06:22:00Z', inputMappings: [{ channel: 2, label: 'Door', purpose: 'door', verified: true }] });
  assert.equal(result.telemetryReceivedAt, '2026-09-17T06:21:31.103Z');
  assert.equal(result.gpsReceivedAt, '2026-09-17T06:21:26.000Z');
  assert.equal(result.fetchedAt, '2026-09-17T06:22:00.000Z');
  assert.equal(result.connected, null);
  assert.equal(result.telemetry.ignition, false);
  assert.equal(result.telemetry.gps.speedKph, 0);
  assert.deepEqual(result.telemetry.inputs.map(({ channel, active }) => ({ channel, active })), [{ channel: 1, active: false }, { channel: 2, active: true }, { channel: 3, active: false }, { channel: 4, active: true }]);
  assert.equal(result.telemetry.inputs[1].label, 'Door');
  assert.equal(result.telemetry.inputs[1].signalKind, 'configured_alarm');
  assert.deepEqual(result.telemetry.diagnostics.unknownSensor, { status: 17 });
  assert.equal(result.raw.lastStatusJson, row.lastStatusJson);
});

test('missing and invalid device values stay unknown, including ACC and malformed input masks', () => {
  for (const key of [undefined, null, '', 'false', '2', true, false]) {
    const device = normalizeVssDevice({ deviceno: 'mdvr', inputnumber: 2, lastStatusJson: { basic: { key }, alarm: { input: 'bad-value' } } }, { receivedAt: '2026-09-17T06:22:00Z' });
    assert.equal(device.telemetry.ignition, null);
    assert.equal(device.lastSeenAt, null);
    assert.equal(device.telemetry.gps.speedKph, null);
    assert.equal(device.telemetry.gps.valid, false);
    assert.equal(device.telemetry.inputs[0].active, null);
    assert.equal(device.telemetry.inputs[1].active, null);
  }
  assert.equal(normalizeVssDevice({}), null);
  const invalidGps = normalizeVssDevice({ deviceno: 'mdvr', latitude: 91, longitude: 100, status: 1, lastonlinetime: '2026-09-17 13:00:00' });
  assert.equal(invalidGps.telemetry.gps.valid, false);
  assert.equal(invalidGps.connected, null);
});

test('input masks preserve higher channels and do not invent an inactive channel roster', () => {
  const device = normalizeVssDevice({ deviceno: 'mdvr', lastStatusJson: { alarm: { input: '0x8000000000000001' } } });
  assert.deepEqual(device.telemetry.inputs.map(({ channel, active }) => ({ channel, active })), [{ channel: 1, active: true }, { channel: 64, active: true }]);
  const zero = normalizeVssDevice({ deviceno: 'mdvr', lastStatusJson: { alarm: { input: '0x0' } } });
  assert.deepEqual(zero.telemetry.inputs, []);
});

test('redaction handles nested embedded JSON, mixed-case credentials, URL auth and query tokens without mutating source', () => {
  const source = {
    custom: { refreshTOKEN: 'refresh-secret', unchanged: 3 },
    lastStatusJson: JSON.stringify({ nested: { password: 'embedded-pass', apiKey: 'key-secret' }, voltage: { vcc: '25.3' } }),
    paraJson: JSON.stringify({ nestedJson: JSON.stringify({ sessionId: 'session-secret' }) }),
    stream: 'https://url-user:url-pass@example.invalid/live?channel=1&AccessToken=url-secret&signature=signature-secret',
    config: [{ secret: 'secret-value', sensor: 'fuel' }],
  };
  const result = redactVssData(source);
  const serialized = JSON.stringify(result);
  for (const secret of ['refresh-secret', 'embedded-pass', 'key-secret', 'session-secret', 'url-user', 'url-pass', 'url-secret', 'signature-secret', 'secret-value']) assert.ok(!serialized.includes(secret), secret);
  assert.equal(result.custom.unchanged, 3);
  assert.equal(JSON.parse(result.lastStatusJson).voltage.vcc, '25.3');
  assert.equal(new URL(result.stream).searchParams.get('channel'), '1');
  assert.equal(source.custom.refreshTOKEN, 'refresh-secret');
});

test('alarm identity deduplicates replay but preserves lifecycle transitions and unknown fields', () => {
  const row = { guid: 'alarm-1', deviceno: 'mdvr', alarmtype: 999, alarmState: 0, reportTime: '2026-09-17 13:00:00', fenceId: 'f-1', fenceName: 'Loading', paraJson: '{"channel":2,"password":"private"}', newVendorField: 99 };
  const start = normalizeVssAlarm(row, { receivedAt: '2026-09-17T06:00:01Z' });
  const replay = normalizeVssAlarm({ ...row }, { receivedAt: '2026-09-17T06:05:00Z' });
  assert.equal(start.id, replay.id);
  assert.equal(start.occurredAt, '2026-09-17T06:00:00.000Z');
  assert.equal(start.alarmType, 999);
  assert.equal(start.fenceId, 'f-1');
  assert.equal(start.decoded.newVendorField, 99);
  assert.equal(start.decoded.paraJson.channel, 2);
  assert.ok(!JSON.stringify(start).includes('private'));
  assert.notEqual(start.id, normalizeVssAlarm({ ...row, alarmState: 1, endTime: '2026-09-17 13:02:00' }).id);
  assert.notEqual(normalizeVssAlarm({ ...row, alarmState: 'new-unknown-state' }).id, normalizeVssAlarm({ ...row, alarmState: 'other-unknown-state' }).id);
  const missingTime = normalizeVssAlarm({ guid: 'g', deviceno: 'mdvr', alarmtype: 5 });
  assert.equal(missingTime.occurredAt, null);
  assert.ok(missingTime.warnings.length);
});
