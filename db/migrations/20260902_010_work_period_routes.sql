BEGIN;

CREATE TABLE IF NOT EXISTS work_period_routes (
  work_period_id TEXT PRIMARY KEY,
  vehicle_number TEXT NOT NULL,
  route_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_period_routes_vehicle_idx
  ON work_period_routes (lower(vehicle_number), updated_at DESC);

CREATE INDEX IF NOT EXISTS work_period_routes_route_name_idx
  ON work_period_routes (lower(route_name));

INSERT INTO app_settings (setting_key, setting_value, updated_at)
VALUES ('database_schema_version', '2026-09-02.1', now())
ON CONFLICT (setting_key) DO UPDATE
  SET setting_value = EXCLUDED.setting_value,
      updated_at = now();

COMMIT;
