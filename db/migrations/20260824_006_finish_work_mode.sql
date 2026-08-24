ALTER TABLE ops_reports DROP CONSTRAINT IF EXISTS ops_reports_mode_check;

ALTER TABLE ops_reports
  ADD CONSTRAINT ops_reports_mode_check
  CHECK (mode IN ('Load', 'Stop vehicle', 'Unload', 'Break', 'Vehicle check', 'Refuel', 'Vehicle wash', 'Park overnight', 'Finish work'))
  NOT VALID;

ALTER TABLE ops_reports VALIDATE CONSTRAINT ops_reports_mode_check;

ALTER TABLE active_jobs DROP CONSTRAINT IF EXISTS active_jobs_mode_check;

ALTER TABLE active_jobs
  ADD CONSTRAINT active_jobs_mode_check
  CHECK (mode IN ('Load', 'Stop vehicle', 'Unload', 'Break', 'Vehicle check', 'Refuel', 'Vehicle wash', 'Park overnight', 'Finish work'))
  NOT VALID;

ALTER TABLE active_jobs VALIDATE CONSTRAINT active_jobs_mode_check;

INSERT INTO app_settings (setting_key, setting_value, updated_at)
VALUES ('database_schema_version', '2026-08-24.1', now())
ON CONFLICT (setting_key) DO UPDATE
  SET setting_value = EXCLUDED.setting_value,
      updated_at = now();
