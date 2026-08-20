import assert from 'node:assert/strict';
import test from 'node:test';
import { clearAdminSessionToken, getAdminSessionToken, setAdminSessionToken } from '../web/app/dashboard-session.js';

test('admin sessions retain an in-memory fallback when browser storage is unavailable', () => {
  clearAdminSessionToken();
  assert.equal(getAdminSessionToken(), '');
  setAdminSessionToken('token-1');
  assert.equal(getAdminSessionToken(), 'token-1');
  clearAdminSessionToken();
  assert.equal(getAdminSessionToken(), '');
});
