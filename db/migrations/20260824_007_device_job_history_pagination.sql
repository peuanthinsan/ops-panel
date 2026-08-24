CREATE INDEX IF NOT EXISTS ops_reports_device_vehicle_end_idx
  ON ops_reports (device_id, lower(vehicle_number), end_time DESC, id DESC);

INSERT INTO app_settings (setting_key, setting_value, updated_at)
VALUES ('database_schema_version', '2026-08-24.2', now())
ON CONFLICT (setting_key) DO UPDATE
  SET setting_value = EXCLUDED.setting_value,
      updated_at = now();
