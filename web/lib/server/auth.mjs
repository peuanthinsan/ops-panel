import crypto from 'node:crypto';

export const ADMIN_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `scrypt:${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128) return false;
  try {
    const [algorithm, salt, expectedHex] = String(encoded).split(':');
    if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
    const actual = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

export function createAdminToken(authVersion, secret, nowMs = Date.now()) {
  const payload = encodeJson({
    scope: 'fleet-admin',
    version: String(authVersion),
    issuedAt: nowMs,
    expiresAt: nowMs + ADMIN_SESSION_LIFETIME_MS,
  });
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyAdminToken(token, authVersion, secret, nowMs = Date.now()) {
  try {
    const [payload, suppliedSignature, extra] = String(token || '').split('.');
    if (!payload || !suppliedSignature || extra) return false;
    const expectedSignature = sign(payload, secret);
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return false;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return claims.scope === 'fleet-admin'
      && claims.version === String(authVersion)
      && Number.isFinite(claims.expiresAt)
      && claims.expiresAt > nowMs;
  } catch {
    return false;
  }
}
