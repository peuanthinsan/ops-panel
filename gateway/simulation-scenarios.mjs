// Everything in this module is a labelled sandbox policy, not a production job
// rule, a customer geofence, or a claim about a truck's physical wiring.
export const SIMULATION_FIXTURES = {
  geofences: [
    ['loading-zone', 'Simulation loading bay', 13.7563, 100.5018, 'loading'],
    ['unloading-zone', 'Simulation unloading bay', 13.7613, 100.5018, 'unloading'],
    ['rest-zone', 'Simulation rest stop', 13.7663, 100.5018, 'rest-break'],
    ['fuel-zone', 'Simulation fuel station', 13.7713, 100.5018, 'refuelling'],
    ['wash-zone', 'Simulation wash station', 13.7763, 100.5018, 'car-wash'],
    ['safe-zone', 'Simulation overnight parking', 13.7813, 100.5018, 'overnight-parking'],
    ['end-zone', 'Simulation job endpoint', 13.7863, 100.5018, 'job-complete'],
  ].map(([id, name, lat, lng, purpose]) => ({ id, name, lat, lng, radiusMeters: 80, source: 'synthetic', purpose })),
  inputMapping: [
    { channel: 1, purpose: 'sos', confirmed: false },
    { channel: 2, purpose: 'snapshot', confirmed: false },
    { channel: 3, purpose: 'loading', confirmed: false },
    { channel: 4, purpose: 'unloading', confirmed: false },
  ],
  thresholds: { stoppedSpeedKph: 1, waitingSeconds: 120, restSeconds: 180, parkingSeconds: 300, fuelRiseRaw: 20, fuelNoiseRaw: 3 },
  completionPrerequisites: ['loading', 'unloading', 'vehicle-check'],
  checklist: ['tyres', 'brakes', 'lights'],
};

export const SIMULATION_LIMITATIONS = [
  'All zones, wiring mappings, confirmations, checklists and media outcomes are synthetic fixtures. No Data-FM FMS or Spark geofences are used.',
  'Virtual device time advances faster than wall time. The clock and thresholds are simulation values, not production settings.',
  'Only telemetry and alarms traverse actual H-protocol TCP. App, geofence, media and rule events are explicitly labelled sandbox results.',
  'ACC means ignition state. It is not PTO, loading or unloading proof.',
  'This lab never starts, finishes or changes production jobs, and never captures real camera media.',
];

const metadata = [
  ['loading', '01', 'Loading', '1', 'job', ['Valid GPS in loading zone', 'Vehicle stopped', 'Driver confirmation or mapped input 3'], ['Input 3 is a fixture mapping; verify physical wiring before production.']],
  ['unloading', '02', 'Unloading', '3', 'job', ['Valid GPS in unloading zone', 'Vehicle stopped', 'Driver confirmation or mapped input 4'], ['Input 4 is a fixture mapping; ACC alone cannot confirm unloading.']],
  ['waiting', '03', 'Waiting', '2', 'job', ['Loading-zone entry', 'Stopped for 120 virtual seconds', 'Threshold and exit checks'], ['A stop in a zone is waiting evidence, not proof that cargo is being handled.']],
  ['rest-break', '04', 'Rest break', '4', 'job', ['Rest-zone entry', 'Stopped for 180 virtual seconds', 'Threshold and exit checks'], ['The rest duration is an accelerated sandbox threshold.']],
  ['vehicle-check', '05', 'Vehicle check', '5', 'job', ['Complete fixture checklist', 'Nonnegative odometer', 'Driver confirmation'], ['Checklist data is an app fixture, not a submission to the real mobile form endpoint.']],
  ['refuelling', '06', 'Refuelling', '6', 'job', ['Valid GPS in fuel zone', 'Stopped vehicle', 'Fuel raw-value rise above noise threshold'], ['Fuel values are raw sensor units; this does not prove litres, RPM or a calibrated fuel reading.']],
  ['car-wash', '07', 'Car wash', '7', 'job', ['Valid GPS in wash zone', 'Mock media outcome available'], ['Media is synthetic; no camera recording or photo request is sent.']],
  ['overnight-parking', '08', 'Overnight parking', '8', 'job', ['Safe-zone entry', 'Ignition off', 'Stopped for 300 virtual seconds', 'SOS remains emergency'], ['The shared SOS input cannot silently select or finish parking.']],
  ['job-complete', '09', 'Job complete', '9', 'job', ['Loading, unloading and vehicle-check evidence', 'Valid GPS at endpoint', 'Driver completion confirmation'], ['Running this scenario alone fails missing prerequisites; use Run all to establish them. SOS is not a completion prerequisite.']],
  ['sos', '10', 'SOS / Emergency', null, 'event', ['Input 1 and SOS event code 5', 'Emergency state', 'Deduplicated start and matching end'], ['Input mapping is synthetic; this event never changes a production job mode.']],
  ['snapshot', '11', 'Snapshot button', null, 'event', ['Mapped input 2 event', 'Mock media outcome available', 'Duplicate trigger handled once'], ['Synthetic media proves the sandbox flow only, not physical camera capture.']],
];
export const SIMULATION_SCENARIOS = metadata.map(([id, number, title, productionMode, kind, requirements, limitations]) => ({ id, number, title, productionMode, kind, requirements, limitations }));

export function distanceMeters(a, b) {
  const radians = (value) => value * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}
export const observationStatus = (observation) => observation.decoded?.status ?? (observation.messageType === '0x1041' ? observation.decoded : null);
export const observationGps = (observation) => observationStatus(observation)?.gps;
export function insideZone(observation, zone) {
  const gps = observationGps(observation);
  return Boolean(zone && gps?.valid && Number.isFinite(gps.lat) && Number.isFinite(gps.lng) && Number.isFinite(Date.parse(gps.capturedAt ?? '')) && distanceMeters(gps, zone) <= zone.radiusMeters);
}
const observedMs = (observation) => Date.parse(observationGps(observation)?.capturedAt ?? observationStatus(observation)?.deviceTime ?? '');
const stopped = (observation, fixtures) => Number.isFinite(observationGps(observation)?.speedKph) && observationGps(observation).speedKph <= fixtures.thresholds.stoppedSpeedKph;
const activeInput = (observation, channel) => observationStatus(observation)?.inputs?.find((input) => input.channel === channel)?.active === true;
const inactiveInput = (observation, channel) => observationStatus(observation)?.inputs?.find((input) => input.channel === channel)?.active === false;
const mappedInput = (fixtures, purpose, channel) => fixtures.inputMapping.some((mapping) => mapping.purpose === purpose && mapping.channel === channel);
const consistentAlarmIdentity = (observations) => observations.length > 0 && observations.every((item) => {
  const first = observations[0].decoded;
  return typeof item.decoded.alarm.uuid === 'string' && item.decoded.alarm.uuid.trim()
    && item.decoded.alarm.uuid === first.alarm.uuid
    && typeof item.decoded.alarm.st === 'string' && item.decoded.alarm.st.trim()
    && item.decoded.alarm.st === first.alarm.st
    && Number.isFinite(Date.parse(item.decoded.startedAt ?? ''))
    && item.decoded.startedAt === first.startedAt;
});
function validAlarmEnd(start, end, observations) {
  const startedAt = Date.parse(start.decoded.startedAt ?? '');
  const endedAt = Date.parse(end.decoded.endedAt ?? '');
  return observations.indexOf(start) < observations.indexOf(end)
    && typeof start.decoded.alarm.uuid === 'string' && start.decoded.alarm.uuid.trim()
    && start.decoded.alarm.uuid === end.decoded.alarm.uuid
    && typeof start.decoded.alarm.st === 'string' && start.decoded.alarm.st.trim()
    && start.decoded.alarm.st === end.decoded.alarm.st
    && Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt;
}

export function deriveGeofenceEvidence(observations, fixtures = SIMULATION_FIXTURES) {
  const events = [];
  const states = new Map();
  for (const observation of observations) {
    if (!observationGps(observation)) continue;
    const now = observedMs(observation);
    for (const zone of fixtures.geofences) {
      const previous = states.get(zone.id) ?? { inside: false, enteredAt: null, stoppedAt: null, lastTime: null };
      const validTime = Number.isFinite(now) && (previous.lastTime == null || now >= previous.lastTime);
      const inside = validTime && insideZone(observation, zone);
      const visitId = inside ? previous.inside ? previous.visitId : `${zone.id}:${observation.packetId}` : previous.visitId;
      if (inside && !previous.inside) events.push({ type: 'enter', zoneId: zone.id, visitId, packetId: observation.packetId, observedAt: new Date(now).toISOString(), dwellSeconds: 0 });
      if (!inside && previous.inside) events.push({ type: !validTime ? 'time-invalid' : observationGps(observation)?.valid ? 'exit' : 'fix-lost', zoneId: zone.id, visitId, packetId: observation.packetId, observedAt: Number.isFinite(now) ? new Date(now).toISOString() : null, dwellSeconds: 0 });
      const stationary = inside && stopped(observation, fixtures) && Number.isFinite(now);
      const enteredAt = inside ? previous.inside ? previous.enteredAt : now : null;
      const stoppedAt = stationary ? previous.inside && previous.stoppedAt != null ? previous.stoppedAt : now : null;
      const dwellSeconds = stoppedAt == null ? 0 : Math.max(0, (now - stoppedAt) / 1000);
      if (inside) events.push({ type: 'dwell', zoneId: zone.id, visitId, packetId: observation.packetId, observedAt: new Date(now).toISOString(), dwellSeconds });
      states.set(zone.id, { inside, enteredAt, stoppedAt, visitId: inside ? visitId : null, lastTime: Number.isFinite(now) ? Math.max(now, previous.lastTime ?? now) : previous.lastTime });
    }
  }
  return events;
}

export function evaluateSimulationScenario(scenarioId, { observations = [], appEvents = [], mediaEvents = [], precedingResults = [], confirmationMode = 'driver', fixtures = SIMULATION_FIXTURES } = {}) {
  const checks = [];
  const add = (id, label, passed, actual, expected, source, observation) => checks.push({ id, label, passed: Boolean(passed), actual: actual ?? null, expected, source, ...(observation?.packetId ? { packetId: observation.packetId } : {}) });
  const zone = (id) => fixtures.geofences.find((item) => item.id === id);
  const inZone = (id) => observations.filter((item) => insideZone(item, zone(id)));
  const validPackets = observations.filter((item) => observationGps(item)?.valid);
  const geofences = deriveGeofenceEvidence(observations, fixtures);
  const hasWire = observations.some((item) => item.packetId && ['0x1041', '0x1051'].includes(item.messageType));
  add('wire', 'Telemetry decoded from acknowledged TCP packets', hasWire, observations.length, 'At least one decoded gateway packet', 'howen-tcp', observations[0]);

  if (['loading', 'unloading'].includes(scenarioId)) {
    const channel = scenarioId === 'loading' ? 3 : 4;
    const candidates = inZone(`${scenarioId}-zone`).filter((item) => stopped(item, fixtures));
    const entry = candidates.find((item) => !activeInput(item, channel));
    const confirmations = appEvents.filter((event) => event.type === 'driver-confirmation' && event.scenarioId === scenarioId && event.confirmed === true && event.phase === 'start');
    const confirmed = confirmationMode === 'input'
      ? candidates.find((item) => mappedInput(fixtures, scenarioId, channel) && activeInput(item, channel))
      : candidates.find((item) => confirmations.some((event) => event.packetId === item.packetId));
    add('zone', 'Stopped inside the correct synthetic zone', candidates.length > 0, candidates.length, `${scenarioId}-zone and speed ≤ ${fixtures.thresholds.stoppedSpeedKph}`, 'simulation-geofence', candidates[0]);
    add('confirmation', confirmationMode === 'input' ? `Mapped input ${channel} confirms work` : 'Driver fixture confirms work', Boolean(confirmed), confirmed ? confirmationMode : 'missing', confirmationMode, confirmationMode === 'input' ? 'howen-tcp' : 'simulation-app', confirmed);
    const confirmedIndex = observations.indexOf(confirmed);
    const completion = confirmationMode === 'input'
      ? candidates.find((item) => confirmedIndex >= 0 && observations.indexOf(item) > confirmedIndex && inactiveInput(item, channel))
      : candidates.find((item) => confirmedIndex >= 0 && observations.indexOf(item) > confirmedIndex && appEvents.some((event) => event.type === 'driver-confirmation' && event.scenarioId === scenarioId && event.phase === 'end' && event.confirmed === true && event.packetId === item.packetId));
    add('completion', confirmationMode === 'input' ? `Mapped input ${channel} releases after work` : 'Driver fixture confirms work finished', Boolean(completion), completion ? 'Matched finish after start' : 'missing', 'Matching completion after work begins', confirmationMode === 'input' ? 'howen-tcp' : 'simulation-app', completion);
    const exit = geofences.find((item) => item.type === 'exit' && item.zoneId === `${scenarioId}-zone` && completion && observations.findIndex((packet) => packet.packetId === item.packetId) > observations.indexOf(completion));
    add('zone-exit', 'Vehicle leaves the work zone after completion', Boolean(exit), exit?.zoneId, 'Exit follows completed work', 'simulation-geofence', observations.find((item) => item.packetId === exit?.packetId));
    add('acc-not-pto', 'Ignition alone does not confirm cargo activity', Boolean(entry) && !confirmations.some((event) => event.packetId === entry.packetId), entry ? { acc: observationStatus(entry)?.acc, inputActive: activeInput(entry, channel) } : null, 'An unconfirmed entry before confirmation', 'simulation-rule', entry);
  } else if (['waiting', 'rest-break', 'overnight-parking'].includes(scenarioId)) {
    const zoneId = { waiting: 'loading-zone', 'rest-break': 'rest-zone', 'overnight-parking': 'safe-zone' }[scenarioId];
    const threshold = { waiting: fixtures.thresholds.waitingSeconds, 'rest-break': fixtures.thresholds.restSeconds, 'overnight-parking': fixtures.thresholds.parkingSeconds }[scenarioId];
    const entries = geofences.filter((event) => event.zoneId === zoneId && event.type === 'enter');
    const dwell = geofences.filter((event) => event.zoneId === zoneId && event.type === 'dwell');
    const exits = geofences.filter((event) => event.zoneId === zoneId && event.type === 'exit');
    const packetIndex = (event) => observations.findIndex((item) => item.packetId === event?.packetId);
    const isFollowingExit = (exit, reached) => Boolean(reached) && exit.visitId === reached.visitId && packetIndex(exit) > packetIndex(reached);
    const reachedCandidates = dwell.filter((event) => event.dwellSeconds >= threshold);
    const reached = reachedCandidates.find((event) => exits.some((exit) => isFollowingExit(exit, event))) ?? reachedCandidates[0];
    const early = dwell.find((event) => event.dwellSeconds > 0 && event.dwellSeconds < threshold && (!reached || event.visitId === reached.visitId && packetIndex(event) < packetIndex(reached)));
    const exit = exits.find((item) => isFollowingExit(item, reached));
    const packet = (event) => observations.find((item) => item.packetId === event?.packetId);
    add('zone-entry', 'Entered the correct synthetic zone', entries.length > 0, entries.length, zoneId, 'simulation-geofence', packet(entries[0]));
    add('before-threshold', 'Early stop does not satisfy dwell', Boolean(early), early?.dwellSeconds, `< ${threshold} virtual seconds`, 'simulation-rule', packet(early));
    add('after-threshold', 'Continuous stopped dwell reaches threshold', Boolean(reached), reached?.dwellSeconds ?? Math.max(0, ...dwell.map((event) => event.dwellSeconds)), `≥ ${threshold} virtual seconds`, 'simulation-rule', packet(reached));
    add('zone-exit', 'Leaving the zone clears the completed dwell', Boolean(exit), exit?.visitId, 'An exit after the threshold in the same zone visit', 'simulation-geofence', packet(exit));
    if (scenarioId === 'overnight-parking') {
      const parked = inZone(zoneId);
      add('ignition-off', 'Ignition stays off during parking dwell', parked.length > 0 && parked.every((item) => observationStatus(item)?.acc === false), parked.map((item) => observationStatus(item)?.acc), 'ACC off', 'howen-tcp', packet(reached));
      const sos = observations.find((item) => String(item.decoded?.alarm?.ec) === '5');
      add('sos-separate', 'Shared SOS remains an emergency event', Boolean(sos) && !appEvents.some((event) => event.type === 'sos-parking-transition'), sos ? 'SOS event retained; no parking transition' : null, 'Emergency stays separate from job mode', 'simulation-rule', sos);
    }
  } else if (scenarioId === 'vehicle-check') {
    const form = appEvents.find((event) => event.type === 'vehicle-check');
    add('checklist', 'All fixture checklist items completed', Boolean(form) && fixtures.checklist.every((key) => form.checks?.[key] === true), form?.checks, fixtures.checklist, 'simulation-app');
    add('odometer', 'Odometer fixture is valid', Number.isFinite(form?.odometer) && form.odometer >= 0, form?.odometer, 'A nonnegative number', 'simulation-app');
    add('driver-confirmation', 'Driver confirms the fixture checklist', form?.confirmed === true, form?.confirmed ?? false, true, 'simulation-app');
  } else if (scenarioId === 'refuelling') {
    const samples = inZone('fuel-zone').filter((item) => stopped(item, fixtures) && Number.isFinite(observationStatus(item)?.diagnostics?.fuel?.balanceRaw));
    const values = samples.map((item) => observationStatus(item).diagnostics.fuel.balanceRaw);
    const baseline = values[0];
    const earlyRise = values.length > 1 ? values[1] - baseline : null;
    const rise = values.length ? values.at(-1) - baseline : null;
    add('fuel-zone', 'Fuel samples are stopped inside the fuel station', samples.length >= 3, samples.length, 'At least 3 decoded raw fuel samples', 'simulation-geofence', samples[0]);
    add('noise', 'Small fuel noise does not trigger refuelling', earlyRise != null && Math.abs(earlyRise) <= fixtures.thresholds.fuelNoiseRaw && earlyRise < fixtures.thresholds.fuelRiseRaw, earlyRise, `Noise ≤ ${fixtures.thresholds.fuelNoiseRaw} raw units`, 'simulation-rule', samples[1]);
    add('fuel-rise', 'Sustained fuel rise exceeds the sandbox threshold', rise != null && rise >= fixtures.thresholds.fuelRiseRaw && values.slice(-2).every((value) => value - baseline >= fixtures.thresholds.fuelRiseRaw), rise, `Two final samples ≥ ${fixtures.thresholds.fuelRiseRaw} raw units above baseline`, 'howen-tcp', samples.at(-1));
    add('raw-units', 'Fuel units remain explicitly unknown', samples.length > 0 && samples.every((item) => observationStatus(item).diagnostics.fuel.units == null), 'raw units', 'No litres or RPM inferred', 'simulation-rule', samples[0]);
  } else if (['car-wash', 'snapshot'].includes(scenarioId)) {
    const triggers = scenarioId === 'car-wash' ? inZone('wash-zone') : observations.filter((item) => String(item.decoded?.alarm?.ec) === '4' && item.decoded?.alarmState === 'start' && activeInput(item, 2) && String(item.decoded.alarm.det?.ch) === '2' && mappedInput(fixtures, 'snapshot', 2));
    add('trigger', scenarioId === 'car-wash' ? 'Entered the wash zone' : 'Input 2 generated a snapshot trigger', triggers.length > 0, triggers.length, scenarioId === 'car-wash' ? 'wash-zone' : 'Mapped input 2 alarm', scenarioId === 'car-wash' ? 'simulation-geofence' : 'howen-tcp', triggers[0]);
    const media = mediaEvents.filter((event) => event.scenarioId === scenarioId && event.status === 'available' && event.simulated === true && String(event.url).startsWith('simulation://') && triggers.some((item) => item.packetId === event.packetId));
    add('media', 'Mock media outcome is available and linked to the trigger', media.length === 1, media.length, 'Exactly one labelled synthetic media result', 'simulation-media', triggers[0]);
    if (scenarioId === 'snapshot') {
      const ids = new Set(triggers.map((item) => item.decoded.alarm.uuid).filter(Boolean));
      add('deduplication', 'Duplicate input event produces one media result', triggers.length >= 2 && consistentAlarmIdentity(triggers) && ids.size === 1 && media.length === 1, { packets: triggers.length, eventIds: ids.size, media: media.length }, 'Duplicate packets with one UUID/start time and one media result', 'simulation-rule', triggers[0]);
      const release = observations.find((item) => String(item.decoded?.alarm?.ec) === '4' && item.decoded.alarmState === 'end' && String(item.decoded.alarm.det?.ch) === '2' && inactiveInput(item, 2) && triggers.some((start) => validAlarmEnd(start, item, observations)));
      add('input-release', 'Snapshot button release matches its press', Boolean(release), release?.decoded?.alarm?.uuid, 'Same event UUID/start time and input 2 inactive', 'howen-tcp', release);
    }
  } else if (scenarioId === 'job-complete') {
    const done = new Set(precedingResults.filter((result) => result.status === 'passed').map((result) => result.scenarioId));
    const present = fixtures.completionPrerequisites.filter((id) => done.has(id));
    add('prerequisites', 'Required earlier scenario evidence exists', present.length === fixtures.completionPrerequisites.length, present, fixtures.completionPrerequisites, 'simulation-rule');
    const endpoint = inZone('end-zone').find((item) => stopped(item, fixtures));
    add('endpoint', 'Vehicle stopped at the synthetic endpoint', Boolean(endpoint), endpoint ? 'end-zone' : null, 'Valid stopped GPS in end-zone', 'simulation-geofence', endpoint);
    const confirmation = appEvents.find((event) => event.type === 'job-completion' && event.confirmed === true && event.packetId === endpoint?.packetId);
    add('confirmation', 'Driver confirms completion', Boolean(confirmation), confirmation?.confirmed ?? false, true, 'simulation-app', endpoint);
    add('no-sos-prerequisite', 'Emergency is not required to complete work', !fixtures.completionPrerequisites.includes('sos'), fixtures.completionPrerequisites, 'No SOS prerequisite', 'simulation-rule');
  } else if (scenarioId === 'sos') {
    const starts = observations.filter((item) => String(item.decoded?.alarm?.ec) === '5' && item.decoded.alarmState === 'start' && activeInput(item, 1) && observationStatus(item)?.diagnostics?.alarms?.emergency === true && mappedInput(fixtures, 'sos', 1));
    const ends = observations.filter((item) => String(item.decoded?.alarm?.ec) === '5' && item.decoded.alarmState === 'end');
    const ids = new Set(starts.map((item) => item.decoded.alarm.uuid).filter(Boolean));
    add('sos-wire', 'SOS code, mapped input and emergency state agree', starts.length > 0, starts.length, 'ec=5, input 1 active, emergency=true', 'howen-tcp', starts[0]);
    add('deduplication', 'Repeated SOS start creates one emergency', starts.length >= 2 && consistentAlarmIdentity(starts) && ids.size === 1, { packets: starts.length, uniqueEvents: ids.size }, 'Duplicate start packets with one UUID and valid start time', 'simulation-rule', starts[0]);
    const matchedEnd = ends.find((end) => inactiveInput(end, 1) && observationStatus(end)?.diagnostics?.alarms?.emergency === false && starts.some((start) => validAlarmEnd(start, end, observations)));
    add('alarm-end', 'SOS end matches its original event', Boolean(matchedEnd), matchedEnd?.decoded?.alarm?.uuid, starts[0]?.decoded?.alarm?.uuid ?? 'Matching start UUID', 'howen-tcp', matchedEnd);
    add('location', 'Emergency includes a valid GPS location', starts.some((item) => observationGps(item)?.valid), starts.find((item) => observationGps(item)?.valid)?.decoded?.status?.gps ?? null, 'Valid decoded GPS', 'howen-tcp', starts[0]);
  } else throw new Error(`Unknown simulation scenario: ${scenarioId}`);

  if (scenarioId !== 'vehicle-check') add('valid-gps', 'Valid GPS evidence is available', validPackets.length > 0, validPackets.length, 'At least one valid GPS fix', 'howen-tcp', validPackets[0]);
  return { checks, passed: checks.length > 0 && checks.every((check) => check.passed), geofences };
}
