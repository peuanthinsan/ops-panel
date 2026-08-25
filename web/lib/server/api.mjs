import crypto from 'node:crypto';
import {
  ADMIN_SESSION_LIFETIME_MS,
  createAdminToken,
  hashPassword,
  verifyAdminToken,
  verifyPassword,
} from './auth.mjs';
import { checkDatabase, ConfigurationError, getDatabase } from './database.mjs';
import { parseHttpAdapterUrl } from '../adapter-url.mjs';
import { songdeeApiHealth } from '../api-contract.mjs';
import { normalizeBulkBindings } from '../bulk-bindings.mjs';
import { parseDeviceJobHistoryQuery } from '../device-job-history.mjs';
import { buildReportQuery } from '../report-query.mjs';
import {
  decryptDeviceSecret,
  deviceRequestSignature,
  newDeviceCredential,
  signaturesMatch,
} from './device-auth.mjs';
import { fetchDataFmDriverIdentity, fetchDataFmGpsHistory } from './data-fm-gps.mjs';
import { fmsSyncNeedsRetry } from './fms-sync-state.mjs';
import { DEFAULT_GPS_PAIR_TOLERANCE_MS, pairExternalGpsSources } from './external-gps.mjs';
import { gpsPairingMetadata } from './gps-pairing.mjs';

const allowedModes = new Set([
  'Load',
  'Stop vehicle',
  'Unload',
  'Break',
  'Vehicle check',
  'Refuel',
  'Vehicle wash',
  'Park overnight',
  'Finish work',
]);
const safeId = /^[a-zA-Z0-9._:-]+$/;
const maximumJsonBodyBytes = 64 * 1024;
const maximumBulkJsonBodyBytes = 2 * 1024 * 1024;
const maximumUpstreamBodyBytes = 256 * 1024;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ApiError extends Error {
  constructor(status, message, { code, headers } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function corsHeaders() {
  const allowedOrigin = process.env.SONGDEE_CORS_ORIGIN;
  return {
    ...(allowedOrigin ? { 'Access-Control-Allow-Origin': allowedOrigin } : {}),
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-token, Authorization, x-device-key-id, x-device-timestamp, x-device-nonce, x-device-signature',
    'Access-Control-Expose-Headers': 'x-songdee-error-code, x-songdee-server-time',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

function json(body, status = 200, extraHeaders = {}) {
  return Response.json(body, { status, headers: { ...corsHeaders(), ...extraHeaders } });
}

function empty(status = 204) {
  return new Response(null, { status, headers: corsHeaders() });
}

async function readJsonPayload(request, maximumBytes = maximumJsonBodyBytes) {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new ApiError(413, 'Request body is too large');
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maximumBytes) {
    throw new ApiError(413, 'Request body is too large');
  }
  try {
    return { input: JSON.parse(raw || '{}'), raw };
  } catch {
    throw new ApiError(400, 'Invalid JSON payload');
  }
}

async function readJson(request, maximumBytes = maximumJsonBodyBytes) {
  return (await readJsonPayload(request, maximumBytes)).input;
}

function requiredText(value, name, maxLength = 180) {
  const result = String(value || '').trim();
  if (!result) throw new ApiError(400, `${name} is required`);
  if (result.length > maxLength) throw new ApiError(400, `${name} is too long`);
  return result;
}

function optionalText(value, name, maxLength = 180) {
  const result = String(value || '').trim();
  if (result.length > maxLength) throw new ApiError(400, `${name} is too long`);
  return result || null;
}

function validClientId(value) {
  const result = String(value || '').trim();
  if (result && (result.length > 180 || !safeId.test(result))) {
    throw new ApiError(400, 'id must contain only letters, numbers, dots, underscores, colons, or hyphens');
  }
  return result;
}

function requiredDate(value, name) {
  const milliseconds = Date.parse(String(value || ''));
  if (!Number.isFinite(milliseconds)) throw new ApiError(400, `${name} must be a valid date`);
  return { milliseconds, iso: new Date(milliseconds).toISOString() };
}

function formatDurationMs(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function adminTokenSecret() {
  const secret = process.env.SONGDEE_ADMIN_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new ConfigurationError('SONGDEE_ADMIN_TOKEN_SECRET must be at least 32 characters.');
  }
  return secret;
}

function requestClientAddress(request) {
  return String(request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown')
    .split(',')[0].trim().slice(0, 180);
}

function rateLimitSubject(value) {
  return crypto.createHmac('sha256', adminTokenSecret()).update(`rate-limit:${value}`).digest('hex');
}

async function consumeRateLimit(request, scope, limit, windowSeconds, subject = requestClientAddress(request)) {
  const sql = getDatabase();
  const now = Date.now();
  const windowMilliseconds = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now / windowMilliseconds) * windowMilliseconds).toISOString();
  const [result] = await sql`
    INSERT INTO api_rate_limits (scope, subject_hash, window_start, attempts)
    VALUES (${scope}, ${rateLimitSubject(subject)}, ${windowStart}, 1)
    ON CONFLICT (scope, subject_hash, window_start) DO UPDATE
      SET attempts = api_rate_limits.attempts + 1, updated_at = now()
    RETURNING attempts
  `;
  if (Number(result?.attempts || 0) > limit) {
    const retryAfter = Math.max(1, Math.ceil((Date.parse(windowStart) + windowMilliseconds - now) / 1000));
    throw new ApiError(429, 'Too many requests. Try again later.', {
      code: 'RATE_LIMITED',
      headers: { 'Retry-After': String(retryAfter) },
    });
  }
  if (Math.random() < 0.01) {
    await Promise.all([
      sql`DELETE FROM device_request_nonces WHERE expires_at < now()`,
      sql`DELETE FROM api_rate_limits WHERE updated_at < now() - interval '2 days'`,
    ]);
  }
}

async function clearRateLimit(scope, subject) {
  const sql = getDatabase();
  await sql`DELETE FROM api_rate_limits WHERE scope = ${scope} AND subject_hash = ${rateLimitSubject(subject)}`;
}

async function deviceAuthStatus(deviceId) {
  const sql = getDatabase();
  const rows = await sql`
    SELECT key_id::text AS "keyId", enforced_at AS "enforcedAt"
    FROM device_credentials WHERE device_id = ${deviceId} LIMIT 1
  `;
  return rows[0]
    ? { keyId: rows[0].keyId, enrolled: true, enforced: Boolean(rows[0].enforcedAt) }
    : { keyId: null, enrolled: false, enforced: false };
}

async function issuePendingDeviceCredential(deviceId) {
  const sql = getDatabase();
  const current = await sql`
    SELECT enforced_at AS "enforcedAt" FROM device_credentials WHERE device_id = ${deviceId} LIMIT 1
  `;
  if (current[0]?.enforcedAt) return null;
  const credential = newDeviceCredential(adminTokenSecret());
  await sql`
    INSERT INTO device_credentials (device_id, key_id, secret_ciphertext)
    VALUES (${deviceId}, ${credential.keyId}::uuid, ${credential.secretCiphertext})
    ON CONFLICT (device_id) DO UPDATE SET
      key_id = EXCLUDED.key_id,
      secret_ciphertext = EXCLUDED.secret_ciphertext,
      enforced_at = NULL,
      rotated_at = now(),
      last_used_at = NULL
  `;
  return { keyId: credential.keyId, secret: credential.secret };
}

async function resetDeviceCredential(deviceId) {
  const sql = getDatabase();
  const credential = newDeviceCredential(adminTokenSecret());
  await sql`
    INSERT INTO device_credentials (device_id, key_id, secret_ciphertext)
    VALUES (${deviceId}, ${credential.keyId}::uuid, ${credential.secretCiphertext})
    ON CONFLICT (device_id) DO UPDATE SET
      key_id = EXCLUDED.key_id,
      secret_ciphertext = EXCLUDED.secret_ciphertext,
      enforced_at = NULL,
      rotated_at = now(),
      last_used_at = NULL
  `;
}

async function authenticateDeviceRequest(request, deviceId, rawBody = '', { allowPendingCredentialMismatch = false } = {}) {
  const sql = getDatabase();
  const rows = await sql`
    SELECT key_id::text AS "keyId", secret_ciphertext AS "secretCiphertext", enforced_at AS "enforcedAt"
    FROM device_credentials WHERE device_id = ${deviceId} LIMIT 1
  `;
  const credential = rows[0];
  const keyId = String(request.headers.get('x-device-key-id') || '').trim();
  const timestamp = String(request.headers.get('x-device-timestamp') || '').trim();
  const nonce = String(request.headers.get('x-device-nonce') || '').trim();
  const signature = String(request.headers.get('x-device-signature') || '').trim().toLowerCase();
  const supplied = Boolean(keyId || timestamp || nonce || signature);

  if (!credential) {
    if (supplied) throw new ApiError(401, 'Device credential is no longer valid.', { code: 'DEVICE_CREDENTIAL_INVALID' });
    return { legacy: true };
  }
  if (!supplied) {
    if (credential.enforcedAt) throw new ApiError(401, 'Signed device request required.', { code: 'DEVICE_AUTH_REQUIRED' });
    return { legacy: true };
  }
  // A Fleet admin reset deliberately returns the credential to a pending state.
  // Let the tablet read its binding with the old key so it can claim the new key
  // without asking the driver or technician for another password.
  if (allowPendingCredentialMismatch && !credential.enforcedAt && keyId !== credential.keyId) {
    return { legacy: true, credentialReset: true };
  }
  if (keyId !== credential.keyId || !uuidPattern.test(keyId)
    || !uuidPattern.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)) {
    throw new ApiError(401, 'Device credential is invalid.', { code: 'DEVICE_CREDENTIAL_INVALID' });
  }
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber) || Math.abs(Date.now() - timestampNumber) > 5 * 60 * 1000) {
    throw new ApiError(401, 'Device clock is outside the allowed window.', {
      code: 'DEVICE_CLOCK_SKEW',
      headers: {
        'x-songdee-error-code': 'DEVICE_CLOCK_SKEW',
        'x-songdee-server-time': String(Date.now()),
      },
    });
  }
  let secret;
  try { secret = decryptDeviceSecret(credential.secretCiphertext, adminTokenSecret()); }
  catch { throw new ConfigurationError('Device credential encryption could not be verified.'); }
  const requestUrl = new URL(request.url);
  const path = `${requestUrl.pathname}${requestUrl.search}`;
  const expected = deviceRequestSignature(secret, request.method, path, timestamp, nonce, rawBody);
  if (!signaturesMatch(expected, signature)) {
    throw new ApiError(401, 'Device request signature is invalid.', { code: 'DEVICE_CREDENTIAL_INVALID' });
  }
  const [inserted] = await sql.transaction(transaction => [
    transaction`
      INSERT INTO device_request_nonces (key_id, nonce, request_timestamp, expires_at)
      VALUES (${keyId}::uuid, ${nonce}::uuid, ${new Date(timestampNumber).toISOString()}, now() + interval '10 minutes')
      ON CONFLICT (key_id, nonce) DO NOTHING
      RETURNING nonce
    `,
    transaction`
      UPDATE device_credentials
      SET enforced_at = COALESCE(enforced_at, now()), last_used_at = now()
      WHERE device_id = ${deviceId} AND key_id = ${keyId}::uuid
    `,
  ]);
  if (!inserted.length) throw new ApiError(409, 'Device request was already received.', { code: 'DEVICE_REQUEST_REPLAYED' });
  return { legacy: false };
}

async function ensureAdminSettings() {
  const sql = getDatabase();
  let settings = await sql`
    SELECT setting_key AS "settingKey", setting_value AS "settingValue"
    FROM app_settings
    WHERE setting_key IN ('admin_password_hash', 'admin_auth_version')
  `;
  if (!settings.some((item) => item.settingKey === 'admin_password_hash')) {
    const initialPassword = process.env.SONGDEE_ADMIN_PASSWORD;
    if (!initialPassword || initialPassword.length < 12 || initialPassword.length > 128) {
      throw new ConfigurationError('SONGDEE_ADMIN_PASSWORD must be 12 to 128 characters for first setup.');
    }
    await sql`
      INSERT INTO app_settings (setting_key, setting_value)
      VALUES ('admin_password_hash', ${hashPassword(initialPassword)})
      ON CONFLICT (setting_key) DO NOTHING
    `;
  }
  await sql`
    INSERT INTO app_settings (setting_key, setting_value)
    VALUES ('admin_auth_version', '1')
    ON CONFLICT (setting_key) DO NOTHING
  `;
  settings = await sql`
    SELECT setting_key AS "settingKey", setting_value AS "settingValue"
    FROM app_settings
    WHERE setting_key IN ('admin_password_hash', 'admin_auth_version')
  `;
  return Object.fromEntries(settings.map((item) => [item.settingKey, item.settingValue]));
}

function requestAdminToken(request) {
  const explicit = request.headers.get('x-admin-token');
  if (explicit) return explicit;
  const authorization = request.headers.get('authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
}

async function requireAdmin(request) {
  const settings = await ensureAdminSettings();
  if (!verifyAdminToken(requestAdminToken(request), settings.admin_auth_version, adminTokenSecret())) {
    throw new ApiError(401, 'Admin login required');
  }
}

async function bindingWasValid(deviceId, vehicleNumber, occurredAt) {
  const sql = getDatabase();
  const [result] = await sql`
    SELECT
      EXISTS (
        SELECT 1 FROM device_binding_history
        WHERE device_id = ${deviceId}
          AND vehicle_number = ${vehicleNumber}
          AND bound_at <= ${occurredAt}::timestamptz
          AND (unbound_at IS NULL OR unbound_at > ${occurredAt}::timestamptz)
      ) OR (
        NOT EXISTS (
          SELECT 1 FROM device_binding_history
          WHERE device_id = ${deviceId} AND vehicle_number = ${vehicleNumber}
        )
        AND EXISTS (
          SELECT 1 FROM device_bindings
          WHERE device_id = ${deviceId} AND vehicle_number = ${vehicleNumber}
        )
      ) AS valid
  `;
  return Boolean(result?.valid);
}

async function findBinding(deviceId) {
  if (!deviceId) return null;
  const sql = getDatabase();
  const rows = await sql`
    SELECT vehicle_number AS "vehicleNumber", device_id AS "deviceId"
    FROM device_bindings WHERE device_id = ${deviceId} LIMIT 1
  `;
  return rows[0] || null;
}

async function allBindings() {
  const sql = getDatabase();
  return sql`
    SELECT
      binding.vehicle_number AS "vehicleNumber",
      binding.device_id AS "deviceId",
      credential.key_id::text AS "deviceKeyId",
      (credential.enforced_at IS NOT NULL) AS "deviceAccessEnforced",
      credential.last_used_at AS "deviceAccessLastUsedAt",
      activity.last_activity_at AS "lastActivityAt"
    FROM device_bindings binding
    LEFT JOIN device_credentials credential ON credential.device_id = binding.device_id
    LEFT JOIN (
      SELECT device_id, max(COALESCE(end_time, start_time)) AS last_activity_at
      FROM ops_reports GROUP BY device_id
    ) activity ON activity.device_id = binding.device_id
    ORDER BY binding.vehicle_number ASC, binding.device_id ASC
  `;
}

async function createInitialBinding(vehicleNumber, deviceId) {
  const sql = getDatabase();
  const existing = await findBinding(deviceId);
  if (existing) {
    if (existing.vehicleNumber === vehicleNumber) {
      const deviceCredential = await issuePendingDeviceCredential(deviceId);
      return {
        deviceConfig: existing,
        deviceAuth: await deviceAuthStatus(deviceId),
        ...(deviceCredential ? { deviceCredential } : {}),
        deduplicated: true,
      };
    }
    throw new ApiError(409, 'Device is already connected; change it from the admin dashboard.');
  }
  const rows = await sql`
    WITH inserted AS (
      INSERT INTO device_bindings (device_id, vehicle_number)
      VALUES (${deviceId}, ${vehicleNumber})
      ON CONFLICT (device_id) DO NOTHING
      RETURNING device_id, vehicle_number
    ), history AS (
      INSERT INTO device_binding_history (device_id, vehicle_number, bound_at)
      SELECT device_id, vehicle_number, now() FROM inserted
    )
    SELECT vehicle_number AS "vehicleNumber", device_id AS "deviceId" FROM inserted
  `;
  if (rows[0]) {
    const deviceCredential = await issuePendingDeviceCredential(deviceId);
    return { deviceConfig: rows[0], deviceAuth: await deviceAuthStatus(deviceId), deviceCredential };
  }
  const concurrent = await findBinding(deviceId);
  if (concurrent?.vehicleNumber === vehicleNumber) {
    const deviceCredential = await issuePendingDeviceCredential(deviceId);
    return {
      deviceConfig: concurrent,
      deviceAuth: await deviceAuthStatus(deviceId),
      ...(deviceCredential ? { deviceCredential } : {}),
      deduplicated: true,
    };
  }
  throw new ApiError(409, 'Device is already connected; change it from the admin dashboard.');
}

async function saveAdminBinding(vehicleNumber, deviceId) {
  const sql = getDatabase();
  const current = await findBinding(deviceId);
  if (current && current.vehicleNumber !== vehicleNumber && await getActiveJobForDevice(deviceId)) {
    throw new ApiError(409, 'Finish or cancel the active job before changing this vehicle binding.');
  }
  const [, rows] = await sql.transaction((transaction) => [
    transaction`
      UPDATE device_binding_history
      SET unbound_at = now()
      WHERE device_id = ${deviceId}
        AND unbound_at IS NULL
        AND vehicle_number <> ${vehicleNumber}
    `,
    transaction`
      INSERT INTO device_bindings (device_id, vehicle_number)
      VALUES (${deviceId}, ${vehicleNumber})
      ON CONFLICT (device_id) DO UPDATE
        SET vehicle_number = EXCLUDED.vehicle_number, updated_at = now()
      RETURNING vehicle_number AS "vehicleNumber", device_id AS "deviceId"
    `,
    transaction`
      INSERT INTO device_binding_history (device_id, vehicle_number, bound_at)
      SELECT ${deviceId}, ${vehicleNumber}, now()
      WHERE NOT EXISTS (
        SELECT 1 FROM device_binding_history
        WHERE device_id = ${deviceId}
          AND vehicle_number = ${vehicleNumber}
          AND unbound_at IS NULL
      )
    `,
  ]);
  return rows[0];
}

async function importAdminBindings(inputBindings) {
  let bindings;
  try {
    bindings = normalizeBulkBindings(inputBindings);
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : 'Invalid binding import');
  }
  const sql = getDatabase();
  const payload = JSON.stringify(bindings);
  const [preflight] = await sql.query(`
    WITH incoming AS (
      SELECT "vehicleNumber" AS vehicle_number, "deviceId" AS device_id
      FROM jsonb_to_recordset($1::jsonb) AS item("vehicleNumber" text, "deviceId" text)
    )
    SELECT
      (SELECT count(*)::int FROM incoming i LEFT JOIN device_bindings d ON d.device_id = i.device_id WHERE d.device_id IS NULL) AS added,
      (SELECT count(*)::int FROM incoming i JOIN device_bindings d ON d.device_id = i.device_id WHERE d.vehicle_number <> i.vehicle_number) AS updated,
      (SELECT count(*)::int FROM incoming i JOIN device_bindings d ON d.device_id = i.device_id WHERE d.vehicle_number = i.vehicle_number) AS skipped,
      COALESCE((
        SELECT json_agg(json_build_object('vehicleNumber', d.vehicle_number, 'deviceId', i.device_id))
        FROM incoming i
        JOIN device_bindings d ON d.device_id = i.device_id AND d.vehicle_number <> i.vehicle_number
        JOIN active_jobs a ON a.device_id = i.device_id
      ), '[]'::json) AS "activeJobConflicts"
  `, [payload]);
  if (preflight.activeJobConflicts?.length) {
    const conflict = preflight.activeJobConflicts[0];
    throw new ApiError(409, `Finish or cancel the active job on device ${conflict.deviceId} before changing vehicle ${conflict.vehicleNumber}.`);
  }

  const [, changedRows] = await sql.transaction((transaction) => [
    transaction`
      UPDATE device_binding_history history
      SET unbound_at = now()
      FROM jsonb_to_recordset(${payload}::jsonb) AS item("vehicleNumber" text, "deviceId" text)
      WHERE history.device_id = item."deviceId"
        AND history.unbound_at IS NULL
        AND history.vehicle_number <> item."vehicleNumber"
    `,
    transaction`
      INSERT INTO device_bindings (device_id, vehicle_number)
      SELECT item."deviceId", item."vehicleNumber"
      FROM jsonb_to_recordset(${payload}::jsonb) AS item("vehicleNumber" text, "deviceId" text)
      ON CONFLICT (device_id) DO UPDATE
        SET vehicle_number = EXCLUDED.vehicle_number, updated_at = now()
      WHERE device_bindings.vehicle_number IS DISTINCT FROM EXCLUDED.vehicle_number
      RETURNING vehicle_number AS "vehicleNumber", device_id AS "deviceId"
    `,
    transaction`
      INSERT INTO device_binding_history (device_id, vehicle_number, bound_at)
      SELECT item."deviceId", item."vehicleNumber", now()
      FROM jsonb_to_recordset(${payload}::jsonb) AS item("vehicleNumber" text, "deviceId" text)
      WHERE NOT EXISTS (
        SELECT 1 FROM device_binding_history history
        WHERE history.device_id = item."deviceId" AND history.unbound_at IS NULL
      )
    `,
  ]);
  return {
    added: Number(preflight.added || 0),
    updated: Number(preflight.updated || 0),
    skipped: Number(preflight.skipped || 0),
    deviceBindings: changedRows,
  };
}

async function removeBinding(deviceId) {
  const sql = getDatabase();
  if (await getActiveJobForDevice(deviceId)) {
    throw new ApiError(409, 'Finish or cancel the active job before removing this vehicle binding.');
  }
  const rows = await sql`
    WITH removed AS (
      DELETE FROM device_bindings WHERE device_id = ${deviceId}
      RETURNING device_id, vehicle_number
    ), closed AS (
      UPDATE device_binding_history
      SET unbound_at = now()
      WHERE device_id IN (SELECT device_id FROM removed) AND unbound_at IS NULL
    )
    SELECT vehicle_number AS "vehicleNumber", device_id AS "deviceId" FROM removed
  `;
  return rows[0] || null;
}

function reportColumns() {
  return `
    id,
    vehicle_number AS "vehicleNumber",
    device_id AS "deviceId",
    driver_name AS "driverName",
    driver_id AS "driverId",
    mode,
    start_time AS "startTime",
    end_time AS "endTime",
    duration,
    gps,
    status,
    gps_lookup_status AS "gpsLookupStatus",
    gps_lookup_message AS "gpsLookupMessage"
  `;
}

async function getReport(id) {
  const sql = getDatabase();
  const rows = await sql.query(`SELECT ${reportColumns()} FROM ops_reports WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] || null;
}

async function getDeviceJobs(deviceId, vehicleNumber, searchParams) {
  const sql = getDatabase();
  const query = parseDeviceJobHistoryQuery(searchParams);
  const values = [deviceId, vehicleNumber];
  const clauses = ['report.device_id = $1', 'lower(report.vehicle_number) = lower($2)'];
  const parameter = value => { values.push(value); return `$${values.length}`; };
  if (query.dayKey) {
    const day = parameter(query.dayKey);
    clauses.push(`report.end_time >= (${day}::date::timestamp AT TIME ZONE 'Asia/Bangkok')`);
    clauses.push(`report.start_time < ((${day}::date + 1)::timestamp AT TIME ZONE 'Asia/Bangkok')`);
  } else if (query.startAt || query.endAt) {
    if (query.startAt) clauses.push(`report.end_time >= ${parameter(query.startAt)}::timestamptz`);
    if (query.endAt) clauses.push(`report.start_time <= ${parameter(query.endAt)}::timestamptz`);
  } else if (query.monthKey) {
    const month = parameter(`${query.monthKey}-01`);
    clauses.push(`report.end_time >= (${month}::date::timestamp AT TIME ZONE 'Asia/Bangkok')`);
    clauses.push(`report.end_time < (((${month}::date + INTERVAL '1 month'))::timestamp AT TIME ZONE 'Asia/Bangkok')`);
  }
  if (query.mode) clauses.push(`report.mode = ${parameter(query.mode)}`);
  if (query.status === 'cancelled') clauses.push(`report.status = 'Cancelled'`);
  if (query.status === 'completed') clauses.push(`report.status <> 'Cancelled'`);
  if (query.status === 'pending' || query.status === 'failed') clauses.push('FALSE');
  if (query.search) {
    clauses.push(`concat_ws(' ', report.id, report.vehicle_number, report.device_id, report.driver_name, report.driver_id, report.mode, report.status, report.start_time, report.end_time, report.duration) ILIKE ${parameter(`%${query.search}%`)}`);
  }
  const orderBy = {
    newest: 'report.end_time DESC, report.id DESC',
    oldest: 'report.end_time ASC, report.id ASC',
    duration_desc: 'EXTRACT(EPOCH FROM (report.end_time - report.start_time)) DESC, report.end_time DESC, report.id DESC',
    mode_asc: 'lower(report.mode) ASC, report.end_time DESC, report.id DESC',
  }[query.sort];
  const whereSql = `WHERE ${clauses.join(' AND ')}`;
  const limitParameter = `$${values.length + 1}`;
  const offsetParameter = `$${values.length + 2}`;
  const offset = (query.page - 1) * query.pageSize;
  const pageValues = [...values, query.pageSize, offset];
  const [jobs, summaryRows, monthRows] = await sql.transaction(transaction => [
    transaction.query(`
      SELECT ${reportColumns()}
      FROM ops_reports report
      ${whereSql}
      ORDER BY ${orderBy}
      LIMIT ${limitParameter} OFFSET ${offsetParameter}
    `, pageValues),
    transaction.query(`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE report.status <> 'Cancelled')::int AS completed,
        count(*) FILTER (WHERE report.status = 'Cancelled')::int AS cancelled,
        COALESCE(floor(sum(EXTRACT(EPOCH FROM (report.end_time - report.start_time)))), 0)::bigint AS "durationSeconds"
      FROM ops_reports report
      ${whereSql}
    `, values),
    transaction.query(`
      SELECT DISTINCT to_char(report.end_time AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM') AS month
      FROM ops_reports report
      WHERE report.device_id = $1 AND lower(report.vehicle_number) = lower($2)
      ORDER BY month DESC
    `, [deviceId, vehicleNumber]),
  ]);
  const summaryRow = summaryRows[0] || {};
  const total = Number(summaryRow.total) || 0;
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  return {
    jobs,
    facets: { months: monthRows.map(row => row.month).filter(Boolean) },
    pageInfo: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages,
      start: jobs.length ? offset + 1 : 0,
      end: offset + jobs.length,
      hasNextPage: query.page < totalPages,
    },
    summary: {
      total,
      completed: Number(summaryRow.completed) || 0,
      cancelled: Number(summaryRow.cancelled) || 0,
      durationSeconds: Number(summaryRow.durationSeconds) || 0,
    },
  };
}

async function getReportsPage(request) {
  const sql = getDatabase();
  const query = buildReportQuery(new URL(request.url).searchParams);
  const limitParameter = `$${query.values.length + 1}`;
  const offsetParameter = `$${query.values.length + 2}`;
  const pageValues = [...query.values, query.pageSize, query.offset];
  const [reports, summaryRows, fleetRows] = await sql.transaction(transaction => [
    transaction.query(`
    WITH page_reports AS (
      SELECT report.*, ROW_NUMBER() OVER (ORDER BY ${query.orderBy}) AS "rowOrder"
      FROM ops_reports report
      ${query.whereSql}
      ORDER BY ${query.orderBy}
      LIMIT ${limitParameter} OFFSET ${offsetParameter}
    )
    SELECT
      ${reportColumns()},
      (SELECT max(sample.device_speed_mps) * 3.6 FROM gps_sync_samples sample WHERE sample.job_id = report.id) AS "topSpeed",
      COALESCE(gps_summary.device_gps_samples, 0)::int AS "deviceGpsSamples",
      COALESCE(gps_summary.fms_gps_samples, 0)::int AS "fmsGpsSamples",
      COALESCE(gps_summary.paired_gps_samples, 0)::int AS "pairedGpsSamples",
      COALESCE(gps_summary.attention_gps_samples, 0)::int AS "attentionGpsSamples",
      gps_summary.last_device_latitude AS "lastDeviceLatitude",
      gps_summary.last_device_longitude AS "lastDeviceLongitude",
      gps_summary.last_fms_latitude AS "lastFmsLatitude",
      gps_summary.last_fms_longitude AS "lastFmsLongitude",
      gps_summary.last_gps_captured_at AS "lastGpsCapturedAt",
      gps_summary.median_position_delta_m AS "medianPositionDeltaM"
    FROM page_reports report
    LEFT JOIN (
      SELECT
        job_id,
        device_samples AS device_gps_samples,
        fms_samples AS fms_gps_samples,
        paired_samples AS paired_gps_samples,
        attention_samples AS attention_gps_samples,
        last_device_latitude,
        last_device_longitude,
        last_fms_latitude,
        last_fms_longitude,
        last_captured_at AS last_gps_captured_at,
        median_position_delta_m
      FROM job_gps_summaries
      WHERE job_id IN (SELECT id FROM page_reports)
    ) AS gps_summary ON gps_summary.job_id = report.id
    ORDER BY report."rowOrder"
  `, pageValues),
    transaction.query(`
      SELECT
        count(*)::int AS total,
        count(DISTINCT report.vehicle_number) FILTER (WHERE report.status <> 'Cancelled')::int AS "activeVehicles",
        count(*) FILTER (WHERE report.gps_lookup_status = 'pending')::int AS queued,
        count(*) FILTER (WHERE report.status = 'Cancelled')::int AS cancelled,
        count(*) FILTER (
          WHERE gps_summary.device_samples > 0
            AND gps_summary.paired_samples = gps_summary.device_samples
        )::int AS "gpsPaired",
        count(*) FILTER (
          WHERE report.status <> 'Cancelled'
            AND COALESCE(gps_summary.device_samples, 0) = 0
        )::int AS "gpsNeedsAttention",
        count(*) FILTER (WHERE gps_summary.device_samples > 0)::int AS "gpsMatched",
        COALESCE(sum(gps_summary.device_samples), 0)::int AS "deviceGpsSamples",
        COALESCE(sum(gps_summary.fms_samples), 0)::int AS "fmsGpsSamples",
        COALESCE(sum(gps_summary.paired_samples), 0)::int AS "pairedGpsSamples",
        COALESCE(sum(gps_summary.attention_samples), 0)::int AS "attentionGpsSamples"
      FROM ops_reports report
      LEFT JOIN job_gps_summaries gps_summary ON gps_summary.job_id = report.id
      ${query.whereSql}
    `, query.values),
    transaction.query('SELECT count(*)::int AS "fleetSize" FROM device_bindings'),
  ]);
  const summary = summaryRows[0] || { total: 0, activeVehicles: 0, queued: 0, cancelled: 0 };
  const totalPages = Math.max(1, Math.ceil(Number(summary.total || 0) / query.pageSize));
  return {
    reports,
    summary: { ...summary, fleetSize: Number(fleetRows[0]?.fleetSize || 0) },
    pageInfo: {
      page: query.page,
      pageSize: query.pageSize,
      total: Number(summary.total || 0),
      totalPages,
      start: reports.length ? query.offset + 1 : 0,
      end: query.offset + reports.length,
    },
  };
}

async function getReportFacets() {
  const sql = getDatabase();
  const [result] = await sql`
    SELECT
      COALESCE((SELECT json_agg(value ORDER BY lower(value), value) FROM (SELECT (array_agg(vehicle_number ORDER BY (vehicle_number <> upper(vehicle_number)) DESC, vehicle_number))[1] AS value FROM ops_reports GROUP BY lower(vehicle_number)) facet_values), '[]'::json) AS vehicles,
      COALESCE((SELECT json_agg(value ORDER BY value) FROM (SELECT DISTINCT device_id AS value FROM ops_reports) facet_values), '[]'::json) AS devices,
      COALESCE((SELECT json_agg(value ORDER BY value) FROM (SELECT DISTINCT driver_name AS value FROM ops_reports WHERE driver_name IS NOT NULL AND driver_name <> '') facet_values), '[]'::json) AS drivers,
      COALESCE((SELECT json_agg(value ORDER BY value) FROM (SELECT DISTINCT status AS value FROM ops_reports) facet_values), '[]'::json) AS statuses,
      COALESCE((SELECT json_agg(value ORDER BY value) FROM (SELECT DISTINCT COALESCE(gps_lookup_status, gps, '') AS value FROM ops_reports WHERE COALESCE(gps_lookup_status, gps, '') <> '') facet_values), '[]'::json) AS "gpsStates"
  `;
  return result || { vehicles: [], devices: [], drivers: [], statuses: [], gpsStates: [] };
}

function activeJobColumns() {
  return `
    id,
    vehicle_number AS "vehicleNumber",
    device_id AS "deviceId",
    driver_name AS "driverName",
    driver_id AS "driverId",
    mode,
    start_time AS "startTime",
    'Active' AS status,
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  `;
}

async function getActiveJob(id) {
  const sql = getDatabase();
  const rows = await sql.query(`SELECT ${activeJobColumns()} FROM active_jobs WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] || null;
}

async function getActiveJobForDevice(deviceId) {
  const sql = getDatabase();
  const rows = await sql.query(`SELECT ${activeJobColumns()} FROM active_jobs WHERE device_id = $1 LIMIT 1`, [deviceId]);
  return rows[0] || null;
}

function sameJobStart(existing, input) {
  return existing.vehicleNumber === input.vehicleNumber
    && existing.deviceId === input.deviceId
    && existing.mode === input.mode
    && new Date(existing.startTime).toISOString() === input.startTime
    && (existing.driverName || null) === input.driverName
    && (existing.driverId || null) === input.driverId;
}

function sameReport(existing, input) {
  return existing.vehicleNumber === input.vehicleNumber
    && existing.deviceId === input.deviceId
    && existing.mode === input.mode
    && new Date(existing.startTime).toISOString() === input.startTime
    && new Date(existing.endTime).toISOString() === input.endTime
    && (existing.driverName || null) === input.driverName
    && (existing.driverId || null) === input.driverId
    && (existing.status === 'Cancelled') === input.cancelled;
}

async function parseUpstreamBody(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumUpstreamBodyBytes) {
    throw new Error('Upstream response is too large');
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumUpstreamBodyBytes) {
      await reader.cancel();
      throw new Error('Upstream response is too large');
    }
    chunks.push(value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(body);
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return { raw: text.slice(0, 4000) }; }
}

function gpsLookupState(reconciliation) {
  const deviceSource = reconciliation?.deviceSource || {};
  if (reconciliation?.gpsSync) {
    if (reconciliation.pairStatus === 'paired') {
      return { status: 'paired', gps: 'GPS paired', message: 'GPS points matched by time.' };
    }
    if (reconciliation.pairStatus === 'fms_delayed') {
      return { status: 'partial', gps: 'GPS partially paired', message: deviceSource.message || 'GPS was found; FMS coverage is partial.' };
    }
    return { status: 'device_only', gps: 'GPS matched', message: deviceSource.message || 'GPS point matched.' };
  }
  if (deviceSource.status === 'no_time_match' || deviceSource.status === 'received') {
    return { status: 'no_data', gps: 'No GPS point', message: deviceSource.message || 'No GPS point was found inside the time window.' };
  }
  if (deviceSource.status === 'not_configured') {
    return { status: 'lookup_unavailable', gps: 'GPS unavailable', message: deviceSource.message || 'GPS lookup is not configured.' };
  }
  return { status: 'lookup_failed', gps: 'GPS lookup failed', message: deviceSource.message || 'GPS lookup failed.' };
}

async function updateReportGpsLookupState(reportId, reconciliation) {
  const sql = getDatabase();
  const state = gpsLookupState(reconciliation);
  const driverName = String(reconciliation?.driverIdentity?.driverName || '').trim().slice(0, 180) || null;
  const driverId = String(reconciliation?.driverIdentity?.driverId || '').trim().slice(0, 180) || null;
  const rows = await sql.query(
    `UPDATE ops_reports
     SET gps = $2, status = 'Completed', gps_lookup_status = $3, gps_lookup_message = $4,
         gps_sync_status = NULL, gps_sync_message = NULL,
         driver_name = COALESCE(NULLIF(driver_name, ''), $5),
         driver_id = COALESCE(NULLIF(driver_id, ''), $6)
     WHERE id = $1
     RETURNING ${reportColumns()}`,
    [reportId, state.gps, state.status, state.message, driverName, driverId],
  );
  return rows[0];
}

async function fetchFmsGps(binding, capturedAt) {
  const endpoint = process.env.SONGDEE_FMS_GPS_API_URL || process.env.SONGDEE_GPS_MOTION_API_URL;
  if (!endpoint) return { status: 'not_configured', gps: null, message: 'FMS GPS adapter is not configured.' };
  const upstream = parseHttpAdapterUrl(endpoint, { allowHttp: process.env.NODE_ENV !== 'production' });
  if (!upstream) return { status: 'unavailable', gps: null, message: 'FMS GPS adapter URL is invalid.' };
  upstream.searchParams.set('vehicleNumber', binding.vehicleNumber);
  upstream.searchParams.set('deviceId', binding.deviceId);
  upstream.searchParams.set('capturedAt', capturedAt);
  try {
    const response = await fetch(upstream, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return { status: 'unavailable', gps: null, message: `FMS GPS API returned HTTP ${response.status}.` };
    return { status: 'received', gps: await parseUpstreamBody(response), message: 'FMS GPS sample received.' };
  } catch {
    return { status: 'unavailable', gps: null, message: 'FMS GPS API unavailable.' };
  }
}

function configuredGpsPairToleranceMs() {
  const configured = Number(process.env.SONGDEE_GPS_PAIR_TOLERANCE_SECONDS);
  return Number.isFinite(configured) && configured > 0 && configured <= 900
    ? Math.round(configured * 1000)
    : DEFAULT_GPS_PAIR_TOLERANCE_MS;
}

function dataFmOptions() {
  return {
    baseUrl: process.env.SONGDEE_DATA_FM_BASE_URL || process.env.FLEET_DATA_FM_BASE_URL,
    username: process.env.SONGDEE_DATA_FM_USERNAME || process.env.FLEET_DATA_FM_USERNAME,
    password: process.env.SONGDEE_DATA_FM_PASSWORD || process.env.FLEET_DATA_FM_PASSWORD,
    timeZone: process.env.SONGDEE_DATA_FM_TIME_ZONE || process.env.FLEET_DATA_FM_TIME_ZONE,
    allowHttp: process.env.NODE_ENV !== 'production',
  };
}

function dataFmEnvironmentSelected() {
  const options = dataFmOptions();
  return Boolean(options.username || options.password);
}

async function fetchExternalGpsSource({ endpoint, token, sourceName, vehicleNumber, targetAt, toleranceMs }) {
  if (!endpoint) return { status: 'not_configured', payload: null, message: `${sourceName} adapter is not configured.` };
  const upstream = parseHttpAdapterUrl(endpoint, { allowHttp: process.env.NODE_ENV !== 'production' });
  if (!upstream) return { status: 'unavailable', payload: null, message: `${sourceName} adapter URL is invalid.` };
  const targetMs = Date.parse(targetAt);
  upstream.searchParams.set('vehicleNumber', vehicleNumber);
  upstream.searchParams.set('capturedAt', targetAt);
  upstream.searchParams.set('from', new Date(targetMs - toleranceMs).toISOString());
  upstream.searchParams.set('to', new Date(targetMs + toleranceMs).toISOString());
  try {
    const response = await fetch(upstream, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { status: 'unavailable', payload: null, message: `${sourceName} API returned HTTP ${response.status}.` };
    return { status: 'received', payload: await parseUpstreamBody(response), message: `${sourceName} response received.` };
  } catch {
    return { status: 'unavailable', payload: null, message: `${sourceName} API unavailable.` };
  }
}

async function fetchDeviceGpsSource({ vehicleNumber, targetAt, toleranceMs }) {
  if (dataFmEnvironmentSelected()) {
    return fetchDataFmGpsHistory({ ...dataFmOptions(), vehicleNumber, targetAt, toleranceMs });
  }
  return fetchExternalGpsSource({
    endpoint: process.env.SONGDEE_DEVICE_GPS_API_URL,
    token: process.env.SONGDEE_DEVICE_GPS_API_TOKEN,
    sourceName: 'GPS device server',
    vehicleNumber,
    targetAt,
    toleranceMs,
  });
}

async function reconcileExternalGpsForJob(job, targetAt) {
  const toleranceMs = configuredGpsPairToleranceMs();
  const [deviceSource, fmsSource] = await Promise.all([
    fetchDeviceGpsSource({ vehicleNumber: job.vehicleNumber, targetAt, toleranceMs }),
    fetchExternalGpsSource({
      endpoint: process.env.SONGDEE_FMS_GPS_API_URL,
      token: process.env.SONGDEE_FMS_GPS_API_TOKEN,
      sourceName: 'Howen FMS GPS',
      vehicleNumber: job.vehicleNumber,
      targetAt,
      toleranceMs,
    }),
  ]);
  const pairing = pairExternalGpsSources(deviceSource.payload, fmsSource.payload, targetAt, toleranceMs);
  if (!pairing.deviceGps) {
    const deviceStatus = deviceSource.status === 'received' ? 'no_time_match' : deviceSource.status;
    return {
      gpsSync: null,
      driverIdentity: deviceSource.driverIdentity || null,
      deviceSource: { status: deviceStatus, message: deviceStatus === 'no_time_match' ? deviceSource.message || 'No GPS fix was found inside the time window.' : deviceSource.message },
      fmsSource: { status: fmsSource.status, message: fmsSource.message },
      pairStatus: pairing.pairStatus,
      toleranceMs,
    };
  }
  const deviceGps = pairing.deviceGps;
  const fmsGps = pairing.fmsGps;
  const fmsStatus = fmsGps ? 'received' : fmsSource.status === 'received' ? 'unavailable' : fmsSource.status;
  const pairStatus = fmsGps
    ? 'paired'
    : fmsStatus === 'not_configured' ? 'device_only' : 'fms_delayed';
  const sampleId = `GPS-${crypto.createHash('sha256').update(`${job.id}\0${deviceGps.capturedAt}`).digest('hex').slice(0, 40)}`;
  const fmsPayload = fmsGps?.raw == null ? null : JSON.stringify(fmsGps.raw);
  const sql = getDatabase();
  await sql`
    INSERT INTO gps_sync_samples (
      id, job_id, vehicle_number, device_id, captured_at,
      device_latitude, device_longitude, device_accuracy_m, device_speed_mps, device_heading_deg,
      fms_payload, fms_status, fms_message, fms_captured_at,
      fms_latitude, fms_longitude, fms_speed_mps,
      position_delta_m, time_delta_ms, pair_status, synced_at
    ) VALUES (
      ${sampleId}, ${job.id}, ${job.vehicleNumber}, ${job.deviceId}, ${deviceGps.capturedAt},
      ${deviceGps.latitude}, ${deviceGps.longitude}, ${deviceGps.accuracy}, ${deviceGps.speedMps}, ${deviceGps.headingDegrees},
      ${fmsPayload}::jsonb, ${fmsStatus}, ${fmsGps ? 'Time-matched Howen FMS sample received.' : fmsSource.status === 'received' ? 'Howen FMS returned no fix inside the time window.' : fmsSource.message}, ${fmsGps?.capturedAt || null},
      ${fmsGps?.latitude ?? null}, ${fmsGps?.longitude ?? null}, ${fmsGps?.speedMps ?? null},
      ${pairing.positionDeltaM}, ${pairing.timeDeltaMs}, ${pairStatus}, now()
    )
    ON CONFLICT (id) DO UPDATE SET
      fms_payload = CASE WHEN gps_sync_samples.fms_status = 'received' AND EXCLUDED.fms_status <> 'received' THEN gps_sync_samples.fms_payload ELSE EXCLUDED.fms_payload END,
      fms_status = CASE WHEN gps_sync_samples.fms_status = 'received' AND EXCLUDED.fms_status <> 'received' THEN gps_sync_samples.fms_status ELSE EXCLUDED.fms_status END,
      fms_message = CASE WHEN gps_sync_samples.fms_status = 'received' AND EXCLUDED.fms_status <> 'received' THEN gps_sync_samples.fms_message ELSE EXCLUDED.fms_message END,
      fms_captured_at = CASE WHEN gps_sync_samples.fms_status = 'received' AND EXCLUDED.fms_status <> 'received' THEN gps_sync_samples.fms_captured_at ELSE EXCLUDED.fms_captured_at END,
      fms_latitude = CASE WHEN gps_sync_samples.fms_status = 'received' AND EXCLUDED.fms_status <> 'received' THEN gps_sync_samples.fms_latitude ELSE EXCLUDED.fms_latitude END,
      fms_longitude = CASE WHEN gps_sync_samples.fms_status = 'received' AND EXCLUDED.fms_status <> 'received' THEN gps_sync_samples.fms_longitude ELSE EXCLUDED.fms_longitude END,
      fms_speed_mps = CASE WHEN gps_sync_samples.fms_status = 'received' AND EXCLUDED.fms_status <> 'received' THEN gps_sync_samples.fms_speed_mps ELSE EXCLUDED.fms_speed_mps END,
      position_delta_m = CASE WHEN gps_sync_samples.fms_status = 'received' AND EXCLUDED.fms_status <> 'received' THEN gps_sync_samples.position_delta_m ELSE EXCLUDED.position_delta_m END,
      time_delta_ms = CASE WHEN gps_sync_samples.fms_status = 'received' AND EXCLUDED.fms_status <> 'received' THEN gps_sync_samples.time_delta_ms ELSE EXCLUDED.time_delta_ms END,
      pair_status = CASE WHEN gps_sync_samples.fms_status = 'received' AND EXCLUDED.fms_status <> 'received' THEN gps_sync_samples.pair_status ELSE EXCLUDED.pair_status END,
      synced_at = CASE WHEN gps_sync_samples.fms_status = 'received' AND EXCLUDED.fms_status <> 'received' THEN gps_sync_samples.synced_at ELSE now() END
  `;
  await refreshJobGpsSummary(job.id);
  return {
    gpsSync: await getGpsSample(sampleId),
    driverIdentity: deviceSource.driverIdentity || null,
    deviceSource: { status: deviceSource.status, message: deviceSource.message },
    fmsSource: { status: fmsSource.status, message: fmsSource.message },
    pairStatus,
    toleranceMs,
  };
}

async function getGpsSample(id) {
  const sql = getDatabase();
  const rows = await sql`
    SELECT
      id,
      job_id AS "jobId",
      vehicle_number AS "vehicleNumber",
      device_id AS "deviceId",
      captured_at AS "capturedAt",
      json_build_object(
        'latitude', device_latitude,
        'longitude', device_longitude,
        'accuracy', device_accuracy_m,
        'speedMps', device_speed_mps,
        'headingDegrees', device_heading_deg
      ) AS "deviceGps",
      fms_payload AS "fmsGps",
      fms_status AS "fmsStatus",
      fms_message AS "fmsMessage",
      fms_captured_at AS "fmsCapturedAt",
      fms_latitude AS "fmsLatitude",
      fms_longitude AS "fmsLongitude",
      fms_speed_mps AS "fmsSpeedMps",
      position_delta_m AS "positionDeltaM",
      time_delta_ms AS "timeDeltaMs",
      pair_status AS "pairStatus",
      synced_at AS "syncedAt"
    FROM gps_sync_samples WHERE id = ${id} LIMIT 1
  `;
  return rows[0] || null;
}

function sameGpsSample(existing, input) {
  return existing.vehicleNumber === input.vehicleNumber
    && existing.deviceId === input.deviceId
    && new Date(existing.capturedAt).toISOString() === input.capturedAt
    && Number(existing.deviceGps?.latitude) === input.latitude
    && Number(existing.deviceGps?.longitude) === input.longitude
    && (existing.deviceGps?.accuracy == null ? null : Number(existing.deviceGps.accuracy)) === input.accuracy
    && (existing.deviceGps?.speedMps == null ? null : Number(existing.deviceGps.speedMps)) === input.speedMps
    && (existing.deviceGps?.headingDegrees == null ? null : Number(existing.deviceGps.headingDegrees)) === input.headingDegrees;
}

async function refreshJobGpsSummary(jobId) {
  if (!jobId) return;
  const sql = getDatabase();
  await sql`
    INSERT INTO job_gps_summaries (
      job_id, vehicle_number, device_id, device_samples, fms_samples,
      paired_samples, attention_samples, last_device_latitude, last_device_longitude,
      last_fms_latitude, last_fms_longitude, last_captured_at,
      median_position_delta_m, updated_at
    )
    SELECT
      job_id,
      (array_agg(vehicle_number ORDER BY captured_at DESC))[1],
      (array_agg(device_id ORDER BY captured_at DESC))[1],
      count(*)::int,
      count(*) FILTER (WHERE fms_status = 'received')::int,
      count(*) FILTER (WHERE pair_status = 'paired')::int,
      count(*) FILTER (WHERE pair_status IN ('device_only', 'fms_delayed', 'fms_received'))::int,
      (array_agg(device_latitude ORDER BY captured_at DESC))[1],
      (array_agg(device_longitude ORDER BY captured_at DESC))[1],
      (array_agg(fms_latitude ORDER BY captured_at DESC) FILTER (WHERE fms_latitude IS NOT NULL))[1],
      (array_agg(fms_longitude ORDER BY captured_at DESC) FILTER (WHERE fms_longitude IS NOT NULL))[1],
      max(captured_at),
      percentile_cont(0.5) WITHIN GROUP (ORDER BY position_delta_m) FILTER (WHERE position_delta_m IS NOT NULL),
      now()
    FROM gps_sync_samples
    WHERE job_id = ${jobId}
    GROUP BY job_id
    ON CONFLICT (job_id) DO UPDATE SET
      vehicle_number = EXCLUDED.vehicle_number,
      device_id = EXCLUDED.device_id,
      device_samples = EXCLUDED.device_samples,
      fms_samples = EXCLUDED.fms_samples,
      paired_samples = EXCLUDED.paired_samples,
      attention_samples = EXCLUDED.attention_samples,
      last_device_latitude = EXCLUDED.last_device_latitude,
      last_device_longitude = EXCLUDED.last_device_longitude,
      last_fms_latitude = EXCLUDED.last_fms_latitude,
      last_fms_longitude = EXCLUDED.last_fms_longitude,
      last_captured_at = EXCLUDED.last_captured_at,
      median_position_delta_m = EXCLUDED.median_position_delta_m,
      updated_at = now()
  `;
}

async function linkGpsSamplesToReport(report) {
  const sql = getDatabase();
  await sql`
    UPDATE gps_sync_samples
    SET job_id = ${report.id}
    WHERE job_id IS NULL
      AND vehicle_number = ${report.vehicleNumber}
      AND device_id = ${report.deviceId}
      AND captured_at BETWEEN ${report.startTime}::timestamptz AND ${report.endTime}::timestamptz
  `;
  await refreshJobGpsSummary(report.id);
}

async function linkGpsSamplesToActiveJob(job) {
  const sql = getDatabase();
  await sql`
    UPDATE gps_sync_samples
    SET job_id = ${job.id}
    WHERE job_id IS NULL
      AND vehicle_number = ${job.vehicleNumber}
      AND device_id = ${job.deviceId}
      AND captured_at >= ${job.startTime}::timestamptz
      AND captured_at <= now()
  `;
  await refreshJobGpsSummary(job.id);
}

function positivePageValue(value, fallback, maximum) {
  const result = Math.trunc(Number(value));
  return Number.isFinite(result) && result > 0 ? Math.min(result, maximum) : fallback;
}

async function getJobGpsDetail(request, reportId) {
  const report = await getReport(reportId);
  if (!report) throw new ApiError(404, 'Report not found');
  const query = new URL(request.url).searchParams;
  const page = positivePageValue(query.get('page'), 1, 100_000);
  const pageSize = positivePageValue(query.get('pageSize'), 100, 200);
  const offset = (page - 1) * pageSize;
  const sql = getDatabase();
  const [samples, summaryRows] = await sql.transaction(transaction => [
    transaction.query(`
      SELECT
        id,
        job_id AS "jobId",
        captured_at AS "capturedAt",
        json_build_object(
          'latitude', device_latitude,
          'longitude', device_longitude,
          'accuracy', device_accuracy_m,
          'speedMps', device_speed_mps,
          'headingDegrees', device_heading_deg
        ) AS "deviceGps",
        CASE WHEN fms_status = 'received' THEN json_build_object(
          'capturedAt', fms_captured_at,
          'latitude', fms_latitude,
          'longitude', fms_longitude,
          'speedMps', fms_speed_mps
        ) ELSE NULL END AS "fmsGps",
        fms_status AS "fmsStatus",
        fms_message AS "fmsMessage",
        position_delta_m AS "positionDeltaM",
        time_delta_ms AS "timeDeltaMs",
        pair_status AS "pairStatus",
        synced_at AS "syncedAt"
      FROM gps_sync_samples
      WHERE job_id = $1
      ORDER BY captured_at DESC, id DESC
      LIMIT $2 OFFSET $3
    `, [reportId, pageSize, offset]),
    transaction.query(`
      SELECT
        COALESCE(device_samples, 0)::int AS "deviceSamples",
        COALESCE(fms_samples, 0)::int AS "fmsSamples",
        COALESCE(paired_samples, 0)::int AS "pairedSamples",
        COALESCE(attention_samples, 0)::int AS "attentionSamples",
        last_captured_at AS "lastCapturedAt",
        median_position_delta_m AS "medianPositionDeltaM"
      FROM job_gps_summaries
      WHERE job_id = $1
    `, [reportId]),
  ]);
  const summary = summaryRows[0] || {
    deviceSamples: 0,
    fmsSamples: 0,
    pairedSamples: 0,
    attentionSamples: 0,
    lastCapturedAt: null,
    medianPositionDeltaM: null,
  };
  const total = Number(summary.deviceSamples || 0);
  return {
    report,
    gpsSummary: summary,
    samples,
    pageInfo: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      start: samples.length ? offset + 1 : 0,
      end: offset + samples.length,
    },
  };
}

async function proxyDriverIdentity(request) {
  const query = new URL(request.url).searchParams;
  const deviceId = String(query.get('deviceId') || '').trim();
  const requestedVehicleNumber = String(query.get('vehicleNumber') || '').trim();
  const binding = await findBinding(deviceId || undefined);
  const vehicleNumber = binding?.vehicleNumber || null;
  const resolvedDeviceId = binding?.deviceId || deviceId || null;
  if (!resolvedDeviceId) throw new ApiError(400, 'deviceId is required');
  await authenticateDeviceRequest(request, resolvedDeviceId);
  await consumeRateLimit(request, 'device-read', 240, 15 * 60, resolvedDeviceId);
  if (requestedVehicleNumber && requestedVehicleNumber !== vehicleNumber) {
    return json({ driverIdentity: null, vehicleNumber, deviceId: resolvedDeviceId, sourceStatus: 'binding_changed' });
  }
  const endpoint = process.env.SONGDEE_DRIVER_IDENTITY_API_URL;
  if (!vehicleNumber || !resolvedDeviceId) {
    return json({ driverIdentity: null, vehicleNumber, deviceId: resolvedDeviceId });
  }
  if (!endpoint && dataFmEnvironmentSelected()) {
    const result = await fetchDataFmDriverIdentity({ ...dataFmOptions(), vehicleNumber });
    return json({
      driverIdentity: result.driverIdentity,
      vehicleNumber,
      deviceId: resolvedDeviceId,
      sourceStatus: result.status,
    });
  }
  if (!endpoint) return json({ driverIdentity: null, vehicleNumber, deviceId: resolvedDeviceId });
  const upstream = parseHttpAdapterUrl(endpoint, { allowHttp: process.env.NODE_ENV !== 'production' });
  if (!upstream) return json({ driverIdentity: null, vehicleNumber, deviceId: resolvedDeviceId, sourceStatus: 'misconfigured' });
  upstream.searchParams.set('vehicleNumber', vehicleNumber);
  upstream.searchParams.set('deviceId', resolvedDeviceId);
  try {
    const response = await fetch(upstream, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return json({ driverIdentity: null, vehicleNumber, deviceId: resolvedDeviceId, sourceStatus: response.status });
    return json({ driverIdentity: await parseUpstreamBody(response), vehicleNumber, deviceId: resolvedDeviceId });
  } catch {
    return json({ driverIdentity: null, vehicleNumber, deviceId: resolvedDeviceId, sourceStatus: 'unavailable' });
  }
}

async function proxyVehicleMotion(request) {
  const query = new URL(request.url).searchParams;
  const deviceId = String(query.get('deviceId') || '').trim();
  const binding = await findBinding(deviceId || undefined);
  const vehicleNumber = binding?.vehicleNumber || null;
  const resolvedDeviceId = binding?.deviceId || deviceId || null;
  if (!resolvedDeviceId) throw new ApiError(400, 'deviceId is required');
  await authenticateDeviceRequest(request, resolvedDeviceId);
  await consumeRateLimit(request, 'device-motion', 600, 15 * 60, resolvedDeviceId);
  const endpoint = process.env.SONGDEE_GPS_MOTION_API_URL;
  if (!endpoint || !vehicleNumber || !resolvedDeviceId) {
    return json({ moving: null, speed: null, vehicleNumber, deviceId: resolvedDeviceId, sourceStatus: 'not_configured' });
  }
  const upstream = parseHttpAdapterUrl(endpoint, { allowHttp: process.env.NODE_ENV !== 'production' });
  if (!upstream) return json({ moving: null, speed: null, vehicleNumber, deviceId: resolvedDeviceId, sourceStatus: 'misconfigured' });
  upstream.searchParams.set('vehicleNumber', vehicleNumber);
  upstream.searchParams.set('deviceId', resolvedDeviceId);
  try {
    const response = await fetch(upstream, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return json({ moving: null, speed: null, vehicleNumber, deviceId: resolvedDeviceId, sourceStatus: 'unavailable' });
    const payload = await parseUpstreamBody(response);
    return json({ ...(payload || {}), vehicleNumber, deviceId: resolvedDeviceId, sourceStatus: 'configured' });
  } catch {
    return json({ moving: null, speed: null, vehicleNumber, deviceId: resolvedDeviceId, sourceStatus: 'unavailable' });
  }
}

async function routeRequest(request, route) {
  const method = request.method;
  let routeDatabase;
  const database = () => routeDatabase ??= getDatabase();

  if (route === 'health' && method === 'GET') {
    await checkDatabase();
    return json(songdeeApiHealth({ database: 'connected' }));
  }

  if (route === 'admin/login' && method === 'POST') {
    const loginSubject = requestClientAddress(request);
    const input = await readJson(request);
    await consumeRateLimit(request, 'admin-login', 8, 15 * 60, loginSubject);
    const settings = await ensureAdminSettings();
    if (!verifyPassword(String(input.password || ''), settings.admin_password_hash)) {
      throw new ApiError(401, 'Invalid password');
    }
    await clearRateLimit('admin-login', loginSubject);
    return json({
      token: createAdminToken(settings.admin_auth_version, adminTokenSecret()),
      expiresIn: ADMIN_SESSION_LIFETIME_MS,
    });
  }

  if (route === 'reports' && method === 'GET') {
    await requireAdmin(request);
    return json(await getReportsPage(request));
  }

  if (route === 'admin/reports/facets' && method === 'GET') {
    await requireAdmin(request);
    return json({ facets: await getReportFacets() });
  }

  const gpsDetailMatch = route.match(/^admin\/reports\/([^/]+)\/gps$/);
  if (gpsDetailMatch && method === 'GET') {
    await requireAdmin(request);
    const reportId = validClientId(decodeURIComponent(gpsDetailMatch[1]));
    if (!reportId) throw new ApiError(400, 'A valid report id is required');
    return json(await getJobGpsDetail(request, reportId));
  }

  if (route === 'device-config' && method === 'GET') {
    const deviceId = new URL(request.url).searchParams.get('deviceId') || undefined;
    if (!deviceId) throw new ApiError(400, 'deviceId is required');
    await consumeRateLimit(request, 'device-config-read', 120, 15 * 60);
    await authenticateDeviceRequest(request, deviceId, '', { allowPendingCredentialMismatch: true });
    return json({ deviceConfig: await findBinding(deviceId), deviceAuth: await deviceAuthStatus(deviceId) });
  }

  if (route === 'device-config' && method === 'POST') {
    await consumeRateLimit(request, 'device-enrollment', 20, 60 * 60);
    const { input, raw } = await readJsonPayload(request);
    const vehicleNumber = requiredText(input.vehicleNumber, 'vehicleNumber', 80);
    const deviceId = requiredText(input.deviceId, 'deviceId', 180);
    await authenticateDeviceRequest(request, deviceId, raw);
    return json(await createInitialBinding(vehicleNumber, deviceId));
  }

  if (route === 'device-config/rebind' && method === 'POST') {
    const { input, raw } = await readJsonPayload(request);
    const vehicleNumber = requiredText(input.vehicleNumber, 'vehicleNumber', 80);
    const deviceId = requiredText(input.deviceId, 'deviceId', 180);
    const password = String(input.password || '');
    await authenticateDeviceRequest(request, deviceId, raw);
    await consumeRateLimit(request, 'device-rebind', 8, 15 * 60, deviceId);
    const settings = await ensureAdminSettings();
    if (!verifyPassword(password, settings.admin_password_hash)) {
      throw new ApiError(401, 'Invalid password');
    }
    const deviceConfig = await saveAdminBinding(vehicleNumber, deviceId);
    await clearRateLimit('device-rebind', deviceId);
    return json({ deviceConfig });
  }

  if (route === 'device-credentials/claim' && method === 'POST') {
    await consumeRateLimit(request, 'device-credential-claim', 12, 60 * 60);
    const input = await readJson(request);
    const vehicleNumber = requiredText(input.vehicleNumber, 'vehicleNumber', 80);
    const deviceId = requiredText(input.deviceId, 'deviceId', 180);
    const binding = await findBinding(deviceId);
    if (!binding || binding.vehicleNumber !== vehicleNumber) {
      throw new ApiError(409, 'Vehicle and device binding does not match.', { code: 'DEVICE_BINDING_MISMATCH' });
    }
    const deviceCredential = await issuePendingDeviceCredential(deviceId);
    if (!deviceCredential) {
      throw new ApiError(409, 'Device access must be reset from Fleet admin.', { code: 'DEVICE_ACCESS_RESET_REQUIRED' });
    }
    return json({ deviceCredential, deviceAuth: await deviceAuthStatus(deviceId) });
  }

  if (route === 'driver-identity' && method === 'GET') return proxyDriverIdentity(request);
  if (route === 'vehicle-motion' && method === 'GET') return proxyVehicleMotion(request);

  if (route === 'device-jobs' && method === 'GET') {
    const query = new URL(request.url).searchParams;
    const deviceId = requiredText(query.get('deviceId'), 'deviceId', 180);
    const vehicleNumber = requiredText(query.get('vehicleNumber'), 'vehicleNumber', 80);
    await authenticateDeviceRequest(request, deviceId);
    await consumeRateLimit(request, 'device-job-history', 120, 15 * 60, deviceId);
    const binding = await findBinding(deviceId);
    if (!binding || binding.vehicleNumber !== vehicleNumber) {
      throw new ApiError(409, 'Vehicle and device binding does not match.', { code: 'DEVICE_BINDING_MISMATCH' });
    }
    return json(await getDeviceJobs(deviceId, vehicleNumber, query));
  }

  if (route === 'job-starts' && method === 'POST') {
    const { input, raw } = await readJsonPayload(request);
    const jobId = validClientId(input.id);
    if (!jobId) throw new ApiError(400, 'id is required');
    const vehicleNumber = requiredText(input.vehicleNumber, 'vehicleNumber', 80);
    const deviceId = requiredText(input.deviceId, 'deviceId', 180);
    await authenticateDeviceRequest(request, deviceId, raw);
    await consumeRateLimit(request, 'device-job-write', 120, 15 * 60, deviceId);
    const mode = requiredText(input.mode, 'mode', 80);
    if (!allowedModes.has(mode)) throw new ApiError(400, 'mode is not one of the supported operations');
    const start = requiredDate(input.startTime, 'startTime');
    const driverName = optionalText(input.driverName, 'driverName', 180);
    const driverId = optionalText(input.driverId, 'driverId', 180);
    if (!await bindingWasValid(deviceId, vehicleNumber, start.iso)) {
      throw new ApiError(409, 'Vehicle and device were not connected when this job started.');
    }
    const inputShape = { vehicleNumber, deviceId, driverName, driverId, mode, startTime: start.iso };
    const sql = database();
    const completed = await getReport(jobId);
    if (completed) {
      if (!sameJobStart(completed, inputShape)) throw new ApiError(409, 'Job id is already used by different data.');
      await sql`DELETE FROM active_jobs WHERE id = ${jobId}`;
      await linkGpsSamplesToReport(completed);
      return json({ jobStart: null, closed: true, deduplicated: true });
    }
    const activeForDevice = await getActiveJobForDevice(deviceId);
    if (activeForDevice && activeForDevice.id !== jobId) {
      throw new ApiError(409, 'Device already has an active job.');
    }
    const rows = await sql.query(
      `INSERT INTO active_jobs (id, vehicle_number, device_id, driver_name, driver_id, mode, start_time)
       SELECT $1,$2,$3,$4,$5,$6,$7
       WHERE NOT EXISTS (SELECT 1 FROM ops_reports WHERE id = $1)
       ON CONFLICT (id) DO NOTHING
       RETURNING ${activeJobColumns()}`,
      [jobId, vehicleNumber, deviceId, driverName, driverId, mode, start.iso],
    );
    if (rows.length) {
      await linkGpsSamplesToActiveJob(rows[0]);
      return json({ jobStart: rows[0] }, 201);
    }
    const completedAfterInsert = await getReport(jobId);
    if (completedAfterInsert) {
      if (!sameJobStart(completedAfterInsert, inputShape)) throw new ApiError(409, 'Job id is already used by different data.');
      await sql`DELETE FROM active_jobs WHERE id = ${jobId}`;
      await linkGpsSamplesToReport(completedAfterInsert);
      return json({ jobStart: null, closed: true, deduplicated: true });
    }
    const existing = await getActiveJob(jobId);
    if (!existing || !sameJobStart(existing, inputShape)) throw new ApiError(409, 'Job id is already used by different data.');
    await linkGpsSamplesToActiveJob(existing);
    return json({ jobStart: existing, deduplicated: true });
  }

  if (route === 'job-gps-sync' && method === 'POST') {
    const { input, raw } = await readJsonPayload(request);
    const jobId = validClientId(input.jobId);
    const vehicleNumber = requiredText(input.vehicleNumber, 'vehicleNumber', 80);
    const deviceId = requiredText(input.deviceId, 'deviceId', 180);
    const targetAt = requiredDate(input.targetAt, 'targetAt').iso;
    if (!jobId) throw new ApiError(400, 'A valid jobId is required');
    await authenticateDeviceRequest(request, deviceId, raw);
    await consumeRateLimit(request, 'job-gps-sync', 180, 15 * 60, deviceId);
    const job = await getActiveJob(jobId) || await getReport(jobId);
    if (!job) throw new ApiError(404, 'Job not found');
    if (job.vehicleNumber !== vehicleNumber || job.deviceId !== deviceId) {
      throw new ApiError(409, 'Job does not belong to this vehicle and Android device.');
    }
    if (job.status === 'Cancelled') throw new ApiError(409, 'Cancelled jobs do not require GPS lookup');
    const targetMs = Date.parse(targetAt);
    const startMs = Date.parse(job.startTime);
    const endMs = job.endTime ? Date.parse(job.endTime) : Date.now() + DEFAULT_GPS_PAIR_TOLERANCE_MS;
    if (targetMs < startMs || targetMs > endMs) {
      throw new ApiError(409, 'GPS reconciliation time is outside the job window.');
    }
    const gpsReconciliation = await reconcileExternalGpsForJob(job, targetAt);
    const report = job.endTime ? await updateReportGpsLookupState(job.id, gpsReconciliation) : null;
    return json({ ...gpsReconciliation, ...(report ? { report } : {}) });
  }

  if (route === 'gps-sync' && method === 'POST') {
    throw new ApiError(410, 'Tablet GPS ingestion has been removed; use job GPS reconciliation.');
  }

  if (route === 'admin/device-bindings' && method === 'GET') {
    await requireAdmin(request);
    return json({ deviceBindings: await allBindings() });
  }

  if (route === 'admin/device-bindings/import' && method === 'POST') {
    await requireAdmin(request);
    const input = await readJson(request, maximumBulkJsonBodyBytes);
    return json({ importResult: await importAdminBindings(input.bindings) });
  }

  if (route === 'admin/device-config' && method === 'POST') {
    await requireAdmin(request);
    const input = await readJson(request);
    const vehicleNumber = requiredText(input.vehicleNumber, 'vehicleNumber', 80);
    const deviceId = requiredText(input.deviceId, 'deviceId', 180);
    const deviceConfig = await saveAdminBinding(vehicleNumber, deviceId);
    return json({ deviceConfig, deviceBindings: await allBindings() });
  }

  if (route === 'admin/device-config' && method === 'DELETE') {
    await requireAdmin(request);
    const input = await readJson(request);
    const deviceId = requiredText(input.deviceId, 'deviceId', 180);
    const removed = await removeBinding(deviceId);
    if (!removed) throw new ApiError(404, 'Device binding not found');
    return json({ deviceBindings: await allBindings(), deviceConfig: null });
  }

  if (route === 'admin/device-credentials/reset' && method === 'POST') {
    await requireAdmin(request);
    const input = await readJson(request);
    const deviceId = requiredText(input.deviceId, 'deviceId', 180);
    if (!await findBinding(deviceId)) throw new ApiError(404, 'Device binding not found');
    await resetDeviceCredential(deviceId);
    return json({ ok: true, deviceAuth: await deviceAuthStatus(deviceId) });
  }

  if (route === 'admin/password' && method === 'POST') {
    await requireAdmin(request);
    const input = await readJson(request);
    const currentPassword = String(input.currentPassword || '');
    const newPassword = String(input.newPassword || '');
    const settings = await ensureAdminSettings();
    if (!verifyPassword(currentPassword, settings.admin_password_hash)) {
      throw new ApiError(400, 'Current admin password is incorrect');
    }
    if (newPassword.length < 12 || newPassword.length > 128) {
      throw new ApiError(400, 'New admin password must be 12 to 128 characters');
    }
    if (newPassword === currentPassword) throw new ApiError(400, 'New admin password must be different');
    const sql = database();
    const nextVersion = crypto.randomUUID();
    const nextPasswordHash = hashPassword(newPassword);
    const [changed] = await sql`
      WITH password_change AS (
        UPDATE app_settings
        SET setting_value = ${nextPasswordHash}, updated_at = now()
        WHERE setting_key = 'admin_password_hash'
          AND setting_value = ${settings.admin_password_hash}
        RETURNING 1
      ), auth_change AS (
        UPDATE app_settings
        SET setting_value = ${nextVersion}, updated_at = now()
        WHERE setting_key = 'admin_auth_version'
          AND EXISTS (SELECT 1 FROM password_change)
        RETURNING 1
      )
      SELECT
        EXISTS (SELECT 1 FROM password_change) AS "passwordChanged",
        EXISTS (SELECT 1 FROM auth_change) AS "authChanged"
    `;
    if (!changed?.passwordChanged || !changed?.authChanged) {
      throw new ApiError(401, 'Admin password changed by another administrator. Sign in again.');
    }
    return json({ ok: true });
  }

  if (route === 'admin/reports/retry' && method === 'POST') {
    await requireAdmin(request);
    const input = await readJson(request);
    const reportId = requiredText(input.reportId, 'reportId', 180);
    const report = await getReport(reportId);
    if (!report) throw new ApiError(404, 'Report not found');
    if (report.status === 'Cancelled') throw new ApiError(409, 'Cancelled jobs do not require GPS lookup');
    const gpsReconciliation = await reconcileExternalGpsForJob(report, report.endTime);
    return json({ report: await updateReportGpsLookupState(reportId, gpsReconciliation), gpsReconciliation });
  }

  if (route === 'reports' && method === 'POST') {
    const { input, raw } = await readJsonPayload(request);
    const reportId = validClientId(input.id) || `OPS-${crypto.randomUUID()}`;
    const vehicleNumber = requiredText(input.vehicleNumber, 'vehicleNumber', 80);
    const deviceId = requiredText(input.deviceId, 'deviceId', 180);
    await authenticateDeviceRequest(request, deviceId, raw);
    await consumeRateLimit(request, 'device-report-write', 120, 15 * 60, deviceId);
    const mode = requiredText(input.mode, 'mode', 80);
    if (!allowedModes.has(mode)) throw new ApiError(400, 'mode is not one of the supported operations');
    const start = requiredDate(input.startTime, 'startTime');
    const end = requiredDate(input.endTime, 'endTime');
    if (end.milliseconds < start.milliseconds) throw new ApiError(400, 'endTime must be after startTime');
    if (!await bindingWasValid(deviceId, vehicleNumber, start.iso)) {
      throw new ApiError(409, 'Vehicle and device were not connected when this job started.');
    }
    const cancelled = input.status === 'Cancelled';
    const driverName = optionalText(input.driverName, 'driverName', 180);
    const driverId = optionalText(input.driverId, 'driverId', 180);
    const sql = database();
    const rows = await sql.query(
      `INSERT INTO ops_reports (
        id, vehicle_number, device_id, driver_name, driver_id, mode,
        start_time, end_time, duration, gps, status,
        gps_lookup_status, gps_lookup_message
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO NOTHING
      RETURNING ${reportColumns()}`,
      [
        reportId,
        vehicleNumber,
        deviceId,
        driverName,
        driverId,
        mode,
        start.iso,
        end.iso,
        formatDurationMs(end.milliseconds - start.milliseconds),
        cancelled ? 'Not applicable' : 'Pending GPS lookup',
        cancelled ? 'Cancelled' : 'Completed',
        cancelled ? 'not_applicable' : 'pending',
        cancelled ? 'Cancelled job recorded.' : 'Waiting for GPS lookup.',
      ],
    );
    const inputShape = { vehicleNumber, deviceId, driverName, driverId, mode, startTime: start.iso, endTime: end.iso, cancelled };
    if (!rows.length) {
      const existing = await getReport(reportId);
      if (!existing || !sameReport(existing, inputShape)) {
        throw new ApiError(409, 'Report id is already used by a different job.');
      }
      await sql`DELETE FROM active_jobs WHERE id = ${reportId}`;
      await linkGpsSamplesToReport(existing);
      return json({ report: existing, deduplicated: true });
    }
    await sql`DELETE FROM active_jobs WHERE id = ${reportId}`;
    await linkGpsSamplesToReport(rows[0]);
    if (cancelled) {
      return json({
        report: rows[0],
        gpsLookup: { status: 'not_applicable', message: 'Cancelled job recorded.' },
      }, 201);
    }
    return json({ report: rows[0], gpsLookup: { status: 'pending', message: 'Waiting for GPS lookup.' } }, 201);
  }

  throw new ApiError(404, 'Not found');
}

export async function handleApiRequest(request, segments = []) {
  if (request.method === 'OPTIONS') return empty();
  const route = segments.join('/');
  try {
    return await routeRequest(request, route);
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status, error.headers);
    if (error instanceof ConfigurationError) return json({ error: error.message }, 503);
    if (error?.code === '23505') {
      if (String(error.constraint || '').includes('active_jobs_one_per_device')) {
        return json({ error: 'Device already has an active job.' }, 409);
      }
      return json({ error: 'Device is already connected; change it from the admin dashboard.' }, 409);
    }
    if (error?.code === '23503' && String(error.constraint || '').includes('active_jobs_current_binding_fk')) {
      if (route === 'admin/device-config' && request.method === 'POST') {
        return json({ error: 'Finish or cancel the active job before changing this vehicle binding.' }, 409);
      }
      if (route === 'admin/device-config' && request.method === 'DELETE') {
        return json({ error: 'Finish or cancel the active job before removing this vehicle binding.' }, 409);
      }
      return json({ error: 'The vehicle binding changed while an active job was being saved. Check the device binding and retry.' }, 409);
    }
    if (error?.code === '42P01') {
      return json({ error: 'Database schema is not initialized. Apply db/schema.sql.' }, 503);
    }
    console.error('Songdee API error', error);
    return json({ error: 'Internal server error' }, 500);
  }
}
