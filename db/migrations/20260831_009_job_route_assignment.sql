BEGIN;

ALTER TABLE active_jobs ADD COLUMN IF NOT EXISTS route_name TEXT;
ALTER TABLE ops_reports ADD COLUMN IF NOT EXISTS route_name TEXT;

CREATE INDEX IF NOT EXISTS active_jobs_route_name_idx
  ON active_jobs (lower(route_name)) WHERE route_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS ops_reports_route_name_idx
  ON ops_reports (lower(route_name), start_time DESC) WHERE route_name IS NOT NULL;

INSERT INTO app_settings (setting_key, setting_value, updated_at)
VALUES ('database_schema_version', '2026-08-31.1', now())
ON CONFLICT (setting_key) DO UPDATE
  SET setting_value = EXCLUDED.setting_value,
      updated_at = now();

COMMIT;
