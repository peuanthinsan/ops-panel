import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export type DeviceCredential = { keyId: string; secret: string };

export type DeviceAuthStatus = {
  keyId: string | null;
  enrolled: boolean;
  enforced: boolean;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseDeviceCredential(value: unknown): DeviceCredential | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const keyId = typeof item.keyId === 'string' ? item.keyId.trim() : '';
  const secret = typeof item.secret === 'string' ? item.secret.trim().toLowerCase() : '';
  return uuidPattern.test(keyId) && /^[0-9a-f]{64}$/.test(secret)
    ? { keyId, secret }
    : null;
}

export function parseStoredDeviceCredential(raw: string | null) {
  if (!raw) return null;
  try { return parseDeviceCredential(JSON.parse(raw)); }
  catch { return null; }
}

export function canonicalDeviceRequest(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body = '',
) {
  const bodyHash = bytesToHex(sha256(utf8ToBytes(body)));
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
}

export function deviceRequestSignature(
  credential: DeviceCredential,
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body = '',
) {
  return bytesToHex(hmac(
    sha256,
    hexToBytes(credential.secret),
    utf8ToBytes(canonicalDeviceRequest(method, path, timestamp, nonce, body)),
  ));
}

export function createDeviceRequestHeaders(
  credential: DeviceCredential,
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body = '',
) {
  return {
    'x-device-key-id': credential.keyId,
    'x-device-timestamp': timestamp,
    'x-device-nonce': nonce,
    'x-device-signature': deviceRequestSignature(credential, method, path, timestamp, nonce, body),
  };
}
