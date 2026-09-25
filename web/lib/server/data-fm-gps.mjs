const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const VEHICLE_MASTER_LIFETIME_MS = 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_FUEL_WINDOW_MS = 7 * MAX_HISTORY_WINDOW_MS;
const MAX_FUEL_RESPONSE_BYTES = 8 * 1024 * 1024;
const FUEL_CACHE_LIFETIME_MS = 30_000;
const MAX_FUEL_CACHE_ENTRIES = 32;
const DEFAULT_BASE_URL = 'https://www.data-fm.com';

let tokenCache = null;
let tokenRequest = null;
let vehicleMasterCache = null;
let vehicleMasterRequest = null;
const driverIdentityCache = new Map();
const fuelHistoryCache = new Map();
const fuelHistoryRequests = new Map();

function objectRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function aliasValue(value, aliases) {
  const source = objectRecord(value);
  if (!source) return null;
  const normalized = new Map(Object.entries(source).map(([key, entry]) => [key.toLowerCase(), entry]));
  for (const alias of aliases) {
    if (normalized.has(alias.toLowerCase())) return normalized.get(alias.toLowerCase());
  }
  return null;
}

function responseCode(payload) {
  const code = Number(aliasValue(payload, ['vResponseCode', 'responseCode']));
  return Number.isFinite(code) ? code : null;
}

function responseRows(payload) {
  let value = aliasValue(payload, ['vData', 'data']);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '[]') return [];
    try { value = JSON.parse(trimmed); } catch { return []; }
  }
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalString(value) {
  if (value == null) return null;
  const parsed = String(value).trim();
  return parsed || null;
}

function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA-u-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date)
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function timezoneOffsetMs(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    - Math.floor(date.getTime() / 1000) * 1000;
}

export function formatDataFmDateTime(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  let parts;
  try { parts = zonedParts(date, timeZone); } catch { return null; }
  const pad = number => String(number).padStart(2, '0');
  return `${parts.year}.${pad(parts.month)}.${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

export function parseDataFmDateTime(value, timeZone) {
  const match = String(value || '').trim().match(/^(\d{4})\.(\d{2})\.(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  try {
    let normalizedMs = localAsUtc - timezoneOffsetMs(new Date(localAsUtc), timeZone);
    normalizedMs = localAsUtc - timezoneOffsetMs(new Date(normalizedMs), timeZone);
    const normalized = new Date(normalizedMs);
    return formatDataFmDateTime(normalized, timeZone) === String(value).trim()
      ? normalized.toISOString()
      : null;
  } catch {
    return null;
  }
}

export function normalizeDataFmHistoryRecord(value, timeZone) {
  const row = objectRecord(value);
  if (!row) return null;
  const sourceTimestampText = optionalString(aliasValue(row, ['tracktime', 'timeoffix']));
  const capturedAt = parseDataFmDateTime(sourceTimestampText, timeZone);
  const latitude = finiteNumber(aliasValue(row, ['latitude', 'lat']));
  const longitude = finiteNumber(aliasValue(row, ['longitude', 'lng', 'lon']));
  if (!capturedAt || latitude == null || latitude < -90 || latitude > 90
    || longitude == null || longitude < -180 || longitude > 180) return null;
  return {
    capturedAt,
    latitude,
    longitude,
    speedKph: finiteNumber(aliasValue(row, ['speed'])),
    headingDegrees: finiteNumber(aliasValue(row, ['bearing'])),
    vehicleNumber: optionalString(aliasValue(row, ['vehicleno'])),
    driverId: optionalString(aliasValue(row, ['driverrfid'])),
    driverName: optionalString(aliasValue(row, ['drivername'])),
    unitNumber: optionalString(aliasValue(row, ['unitno'])),
    sourceTimestampText,
    sourceTimeZone: timeZone,
    raw: row,
  };
}

function configuration(input = {}) {
  const baseUrl = String(input.baseUrl || DEFAULT_BASE_URL).trim();
  const username = String(input.username || '').trim();
  const password = String(input.password || '');
  const timeZone = String(input.timeZone || '').trim();
  if (!username || !password || !timeZone) return { configured: false };
  let parsedBaseUrl;
  try { parsedBaseUrl = new URL(baseUrl); } catch { return { configured: true, error: 'Data-FM base URL is invalid.' }; }
  if (!['http:', 'https:'].includes(parsedBaseUrl.protocol)) {
    return { configured: true, error: 'Data-FM base URL must use HTTP or HTTPS.' };
  }
  if (parsedBaseUrl.protocol !== 'https:' && !input.allowHttp) {
    return { configured: true, error: 'Data-FM credentials require HTTPS in production.' };
  }
  if (!formatDataFmDateTime(new Date(0), timeZone)) {
    return { configured: true, error: 'Data-FM source timezone is invalid.' };
  }
  return { configured: true, baseUrl: parsedBaseUrl, username, password, timeZone };
}

async function responseJson(response, maxBytes = MAX_RESPONSE_BYTES) {
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) throw new Error('Data-FM response is too large.');
  try { return JSON.parse(body || '{}'); } catch { throw new Error('Data-FM returned invalid JSON.'); }
}

function endpoint(baseUrl, pathname) {
  return new URL(pathname, baseUrl);
}

function cacheKey(config) {
  return `${config.baseUrl.origin}\0${config.username}\0${config.password}`;
}

async function requestToken(config, fetchImpl, nowMs, timeoutMs) {
  const url = endpoint(config.baseUrl, '/Api/VTService.svc/GetToken');
  url.searchParams.set('username', config.username);
  url.searchParams.set('Password', config.password);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Data-FM token endpoint returned HTTP ${response.status}.`);
  const payload = await responseJson(response);
  const code = responseCode(payload);
  const token = optionalString(aliasValue(payload, ['token', 'jtoken']));
  if (code !== 0 || !token) throw new Error(`Data-FM authentication failed with response code ${code ?? 'unknown'}.`);
  tokenCache = {
    key: cacheKey(config),
    token,
    expiresAt: nowMs + TOKEN_LIFETIME_MS - TOKEN_REFRESH_MARGIN_MS,
  };
  return token;
}

async function dataFmToken(config, fetchImpl, nowMs, timeoutMs, forceRefresh = false) {
  const key = cacheKey(config);
  if (!forceRefresh && tokenCache?.key === key && tokenCache.expiresAt > nowMs) return tokenCache.token;
  if (!forceRefresh && tokenRequest?.key === key) return tokenRequest.promise;
  const promise = requestToken(config, fetchImpl, nowMs, timeoutMs);
  tokenRequest = { key, promise };
  try { return await promise; }
  finally { if (tokenRequest?.promise === promise) tokenRequest = null; }
}

function dataFmStatusMessage(code) {
  const messages = {
    1: 'Data-FM token was rejected.',
    2: 'Data-FM rejected the request parameters.',
    3: 'Data-FM rejected a history window longer than 24 hours.',
    4: 'Data-FM reported a system exception.',
    5: 'Data-FM rejected the integration login.',
    6: 'No GPS records were found.',
    7: 'Data-FM request limit was exceeded.',
  };
  return messages[code] || `Data-FM returned response code ${code ?? 'unknown'}.`;
}

async function historyRequest({ config, fetchImpl, token, vehicleNumber, fromAt, toAt, timeoutMs }) {
  const url = endpoint(config.baseUrl, '/Api/VTService.svc/GetVehicleHistory');
  url.searchParams.set('jtoken', token);
  url.searchParams.set('vehicleno', vehicleNumber);
  url.searchParams.set('fromdatetime', formatDataFmDateTime(fromAt, config.timeZone));
  url.searchParams.set('todatetime', formatDataFmDateTime(toAt, config.timeZone));
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) return { code: null, payload: null, error: `Data-FM history endpoint returned HTTP ${response.status}.` };
  const payload = await responseJson(response);
  return { code: responseCode(payload), payload, error: null };
}

function normalizedVehicleLookupKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

async function requestVehicleMaster(config, fetchImpl, token, timeoutMs) {
  const url = endpoint(config.baseUrl, '/Api/VTService.svc/GetMasterVehicleList');
  url.searchParams.set('jtoken', token);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Data-FM vehicle master endpoint returned HTTP ${response.status}.`);
  const payload = await responseJson(response);
  const code = responseCode(payload);
  if (code !== 0) throw new Error(dataFmStatusMessage(code));
  const canonicalVehicles = new Map();
  for (const row of responseRows(payload)) {
    const vehicleNumber = optionalString(aliasValue(row, ['vehicleno']));
    const key = normalizedVehicleLookupKey(vehicleNumber);
    if (!vehicleNumber || !key) continue;
    const existing = canonicalVehicles.get(key);
    canonicalVehicles.set(key, existing && existing !== vehicleNumber ? null : vehicleNumber);
  }
  return canonicalVehicles;
}

async function canonicalDataFmVehicleNumber(config, fetchImpl, token, vehicleNumber, nowMs, timeoutMs) {
  const key = cacheKey(config);
  let vehicles = vehicleMasterCache?.key === key && vehicleMasterCache.expiresAt > nowMs
    ? vehicleMasterCache.vehicles
    : null;
  if (!vehicles) {
    if (vehicleMasterRequest?.key === key) vehicles = await vehicleMasterRequest.promise;
    else {
      const promise = requestVehicleMaster(config, fetchImpl, token, timeoutMs);
      vehicleMasterRequest = { key, promise };
      try { vehicles = await promise; }
      finally { if (vehicleMasterRequest?.promise === promise) vehicleMasterRequest = null; }
      vehicleMasterCache = { key, vehicles, expiresAt: nowMs + VEHICLE_MASTER_LIFETIME_MS };
    }
  }
  return vehicles.get(normalizedVehicleLookupKey(vehicleNumber)) || null;
}

export async function fetchDataFmGpsHistory({
  baseUrl,
  username,
  password,
  timeZone,
  allowHttp = false,
  vehicleNumber,
  targetAt,
  toleranceMs,
  fetchImpl = globalThis.fetch,
  nowMs = Date.now(),
  timeoutMs = 8_000,
} = {}) {
  const config = configuration({ baseUrl, username, password, timeZone, allowHttp });
  if (!config.configured) return { status: 'not_configured', payload: null, driverIdentity: null, message: 'Data-FM GPS adapter is not configured.' };
  if (config.error) return { status: 'unavailable', payload: null, driverIdentity: null, message: config.error };
  const targetMs = Date.parse(String(targetAt || ''));
  const windowMs = Number(toleranceMs);
  if (!vehicleNumber || !Number.isFinite(targetMs) || !Number.isFinite(windowMs) || windowMs < 0 || windowMs * 2 > MAX_HISTORY_WINDOW_MS) {
    return { status: 'unavailable', payload: null, driverIdentity: null, message: 'Data-FM history request parameters are invalid.' };
  }
  const fromAt = new Date(targetMs - windowMs);
  const toAt = new Date(targetMs + windowMs);
  try {
    let token = await dataFmToken(config, fetchImpl, nowMs, timeoutMs);
    let result = await historyRequest({ config, fetchImpl, token, vehicleNumber, fromAt, toAt, timeoutMs });
    if (result.code === 1) {
      if (tokenCache?.key === cacheKey(config)) tokenCache = null;
      token = await dataFmToken(config, fetchImpl, nowMs, timeoutMs, true);
      result = await historyRequest({ config, fetchImpl, token, vehicleNumber, fromAt, toAt, timeoutMs });
    }
    if (result.code === 6) {
      const canonicalVehicleNumber = await canonicalDataFmVehicleNumber(config, fetchImpl, token, vehicleNumber, nowMs, timeoutMs);
      if (canonicalVehicleNumber && canonicalVehicleNumber !== vehicleNumber) {
        result = await historyRequest({ config, fetchImpl, token, vehicleNumber: canonicalVehicleNumber, fromAt, toAt, timeoutMs });
      }
    }
    if (result.error) return { status: 'unavailable', payload: null, driverIdentity: null, message: result.error };
    if (result.code === 6) return { status: 'received', payload: { positions: [] }, driverIdentity: null, message: dataFmStatusMessage(6) };
    if (result.code !== 0) return { status: 'unavailable', payload: null, driverIdentity: null, message: dataFmStatusMessage(result.code) };
    const positions = responseRows(result.payload)
      .map(row => normalizeDataFmHistoryRecord(row, config.timeZone))
      .filter(Boolean);
    const payload = { positions };
    return {
      status: 'received',
      payload,
      driverIdentity: dataFmDriverIdentity(payload),
      message: `${positions.length} GPS record${positions.length === 1 ? '' : 's'} found.`,
    };
  } catch (error) {
    return {
      status: 'unavailable',
      payload: null,
      driverIdentity: null,
      message: error instanceof Error ? error.message : 'Data-FM GPS API unavailable.',
    };
  }
}

export function parseDataFmFuelDateTime(value, timeZone) {
  const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, day, month, year, hour, minute, second] = match;
  return parseDataFmDateTime(`${year}.${month}.${day} ${hour.padStart(2, '0')}:${minute}:${second}`, timeZone);
}

function nonnegativeFuelNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function fuelResult(status, message, samples = []) {
  return { status, samples, message, source: 'data-fm', fuelUnit: null };
}

function fuelResponseCode(payload) {
  const value = aliasValue(payload, ['vResponseCode', 'responseCode']);
  const code = nonnegativeFuelNumber(value);
  return Number.isSafeInteger(code) ? code : null;
}

function completeFuelRows(payload) {
  let rows = aliasValue(payload, ['vData', 'data']);
  if (typeof rows === 'string') {
    try { rows = JSON.parse(rows); } catch { return null; }
  }
  const total = nonnegativeFuelNumber(aliasValue(payload, ['vTotalRecords', 'totalRecords']));
  if (!Array.isArray(rows) || !Number.isSafeInteger(total) || total !== rows.length) return null;
  return rows;
}

async function fuelHistoryRequest({ config, fetchImpl, token, vehicleNumber, fromMs, toMs, timeoutMs }) {
  const url = endpoint(config.baseUrl, '/Api/VTService.svc/GetFuelStatus');
  url.searchParams.set('jtoken', token);
  url.searchParams.set('vehicleno', vehicleNumber);
  url.searchParams.set('fromdatetime', formatDataFmDateTime(new Date(fromMs), config.timeZone));
  url.searchParams.set('todatetime', formatDataFmDateTime(new Date(toMs), config.timeZone));
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) return { code: null, error: `Data-FM fuel endpoint returned HTTP ${response.status}.` };
  const payload = await responseJson(response, MAX_FUEL_RESPONSE_BYTES);
  return { code: fuelResponseCode(payload), payload, error: null };
}

async function readFuelHistory({ config, fetchImpl, vehicleNumber, fromMs, toMs, nowMs, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  const remainingMs = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Fuel request timed out.');
    return remaining;
  };
  let token = await dataFmToken(config, fetchImpl, nowMs, remainingMs());
  let refreshedToken = false;
  let queryVehicleNumber = vehicleNumber;
  let canonicalLookupAttempted = false;
  const requestSegment = async (start, end) => {
    let response = await fuelHistoryRequest({ config, fetchImpl, token, vehicleNumber: queryVehicleNumber, fromMs: start, toMs: end, timeoutMs: remainingMs() });
    if (response.code === 1 && !refreshedToken) {
      refreshedToken = true;
      if (tokenCache?.key === cacheKey(config)) tokenCache = null;
      token = await dataFmToken(config, fetchImpl, nowMs, remainingMs(), true);
      response = await fuelHistoryRequest({ config, fetchImpl, token, vehicleNumber: queryVehicleNumber, fromMs: start, toMs: end, timeoutMs: remainingMs() });
    }
    return response;
  };
  const samples = new Map();
  // Inclusive provider windows share one boundary; deduplication keeps one point
  // per timestamp while every segment remains at most 24 hours.
  for (let start = fromMs; ;) {
    const end = Math.min(start + MAX_HISTORY_WINDOW_MS, toMs);
    let response = await requestSegment(start, end);
    if (response.code === 6 && completeFuelRows(response.payload)?.length === 0 && !canonicalLookupAttempted) {
      canonicalLookupAttempted = true;
      const canonicalVehicleNumber = await canonicalDataFmVehicleNumber(config, fetchImpl, token, vehicleNumber, nowMs, remainingMs());
      if (canonicalVehicleNumber && canonicalVehicleNumber !== queryVehicleNumber) {
        queryVehicleNumber = canonicalVehicleNumber;
        response = await requestSegment(start, end);
      }
    }
    if (response.error) return fuelResult('unavailable', response.error);
    if (response.code !== 0 && response.code !== 6) return fuelResult('unavailable', dataFmStatusMessage(response.code));
    const rows = completeFuelRows(response.payload);
    if (!rows || (response.code === 6 && rows.length !== 0)) {
      return fuelResult('unavailable', 'Data-FM did not return a complete fuel record list.');
    }
    for (const row of rows) {
      const capturedAt = parseDataFmFuelDateTime(aliasValue(row, ['datetime']), config.timeZone);
      const rowVehicle = optionalString(aliasValue(row, ['vehicleno']));
      if (!capturedAt || normalizedVehicleLookupKey(rowVehicle) !== normalizedVehicleLookupKey(queryVehicleNumber)) {
        return fuelResult('unavailable', 'Data-FM returned an invalid fuel record or a different vehicle.');
      }
      const capturedMs = Date.parse(capturedAt);
      // The API accepts whole seconds only. Filter any extra endpoint samples
      // against the original millisecond precision requested by the caller.
      if (capturedMs < fromMs || capturedMs > toMs) continue;
      samples.set(capturedAt, {
        id: `data-fm-fuel:${vehicleNumber}:${capturedAt}`,
        capturedAt,
        speedKph: nonnegativeFuelNumber(aliasValue(row, ['speed'])),
        totalFuel: nonnegativeFuelNumber(aliasValue(row, ['totalfuel'])),
      });
    }
    if (end >= toMs) break;
    start = end;
  }
  const sorted = [...samples.values()].sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
  return fuelResult('received', sorted.length ? `${sorted.length} fuel and speed records found.` : 'No fuel and speed records were found.', sorted);
}

export async function fetchDataFmFuelHistory({
  baseUrl,
  username,
  password,
  timeZone,
  allowHttp = false,
  vehicleNumber,
  fromAt,
  toAt,
  fetchImpl = globalThis.fetch,
  nowMs = Date.now(),
  timeoutMs = 20_000,
} = {}) {
  const config = configuration({ baseUrl, username, password, timeZone, allowHttp });
  if (!config.configured) return fuelResult('not_configured', 'Data-FM fuel adapter is not configured.');
  if (config.error) return fuelResult('unavailable', config.error);
  const fromMs = Date.parse(String(fromAt || ''));
  const toMs = Date.parse(String(toAt || ''));
  const vehicle = optionalString(vehicleNumber);
  if (!vehicle || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    return fuelResult('unavailable', 'Data-FM fuel request parameters are invalid.');
  }
  if (toMs - fromMs > MAX_FUEL_WINDOW_MS) return fuelResult('unavailable', 'Fuel and speed history supports a maximum of 7 days per request.');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) return fuelResult('unavailable', 'Data-FM fuel request timeout is invalid.');
  const budgetMs = Math.min(Math.floor(timeoutMs), 30_000);
  const key = `${cacheKey(config)}\0${config.timeZone}\0${vehicle}\0${fromMs}\0${toMs}`;
  for (const [cacheEntryKey, entry] of fuelHistoryCache) {
    if (entry.expiresAt <= nowMs) fuelHistoryCache.delete(cacheEntryKey);
  }
  const cached = fuelHistoryCache.get(key);
  if (cached) return cached.result;
  if (fuelHistoryRequests.has(key)) return fuelHistoryRequests.get(key);
  if (fuelHistoryRequests.size >= MAX_FUEL_CACHE_ENTRIES) return fuelResult('unavailable', 'Data-FM fuel history is busy. Please try again.');

  let timer;
  const timedOut = fuelResult('unavailable', 'Data-FM fuel history timed out. Please try again.');
  const pending = Promise.race([
    readFuelHistory({ config, fetchImpl, vehicleNumber: vehicle, fromMs, toMs, nowMs, timeoutMs: budgetMs })
      // Fetch errors may include credential-bearing URLs. Never expose them.
      .catch(() => fuelResult('unavailable', 'Data-FM fuel history is unavailable. Please try again.')),
    new Promise(resolve => { timer = setTimeout(() => resolve(timedOut), budgetMs); }),
  ]).then(result => {
    if (fuelHistoryCache.size >= MAX_FUEL_CACHE_ENTRIES) fuelHistoryCache.delete(fuelHistoryCache.keys().next().value);
    fuelHistoryCache.set(key, { result, expiresAt: nowMs + (result.status === 'received' ? FUEL_CACHE_LIFETIME_MS : 5_000) });
    return result;
  }).finally(() => {
    clearTimeout(timer);
    fuelHistoryRequests.delete(key);
  });
  fuelHistoryRequests.set(key, pending);
  return pending;
}

export function dataFmDriverIdentity(payload) {
  const positions = Array.isArray(payload?.positions) ? payload.positions : [];
  const matched = [...positions]
    .filter(point => point?.driverId || point?.driverName)
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))[0];
  if (!matched) return null;
  return {
    driverId: matched.driverId || null,
    driverName: matched.driverName || null,
  };
}

export async function fetchDataFmDriverIdentity(options = {}) {
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const key = `${String(options.baseUrl || DEFAULT_BASE_URL)}\0${String(options.username || '')}\0${String(options.vehicleNumber || '')}`;
  const cached = driverIdentityCache.get(key);
  if (cached?.expiresAt > nowMs) return cached.result;
  const halfWindowMs = 150_000;
  const history = await fetchDataFmGpsHistory({
    ...options,
    targetAt: new Date(nowMs - halfWindowMs).toISOString(),
    toleranceMs: halfWindowMs,
    nowMs,
  });
  const result = {
    status: history.status,
    driverIdentity: history.status === 'received' ? history.driverIdentity : null,
    message: history.message,
  };
  driverIdentityCache.set(key, { result, expiresAt: nowMs + 30_000 });
  return result;
}

export function resetDataFmTokenCacheForTests() {
  tokenCache = null;
  tokenRequest = null;
  vehicleMasterCache = null;
  vehicleMasterRequest = null;
  driverIdentityCache.clear();
  fuelHistoryCache.clear();
  fuelHistoryRequests.clear();
}
