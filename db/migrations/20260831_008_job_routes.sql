BEGIN;

CREATE TABLE IF NOT EXISTS job_routes (
  id TEXT PRIMARY KEY,
  route_name TEXT NOT NULL UNIQUE,
  google_maps_url TEXT NOT NULL,
  anchors JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_routes_active_name_idx
  ON job_routes (active, lower(route_name));

INSERT INTO app_settings (setting_key, setting_value)
VALUES
  ('route_deviation_distance_km', '0.5'),
  ('route_deviation_duration_seconds', '60')
ON CONFLICT (setting_key) DO NOTHING;

COMMIT;
