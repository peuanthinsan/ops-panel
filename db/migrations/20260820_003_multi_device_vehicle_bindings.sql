-- A vehicle may be operated from multiple Android devices, while each device
-- remains bound to exactly one vehicle through device_bindings.device_id.
ALTER TABLE device_bindings
  DROP CONSTRAINT IF EXISTS device_bindings_vehicle_number_key;

DROP INDEX IF EXISTS device_bindings_vehicle_number_key;

CREATE INDEX IF NOT EXISTS device_bindings_vehicle_number_idx
  ON device_bindings (vehicle_number, device_id);

INSERT INTO app_settings (setting_key, setting_value, updated_at)
VALUES ('database_schema_version', '2026-08-20.2', now())
ON CONFLICT (setting_key) DO UPDATE
  SET setting_value = EXCLUDED.setting_value,
      updated_at = now();
