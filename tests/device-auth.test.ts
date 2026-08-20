import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeviceRequestHeaders, deviceRequestSignature, parseDeviceCredential } from '../lib/device-auth.ts';
import { decryptDeviceSecret, deviceRequestSignature as serverSignature, newDeviceCredential } from '../web/lib/server/device-auth.mjs';

test('Android and server request signatures use the same canonical payload', () => {
  const credential = { keyId: '8c5544e8-14a2-4a25-84df-b977844a8fa1', secret: '11'.repeat(32) };
  const method = 'POST';
  const path = '/api/reports?source=tablet';
  const timestamp = '1787112300000';
  const nonce = '7595caf1-c137-4cb6-8bd8-bababa6bb6ef';
  const body = '{"vehicleNumber":"70-1234"}';
  assert.equal(
    deviceRequestSignature(credential, method, path, timestamp, nonce, body),
    serverSignature(credential.secret, method, path, timestamp, nonce, body),
  );
  assert.equal(createDeviceRequestHeaders(credential, method, path, timestamp, nonce, body)['x-device-signature'], serverSignature(credential.secret, method, path, timestamp, nonce, body));
});

test('device secrets are encrypted at rest and malformed credentials are rejected', () => {
  const issued = newDeviceCredential('a'.repeat(64));
  assert.notEqual(issued.secretCiphertext.includes(issued.secret), true);
  assert.equal(decryptDeviceSecret(issued.secretCiphertext, 'a'.repeat(64)), issued.secret);
  assert.deepEqual(parseDeviceCredential({ keyId: issued.keyId, secret: issued.secret }), { keyId: issued.keyId, secret: issued.secret });
  assert.equal(parseDeviceCredential({ keyId: issued.keyId, secret: 'short' }), null);
  assert.equal(parseDeviceCredential({ keyId: 'a'.repeat(36), secret: issued.secret }), null);
});
