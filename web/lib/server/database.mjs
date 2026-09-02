import { neon } from '@neondatabase/serverless';

let databaseClient;
export const REQUIRED_DATABASE_SCHEMA_VERSION = '2026-09-02.1';

export class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export function getDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new ConfigurationError('DATABASE_URL is not configured.');
  }
  databaseClient ||= neon(connectionString);
  return databaseClient;
}

export async function checkDatabase() {
  const sql = getDatabase();
  const [schema] = await sql`
    SELECT
      to_regclass('public.device_bindings')::text AS "deviceBindings",
      to_regclass('public.device_binding_history')::text AS "bindingHistory",
      to_regclass('public.device_credentials')::text AS "deviceCredentials",
      to_regclass('public.device_request_nonces')::text AS "deviceRequestNonces",
      to_regclass('public.api_rate_limits')::text AS "apiRateLimits",
      to_regclass('public.schema_migrations')::text AS "schemaMigrations",
      to_regclass('public.app_settings')::text AS "appSettings",
      to_regclass('public.ops_reports')::text AS "opsReports",
      to_regclass('public.active_jobs')::text AS "activeJobs",
      to_regclass('public.gps_sync_samples')::text AS "gpsSamples",
      to_regclass('public.job_gps_summaries')::text AS "jobGpsSummaries",
      to_regclass('public.job_routes')::text AS "jobRoutes",
      to_regclass('public.work_period_routes')::text AS "workPeriodRoutes"
  `;
  if (!schema || Object.values(schema).some((table) => !table)) {
    throw new ConfigurationError('Database schema is not initialized. Apply db/schema.sql.');
  }
  const [version] = await sql`
    SELECT setting_value AS "schemaVersion"
    FROM app_settings
    WHERE setting_key = 'database_schema_version'
    LIMIT 1
  `;
  if (version?.schemaVersion !== REQUIRED_DATABASE_SCHEMA_VERSION) {
    throw new ConfigurationError(`Database schema is outdated. Apply db/schema.sql (required ${REQUIRED_DATABASE_SCHEMA_VERSION}).`);
  }
}
