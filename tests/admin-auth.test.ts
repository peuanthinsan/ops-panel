import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_SESSION_LIFETIME_MS,
  createAdminToken,
  hashPassword,
  verifyAdminToken,
  verifyPassword,
} from '../web/lib/server/auth.mjs';

const secret = 'test-secret-longer-than-thirty-two-characters';

test('password hashes verify only the original password', () => {
  const hash = hashPassword('a-strong-admin-password');
  assert.equal(verifyPassword('a-strong-admin-password', hash), true);
  assert.equal(verifyPassword('a-different-admin-password', hash), false);
  assert.equal(verifyPassword('x'.repeat(129), hash), false);
});

test('admin token is valid for its version until expiration', () => {
  const issuedAt = 1_800_000_000_000;
  const token = createAdminToken('version-1', secret, issuedAt);
  assert.equal(verifyAdminToken(token, 'version-1', secret, issuedAt + 1), true);
  assert.equal(verifyAdminToken(token, 'version-2', secret, issuedAt + 1), false);
  assert.equal(verifyAdminToken(token, 'version-1', secret, issuedAt + ADMIN_SESSION_LIFETIME_MS), false);
});

test('admin token rejects tampering and the wrong signing secret', () => {
  const token = createAdminToken('version-1', secret, 1_800_000_000_000);
  const [payload, signature] = token.split('.');
  assert.equal(verifyAdminToken(`${payload}x.${signature}`, 'version-1', secret, 1_800_000_000_001), false);
  assert.equal(verifyAdminToken(token, 'version-1', `${secret}-wrong`, 1_800_000_000_001), false);
});
