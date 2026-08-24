import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL as NodeUrl } from 'node:url';
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

test('the tablet database keeps a durable archive separate from the retry outbox', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../lib/mobile-database.ts', import.meta.url)), 'utf8');
  assert.match(source, /CREATE TABLE IF NOT EXISTS saved_job_reports/);
  assert.match(source, /saved_job_reports_binding_end_idx[\s\S]*device_id, vehicle_number, end_at DESC/);
  assert.match(source, /PRAGMA user_version = 2/);
});
