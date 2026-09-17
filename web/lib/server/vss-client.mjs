import { createHash } from 'node:crypto';

const SUCCESS = 10000;
const SESSION_EXPIRED = 10023;
const REDACTED = '[redacted]';
const sensitiveKey = /password|passwd|pwd|token|secret|authorization|credential|api.?key|access.?key|session|signature|cookie|^auth$|^sig$|^username$/i;

export class VssClientError extends Error {
  constructor(code, message, statusCode = 502) {
    super(message);
    this.name = 'VssClientError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function fail(code, message, statusCode) { return new VssClientError(code, message, statusCode); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function number(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function integer(value) { const n = number(value); return Number.isSafeInteger(n) ? n : null; }
function string(value) {
  return (typeof value === 'string' && value.trim()) || (typeof value === 'number' && Number.isFinite(value) ? String(value) : null);
}
function exactBoolean(value) {
  if (value === 1 || value === '1' || value === true) return true;
  if (value === 0 || value === '0' || value === false) return false;
  return null;
}
function limit(value, name, min, max, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = integer(value);
  if (n === null || n < min || n > max) throw fail('configuration_invalid', `${name} must be an integer from ${min} to ${max}.`, 503);
  return n;
}

/** Backend-only configuration. Never expose the returned credentials in an API response. */
export function readVssConfiguration(env = process.env) {
  const keys = ['HOWEN_VSS_BASE_URL', 'HOWEN_VSS_USERNAME', 'HOWEN_VSS_PASSWORD'];
  const present = keys.map((key) => typeof env[key] === 'string' && env[key].trim().length > 0);
  if (present.every((value) => !value)) return { configured: false };
  if (!present.every(Boolean)) throw fail('configuration_invalid', 'Set HOWEN_VSS_BASE_URL, HOWEN_VSS_USERNAME and HOWEN_VSS_PASSWORD together.', 503);
  let base;
  try { base = new URL(env.HOWEN_VSS_BASE_URL.trim()); } catch { throw fail('configuration_invalid', 'HOWEN_VSS_BASE_URL must be a valid HTTP or HTTPS server URL.', 503); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || !base.hostname) {
    throw fail('configuration_invalid', 'HOWEN_VSS_BASE_URL must be an HTTP or HTTPS URL without credentials, query parameters or fragments.', 503);
  }
  return {
    configured: true,
    baseUrl: base.toString().replace(/\/+$/, ''),
    username: env.HOWEN_VSS_USERNAME.trim(),
    password: env.HOWEN_VSS_PASSWORD,
    utcOffsetMinutes: limit(env.HOWEN_VSS_UTC_OFFSET_MIN, 'HOWEN_VSS_UTC_OFFSET_MIN', -840, 840, 420),
    timeoutMs: limit(env.HOWEN_VSS_TIMEOUT_MS, 'HOWEN_VSS_TIMEOUT_MS', 100, 120000, 12000),
    maxResponseBytes: limit(env.HOWEN_VSS_MAX_RESPONSE_BYTES, 'HOWEN_VSS_MAX_RESPONSE_BYTES', 1024, 64 * 1024 * 1024, 16 * 1024 * 1024),
    sessionTtlMs: 8 * 60_000,
    loginCooldownMs: 3 * 60_000,
  };
}

function redactString(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try { return JSON.stringify(redactVssData(JSON.parse(value))); } catch { /* Not embedded JSON. */ }
  }
  return value.replace(/https?:\/\/[^\s<>"']+/gi, (candidate) => {
    try {
      const url = new URL(candidate);
      if (url.username) url.username = REDACTED;
      if (url.password) url.password = REDACTED;
      for (const key of [...url.searchParams.keys()]) if (sensitiveKey.test(key)) url.searchParams.set(key, REDACTED);
      if (/token|secret|password|credential|authorization/i.test(url.hash)) url.hash = REDACTED;
      return url.toString();
    } catch { return REDACTED; }
  });
}

/** Preserve unknown VSS diagnostics while removing nested and embedded credentials. */
export function redactVssData(value) {
  const seen = new WeakSet();
  function visit(item, depth) {
    if (depth > 40) return '[maximum depth]';
    if (typeof item === 'string') return redactString(item);
    if (item === null || typeof item !== 'object') return item;
    if (seen.has(item)) return '[circular]';
    seen.add(item);
    const result = Array.isArray(item) ? item.map((v) => visit(v, depth + 1)) : Object.fromEntries(Object.entries(item).map(([key, val]) => [key, sensitiveKey.test(key) ? REDACTED : visit(val, depth + 1)]));
    seen.delete(item);
    return result;
  }
  return visit(value, 0);
}

/** Parse VSS wall-clock strings independently of the host OS timezone. */
export function parseVssTime(value, utcOffsetMinutes = 420) {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10}(?:\d{3})?$/.test(value.trim()))) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    const epoch = n < 100_000_000_000 ? n * 1000 : n;
    const date = new Date(epoch);
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const source = value.trim();
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(source);
  if (local) {
    const [, year, month, day, hour, minute, second, fraction = ''] = local;
    const utc = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second, +(fraction.padEnd(3, '0')));
    const date = new Date(utc);
    if (date.getUTCFullYear() !== +year || date.getUTCMonth() !== +month - 1 || date.getUTCDate() !== +day || date.getUTCHours() !== +hour || date.getUTCMinutes() !== +minute || date.getUTCSeconds() !== +second) return null;
    return new Date(utc - utcOffsetMinutes * 60_000).toISOString();
  }
  // Unqualified Date.parse() would silently use the Windows server timezone.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(source)) return null;
  const [year, month, day] = source.slice(0, 10).split('-').map(Number);
  const calendarDay = new Date(Date.UTC(year, month - 1, day));
  if (calendarDay.getUTCFullYear() !== year || calendarDay.getUTCMonth() !== month - 1 || calendarDay.getUTCDate() !== day) return null;
  const date = new Date(source);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function canonicalInstant(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.valueOf();
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) throw fail('request_invalid', 'VSS alarm windows require ISO timestamps with an explicit timezone.', 400);
  const parsed = parseVssTime(value);
  if (!parsed) throw fail('request_invalid', 'VSS alarm window timestamp is invalid.', 400);
  return Date.parse(parsed);
}
function formatVssTime(instant, offset) { return new Date(instant + offset * 60_000).toISOString().slice(0, 19).replace('T', ' '); }

function pageResult(json, requestedPage, requestedSize) {
  const data = object(json.data);
  if (!Array.isArray(data.dataList) || data.dataList.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw fail('response_invalid', 'VSS returned an invalid record list.');
  }
  const records = data.dataList;
  const reportedPage = integer(data.pageNum);
  if (reportedPage !== null && reportedPage !== requestedPage) throw fail('pagination_invalid', 'VSS returned a different page than requested.');
  const declaredTotal = data.totalCount ?? json.count;
  const total = declaredTotal === undefined || declaredTotal === null ? null : integer(declaredTotal);
  if (declaredTotal !== undefined && declaredTotal !== null && (total === null || total < 0)) throw fail('pagination_invalid', 'VSS returned an invalid record count.');
  const size = integer(data.pageCount) ?? requestedSize;
  if (size < 1 || size > requestedSize || records.length > size) throw fail('pagination_invalid', 'VSS returned an inconsistent page size.');
  const offset = integer(data.fromCount) ?? (requestedPage - 1) * size;
  if (offset !== (requestedPage - 1) * size) throw fail('pagination_invalid', 'VSS returned an inconsistent page offset.');
  if (total !== null && (offset + records.length > total || (records.length === 0 && offset < total))) throw fail('pagination_invalid', 'VSS record count disagrees with the returned page.');
  if (records.length < size && total !== null && offset + records.length < total) throw fail('pagination_invalid', 'VSS returned an incomplete page before the end of the results.');
  return { records, total, hasMore: total === null ? records.length === size : offset + records.length < total };
}

/** One persistent collector owns this client, its session and login cooldown. */
export function createVssClient({ configuration, fetchImpl = globalThis.fetch, now = Date.now }) {
  if (!configuration?.configured) throw fail('not_configured', 'VSS connection is not configured.', 503);
  const config = { timeoutMs: 12000, maxResponseBytes: 16 * 1024 * 1024, sessionTtlMs: 480000, loginCooldownMs: 180000, utcOffsetMinutes: 420, ...configuration };
  let session = null;
  let loginPending = null;
  let cooldownUntil = 0;

  async function request(path, body) {
    const controller = new AbortController();
    let timer;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(fail('timeout', 'VSS request timed out.')); }, config.timeoutMs);
    });
    try {
      return await Promise.race([expired, (async () => {
        const response = await fetchImpl(`${config.baseUrl}${path}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body), signal: controller.signal, redirect: 'manual', cache: 'no-store',
        });
        if (response.redirected || (response.status >= 300 && response.status < 400)) throw fail('redirect_rejected', 'VSS redirected a credential-bearing request; update the configured server URL.');
        if (!response.ok) throw fail('upstream_http', `VSS returned HTTP ${response.status}.`);
        const declaredLength = Number(response.headers?.get?.('content-length'));
        if (declaredLength > config.maxResponseBytes) { controller.abort(); throw fail('response_too_large', 'VSS response exceeds the configured size limit.'); }
        let text;
        if (response.body?.getReader) {
          const reader = response.body.getReader();
          const chunks = [];
          let length = 0;
          try {
            for (;;) {
              const next = await reader.read();
              if (next.done) break;
              length += next.value.byteLength;
              if (length > config.maxResponseBytes) { controller.abort(); await reader.cancel().catch(() => {}); throw fail('response_too_large', 'VSS response exceeds the configured size limit.'); }
              chunks.push(Buffer.from(next.value));
            }
            text = Buffer.concat(chunks, length).toString('utf8');
          } finally { reader.releaseLock(); }
        } else {
          text = await response.text();
          if (Buffer.byteLength(text) > config.maxResponseBytes) throw fail('response_too_large', 'VSS response exceeds the configured size limit.');
        }
        let json;
        try { json = JSON.parse(text); } catch { throw fail('response_invalid', 'VSS returned invalid JSON.'); }
        if (!json || typeof json !== 'object' || Array.isArray(json) || integer(json.status) === null) throw fail('response_invalid', 'VSS returned an invalid API response.');
        return json;
      })()]);
    } catch (error) {
      if (error instanceof VssClientError) throw error;
      // Fetch errors and server messages may include URLs, credentials or response bodies.
      throw fail(controller.signal.aborted ? 'timeout' : 'network_error', controller.signal.aborted ? 'VSS request timed out.' : 'Unable to reach the configured VSS server.');
    } finally { clearTimeout(timer); }
  }

  async function login() {
    if (session && now() - session.at < config.sessionTtlMs) return session.token;
    if (loginPending) return loginPending;
    if (now() < cooldownUntil) throw fail('login_cooldown', 'VSS login is temporarily paused after a failed attempt.', 503);
    loginPending = (async () => {
      try {
        const json = await request('/vss/user/login.action', { username: config.username, password: config.password });
        const token = typeof json.data?.token === 'string' ? json.data.token : null;
        if (Number(json.status) !== SUCCESS || !token) throw fail('login_failed', `VSS login was rejected (status ${integer(json.status)}).`, 503);
        session = { token, at: now() };
        cooldownUntil = 0;
        return token;
      } catch (error) { session = null; cooldownUntil = now() + config.loginCooldownMs; throw error; }
    })();
    try { return await loginPending; } finally { loginPending = null; }
  }

  async function authedPost(path, body) {
    let token = await login();
    let json = await request(path, { ...body, token });
    if (Number(json.status) === SESSION_EXPIRED) {
      // Another concurrent request may already have refreshed this token.
      if (session?.token === token) session = null;
      token = await login();
      json = await request(path, { ...body, token });
    }
    if (Number(json.status) !== SUCCESS) {
      if (Number(json.status) === SESSION_EXPIRED) { if (session?.token === token) session = null; cooldownUntil = now() + config.loginCooldownMs; }
      throw fail('api_rejected', `VSS rejected the data request (status ${integer(json.status)}).`);
    }
    return json;
  }

  return {
    async fetchCatalog({ pageSize = 500, maxPages = 200 } = {}) {
      pageSize = limit(pageSize, 'pageSize', 1, 500, 500);
      maxPages = limit(maxPages, 'maxPages', 1, 200, 200);
      const all = [];
      const fingerprints = new Set();
      const deviceIds = new Set();
      let expectedTotal;
      for (let page = 1; page <= maxPages; page++) {
        const json = await authedPost('/vss/vehicle/findAll.action', { pageNum: page, pageCount: pageSize });
        const result = pageResult(json, page, pageSize);
        if (expectedTotal !== undefined && expectedTotal !== result.total) throw fail('pagination_changed', 'VSS catalog changed while paging; the next collection must retry the complete catalog.');
        expectedTotal = result.total;
        const fingerprint = createHash('sha256').update(JSON.stringify(result.records)).digest('hex');
        if (result.records.length && fingerprints.has(fingerprint)) throw fail('pagination_repeated', 'VSS repeated a catalog page.');
        fingerprints.add(fingerprint);
        for (const row of result.records) {
          const id = string(row.deviceno);
          if (id && deviceIds.has(id)) throw fail('pagination_repeated', 'VSS repeated a device while paging the catalog.');
          if (id) deviceIds.add(id);
          all.push(row);
        }
        if (!result.hasMore) {
          if (result.total !== null && all.length !== result.total) throw fail('pagination_invalid', 'VSS catalog was incomplete.');
          return all;
        }
      }
      throw fail('pagination_limit', 'VSS catalog exceeds the configured page limit; no partial catalog was accepted.');
    },
    async fetchAlarmPage({ from, to, page = 1, pageSize = 500 }) {
      page = limit(page, 'page', 1, 1000000, 1);
      pageSize = limit(pageSize, 'pageSize', 1, 500, 500);
      const start = canonicalInstant(from);
      const end = canonicalInstant(to);
      if (end < start) throw fail('request_invalid', 'VSS alarm window end must not precede its start.', 400);
      const json = await authedPost('/vss/alarm/findAllByTime.action', {
        beginTime: formatVssTime(start, config.utcOffsetMinutes), endTime: formatVssTime(end, config.utcOffsetMinutes), pageNum: page, pageSize,
      });
      return pageResult(json, page, pageSize);
    },
  };
}

function embeddedObject(value, warnings, field) {
  if (value === null || value === undefined || value === '') return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const result = JSON.parse(value); if (result && typeof result === 'object' && !Array.isArray(result)) return result; } catch { /* Report malformed source. */ }
  }
  warnings.push(`${field} is not a valid JSON object.`);
  return {};
}
function parseMask(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value !== 'string' || !/^(?:0x)?[0-9a-f]{1,16}$/i.test(value.trim())) return null;
  return BigInt(`0x${value.trim().replace(/^0x/i, '')}`);
}
function deviceIdOf(row) { return string(row.deviceno) ?? string(row.deviceID) ?? string(row.deviceId); }

export function normalizeVssDevice(row, { receivedAt = new Date().toISOString(), utcOffsetMinutes = 420, inputMappings = [] } = {}) {
  row = object(row);
  const deviceId = deviceIdOf(row);
  if (!deviceId) return null;
  const warnings = [];
  const status = embeddedObject(row.lastStatusJson, warnings, 'lastStatusJson');
  const state = embeddedObject(row.lastStateJson, warnings, 'lastStateJson');
  const basic = object(status.basic);
  const ext = object(status.ext);
  const location = object(status.location);
  const observedAt = parseVssTime(ext.reportTime, utcOffsetMinutes) ?? parseVssTime(status.dtu, utcOffsetMinutes) ?? parseVssTime(row.dtu, utcOffsetMinutes);
  const gpsAt = parseVssTime(location.dtu, utcOffsetMinutes) ?? parseVssTime(row.dtu, utcOffsetMinutes);
  if (!observedAt) warnings.push('Device observation timestamp is missing or invalid; freshness is unknown.');
  if (!gpsAt) warnings.push('GPS observation timestamp is missing or invalid; freshness is unknown.');
  const latitude = number(location.latitude ?? row.latitude);
  const longitude = number(location.longitude ?? row.longitude);
  const valid = latitude !== null && longitude !== null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && (latitude !== 0 || longitude !== 0);
  const rawSpeed = number(location.speed ?? row.speed);
  const rawHeading = number(location.direct ?? row.direct);
  const rawSatellites = integer(location.satellites ?? row.satellites);
  const inputMaskRaw = object(status.alarm).input;
  const inputMask = parseMask(inputMaskRaw);
  if (inputMaskRaw !== undefined && inputMaskRaw !== null && inputMask === null) warnings.push('VSS input alarm mask is invalid; input states are unknown.');
  const count = integer(row.inputnumber ?? basic.inputnumber);
  const channels = new Set();
  if (count !== null && count >= 0 && count <= 64) for (let channel = 1; channel <= count; channel++) channels.add(channel);
  const mappings = new Map();
  for (const mapping of Array.isArray(inputMappings) ? inputMappings : []) {
    if (Number.isInteger(mapping.channel) && mapping.channel >= 1 && mapping.channel <= 64) { channels.add(mapping.channel); mappings.set(mapping.channel, mapping); }
  }
  if (inputMask !== null) for (let channel = 1; channel <= 64; channel++) if (inputMask & (1n << BigInt(channel - 1))) channels.add(channel);
  if (inputMask !== null && (count === null || count < 0 || count > 64)) warnings.push('VSS input channel count is unavailable; only mapped or active channels are shown.');
  const inputs = [...channels].sort((a, b) => a - b).map((channel) => {
    const mapping = mappings.get(channel);
    return { channel, label: redactString(string(mapping?.label) ?? `Input ${channel}`), active: inputMask === null ? null : Boolean(inputMask & (1n << BigInt(channel - 1))), purpose: mapping?.purpose ?? null, verified: mapping?.verified === true, signalKind: 'configured_alarm', observedAt };
  });
  if (inputMask !== null) warnings.push('Input values are configured VSS alarm states, not raw electrical levels or proof of PTO activity.');
  // Generic "status", online/offline timestamps and ACC do not establish connection state.
  const onlineValues = [row.online, row.isOnline, state.online, state.isOnline].map(exactBoolean).filter((v) => v !== null);
  const connected = onlineValues.length && onlineValues.every((v) => v === onlineValues[0]) ? onlineValues[0] : null;
  const ignition = basic.key === 1 || basic.key === '1' ? true : basic.key === 0 || basic.key === '0' ? false : null;
  return {
    deviceId,
    vehicleNumber: redactString(string(row.plateno) ?? string(row.plateNo) ?? string(row.devicename) ?? string(row.deviceName) ?? deviceId),
    model: string(row.deviceModel) ?? string(row.devicetype), firmware: string(row.appVersion), connected,
    lastSeenAt: observedAt, telemetryReceivedAt: observedAt, gpsReceivedAt: gpsAt, fetchedAt: parseVssTime(receivedAt, utcOffsetMinutes),
    telemetry: {
      gps: { valid, latitude, longitude, speedKph: rawSpeed !== null && rawSpeed >= 0 ? rawSpeed : null, heading: rawHeading !== null && rawHeading >= 0 && rawHeading <= 360 ? rawHeading : null, satellites: rawSatellites !== null && rawSatellites >= 0 ? rawSatellites : null, capturedAt: gpsAt },
      ignition, inputs,
      diagnostics: redactVssData({ ...status, inputMask: inputMaskRaw ?? null, inputCount: count, totalMileageMeters: number(row.totalmileage), lastOnlineAt: parseVssTime(row.lastonlinetime, utcOffsetMinutes), lastOfflineAt: parseVssTime(row.lastofflinetime, utcOffsetMinutes), state }),
    },
    raw: redactVssData(row), warnings, rule: null,
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function normalizeVssAlarm(row, { receivedAt = new Date().toISOString(), utcOffsetMinutes = 420 } = {}) {
  row = object(row);
  const deviceId = deviceIdOf(row);
  if (!deviceId) return null;
  const warnings = [];
  const occurredAt = parseVssTime(row.reportTime, utcOffsetMinutes) ?? parseVssTime(row.createtime, utcOffsetMinutes);
  const endedAt = parseVssTime(row.endTime, utcOffsetMinutes);
  if (!occurredAt) warnings.push('Alarm observation timestamp is missing or invalid; it cannot establish a current activity.');
  const alarmType = integer(row.alarmtype);
  const alarmState = integer(row.alarmState);
  const raw = redactVssData(row);
  const guid = string(row.guid);
  const identity = guid ? { deviceId, guid, alarmType, alarmState: row.alarmState ?? null, occurredAt, endedAt, reportTime: row.reportTime ?? null, endTime: row.endTime ?? null, alarmvalue: row.alarmvalue ?? null } : { deviceId, raw };
  if (!guid) warnings.push('Alarm has no VSS GUID; event identity is derived from its payload.');
  const id = `vss-alarm-${createHash('sha256').update(stableJson(identity)).digest('hex')}`;
  const label = string(row.alarmTypeValue) ?? (alarmType === null ? 'Unknown alarm' : `Alarm ${alarmType}`);
  const parameters = embeddedObject(row.paraJson, warnings, 'paraJson');
  return {
    id, deviceId, receivedAt: parseVssTime(receivedAt, utcOffsetMinutes), occurredAt, endedAt,
    kind: 'alarm', direction: 'inbound', summary: redactString(`${label}${alarmState === null ? '' : ` · state ${alarmState}`}`), alarmType, alarmState,
    fenceId: string(row.fenceId), fenceName: string(row.fenceName),
    decoded: redactVssData({ ...row, paraJson: parameters, occurredAt, endedAt }), raw, warnings,
  };
}
