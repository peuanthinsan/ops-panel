const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BASE_URL = 'https://www.data-fm.com';

let tokenCache = null;
let tokenRequest = null;
const driverIdentityCache = new Map();

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

async function responseJson(response) {
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) throw new Error('Data-FM response is too large.');
  try { return JSON.parse(body || '{}'); } catch { throw new Error('Data-FM returned invalid JSON.'); }
}

function endpoint(baseUrl, pathname) {
  return new URL(pathname, baseUrl);
}

function cacheKey(config) {
  return `${config.baseUrl.origin}\0${config.username}`;
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
    6: 'Data-FM returned no GPS records.',
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
  if (!config.configured) return { status: 'not_configured', payload: null, message: 'Data-FM GPS adapter is not configured.' };
  if (config.error) return { status: 'unavailable', payload: null, message: config.error };
  const targetMs = Date.parse(String(targetAt || ''));
  const windowMs = Number(toleranceMs);
  if (!vehicleNumber || !Number.isFinite(targetMs) || !Number.isFinite(windowMs) || windowMs < 0 || windowMs * 2 > MAX_HISTORY_WINDOW_MS) {
    return { status: 'unavailable', payload: null, message: 'Data-FM history request parameters are invalid.' };
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
    if (result.error) return { status: 'unavailable', payload: null, message: result.error };
    if (result.code === 6) return { status: 'received', payload: { positions: [] }, message: dataFmStatusMessage(6) };
    if (result.code !== 0) return { status: 'unavailable', payload: null, message: dataFmStatusMessage(result.code) };
    const positions = responseRows(result.payload)
      .map(row => normalizeDataFmHistoryRecord(row, config.timeZone))
      .filter(Boolean);
    return {
      status: 'received',
      payload: { positions },
      message: `Data-FM returned ${positions.length} normalized GPS record${positions.length === 1 ? '' : 's'}.`,
    };
  } catch (error) {
    return {
      status: 'unavailable',
      payload: null,
      message: error instanceof Error ? error.message : 'Data-FM GPS API unavailable.',
    };
  }
}

export function dataFmDriverIdentity(payload) {
  const positions = Array.isArray(payload?.positions) ? payload.positions : [];
  const matched = [...positions]
    .filter(point => point?.driverId || point?.driverName)
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))[0];
  if (!matched) return null;
  return {
    driverId: matched.driverId || null,
    driverName: matched.driverName || matched.driverId || null,
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
    driverIdentity: history.status === 'received' ? dataFmDriverIdentity(history.payload) : null,
    message: history.message,
  };
  driverIdentityCache.set(key, { result, expiresAt: nowMs + 30_000 });
  return result;
}

export function resetDataFmTokenCacheForTests() {
  tokenCache = null;
  tokenRequest = null;
  driverIdentityCache.clear();
}
