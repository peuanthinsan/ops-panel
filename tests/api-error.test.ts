import assert from 'node:assert/strict';
import test from 'node:test';
import { isRetryableApiError, SongdeeApiError } from '../lib/api-error.ts';

test('network and temporary server failures remain retryable', () => {
  assert.equal(isRetryableApiError(new Error('network unavailable')), true);
  assert.equal(isRetryableApiError(new SongdeeApiError(408, 'timeout')), true);
  assert.equal(isRetryableApiError(new SongdeeApiError(429, 'rate limited')), true);
  assert.equal(isRetryableApiError(new SongdeeApiError(503, 'unavailable')), true);
});

test('invalid or conflicting payloads do not block later outbox records', () => {
  assert.equal(isRetryableApiError(new SongdeeApiError(400, 'invalid payload')), false);
  assert.equal(isRetryableApiError(new SongdeeApiError(409, 'binding conflict')), false);
});
