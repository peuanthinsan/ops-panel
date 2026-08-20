import assert from 'node:assert/strict';
import test from 'node:test';
import { fmsSyncNeedsRetry } from '../web/lib/server/fms-sync-state.mjs';

test('an external GPS-device fix remains reviewable before the FMS adapter is configured', () => {
  assert.equal(fmsSyncNeedsRetry('not_configured'), false);
  assert.equal(fmsSyncNeedsRetry('received'), false);
});

test('configured FMS failures and unfinished samples remain retryable', () => {
  assert.equal(fmsSyncNeedsRetry('unavailable'), true);
  assert.equal(fmsSyncNeedsRetry('pending'), true);
  assert.equal(fmsSyncNeedsRetry(null), true);
});
