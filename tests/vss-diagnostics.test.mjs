import assert from 'node:assert/strict';
import test from 'node:test';
import { createVssDiagnostics } from '../web/lib/server/vss-diagnostics.mjs';
import { VssClientError } from '../web/lib/server/vss-client.mjs';

const initialTime = Date.parse('2026-09-17T06:30:00Z');
const configuration = {
  HOWEN_VSS_BASE_URL: 'https://diagnostics.example.invalid',
  HOWEN_VSS_USERNAME: 'fixture-account',
  HOWEN_VSS_PASSWORD: 'fixture-password',
};
const query = (fields = {}) => new URLSearchParams(fields);
const device = (id = 'A', time = '2026-09-17 13:29:00', extras = {}) => ({
  deviceno: id, devicename: `Truck ${id}`, deviceModel: 'Hero fixture', inputnumber: 2,
  dtu: time, latitude: 13.7, longitude: 100.5, speed: 0,
  lastStatusJson: JSON.stringify({ basic: { key: '0' }, alarm: { input: '0x2' }, voltage: { vcc: '25.3' } }),
  ...extras,
});
const alarm = (id = 'alarm-A', deviceId = 'A', extras = {}) => ({
  guid: id, deviceno: deviceId, alarmtype: 5, alarmState: 0,
  reportTime: '2026-09-17 13:29:30', alarmTypeValue: 'Emergency Alarm', ...extras,
});
const page = (records = [], overrides = {}) => ({ records, total: records.length, hasMore: false, ...overrides });

function harness({ catalog = () => [device()], alarms = () => page([alarm()]), env = { ...configuration } } = {}) {
  let time = initialTime;
  const calls = { catalog: 0, alarms: [], configurations: [] };
  const snapshot = createVssDiagnostics({
    env, now: () => time,
    clientFactory: ({ configuration: source }) => {
      calls.configurations.push({ ...source });
      return {
        fetchCatalog: async () => { calls.catalog++; return catalog(calls.catalog); },
        fetchAlarmPage: async (options) => { calls.alarms.push(options); return alarms(options, calls.alarms.length); },
      };
    },
  });
  return { snapshot, calls, env, advance(ms) { time += ms; }, setTime(value) { time = value; } };
}

test('unconfigured snapshots perform no network/client work and disclose read-only scope', async () => {
  const fixture = harness({ env: {} });
  const result = await fixture.snapshot();
  assert.equal(result.configured, false);
  assert.deepEqual(result.devices, []);
  assert.deepEqual(result.events, []);
  assert.equal(result.parameters.readOnly, true);
  assert.equal(result.parameters.deviceSettingsReadback, false);
  assert.match(result.parameters.rawPayloadScope, /original MDVR wire packets are not provided/);
  assert.equal(fixture.calls.configurations.length, 0);
  assert.equal(fixture.calls.catalog, 0);
});

test('malformed or partial configuration fails safely before client construction', async () => {
  const fixture = harness({ env: { HOWEN_VSS_PASSWORD: 'must-not-appear' } });
  await assert.rejects(fixture.snapshot(), (error) => error.status === 503 && !error.message.includes('must-not-appear'));
  assert.equal(fixture.calls.configurations.length, 0);
});

test('one in-flight fetch serves different operators/devices and cached reads share the session', async () => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const fixture = harness({ catalog: async () => { await wait; return [device('A'), device('B')]; }, alarms: () => page([alarm('a', 'A'), alarm('b', 'B')]) });
  const left = fixture.snapshot(query({ deviceId: 'A' }));
  const right = fixture.snapshot(query({ deviceId: 'B' }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.calls.catalog, 1);
  assert.equal(fixture.calls.alarms.length, 1);
  release();
  const [a, b] = await Promise.all([left, right]);
  assert.equal(a.selectedDeviceId, 'A');
  assert.equal(b.selectedDeviceId, 'B');
  assert.ok(a.events.every((event) => event.deviceId === 'A'));
  assert.ok(b.events.every((event) => event.deviceId === 'B'));
  assert.equal(a.devices.find((row) => row.deviceId === 'B').raw, undefined);
  assert.equal(b.devices.find((row) => row.deviceId === 'A').raw, undefined);
  fixture.advance(14_999);
  await fixture.snapshot(query({ deviceId: 'A', kind: 'alarm', limit: '1' }));
  assert.equal(fixture.calls.catalog, 1);
  assert.equal(fixture.calls.configurations.length, 1);
  fixture.advance(2);
  await fixture.snapshot();
  assert.equal(fixture.calls.catalog, 2);
  assert.equal(fixture.calls.configurations.length, 1);
});

test('snapshots expose real normalizer fields, UTC occurrence times, raw JSON and display coverage', async () => {
  const fixture = harness({ catalog: () => [device('A'), device('B', '2026-09-17 13:28:00')], alarms: () => page([alarm()]) });
  const result = await fixture.snapshot(query({ limit: '1' }));
  assert.equal(result.source, 'vss');
  assert.equal(result.selectedDeviceId, 'A');
  assert.equal(result.devices[0].telemetry.ignition, false);
  assert.equal(result.devices[0].telemetry.inputs[1].active, true);
  assert.equal(result.devices[0].telemetry.inputs[1].signalKind, 'configured_alarm');
  assert.equal(result.devices[0].telemetryReceivedAt, '2026-09-17T06:29:00.000Z');
  assert.equal(result.events[0].kind, 'alarm');
  assert.equal(result.events[0].occurredAt, '2026-09-17T06:29:30.000Z');
  assert.equal(result.events[0].raw.guid, 'alarm-A');
  assert.equal(result.events[0].sourceRequest.body.token, '[redacted]');
  assert.equal(result.coverage.matchingEvents, 2);
  assert.equal(result.coverage.returnedEvents, 1);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.from, '2026-09-17T06:15:00.000Z');
  assert.equal(result.coverage.to, '2026-09-17T06:30:00.000Z');
  assert.equal(result.service.readOnly, true);
  assert.equal(result.service.deviceCount, 2);
  assert.equal(result.service.lastError, null);
  assert.deepEqual(fixture.calls.alarms[0], { from: '2026-09-17T06:15:00.000Z', to: '2026-09-17T06:30:00.000Z', page: 1, pageSize: 500 });
});

test('first partial success remains usable and unavailable source errors are sanitized', async () => {
  const fixture = harness({ alarms: () => { throw new Error('password=do-not-leak'); } });
  const result = await fixture.snapshot();
  assert.equal(result.devices.length, 1);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, 'telemetry');
  assert.equal(result.service.alarmsStale, true);
  assert.equal(result.service.catalogStale, false);
  assert.equal(result.service.alarmsFetchedAt, null);
  assert.equal(result.service.lastSuccessAt, null);
  assert.match(result.service.lastError, /Alarms: VSS could not be reached/);
  assert.ok(!JSON.stringify(result).includes('do-not-leak'));
});

test('when vehicle status is unavailable, explicit device filters still restrict returned alarms', async () => {
  const fixture = harness({ catalog: () => { throw new Error('offline'); }, alarms: () => page([alarm('a', 'A'), alarm('b', 'B')]) });
  const result = await fixture.snapshot(query({ deviceId: 'A', kind: 'alarm' }));
  assert.equal(result.events.length, 1);
  assert.ok(result.events.every((event) => event.deviceId === 'A'));
  assert.equal(result.coverage.matchingDeviceAlarms, 1);
  assert.equal(result.service.catalogStale, true);
});

test('refresh failures retain previous successful data and retry on a bounded schedule', async () => {
  let failCatalog = false;
  let failAlarms = false;
  const fixture = harness({
    catalog: () => { if (failCatalog) throw new VssClientError('network_error', 'Unable to reach the configured VSS server.'); return [device()]; },
    alarms: () => { if (failAlarms) throw new Error('offline'); return page([alarm()]); },
  });
  const first = await fixture.snapshot();
  failCatalog = true;
  fixture.advance(31_000);
  const partial = await fixture.snapshot();
  assert.equal(partial.devices[0].raw.deviceno, 'A');
  assert.equal(partial.service.catalogFetchedAt, first.service.catalogFetchedAt);
  assert.notEqual(partial.service.alarmsFetchedAt, first.service.alarmsFetchedAt);
  assert.equal(partial.service.catalogStale, true);
  assert.equal(partial.service.alarmsStale, false);
  assert.equal(partial.service.lastSuccessAt, first.service.lastSuccessAt);
  failAlarms = true;
  fixture.advance(29_999);
  await fixture.snapshot();
  assert.equal(fixture.calls.catalog, 2);
  fixture.advance(2);
  const failed = await fixture.snapshot();
  assert.equal(fixture.calls.catalog, 3);
  assert.equal(failed.devices.length, 1);
  assert.equal(failed.service.catalogFetchedAt, first.service.catalogFetchedAt);
  assert.equal(failed.service.alarmsFetchedAt, partial.service.alarmsFetchedAt);
  assert.equal(failed.service.catalogStale, true);
  assert.equal(failed.service.alarmsStale, true);
});

test('total initial failure returns a safe error and cooldown avoids an immediate retry burst', async () => {
  const fixture = harness({ catalog: () => { throw new Error('secret-password'); }, alarms: () => { throw new Error('secret-token'); } });
  await assert.rejects(fixture.snapshot(), (error) => error.status === 502 && !/secret-password|secret-token/.test(error.message));
  await assert.rejects(fixture.snapshot(), { status: 502 });
  assert.equal(fixture.calls.catalog, 1);
  assert.equal(fixture.calls.alarms.length, 1);
});

test('bounded alarm paging reports incomplete coverage and preserves one fixed window', async () => {
  const fixture = harness({ alarms: ({ page: number }) => page([alarm(`page-${number}`)], { total: 15_000, hasMore: true }) });
  const result = await fixture.snapshot(query({ kind: 'alarm', limit: '500' }));
  assert.equal(fixture.calls.alarms.length, 10);
  assert.deepEqual(fixture.calls.alarms.map(({ page }) => page), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(new Set(fixture.calls.alarms.map(({ from, to }) => `${from}:${to}`)).size, 1);
  assert.equal(result.coverage.total, 15000);
  assert.equal(result.coverage.loaded, 10);
  assert.equal(result.coverage.rowsRead, 10);
  assert.equal(result.coverage.uniqueEvents, 10);
  assert.equal(result.coverage.duplicateRows, 0);
  assert.equal(result.coverage.skippedRows, 0);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.truncated, true);
  assert.equal(result.coverage.pages, 10);
});

test('changing alarm totals never claim complete coverage and lifecycle changes survive deduplication', async () => {
  const fixture = harness({ alarms: ({ page: number }) => number === 1
    ? page([alarm('same')], { total: 2, hasMore: true })
    : page([alarm('same'), alarm('same', 'A', { alarmState: 1, endTime: '2026-09-17 13:29:50' })], { total: 3, hasMore: false }) });
  const result = await fixture.snapshot(query({ kind: 'alarm' }));
  assert.equal(result.events.length, 2);
  assert.equal(result.coverage.loaded, 2);
  assert.equal(result.coverage.rowsRead, 3);
  assert.equal(result.coverage.uniqueEvents, 2);
  assert.equal(result.coverage.duplicateRows, 1);
  assert.equal(result.coverage.skippedRows, 0);
  assert.equal(result.coverage.changedDuringRead, true);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.truncated, false);
  assert.equal(new Set(result.events.map((event) => event.id)).size, 2);
});

test('alarm coverage separates source rows from unique events, duplicates and skipped identities', async () => {
  const fixture = harness({ alarms: ({ page: number }) => number === 1
    ? page([alarm('same'), alarm('same'), alarm('missing-device', '')], { total: 6, hasMore: true })
    : page([alarm('same'), alarm('other', 'B'), alarm('missing-time', 'A', { reportTime: 'unknown' })], { total: 6, hasMore: false }) });
  const result = await fixture.snapshot(query({ deviceId: 'A', kind: 'alarm', limit: '1' }));
  assert.equal(result.coverage.total, 6);
  assert.equal(result.coverage.rowsRead, 6);
  assert.equal(result.coverage.uniqueEvents, 3);
  assert.equal(result.coverage.loaded, result.coverage.uniqueEvents);
  assert.equal(result.coverage.duplicateRows, 2);
  assert.equal(result.coverage.skippedRows, 1);
  assert.equal(result.coverage.rowsRead, result.coverage.uniqueEvents + result.coverage.duplicateRows + result.coverage.skippedRows);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.matchingDeviceAlarms, 2);
  assert.equal(result.coverage.matchingEvents, 2);
  assert.equal(result.coverage.returnedEvents, 1);
  assert.equal(result.events.length, 1);
});

test('alarm coverage preserves unknown totals and zero counts for an empty source window', async () => {
  for (const records of [[], [alarm()]]) {
    const fixture = harness({ alarms: () => page(records, { total: null }) });
    const result = await fixture.snapshot(query({ kind: 'alarm' }));
    assert.equal(result.coverage.total, null);
    assert.equal(result.coverage.rowsRead, records.length);
    assert.equal(result.coverage.uniqueEvents, records.length);
    assert.equal(result.coverage.loaded, records.length);
    assert.equal(result.coverage.duplicateRows, 0);
    assert.equal(result.coverage.skippedRows, 0);
    assert.equal(result.coverage.complete, true);
  }
});

test('repeated alarm pages reject the new sample and retain a previous usable sample', async () => {
  let repeat = false;
  const fixture = harness({ alarms: () => repeat ? page([alarm('repeated')], { total: 50, hasMore: true }) : page([alarm('initial')]) });
  const first = await fixture.snapshot(query({ kind: 'alarm' }));
  repeat = true;
  fixture.advance(16_000);
  const next = await fixture.snapshot(query({ kind: 'alarm' }));
  assert.equal(next.events.length, 1);
  assert.equal(next.events[0].id, first.events[0].id);
  assert.equal(next.service.alarmsFetchedAt, first.service.alarmsFetchedAt);
  assert.match(next.service.lastError, /repeated an alarm page/);
  assert.equal(fixture.calls.alarms.length, 3);
});

test('filter validation rejects malformed/repeated/unknown arguments without source reads', async () => {
  const fixture = harness();
  for (const params of [
    new URLSearchParams('deviceId=A&deviceId=B'), new URLSearchParams('password=private'),
    query({ kind: 'automation' }), query({ limit: '501' }), query({ limit: '0' }), query({ limit: '1.5' }),
    query({ deviceId: '\u0000A' }), query({ deviceId: 'A'.repeat(181) }),
  ]) await assert.rejects(fixture.snapshot(params), { status: 400 });
  assert.equal(fixture.calls.configurations.length, 0);
  await assert.rejects(fixture.snapshot(query({ deviceId: 'missing' })), { status: 404 });
  assert.equal(fixture.calls.catalog, 1);
  const alarms = await fixture.snapshot(query({ deviceId: 'A', kind: 'alarm' }));
  assert.ok(alarms.events.every((event) => event.kind === 'alarm'));
});

test('status history deduplicates unchanged source observations and keeps genuine later samples', async () => {
  let row = device();
  const fixture = harness({ catalog: () => [row] });
  const first = await fixture.snapshot(query({ kind: 'telemetry' }));
  fixture.advance(16_000);
  const unchanged = await fixture.snapshot(query({ kind: 'telemetry' }));
  assert.equal(unchanged.events.length, 1);
  assert.equal(unchanged.events[0].id, first.events[0].id);
  assert.equal(unchanged.events[0].receivedAt, first.events[0].receivedAt);
  row = device('A', '2026-09-17 13:30:10');
  fixture.advance(16_000);
  const changed = await fixture.snapshot(query({ kind: 'telemetry' }));
  assert.equal(changed.events.length, 2);
  assert.equal(changed.events[0].occurredAt, '2026-09-17T06:30:10.000Z');
});

test('credential change creates a new client/cache without leaking the previous account payload', async () => {
  let rows = [device('old-account')];
  const fixture = harness({ catalog: () => rows, alarms: () => page([]) });
  await fixture.snapshot();
  fixture.env.HOWEN_VSS_PASSWORD = 'new-password';
  rows = [device('new-account')];
  const next = await fixture.snapshot();
  assert.equal(fixture.calls.configurations.length, 2);
  assert.equal(next.devices.length, 1);
  assert.equal(next.devices[0].deviceId, 'new-account');
  assert.ok(!JSON.stringify(next).includes('old-account'));
});

test('response redaction covers credentials embedded in VSS status, alarm parameters and URLs', async () => {
  const fixture = harness({
    catalog: () => [device('A', '2026-09-17 13:29:00', {
      username: 'catalog-account-secret',
      configJson: JSON.stringify({ password: 'config-password-secret', service: 'https://url-user-secret:url-password-secret@example.invalid/video?token=url-token-secret&channel=1' }),
      lastStatusJson: JSON.stringify({ basic: { key: '1' }, newSensor: { temperature: 24, accessToken: 'status-token-secret' } }),
    })],
    alarms: () => page([alarm('secure-alarm', 'A', { paraJson: JSON.stringify({ apiKey: 'alarm-key-secret', measurement: 10 }), extra: { refreshToken: 'refresh-token-secret' } })]),
  });
  const result = await fixture.snapshot();
  const serialized = JSON.stringify(result);
  for (const secret of [configuration.HOWEN_VSS_USERNAME, configuration.HOWEN_VSS_PASSWORD, 'catalog-account-secret', 'config-password-secret', 'url-user-secret', 'url-password-secret', 'url-token-secret', 'status-token-secret', 'alarm-key-secret', 'refresh-token-secret']) assert.ok(!serialized.includes(secret), secret);
  assert.equal(result.devices[0].telemetry.diagnostics.newSensor.temperature, 24);
  assert.equal(result.events.find((event) => event.kind === 'alarm').decoded.paraJson.measurement, 10);
  assert.ok(serialized.includes('[redacted]'));
});
