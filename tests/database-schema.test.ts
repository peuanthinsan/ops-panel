import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL as NodeUrl } from 'node:url';
import test from 'node:test';

test('production schema applies atomically and records the version required by health checks', async () => {
  const schema = await readFile(fileURLToPath(new NodeUrl('../db/schema.sql', import.meta.url)), 'utf8');
  const database = await readFile(fileURLToPath(new NodeUrl('../web/lib/server/database.mjs', import.meta.url)), 'utf8');
  assert.match(schema, /^--[\s\S]*\nBEGIN;/);
  assert.match(schema.trim(), /COMMIT;$/);
  const schemaVersion = schema.match(/VALUES \('database_schema_version', '([^']+)'/i)?.[1];
  const requiredVersion = database.match(/REQUIRED_DATABASE_SCHEMA_VERSION = '([^']+)'/)?.[1];
  assert.ok(schemaVersion);
  assert.equal(schemaVersion, requiredVersion);
  assert.match(database, /WHERE setting_key = 'database_schema_version'/);
  assert.match(database, /Database schema is outdated/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS schema_migrations/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS device_credentials/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS api_rate_limits/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS job_gps_summaries/);
  assert.match(database, /job_gps_summaries/);
  assert.doesNotMatch(schema, /vehicle_number TEXT NOT NULL UNIQUE/);
  assert.match(schema, /device_bindings_vehicle_number_idx[\s\S]*vehicle_number, device_id/);
});

test('production schema validates job timing, GPS values, and the active binding foreign key', async () => {
  const schema = await readFile(fileURLToPath(new NodeUrl('../db/schema.sql', import.meta.url)), 'utf8');
  assert.match(schema, /CONSTRAINT ops_reports_time_order_check[\s\S]*CHECK \(end_time >= start_time\)/);
  assert.match(schema, /VALIDATE CONSTRAINT ops_reports_time_order_check/);
  assert.match(schema, /VALIDATE CONSTRAINT active_jobs_current_binding_fk/);
  assert.match(schema, /CONSTRAINT gps_sync_samples_coordinates_check[\s\S]*device_latitude BETWEEN -90 AND 90[\s\S]*device_longitude BETWEEN -180 AND 180/);
  assert.match(schema, /CONSTRAINT gps_sync_samples_accuracy_check[\s\S]*device_accuracy_m IS NULL OR device_accuracy_m >= 0/);
  assert.match(schema, /gps_sync_samples_report_window_idx[\s\S]*vehicle_number, device_id, captured_at DESC/);
  assert.match(schema, /gps_sync_samples_job_time_idx[\s\S]*job_id, captured_at DESC/);
  assert.match(schema, /device_speed_mps DOUBLE PRECISION/);
  assert.match(schema, /fms_captured_at TIMESTAMPTZ/);
  assert.match(schema, /position_delta_m DOUBLE PRECISION/);
  assert.match(schema, /pair_status TEXT NOT NULL DEFAULT 'pending'/);
  assert.match(schema, /gps_sync_samples_pair_status_check/);
  assert.match(schema, /ops_reports_keyset_idx[\s\S]*start_time DESC, id DESC/);
});

test('database migrations are ordered and checksum-protected', async () => {
  const runner = await readFile(fileURLToPath(new NodeUrl('../web/scripts/migrate.mjs', import.meta.url)), 'utf8');
  const migration = await readFile(fileURLToPath(new NodeUrl('../db/migrations/20260819_001_device_security_and_report_indexes.sql', import.meta.url)), 'utf8');
  const gpsMigration = await readFile(fileURLToPath(new NodeUrl('../db/migrations/20260820_002_job_gps_pairing.sql', import.meta.url)), 'utf8');
  const multiDeviceMigration = await readFile(fileURLToPath(new NodeUrl('../db/migrations/20260820_003_multi_device_vehicle_bindings.sql', import.meta.url)), 'utf8');
  const optionalDeliveryMigration = await readFile(fileURLToPath(new NodeUrl('../db/migrations/20260820_004_optional_report_delivery.sql', import.meta.url)), 'utf8');
  const gpsLookupMigration = await readFile(fileURLToPath(new NodeUrl('../db/migrations/20260820_005_gps_lookup_states.sql', import.meta.url)), 'utf8');
  assert.match(runner, /\.filter\(file => file\.endsWith\('\.sql'\)\)\.sort\(\)/);
  assert.match(runner, /createHash\('sha256'\)/);
  assert.match(runner, /splitSqlStatements/);
  assert.match(runner, /modified after it was applied/);
  assert.match(runner, /!migrationTable\?\.name && !checkOnly/);
  assert.match(migration, /device_request_nonces/);
  assert.match(migration, /database_schema_version/);
  assert.match(gpsMigration, /ALTER TABLE gps_sync_samples ADD COLUMN IF NOT EXISTS job_id TEXT/);
  assert.match(gpsMigration, /CREATE TABLE IF NOT EXISTS job_gps_summaries/);
  assert.doesNotMatch(gpsMigration, /DO \$\$/);
  assert.match(gpsMigration, /VALUES \('database_schema_version', '2026-08-20\.1'/);
  assert.match(multiDeviceMigration, /DROP CONSTRAINT IF EXISTS device_bindings_vehicle_number_key/);
  assert.match(multiDeviceMigration, /device_bindings_vehicle_number_idx/);
  assert.match(multiDeviceMigration, /VALUES \('database_schema_version', '2026-08-20\.2'/);
  assert.match(optionalDeliveryMigration, /WHERE gps_sync_status = 'adapter_pending'/);
  assert.match(optionalDeliveryMigration, /VALUES \('database_schema_version', '2026-08-20\.3'/);
  assert.match(gpsLookupMigration, /ADD COLUMN IF NOT EXISTS gps_lookup_status/);
  assert.match(gpsLookupMigration, /gps_sync_status = NULL/);
  assert.match(gpsLookupMigration, /VALUES \('database_schema_version', '2026-08-20\.4'/);
});
