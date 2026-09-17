import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHowenGateway } from '../gateway/server.mjs';
import { createSimulationLab } from '../gateway/simulation-lab.mjs';
import { SIMULATION_FIXTURES, deriveGeofenceEvidence, evaluateSimulationScenario } from '../gateway/simulation-scenarios.mjs';
import { encodeSimulatedStatus, encodeSimulatedAlarm } from '../gateway/simulator.mjs';
import { decodePacket, encodeFrame } from '../gateway/protocol.mjs';

async function until(predicate, message, timeout = 12000) {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > timeout) throw new Error(`Timed out: ${message}`); await new Promise((resolve) => setTimeout(resolve, 10)); }
}
async function setup(t, options = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'howen-lab-test-'));
  const gateway = createHowenGateway({ env: {}, apiKey: 'simulation-test-private-key-24-chars', dataDir, tcpPort: 0, httpPort: 0, simulatedDevices: ['SIM-HOWEN-001'] });
  const addresses = await gateway.start();
  const lab = createSimulationLab({ port: addresses.tcp.port, readSnapshot: () => gateway.snapshot(), stepDelayMs: 0, ...options });
  t.after(async () => { await lab.close(); await gateway.stop(); await rm(dataDir, { recursive: true, force: true }); });
  return { gateway, lab };
}
const ended = (lab) => ['completed', 'failed', 'stopped'].includes(lab.snapshot().status);
const failedCheck = (evaluation, id) => assert.equal(evaluation.checks.find((check) => check.id === id)?.passed, false, `Expected ${id} to fail`);
let serial = 0;
function observation({ seconds = 0, zone = 'loading-zone', alarm = false, ...options } = {}) {
  const location = SIMULATION_FIXTURES.geofences.find((item) => item.id === zone) ?? { lat: 13.7, lng: 100.4 };
  const time = new Date(Date.parse('2026-09-17T10:00:00Z') + seconds * 1000);
  const values = { lat: location.lat, lng: location.lng, time, speedKph: 0, acc: true, inputBits: 0, ...options };
  const type = alarm ? 0x1051 : 0x1041;
  const decoded = decodePacket(encodeFrame(type, alarm ? encodeSimulatedAlarm(values) : encodeSimulatedStatus(values)));
  return { packetId: `decoded-test-${++serial}`, messageType: decoded.messageType, decoded: decoded.decoded, receivedAt: time.toISOString() };
}

test('all eleven driver-confirmation scenarios pass only after decoded real TCP evidence', async (t) => {
  const { gateway, lab } = await setup(t);
  const accepted = lab.start({ scenarioId: 'all', confirmationMode: 'driver' });
  assert.equal(accepted.status, 'running');
  assert.throws(() => lab.start({ scenarioId: 'sos' }), (error) => error.status === 409);
  await until(() => ended(lab), 'all scenarios');
  const state = lab.snapshot();
  assert.equal(state.status, 'completed', JSON.stringify(state.results.filter((result) => result.status !== 'passed')));
  assert.deepEqual(state.summary, { total: 11, passed: 11, failed: 0, pending: 0 });
  assert.equal(state.stepIndex, state.stepCount);
  assert.ok(state.events.length <= 256);
  const packets = gateway.snapshot().packets;
  for (const result of state.results) {
    assert.ok(result.checks.length > 0);
    assert.ok(result.checks.every((check) => check.passed));
    for (const check of result.checks.filter((item) => item.packetId)) assert.ok(packets.some((packet) => packet.id === check.packetId), `Missing gateway packet ${check.packetId}`);
  }
  for (const source of ['howen-tcp', 'simulation-geofence', 'simulation-app', 'simulation-media', 'simulation-rule']) assert.ok(state.events.some((event) => event.source === source));
  assert.ok(state.fixtures.geofences.every((fence) => fence.source === 'synthetic'));
  assert.ok(state.fixtures.inputMapping.every((mapping) => mapping.confirmed === false));
  assert.deepEqual(state.scenarios.filter((scenario) => scenario.kind === 'event').map((scenario) => scenario.productionMode), [null, null]);
  const previousRun = state.runId;
  const previousTime = Date.parse(state.virtualTime);
  lab.start({ scenarioId: 'loading', confirmationMode: 'input' });
  await until(() => ended(lab), 'subsequent input-mode run');
  const restarted = lab.snapshot();
  assert.equal(restarted.status, 'completed', restarted.error);
  assert.equal(restarted.summary.total, 1);
  assert.notEqual(restarted.runId, previousRun);
  assert.ok(Date.parse(restarted.virtualTime) > previousTime);
  assert.ok(!gateway.snapshot().packets.filter((packet) => packet.receivedAt >= restarted.startedAt).some((packet) => packet.warnings.some((warning) => warning.startsWith('Delayed '))));
});

test('all eleven input-confirmation scenarios also pass; standalone completion exposes missing prerequisites', async (t) => {
  const { lab } = await setup(t);
  lab.start({ scenarioId: 'all', confirmationMode: 'input' });
  await until(() => ended(lab), 'input-mode scenarios');
  assert.equal(lab.snapshot().summary.passed, 11, JSON.stringify(lab.snapshot().results.filter((result) => result.status !== 'passed')));
  lab.start({ scenarioId: 'job-complete' });
  await until(() => ended(lab), 'isolated completion');
  assert.equal(lab.snapshot().status, 'failed');
  failedCheck({ checks: lab.snapshot().results[0].checks }, 'prerequisites');
  assert.equal(lab.snapshot().summary.total, 1);
});

test('stop aborts a run, rejects concurrent starts, and close permanently disables control', async (t) => {
  const { lab } = await setup(t, { stepDelayMs: 1000 });
  assert.throws(() => lab.start({ scenarioId: 'missing' }), (error) => error.status === 400);
  assert.throws(() => lab.start({ confirmationMode: 'magic' }), (error) => error.status === 400);
  lab.start({ scenarioId: 'all' });
  await until(() => lab.snapshot().stepIndex >= 1, 'first step');
  const stopping = lab.stop();
  assert.throws(() => lab.start(), (error) => error.status === 409);
  await stopping;
  assert.equal(lab.snapshot().status, 'stopped');
  assert.equal(lab.snapshot().summary.total, lab.snapshot().summary.passed + lab.snapshot().summary.failed + lab.snapshot().summary.pending);
  const eventCount = lab.snapshot().events.length;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(lab.snapshot().events.length, eventCount);
  await lab.close();
  assert.throws(() => lab.start(), (error) => error.status === 409);
});

test('loading rejects wrong zone, missing physical mapping and omitted work completion', () => {
  const observations = [observation(), observation({ seconds: 1, inputBits: 4 })];
  let evaluation = evaluateSimulationScenario('loading', { observations, confirmationMode: 'input' });
  failedCheck(evaluation, 'completion');
  failedCheck(evaluation, 'zone-exit');
  evaluation = evaluateSimulationScenario('loading', { observations: observations.map((item) => ({ ...item, decoded: { ...item.decoded, gps: { ...item.decoded.gps, lat: 0, lng: 0 } } })), confirmationMode: 'input' });
  failedCheck(evaluation, 'zone');
  evaluation = evaluateSimulationScenario('loading', { observations, confirmationMode: 'input', fixtures: { ...SIMULATION_FIXTURES, inputMapping: [] } });
  failedCheck(evaluation, 'confirmation');
});

test('waiting refuses early, invalid GPS and backwards source-time dwell', () => {
  const early = [observation({ seconds: 0 }), observation({ seconds: 119 })];
  failedCheck(evaluateSimulationScenario('waiting', { observations: early }), 'after-threshold');
  const invalid = [observation({ seconds: 0 }), observation({ seconds: 119, gpsValid: false }), observation({ seconds: 120 })];
  failedCheck(evaluateSimulationScenario('waiting', { observations: invalid }), 'after-threshold');
  const backwards = [observation({ seconds: 0 }), observation({ seconds: 119 }), observation({ seconds: 60 }), observation({ seconds: 120 })];
  failedCheck(evaluateSimulationScenario('waiting', { observations: backwards }), 'after-threshold');
  const malformedTime = observation({ seconds: 121 }); malformedTime.decoded.gps.capturedAt = 'invalid'; malformedTime.decoded.deviceTime = 'invalid';
  assert.doesNotThrow(() => deriveGeofenceEvidence([...early, malformedTime]));
  assert.ok(deriveGeofenceEvidence([...early, malformedTime]).some((event) => event.type === 'time-invalid'));
});

test('refuelling requires zone, raw rise and persistent evidence beyond noise', () => {
  const samples = [100, 102, 101, 103].map((fuelBalanceRaw, index) => observation({ zone: 'fuel-zone', seconds: index * 5, fuelBalanceRaw }));
  failedCheck(evaluateSimulationScenario('refuelling', { observations: samples }), 'fuel-rise');
  const outside = [100, 102, 130, 131].map((fuelBalanceRaw, index) => observation({ zone: null, seconds: index * 5, fuelBalanceRaw }));
  failedCheck(evaluateSimulationScenario('refuelling', { observations: outside }), 'fuel-zone');
  const spike = [100, 102, 130, 103].map((fuelBalanceRaw, index) => observation({ zone: 'fuel-zone', seconds: index * 5, fuelBalanceRaw }));
  failedCheck(evaluateSimulationScenario('refuelling', { observations: spike }), 'fuel-rise');
});

test('vehicle checklist and mocked media must exist as explicit fixture evidence', () => {
  const wire = [observation()];
  const form = evaluateSimulationScenario('vehicle-check', { observations: wire, appEvents: [{ type: 'vehicle-check', checks: { tyres: true, brakes: true }, odometer: -1, confirmed: false }] });
  for (const id of ['checklist', 'odometer', 'driver-confirmation']) failedCheck(form, id);
  failedCheck(evaluateSimulationScenario('car-wash', { observations: [observation({ zone: 'wash-zone' })], mediaEvents: [] }), 'media');
});

test('SOS deduplication needs consistent UUIDs and a released matching end; snapshot requires release and mock media', () => {
  const startedAt = new Date('2026-09-17T10:00:00Z');
  const start = observation({ alarm: true, ec: '5', active: true, eventId: 'sos-id', startedAt, inputBits: 1, emergency: true });
  const duplicate = observation({ alarm: true, seconds: 1, ec: '5', active: true, eventId: 'sos-id', startedAt, inputBits: 1, emergency: true });
  const unreleased = observation({ alarm: true, seconds: 2, ec: '5', active: false, eventId: 'sos-id', startedAt, inputBits: 1, emergency: true });
  failedCheck(evaluateSimulationScenario('sos', { observations: [start, duplicate, unreleased] }), 'alarm-end');
  const missingRelease = structuredClone(unreleased); missingRelease.decoded.status.inputs = null; missingRelease.decoded.status.diagnostics.alarms.emergency = false;
  failedCheck(evaluateSimulationScenario('sos', { observations: [start, duplicate, missingRelease] }), 'alarm-end');
  const missingId = structuredClone(duplicate); delete missingId.decoded.alarm.uuid;
  failedCheck(evaluateSimulationScenario('sos', { observations: [start, missingId] }), 'deduplication');
  const distinct = structuredClone(duplicate); distinct.decoded.alarm.uuid = 'second-emergency';
  failedCheck(evaluateSimulationScenario('sos', { observations: [start, distinct] }), 'deduplication');
  const snapshot = observation({ alarm: true, ec: '4', active: true, eventId: 'snap-id', startedAt, inputBits: 2, det: { ch: '2' } });
  const snapshotAgain = observation({ alarm: true, seconds: 1, ec: '4', active: true, eventId: 'snap-id', startedAt, inputBits: 2, det: { ch: '2' } });
  const evaluation = evaluateSimulationScenario('snapshot', { observations: [snapshot, snapshotAgain], mediaEvents: [] });
  failedCheck(evaluation, 'input-release'); failedCheck(evaluation, 'media');
  delete snapshotAgain.decoded.alarm.uuid;
  failedCheck(evaluateSimulationScenario('snapshot', { observations: [snapshot, snapshotAgain], mediaEvents: [{ scenarioId: 'snapshot', status: 'available', simulated: true, url: 'simulation://fixture', packetId: snapshot.packetId }] }), 'deduplication');
});

test('dwell completion cannot reuse an exit from an earlier zone visit', () => {
  for (const [scenarioId, zone, threshold] of [['waiting', 'loading-zone', 120], ['rest-break', 'rest-zone', 180], ['overnight-parking', 'safe-zone', 300]]) {
    const acc = scenarioId !== 'overnight-parking';
    const observations = [
      observation({ zone, seconds: 0, acc }),
      observation({ zone, seconds: threshold - 1, acc }),
      observation({ zone: null, seconds: threshold, speedKph: 18, acc }),
      observation({ zone, seconds: threshold + 1, acc }),
      observation({ zone, seconds: threshold * 2, acc }),
      observation({ zone, seconds: threshold * 2 + 1, acc }),
    ];
    const incomplete = evaluateSimulationScenario(scenarioId, { observations });
    assert.equal(incomplete.checks.find((check) => check.id === 'after-threshold').passed, true);
    failedCheck(incomplete, 'zone-exit');
    observations.push(observation({ zone: null, seconds: threshold * 2 + 2, speedKph: 18, acc }));
    const completed = evaluateSimulationScenario(scenarioId, { observations });
    assert.equal(completed.checks.find((check) => check.id === 'zone-exit').passed, true);
  }
});

test('SOS and snapshot reject contradictory duplicate start times and ends before starts', () => {
  for (const scenarioId of ['sos', 'snapshot']) {
    const startedAt = new Date('2026-09-17T10:00:00Z');
    const options = { alarm: true, ec: scenarioId === 'sos' ? '5' : '4', eventId: `${scenarioId}-one`, startedAt, det: { ch: scenarioId === 'sos' ? '1' : '2' } };
    const active = { inputBits: scenarioId === 'sos' ? 1 : 2, emergency: scenarioId === 'sos' };
    const start = observation({ ...options, ...active, active: true });
    const duplicate = observation({ ...options, ...active, seconds: 1, active: true });
    const end = observation({ ...options, seconds: 2, active: false, inputBits: 0, emergency: false });
    const mediaEvents = scenarioId === 'snapshot' ? [{ scenarioId, status: 'available', simulated: true, url: 'simulation://fixture', packetId: start.packetId }] : [];
    assert.equal(evaluateSimulationScenario(scenarioId, { observations: [start, duplicate, end], mediaEvents }).passed, true);
    const contradictory = observation({ ...options, ...active, seconds: 1, startedAt: new Date(startedAt.getTime() + 1000), active: true });
    failedCheck(evaluateSimulationScenario(scenarioId, { observations: [start, contradictory, end], mediaEvents }), 'deduplication');
    const impossibleEnd = observation({ ...options, seconds: -1, active: false, inputBits: 0, emergency: false });
    failedCheck(evaluateSimulationScenario(scenarioId, { observations: [start, duplicate, impossibleEnd], mediaEvents }), scenarioId === 'sos' ? 'alarm-end' : 'input-release');
    failedCheck(evaluateSimulationScenario(scenarioId, { observations: [end, start, duplicate], mediaEvents }), scenarioId === 'sos' ? 'alarm-end' : 'input-release');
    const missingStartTime = structuredClone(start); missingStartTime.decoded.alarm.st = ''; missingStartTime.decoded.startedAt = null;
    failedCheck(evaluateSimulationScenario(scenarioId, { observations: [missingStartTime, duplicate, end], mediaEvents }), 'deduplication');
  }
});
