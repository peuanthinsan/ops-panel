import { randomUUID } from 'node:crypto';
import { createHowenSimulator } from './simulator.mjs';
import { SIMULATION_FIXTURES, SIMULATION_SCENARIOS, SIMULATION_LIMITATIONS, deriveGeofenceEvidence, evaluateSimulationScenario } from './simulation-scenarios.mjs';

const OUTSIDE = { lat: 13.74, lng: 100.48 };
const aborted = () => Object.assign(new Error('Simulation stopped'), { name: 'AbortError' });
const requestError = (status, message) => Object.assign(new Error(message), { status });
const clone = (value) => structuredClone(value);

function scenarioSteps(id, confirmationMode) {
  const status = (title, zoneId, seconds = 1, values = {}) => ({ type: 'status', title, zoneId, seconds, values });
  const app = (title, eventType, data) => ({ type: 'app', title, eventType, data });
  const alarm = (title, zoneId, seconds, values) => ({ type: 'alarm', title, zoneId, seconds, values });
  const enter = (zoneId, values = {}) => [status('Approach from outside the zone', null, 1, { speedKph: 18 }), status('Enter the zone and stop', zoneId, 1, values)];
  if (['loading', 'unloading'].includes(id)) {
    const channel = id === 'loading' ? 3 : 4;
    return [...enter(`${id}-zone`), status(confirmationMode === 'input' ? `Activate fixture input ${channel}` : 'Observe stopped GPS before driver confirmation', `${id}-zone`, 1, { inputBits: confirmationMode === 'input' ? 1 << (channel - 1) : 0 }), ...(confirmationMode === 'driver' ? [app('Record synthetic work-start confirmation', 'driver-confirmation', { confirmed: true, phase: 'start' })] : []), status(confirmationMode === 'input' ? `Release fixture input ${channel} after work` : 'Observe stopped GPS before finish confirmation', `${id}-zone`, 10, { inputBits: 0 }), ...(confirmationMode === 'driver' ? [app('Record synthetic work-finish confirmation', 'driver-confirmation', { confirmed: true, phase: 'end' })] : []), status('Leave the completed work zone', null, 1, { speedKph: 18 })];
  }
  if (['waiting', 'rest-break', 'overnight-parking'].includes(id)) {
    const zoneId = { waiting: 'loading-zone', 'rest-break': 'rest-zone', 'overnight-parking': 'safe-zone' }[id];
    const seconds = { waiting: 120, 'rest-break': 180, 'overnight-parking': 300 }[id];
    const values = { acc: id !== 'overnight-parking' };
    return [...enter(zoneId, values), status('Check one second before the dwell threshold', zoneId, seconds - 1, values), status('Reach the dwell threshold', zoneId, 1, values), ...(id === 'overnight-parking' ? [alarm('Confirm shared SOS remains an emergency', zoneId, 1, { ...values, ec: '5', active: true, inputBits: 1, emergency: true }), alarm('End the shared SOS event without changing job mode', zoneId, 1, { ...values, ec: '5', active: false, inputBits: 0, emergency: false })] : []), status('Exit the zone and clear dwell', null, 1, { speedKph: 18 })];
  }
  if (id === 'vehicle-check') return [status('Observe vehicle before app fixture', null), app('Complete synthetic checklist and odometer', 'vehicle-check', { checks: { tyres: true, brakes: true, lights: true }, odometer: 125000, confirmed: true })];
  if (id === 'refuelling') return [status('Approach fuel station', null, 1, { speedKph: 15, fuelBalanceRaw: 100 }), status('Record raw fuel baseline at the station', 'fuel-zone', 1, { fuelBalanceRaw: 100 }), status('Observe sensor noise below threshold', 'fuel-zone', 5, { fuelBalanceRaw: 102 }), status('Observe raw fuel rise', 'fuel-zone', 20, { fuelBalanceRaw: 130 }), status('Confirm the rise persists', 'fuel-zone', 5, { fuelBalanceRaw: 131 })];
  if (id === 'car-wash') return [...enter('wash-zone'), { type: 'media', title: 'Complete mocked wash media capture', mediaKind: 'wash-clip' }];
  if (id === 'job-complete') return [...enter('end-zone'), app('Confirm completion using preceding scenario evidence', 'job-completion', { confirmed: true })];
  if (id === 'sos') return [status('Observe vehicle before SOS', null), alarm('Press fixture SOS input 1', null, 1, { ec: '5', active: true, inputBits: 1, emergency: true }), alarm('Receive duplicate SOS start packet', null, 1, { ec: '5', active: true, inputBits: 1, emergency: true, duplicate: true }), alarm('Release SOS with a matching event end', null, 1, { ec: '5', active: false, inputBits: 0, emergency: false })];
  if (id === 'snapshot') return [status('Observe vehicle before snapshot input', null), alarm('Press fixture snapshot input 2', null, 1, { ec: '4', active: true, inputBits: 2, det: { ch: '2', num: '22' } }), alarm('Receive duplicate snapshot input packet', null, 1, { ec: '4', active: true, inputBits: 2, det: { ch: '2', num: '22' }, duplicate: true }), { type: 'media', title: 'Complete one mocked snapshot capture', mediaKind: 'snapshot-photo' }, alarm('Release snapshot input 2', null, 1, { ec: '4', active: false, inputBits: 0, det: { ch: '2', num: '22' } })];
  throw new Error(`Unknown scenario ${id}`);
}

export function createSimulationLab({ host = '127.0.0.1', port, deviceId = 'SIM-HOWEN-001', readSnapshot, onChange = () => {}, stepDelayMs = 450 } = {}) {
  if (typeof readSnapshot !== 'function') throw new Error('Simulation lab requires a gateway snapshot reader');
  if (!deviceId.startsWith('SIM-')) throw new Error('Simulation lab requires an explicit SIM- device ID');
  let state = initialState();
  let simulator = null;
  let controller = null;
  let running = null;
  let busy = false;
  let closed = false;
  let lastVirtualMs = 0;

  function initialState() {
    return { enabled: true, status: 'idle', runId: null, selectedScenarioId: 'all', confirmationMode: 'driver', startedAt: null, finishedAt: null, virtualTime: null, currentStep: null, stepIndex: 0, stepCount: 0, scenarios: clone(SIMULATION_SCENARIOS), fixtures: clone(SIMULATION_FIXTURES), results: [], events: [], summary: { total: 0, passed: 0, failed: 0, pending: 0 }, limitations: [...SIMULATION_LIMITATIONS], error: null };
  }
  function update() {
    state.summary = { total: state.results.length, passed: state.results.filter((result) => result.status === 'passed').length, failed: state.results.filter((result) => result.status === 'failed').length, pending: state.results.filter((result) => ['pending', 'running', 'stopped'].includes(result.status)).length };
    try { onChange(clone(state)); } catch {}
  }
  function event(scenarioId, type, title, source, data, packetId) {
    state.events.push({ id: randomUUID(), scenarioId, virtualTime: state.virtualTime, type, title, source, data, ...(packetId ? { packetId } : {}) });
    if (state.events.length > 256) state.events.splice(0, state.events.length - 256);
    update();
  }
  function checkAbort() { if (controller?.signal.aborted) throw aborted(); }
  async function delay(milliseconds) {
    checkAbort();
    if (milliseconds <= 0) return;
    await new Promise((resolve, reject) => {
      const signal = controller.signal;
      const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(aborted()); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, milliseconds);
      signal.addEventListener('abort', cancel, { once: true });
    });
  }
  async function observe(step, scenarioId, context) {
    checkAbort();
    const previous = await readSnapshot();
    const previousIds = new Set((previous.packets ?? []).map((packet) => packet.id));
    const zone = state.fixtures.geofences.find((item) => item.id === step.zoneId);
    lastVirtualMs += (step.seconds ?? 1) * 1000;
    const time = new Date(lastVirtualMs);
    state.virtualTime = time.toISOString();
    const values = { ...(zone ? { lat: zone.lat, lng: zone.lng } : OUTSIDE), time, speedKph: 0, acc: true, inputBits: 0, gpsValid: true, ...step.values };
    if (step.type === 'alarm') {
      if (!context.alarmId) { context.alarmId = randomUUID(); context.alarmStartedAt = time; }
      values.eventId = context.alarmId;
      values.startedAt = context.alarmStartedAt;
      if (values.ec === '5') values.det = { ch: '1' };
    }
    const acknowledgement = step.type === 'alarm' ? await simulator.sendAlarm(values) : await simulator.sendStatus(values);
    checkAbort();
    if (!acknowledgement?.acknowledged) throw new Error('Gateway did not acknowledge the simulation packet');
    const expectedType = step.type === 'alarm' ? '0x1051' : '0x1041';
    let found;
    for (let attempt = 0; attempt < 20 && !found; attempt++) {
      const observed = await readSnapshot();
      found = (observed.packets ?? []).find((packet) => !previousIds.has(packet.id) && packet.deviceId === deviceId && packet.direction === 'inbound' && packet.messageType === expectedType && packet.decoded?.deviceTime === time.toISOString());
      if (!found) await delay(25);
    }
    if (!found) throw new Error(`Acknowledged ${expectedType} was not found in the decoded gateway journal`);
    if (found.simulated !== true) throw new Error('Gateway did not mark this device as explicitly configured simulation traffic');
    const observation = { packetId: found.id, messageType: found.messageType, decoded: clone(found.decoded), receivedAt: found.receivedAt, occurredAt: found.occurredAt };
    context.observations.push(observation);
    event(scenarioId, 'packet-observed', `${found.summary} · acknowledged`, 'howen-tcp', { messageType: found.messageType, acknowledgement: acknowledgement.ackType, decoded: observation.decoded, warnings: found.warnings ?? [] }, found.id);
    const derived = deriveGeofenceEvidence(context.observations, state.fixtures);
    for (const item of derived.slice(context.geofenceEventCount)) event(scenarioId, `geofence-${item.type}`, `${item.type} · ${item.zoneId}`, 'simulation-geofence', item, item.packetId);
    context.geofenceEventCount = derived.length;
    return observation;
  }
  async function run(selected) {
    let terminalStatus = 'failed';
    try {
      const previous = await readSnapshot();
      const device = previous.devices?.find((item) => item.deviceId === deviceId);
      const existingTimes = [Date.parse(device?.telemetryObservedAt ?? ''), ...Object.values(device?.telemetryTimestamps ?? {}).map((item) => Date.parse(item.observedAt ?? '')), ...(previous.packets ?? []).filter((packet) => packet.deviceId === deviceId).map((packet) => Date.parse(packet.decoded?.deviceTime ?? ''))].filter(Number.isFinite);
      // A completed accelerated run may leave device timestamps ahead of wall
      // time. The next run starts after that evidence rather than being stale.
      lastVirtualMs = Math.floor(Math.max(Date.now(), lastVirtualMs, ...existingTimes) / 1000) * 1000 + 1000;
      state.virtualTime = new Date(lastVirtualMs).toISOString();
      simulator = createHowenSimulator({ host, port, deviceId, autoEmit: false });
      checkAbort();
      await simulator.start();
      await simulator.ready();
      checkAbort();
      for (const scenario of selected) {
        checkAbort();
        const result = state.results.find((item) => item.scenarioId === scenario.id);
        result.status = 'running';
        const context = { observations: [], appEvents: [], mediaEvents: [], geofenceEventCount: 0, alarmId: null, alarmStartedAt: null };
        event(scenario.id, 'scenario-started', `${scenario.number} · ${scenario.title}`, 'simulation-rule', { productionMode: scenario.productionMode, kind: scenario.kind, simulationOnly: true });
        for (const step of scenarioSteps(scenario.id, state.confirmationMode)) {
          checkAbort();
          state.currentStep = `${scenario.title} · ${step.title}`;
          state.stepIndex++;
          update();
          if (['status', 'alarm'].includes(step.type)) await observe(step, scenario.id, context);
          else if (step.type === 'app') {
            const fixture = { type: step.eventType, scenarioId: scenario.id, simulated: true, packetId: context.observations.at(-1)?.packetId ?? null, ...clone(step.data) };
            context.appEvents.push(fixture);
            event(scenario.id, step.eventType, step.title, 'simulation-app', fixture, fixture.packetId);
          } else if (step.type === 'media') {
            const trigger = scenario.id === 'snapshot' ? context.observations.find((item) => item.messageType === '0x1051') : context.observations.at(-1);
            const fixture = { scenarioId: scenario.id, kind: step.mediaKind, status: 'available', simulated: true, url: `simulation://${state.runId}/${scenario.id}/media`, packetId: trigger?.packetId ?? null };
            context.mediaEvents.push(fixture);
            event(scenario.id, 'mock-media', step.title, 'simulation-media', fixture, fixture.packetId);
          }
          await delay(stepDelayMs);
        }
        const evaluation = evaluateSimulationScenario(scenario.id, { ...context, confirmationMode: state.confirmationMode, precedingResults: state.results, fixtures: state.fixtures });
        result.checks = evaluation.checks;
        result.status = evaluation.passed ? 'passed' : 'failed';
        if (!evaluation.passed) result.error = `Unsatisfied checks: ${evaluation.checks.filter((check) => !check.passed).map((check) => check.id).join(', ')}`;
        event(scenario.id, 'scenario-evaluated', `${scenario.title}: ${result.status}`, 'simulation-rule', { status: result.status, checks: result.checks });
      }
      terminalStatus = state.results.every((result) => result.status === 'passed') ? 'completed' : 'failed';
      state.error = terminalStatus === 'failed' ? 'One or more sandbox scenarios did not satisfy their evidence checks.' : null;
    } catch (error) {
      const stopped = controller?.signal.aborted || error.name === 'AbortError';
      terminalStatus = stopped ? 'stopped' : 'failed';
      state.error = stopped ? null : error.message;
      for (const result of state.results) if (['pending', 'running'].includes(result.status)) { result.status = stopped ? 'stopped' : 'failed'; if (!stopped) result.error = error.message; }
    } finally {
      try { await simulator?.stop(); }
      catch (error) { terminalStatus = 'failed'; state.error = `Simulation connection cleanup failed: ${error.message}`; }
      simulator = null;
      state.status = controller?.signal.aborted && terminalStatus === 'completed' ? 'stopped' : terminalStatus;
      state.finishedAt = new Date().toISOString();
      state.currentStep = null;
      busy = false;
      update();
    }
  }
  return {
    snapshot: () => clone(state),
    start({ scenarioId = 'all', confirmationMode = 'driver' } = {}) {
      if (closed) throw requestError(409, 'Simulation lab is closed');
      if (busy) throw requestError(409, 'A simulation run is already active');
      if (!['driver', 'input'].includes(confirmationMode)) throw requestError(400, 'Choose driver or input confirmation');
      const selected = scenarioId === 'all' ? SIMULATION_SCENARIOS : SIMULATION_SCENARIOS.filter((scenario) => scenario.id === scenarioId);
      if (!selected.length) throw requestError(400, 'Unknown simulation scenario');
      state = initialState();
      state.status = 'running'; state.runId = randomUUID(); state.selectedScenarioId = scenarioId; state.confirmationMode = confirmationMode;
      state.startedAt = new Date().toISOString(); state.results = selected.map((scenario) => ({ scenarioId: scenario.id, status: 'pending', checks: [] }));
      state.stepCount = selected.reduce((sum, scenario) => sum + scenarioSteps(scenario.id, confirmationMode).length, 0);
      controller = new AbortController();
      busy = true;
      update();
      running = run(selected);
      return clone(state);
    },
    async stop() {
      if (!busy) return clone(state);
      state.status = 'stopping'; controller.abort(); update();
      try { await simulator?.stop(); } catch {}
      await running;
      if (state.status === 'stopping') { state.status = 'stopped'; update(); }
      return clone(state);
    },
    async close() { closed = true; await this.stop(); },
  };
}
