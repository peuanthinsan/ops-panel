import crypto from 'node:crypto';

const DEVICE_SECRET_CONTEXT = 'songdee-ops-panel:device-secret:v1';

function encryptionKey(masterSecret) {
  return crypto.createHmac('sha256', masterSecret).update(DEVICE_SECRET_CONTEXT).digest();
}

export function newDeviceCredential(masterSecret) {
  const secret = crypto.randomBytes(32).toString('hex');
  return {
    keyId: crypto.randomUUID(),
    secret,
    secretCiphertext: encryptDeviceSecret(secret, masterSecret),
  };
}

export function encryptDeviceSecret(secret, masterSecret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(masterSecret), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptDeviceSecret(value, masterSecret) {
  const [version, ivValue, tagValue, ciphertextValue] = String(value || '').split('.');
  if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) throw new Error('Invalid device secret ciphertext');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(masterSecret), Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function canonicalDeviceRequest(method, path, timestamp, nonce, body = '') {
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  return `${String(method).toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
}

export function deviceRequestSignature(secret, method, path, timestamp, nonce, body = '') {
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(canonicalDeviceRequest(method, path, timestamp, nonce, body))
    .digest('hex');
}

export function signaturesMatch(expected, supplied) {
  const left = Buffer.from(String(expected || ''), 'hex');
  const right = Buffer.from(String(supplied || ''), 'hex');
  return left.length === 32 && right.length === 32 && crypto.timingSafeEqual(left, right);
}
