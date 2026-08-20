-- Data-FM history lookup is the GPS source. A separate proprietary report POST
-- remains optional and must not leave otherwise completed jobs queued.
UPDATE ops_reports
SET gps = 'Not submitted',
    status = 'Completed',
    gps_sync_status = 'not_configured',
    gps_sync_message = 'Optional report delivery is not configured.'
WHERE gps_sync_status = 'adapter_pending';

INSERT INTO app_settings (setting_key, setting_value, updated_at)
VALUES ('database_schema_version', '2026-08-20.3', now())
ON CONFLICT (setting_key) DO UPDATE
  SET setting_value = EXCLUDED.setting_value,
      updated_at = now();
