import assert from 'node:assert/strict';
import test from 'node:test';
import { missingRetryColumns } from '../lib/mobile-database-schema.ts';

test('a fresh outbox schema needs every retry diagnostic column', () => {
  assert.deepEqual(missingRetryColumns(['id', 'payload']).map(([name]) => name), [
    'retry_disabled',
    'failed_at',
    'last_error',
  ]);
});

test('a partially applied migration adds only missing columns', () => {
  assert.deepEqual(missingRetryColumns(['id', 'payload', 'retry_disabled', 'failed_at']), [
    ['last_error', 'TEXT'],
  ]);
  assert.deepEqual(missingRetryColumns(['retry_disabled', 'failed_at', 'last_error']), []);
});
