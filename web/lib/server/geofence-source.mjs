import { createHash } from 'node:crypto';
import { redactVssData } from './vss-client.mjs';

const CACHE_MS = 60_000;
const AUTH_TTL_MS = 8 * 60_000;
const AUTH_COOLDOWN_MS = 3 * 60_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const TIMEOUT_MS = 12_000;
const FMS_PATH = '/SDFMSV20/';
const SOURCE_NAMES = { fms: 'Data-FM FMS (web)', 'data-fm': 'Data-FM FMS (API)' };

export class GeofenceSourceError extends Error {
  constructor(code, message, statusCode = 502) {
    super(message);
    this.name = 'GeofenceSourceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}
const fail = (code, message, status) => new GeofenceSourceError(code, message, status);
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const keyOf = value => String(value).toLowerCase().replace(/[\s_-]/g, '');
function field(value, aliases) {
  const source = record(value);
  if (!source) return undefined;
  const entries = new Map(Object.entries(source).map(([key, item]) => [keyOf(key), item]));
  for (const alias of aliases) if (entries.has(keyOf(alias))) return entries.get(keyOf(alias));
  return undefined;
}
function number(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'string' && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function integer(value) { const n = number(value); return Number.isSafeInteger(n) ? n : null; }
function string(value) {
  return typeof value === 'string' ? value.trim() || null : typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
}
function boolean(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}
function json(value, label) {
  let parsed = value;
  for (let depth = 0; typeof parsed === 'string' && depth < 3; depth++) {
    try { parsed = JSON.parse(parsed); } catch { throw fail('response_invalid', `${label} returned invalid JSON.`); }
  }
  return parsed;
}
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

// In addition to the shared redactor, remove complete header containers and any
// known credential values echoed under otherwise innocuous vendor field names.
function sanitize(value, secrets) {
  function visit(item) {
    if (typeof item === 'string') {
      if (/^\s*[\[{]/.test(item)) {
        try { return JSON.stringify(visit(JSON.parse(item))); } catch { /* Preserve non-JSON vendor text. */ }
      }
      let result = item;
      for (const secret of secrets) if (secret) result = result.split(secret).join('[redacted]');
      return result;
    }
    if (Array.isArray(item)) return item.map(visit);
    if (!record(item)) return item;
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, /headers?|cookies?/i.test(key) ? '[redacted]' : visit(child)]));
  }
  return visit(redactVssData(value));
}

function point(value) {
  const lat = number(field(value, ['lat', 'latitude']));
  const lng = number(field(value, ['lng', 'lon', 'longitude']));
  return lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? { lat, lng } : null;
}
function keyedPath(value, minimum) {
  if (!Array.isArray(value) || value.length < minimum) return null;
  const points = value.map(point);
  return points.every(Boolean) && new Set(points.map(p => `${p.lat},${p.lng}`)).size >= minimum ? points : null;
}
function geoJsonPath(value, polygon) {
  if (!Array.isArray(value)) return null;
  const points = value.map(pair => Array.isArray(pair) && pair.length >= 2 ? point({ lng: pair[0], lat: pair[1] }) : null);
  if (points.some(p => !p) || new Set(points.map(p => `${p.lat},${p.lng}`)).size < (polygon ? 3 : 2)) return null;
  if (polygon && (points.length < 4 || points[0].lat !== points.at(-1).lat || points[0].lng !== points.at(-1).lng)) return null;
  return points;
}
function shape(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}
function geometryFor(row) {
  const nested = shape(field(row, ['geometry', 'geojson']));
  const explicit = string(field(row, ['shapeType', 'geometryType', 'shape', 'type'])) || string(field(nested, ['type']));
  const typeName = explicit?.toLowerCase();
  const type = typeName === 'circle' ? 'circle' : typeName === 'polygon' ? 'polygon' : ['polyline', 'linestring'].includes(typeName) ? 'polyline' : 'unknown';
  const container = record(nested) || row;
  if (type === 'circle') {
    const center = point(field(container, ['center'])) || point(container) || point(row);
    const radiusMeters = number(field(container, ['radiusMeters', 'radius'])) ?? number(field(row, ['radiusMeters', 'radius']));
    return { type, geometry: center && radiusMeters !== null && radiusMeters > 0 ? { type, center, radiusMeters } : null };
  }
  const coordinates = shape(field(container, ['shapeCoordinates', 'paths', 'path', 'points', 'vertices', 'coordinates']) ?? field(row, ['shapeCoordinates', 'paths', 'path', 'points', 'vertices', 'coordinates']));
  // Only an explicitly typed GeoJSON object establishes [longitude, latitude].
  // Unlabelled numeric pairs and vendor coordinate strings remain unrendered.
  const geo = record(nested) || (['Polygon', 'LineString'].includes(row?.type) ? row : record(coordinates));
  if (geo?.type === 'Polygon' && Array.isArray(geo.coordinates)) {
    const paths = geo.coordinates.map(path => geoJsonPath(path, true));
    if (paths.length && paths.every(Boolean)) return { type: 'polygon', geometry: { type: 'polygon', paths } };
  }
  if (geo?.type === 'LineString') {
    const path = geoJsonPath(geo.coordinates, false);
    if (path) return { type: 'polyline', geometry: { type: 'polyline', path } };
  }
  if (type === 'polygon') {
    const single = keyedPath(coordinates, 3);
    const paths = single ? [single] : Array.isArray(coordinates) ? coordinates.map(path => keyedPath(path, 3)) : [];
    return { type, geometry: paths.length && paths.every(Boolean) ? { type, paths } : null };
  }
  if (type === 'polyline') {
    const path = keyedPath(coordinates, 2);
    return { type, geometry: path ? { type, path } : null };
  }
  return { type, geometry: null };
}

function normalizeRows(rows, source, headers, secrets) {
  const ids = new Map();
  return rows.map(original => {
    const raw = sanitize(original, secrets);
    const row = { ...(record(raw) || {}) };
    for (const header of headers) {
      const colid = string(header?.colid);
      const colname = string(header?.colname);
      if (colid && colname && !['__proto__', 'prototype', 'constructor'].includes(colname) && Object.hasOwn(row, colid) && !Object.hasOwn(row, colname)) row[colname] = row[colid];
    }
    const sourceId = string(field(row, ['geofenceid', 'geofence_id', 'guid', 'vt_recordid', 'id']));
    const baseId = `${source}:${sourceId || createHash('sha256').update(stableJson(raw)).digest('hex').slice(0, 24)}`;
    const duplicate = ids.get(baseId) || 0;
    ids.set(baseId, duplicate + 1);
    const { type, geometry } = geometryFor(row);
    return {
      id: duplicate ? `${baseId}:duplicate-${duplicate + 1}` : baseId,
      name: string(field(row, ['geofenceName', 'fenceName', 'name', 'title'])) || 'Unnamed geofence',
      source,
      group: string(field(row, ['group', 'groupName', 'geofenceGroup'])),
      category: string(field(row, ['category', 'categoryName', 'geofenceType', 'fenceType'])),
      type,
      description: string(field(row, ['description', 'remarks', 'remark'])),
      enabled: boolean(field(row, ['enabled', 'isEnabled', 'active', 'isActive'])),
      geometry,
      raw,
      warnings: [...(!geometry ? ['Geometry is missing, invalid, or uses an unverified coordinate format; this record is retained without a map shape.'] : []), ...(duplicate ? ['The source returned a duplicate geofence ID; both records are retained.'] : [])],
    };
  });
}

function sourceConfiguration(env, id) {
  const prefix = id === 'fms' ? 'SONGDEE_FMS' : 'SONGDEE_DATA_FM';
  const keys = ['BASE_URL', 'USERNAME', 'PASSWORD'].map(key => `${prefix}_${key}`);
  const present = keys.map(key => typeof env[key] === 'string' && Boolean(env[key].trim()));
  if (!present.some(Boolean)) return { id, configured: false, complete: false };
  if (!present.every(Boolean)) return { id, configured: false, complete: false, error: `Set ${keys.join(', ')} together.` };
  const config = { id, configured: true, complete: true, username: env[keys[1]].trim(), password: env[keys[2]] };
  try {
    const base = new URL(env[keys[0]].trim());
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error();
    config.baseUrl = base;
  } catch { config.error = `${prefix}_BASE_URL must be an HTTPS URL without credentials, query parameters, or fragments.`; }
  return config;
}

function decodeAttribute(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const names = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (names[entity.toLowerCase()]) return names[entity.toLowerCase()];
    const code = entity.toLowerCase().startsWith('&#x') ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}
function anchorUrl(html, id, base, optional = false) {
  const cleaned = html.replace(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const matches = [];
  for (const tag of cleaned.matchAll(/<a\b[^>]*>/gi)) {
    const attrs = new Map();
    for (const attr of tag[0].matchAll(/\b([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs.set(attr[1].toLowerCase(), decodeAttribute(attr[2] ?? attr[3] ?? attr[4]));
    if (attrs.get('id') === id) matches.push(attrs.get('href'));
  }
  if (!matches.length && optional) return null;
  if (matches.length !== 1 || !matches[0]) throw fail('fms_page_invalid', `Data-FM FMS did not expose the expected ${id} read endpoint.`);
  let url;
  try { url = new URL(matches[0], base); } catch { throw fail('fms_endpoint_invalid', 'Data-FM FMS returned an invalid read endpoint.'); }
  let decodedPath;
  try { decodedPath = decodeURIComponent(url.pathname); } catch { throw fail('fms_endpoint_invalid', 'Data-FM FMS returned an invalid read endpoint.'); }
  if (url.origin !== base.origin || url.username || url.password || url.hash || !decodedPath.startsWith(FMS_PATH) || /(?:update|delete|create|insert|remove|save|logout)/i.test(decodedPath + url.search) || /[\\\x00-\x20]/.test(decodedPath) || decodedPath.split('/').some(part => part === '.' || part === '..')) {
    throw fail('fms_endpoint_invalid', 'Data-FM FMS returned an unsafe read endpoint.');
  }
  return url;
}

/** Read-only, bounded upstream adapter. No Spark credentials or geofence APIs are used. */
export function createGeofenceSource({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const fms = sourceConfiguration(env, 'fms');
  const dataFm = sourceConfiguration(env, 'data-fm');
  const config = fms.complete ? fms : dataFm.complete || dataFm.error ? dataFm : fms.error ? fms : null;
  const secrets = new Set([config?.username, config?.password].filter(Boolean));
  const cookies = new Map();
  let auth = null;
  let authPending = null;
  let cooldownUntil = 0;
  let cache = null;
  let pending = null;

  function acceptCookies(response, requestUrl) {
    const values = response.headers?.getSetCookie?.() || (response.headers?.get?.('set-cookie') || '').split(/,(?=\s*[^;,\s]+=)/);
    for (const cookie of values) {
      const [pair, ...attributes] = cookie.split(';');
      const equals = pair.indexOf('=');
      if (equals <= 0) continue;
      const name = pair.slice(0, equals).trim();
      const value = pair.slice(equals + 1).trim();
      if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(name) || /[\r\n;]/.test(value)) continue;
      const attrs = new Map(attributes.map(attribute => { const index = attribute.indexOf('='); return index < 0 ? [attribute.trim().toLowerCase(), ''] : [attribute.slice(0, index).trim().toLowerCase(), attribute.slice(index + 1).trim()]; }));
      const domain = attrs.get('domain')?.replace(/^\./, '').toLowerCase();
      const hostname = requestUrl.hostname.toLowerCase();
      // FMS may set Domain=.data-fm.com from www.data-fm.com. The jar remains
      // private to this adapter, whose requests never leave the configured origin.
      if (domain !== undefined && (!domain || (domain !== hostname && !hostname.endsWith(`.${domain}`)))) continue;
      const path = attrs.get('path') || requestUrl.pathname.slice(0, requestUrl.pathname.lastIndexOf('/') + 1) || '/';
      const maxAge = number(attrs.get('max-age'));
      const expires = maxAge !== null ? now() + maxAge * 1000 : attrs.has('expires') ? Date.parse(attrs.get('expires')) : Infinity;
      const key = `${name}\0${path}`;
      if (expires <= now()) cookies.delete(key);
      else cookies.set(key, { name, value, path, expires });
      if (value) secrets.add(value);
    }
    if (cookies.size > 64 || [...cookies.values()].reduce((size, cookie) => size + cookie.name.length + cookie.value.length, 0) > 16384) throw fail('fms_cookies_invalid', 'Data-FM FMS returned an oversized session.');
  }
  function cookieHeader(url) {
    return [...cookies.values()].filter(cookie => cookie.expires > now() && (url.pathname === cookie.path || url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`))).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  }

  async function request(url, { method = 'GET', body, form = false, html = false } = {}) {
    const controller = new AbortController();
    let timer;
    const expired = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(fail('timeout', 'The geofence source request timed out.')); }, TIMEOUT_MS); });
    try {
      return await Promise.race([expired, (async () => {
        const headers = { Accept: html ? 'text/html' : 'application/json' };
        if (body !== undefined) headers['Content-Type'] = form ? 'application/x-www-form-urlencoded' : 'application/json; charset=utf-8';
        if (config.id === 'fms') {
          const cookie = cookieHeader(url);
          if (cookie) headers.Cookie = cookie;
          if (method === 'POST') headers['X-Requested-With'] = 'XMLHttpRequest';
        }
        const response = await fetchImpl(url, { method, body, headers, signal: controller.signal, redirect: 'manual', cache: 'no-store' });
        if (response.redirected || (response.status >= 300 && response.status < 400)) throw fail('redirect_rejected', 'The geofence source redirected a request; verify the configured server URL and login.');
        if (!response.ok) throw fail('upstream_http', `The geofence source returned HTTP ${response.status}.`);
        if (number(response.headers?.get?.('content-length')) > MAX_RESPONSE_BYTES) { controller.abort(); throw fail('response_too_large', 'The geofence response exceeds the size limit.'); }
        let text;
        if (response.body?.getReader) {
          const reader = response.body.getReader();
          const chunks = [];
          let bytes = 0;
          try {
            for (;;) {
              const next = await reader.read();
              if (next.done) break;
              bytes += next.value.byteLength;
              if (bytes > MAX_RESPONSE_BYTES) { controller.abort(); await reader.cancel().catch(() => {}); throw fail('response_too_large', 'The geofence response exceeds the size limit.'); }
              chunks.push(Buffer.from(next.value));
            }
            text = Buffer.concat(chunks, bytes).toString('utf8');
          } finally { reader.releaseLock(); }
        } else {
          text = await response.text();
          if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw fail('response_too_large', 'The geofence response exceeds the size limit.');
        }
        if (config.id === 'fms') acceptCookies(response, url);
        return html ? text : json(text, SOURCE_NAMES[config.id]);
      })()]);
    } catch (error) {
      if (error instanceof GeofenceSourceError) throw error;
      throw fail(controller.signal.aborted ? 'timeout' : 'network_error', controller.signal.aborted ? 'The geofence source request timed out.' : 'Unable to read the configured geofence source.');
    } finally { clearTimeout(timer); }
  }

  async function login() {
    if (auth && now() - auth.at < AUTH_TTL_MS) return auth;
    if (authPending) return authPending;
    if (now() < cooldownUntil) throw fail('login_cooldown', 'Geofence source login is temporarily paused after a failed attempt.', 503);
    authPending = (async () => {
      try {
        if (config.id === 'data-fm') {
          const url = new URL('/Api/VTService.svc/GetToken', config.baseUrl);
          url.searchParams.set('username', config.username);
          url.searchParams.set('Password', config.password);
          const payload = await request(url);
          const code = integer(field(payload, ['vResponseCode']));
          const token = string(field(payload, ['token', 'jtoken']));
          if (code !== 0 || !token) throw fail('login_failed', `Data-FM authentication failed (response code ${code ?? 'unknown'}).`, 503);
          secrets.add(token);
          auth = { token, at: now() };
        } else {
          cookies.clear();
          const pageUrl = new URL(FMS_PATH, config.baseUrl);
          const page = await request(pageUrl, { html: true });
          const loginUrl = anchorUrl(page, 'jQCheckLogin', pageUrl);
          if (loginUrl.pathname !== `${FMS_PATH}login/isValidLogin` || loginUrl.search) throw fail('fms_login_invalid', 'Data-FM FMS returned an unexpected login endpoint.');
          const result = await request(loginUrl, { method: 'POST', form: true, body: new URLSearchParams({ username: config.username, password: config.password }).toString() });
          const status = Array.isArray(result) && result.length ? integer(field(result[0], ['loginstatus'])) : null;
          if (status === null || status === 0 || !cookies.size) throw fail('login_failed', 'Data-FM FMS authentication failed; verify the web login credentials.', 503);
          auth = { at: now() };
        }
        cooldownUntil = 0;
        return auth;
      } catch (error) { auth = null; cookies.clear(); cooldownUntil = now() + AUTH_COOLDOWN_MS; throw error; }
    })();
    try { return await authPending; } finally { authPending = null; }
  }

  async function readDataFm() {
    let session = await login();
    let payload;
    let code;
    for (let attempt = 0; attempt < 2; attempt++) {
      const url = new URL('/Api/VTService.svc/GetGeofenceInfo', config.baseUrl);
      url.searchParams.set('jtoken', session.token);
      payload = await request(url);
      code = integer(field(payload, ['vResponseCode']));
      if (code !== 1) break;
      auth = null;
      if (attempt === 0) session = await login();
      else cooldownUntil = now() + AUTH_COOLDOWN_MS;
    }
    if (code !== 0) throw fail('data_fm_rejected', code === 4 ? 'Data-FM reported a server exception while reading geofences (response code 4).' : `Data-FM rejected the geofence request (response code ${code ?? 'unknown'}).`);
    const rows = json(field(payload, ['vData']), 'Data-FM geofence data');
    if (!Array.isArray(rows)) throw fail('response_invalid', 'Data-FM did not return a geofence record array.');
    const declared = field(payload, ['vTotalRecords']);
    const total = integer(declared);
    if (declared !== undefined && (total === null || total < 0)) throw fail('response_invalid', 'Data-FM returned an invalid geofence total.');
    const complete = total !== null && total === rows.length;
    return { rows, headers: [], total, complete, error: complete ? null : 'Data-FM did not confirm that all geofence records were returned.' };
  }

  async function readFms() {
    await login();
    try {
      const pageUrl = new URL(`${FMS_PATH}MasterList?pModuleId=10`, config.baseUrl);
      const page = await request(pageUrl, { html: true });
      const dataUrl = anchorUrl(page, 'jQGetListData', pageUrl);
      const headerUrl = anchorUrl(page, 'jQGetListHeader', pageUrl, true) || anchorUrl(page, 'jQGetListHeaders', pageUrl, true);
      let headers = [];
      if (headerUrl) {
        headers = await request(headerUrl, { method: 'POST', body: JSON.stringify({ pModuleId: '10' }) });
        if (!Array.isArray(headers)) throw fail('response_invalid', 'Data-FM FMS returned invalid geofence column headers.');
      }
      const rows = await request(dataUrl, { method: 'POST', body: JSON.stringify({ itemid: '10' }) });
      if (!Array.isArray(rows)) throw fail('response_invalid', 'Data-FM FMS did not return a geofence record array.');
      // The verified MasterList bundle uses a client-side DataTable: this response
      // is the complete list, independent of the table's display page length.
      return { rows, headers, total: rows.length, complete: true, error: null };
    } catch (error) { auth = null; cookies.clear(); throw error; }
  }

  async function collect() {
    const generatedAt = new Date(now()).toISOString();
    if (!config) return { configured: false, generatedAt, fences: [], sources: ['fms', 'data-fm'].map(id => ({ id, name: SOURCE_NAMES[id], status: 'unconfigured', total: null, complete: false, error: null, fetchedAt: null })), coverage: { total: null, returned: 0, complete: false } };
    const source = { id: config.id, name: SOURCE_NAMES[config.id], status: 'error', total: null, complete: false, error: null, fetchedAt: null };
    let fences = [];
    try {
      if (config.error) throw fail('configuration_invalid', config.error, 503);
      const result = await (config.id === 'fms' ? readFms() : readDataFm());
      fences = normalizeRows(result.rows, config.id, result.headers, secrets);
      Object.assign(source, { status: result.complete ? 'ok' : 'error', total: result.total, complete: result.complete, error: result.error, fetchedAt: new Date(now()).toISOString() });
    } catch (error) { source.error = error instanceof GeofenceSourceError ? error.message : 'Unable to read the configured geofence source.'; }
    return { configured: config.configured, generatedAt, fences, sources: [source], coverage: { total: source.total, returned: fences.length, complete: source.complete } };
  }

  return {
    async getGeofenceSnapshot() {
      if (cache && now() - cache.at < CACHE_MS) return structuredClone(cache.snapshot);
      if (!pending) pending = collect().then(snapshot => { if (snapshot.coverage.complete) cache = { at: now(), snapshot }; return snapshot; }).finally(() => { pending = null; });
      return structuredClone(await pending);
    },
  };
}

let singleton;
export function getGeofenceSnapshot() {
  singleton ||= createGeofenceSource();
  return singleton.getGeofenceSnapshot();
}
