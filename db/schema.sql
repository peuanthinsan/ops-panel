-- Songdee GPS Control production schema.
-- Apply this to the dedicated Postgres database selected for this application.

BEGIN;

CREATE TABLE IF NOT EXISTS device_bindings (
  device_id TEXT PRIMARY KEY,
  vehicle_number TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS device_bindings_device_vehicle_unique_idx
  ON device_bindings (device_id, vehicle_number);

CREATE INDEX IF NOT EXISTS device_bindings_vehicle_number_idx
  ON device_bindings (vehicle_number, device_id);

CREATE TABLE IF NOT EXISTS device_credentials (
  device_id TEXT PRIMARY KEY,
  key_id UUID NOT NULL UNIQUE,
  secret_ciphertext TEXT NOT NULL,
  enforced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS device_request_nonces (
  key_id UUID NOT NULL REFERENCES device_credentials (key_id) ON UPDATE CASCADE ON DELETE CASCADE,
  nonce UUID NOT NULL,
  request_timestamp TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (key_id, nonce)
);

CREATE INDEX IF NOT EXISTS device_request_nonces_expiry_idx
  ON device_request_nonces (expires_at);

CREATE TABLE IF NOT EXISTS api_rate_limits (
  scope TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, subject_hash, window_start)
);

CREATE INDEX IF NOT EXISTS api_rate_limits_cleanup_idx
  ON api_rate_limits (updated_at);

CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS device_binding_history (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  vehicle_number TEXT NOT NULL,
  bound_at TIMESTAMPTZ NOT NULL,
  unbound_at TIMESTAMPTZ,
  CHECK (unbound_at IS NULL OR unbound_at >= bound_at)
);

CREATE INDEX IF NOT EXISTS device_binding_history_lookup_idx
  ON device_binding_history (device_id, vehicle_number, bound_at, unbound_at);

CREATE UNIQUE INDEX IF NOT EXISTS device_binding_history_one_open_device_idx
  ON device_binding_history (device_id)
  WHERE unbound_at IS NULL;

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS ops_reports (
  id TEXT PRIMARY KEY,
  vehicle_number TEXT NOT NULL,
  device_id TEXT NOT NULL,
  driver_name TEXT,
  driver_id TEXT,
  mode TEXT NOT NULL,
  route_name TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration TEXT NOT NULL,
  gps TEXT,
  status TEXT NOT NULL,
  gps_sync_status TEXT,
  gps_sync_message TEXT,
  gps_lookup_status TEXT,
  gps_lookup_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ops_reports_vehicle_binding CHECK (vehicle_number <> '')
);

CREATE INDEX IF NOT EXISTS ops_reports_start_time_idx ON ops_reports (start_time DESC);
CREATE INDEX IF NOT EXISTS ops_reports_keyset_idx ON ops_reports (start_time DESC, id DESC);
CREATE INDEX IF NOT EXISTS ops_reports_vehicle_number_idx ON ops_reports (vehicle_number, start_time DESC);
CREATE INDEX IF NOT EXISTS ops_reports_device_id_idx ON ops_reports (device_id, start_time DESC);
CREATE INDEX IF NOT EXISTS ops_reports_device_vehicle_end_idx ON ops_reports (device_id, lower(vehicle_number), end_time DESC, id DESC);
CREATE INDEX IF NOT EXISTS ops_reports_driver_name_idx ON ops_reports (driver_name, start_time DESC) WHERE driver_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS ops_reports_status_idx ON ops_reports (status, start_time DESC);
CREATE INDEX IF NOT EXISTS ops_reports_gps_sync_status_idx ON ops_reports (gps_sync_status) WHERE gps_sync_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS ops_reports_gps_lookup_status_idx ON ops_reports (gps_lookup_status) WHERE gps_lookup_status IS NOT NULL;

ALTER TABLE ops_reports ADD COLUMN IF NOT EXISTS gps_lookup_status TEXT;
ALTER TABLE ops_reports ADD COLUMN IF NOT EXISTS gps_lookup_message TEXT;
ALTER TABLE ops_reports ADD COLUMN IF NOT EXISTS route_name TEXT;
CREATE INDEX IF NOT EXISTS ops_reports_route_name_idx ON ops_reports (lower(route_name), start_time DESC) WHERE route_name IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ops_reports_time_order_check'
  ) THEN
    ALTER TABLE ops_reports
      ADD CONSTRAINT ops_reports_time_order_check
      CHECK (end_time >= start_time)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE ops_reports VALIDATE CONSTRAINT ops_reports_time_order_check;

ALTER TABLE ops_reports DROP CONSTRAINT IF EXISTS ops_reports_mode_check;
ALTER TABLE ops_reports
  ADD CONSTRAINT ops_reports_mode_check
  CHECK (mode IN ('Load', 'Stop vehicle', 'Unload', 'Break', 'Vehicle check', 'Refuel', 'Vehicle wash', 'Park overnight', 'Finish work'))
  NOT VALID;
ALTER TABLE ops_reports VALIDATE CONSTRAINT ops_reports_mode_check;

CREATE TABLE IF NOT EXISTS active_jobs (
  id TEXT PRIMARY KEY,
  vehicle_number TEXT NOT NULL,
  device_id TEXT NOT NULL,
  driver_name TEXT,
  driver_id TEXT,
  mode TEXT NOT NULL,
  route_name TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS active_jobs_vehicle_start_idx ON active_jobs (vehicle_number, start_time DESC);
CREATE UNIQUE INDEX IF NOT EXISTS active_jobs_one_per_device_idx ON active_jobs (device_id);
ALTER TABLE active_jobs ADD COLUMN IF NOT EXISTS route_name TEXT;
CREATE INDEX IF NOT EXISTS active_jobs_route_name_idx ON active_jobs (lower(route_name)) WHERE route_name IS NOT NULL;

ALTER TABLE active_jobs DROP CONSTRAINT IF EXISTS active_jobs_mode_check;
ALTER TABLE active_jobs
  ADD CONSTRAINT active_jobs_mode_check
  CHECK (mode IN ('Load', 'Stop vehicle', 'Unload', 'Break', 'Vehicle check', 'Refuel', 'Vehicle wash', 'Park overnight', 'Finish work'))
  NOT VALID;
ALTER TABLE active_jobs VALIDATE CONSTRAINT active_jobs_mode_check;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'active_jobs_current_binding_fk'
  ) THEN
    ALTER TABLE active_jobs
      ADD CONSTRAINT active_jobs_current_binding_fk
      FOREIGN KEY (device_id, vehicle_number)
      REFERENCES device_bindings (device_id, vehicle_number)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;

ALTER TABLE active_jobs VALIDATE CONSTRAINT active_jobs_current_binding_fk;

CREATE TABLE IF NOT EXISTS gps_sync_samples (
  id TEXT PRIMARY KEY,
  job_id TEXT,
  vehicle_number TEXT NOT NULL,
  device_id TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  device_latitude DOUBLE PRECISION NOT NULL,
  device_longitude DOUBLE PRECISION NOT NULL,
  device_accuracy_m DOUBLE PRECISION,
  device_speed_mps DOUBLE PRECISION,
  device_heading_deg DOUBLE PRECISION,
  fms_payload JSONB,
  fms_status TEXT NOT NULL,
  fms_message TEXT,
  fms_captured_at TIMESTAMPTZ,
  fms_latitude DOUBLE PRECISION,
  fms_longitude DOUBLE PRECISION,
  fms_speed_mps DOUBLE PRECISION,
  position_delta_m DOUBLE PRECISION,
  time_delta_ms BIGINT,
  pair_status TEXT NOT NULL DEFAULT 'pending',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE gps_sync_samples ADD COLUMN IF NOT EXISTS job_id TEXT;
ALTER TABLE gps_sync_samples ADD COLUMN IF NOT EXISTS device_speed_mps DOUBLE PRECISION;
ALTER TABLE gps_sync_samples ADD COLUMN IF NOT EXISTS device_heading_deg DOUBLE PRECISION;
ALTER TABLE gps_sync_samples ADD COLUMN IF NOT EXISTS fms_captured_at TIMESTAMPTZ;
ALTER TABLE gps_sync_samples ADD COLUMN IF NOT EXISTS fms_latitude DOUBLE PRECISION;
ALTER TABLE gps_sync_samples ADD COLUMN IF NOT EXISTS fms_longitude DOUBLE PRECISION;
ALTER TABLE gps_sync_samples ADD COLUMN IF NOT EXISTS fms_speed_mps DOUBLE PRECISION;
ALTER TABLE gps_sync_samples ADD COLUMN IF NOT EXISTS position_delta_m DOUBLE PRECISION;
ALTER TABLE gps_sync_samples ADD COLUMN IF NOT EXISTS time_delta_ms BIGINT;
ALTER TABLE gps_sync_samples ADD COLUMN IF NOT EXISTS pair_status TEXT NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS gps_sync_samples_vehicle_time_idx ON gps_sync_samples (vehicle_number, captured_at DESC);
CREATE INDEX IF NOT EXISTS gps_sync_samples_report_window_idx ON gps_sync_samples (vehicle_number, device_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS gps_sync_samples_job_time_idx ON gps_sync_samples (job_id, captured_at DESC) WHERE job_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gps_sync_samples_coordinates_check'
  ) THEN
    ALTER TABLE gps_sync_samples
      ADD CONSTRAINT gps_sync_samples_coordinates_check
      CHECK (
        device_latitude BETWEEN -90 AND 90
        AND device_longitude BETWEEN -180 AND 180
      )
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gps_sync_samples_accuracy_check'
  ) THEN
    ALTER TABLE gps_sync_samples
      ADD CONSTRAINT gps_sync_samples_accuracy_check
      CHECK (device_accuracy_m IS NULL OR device_accuracy_m >= 0)
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gps_sync_samples_motion_check'
  ) THEN
    ALTER TABLE gps_sync_samples
      ADD CONSTRAINT gps_sync_samples_motion_check
      CHECK (
        (device_speed_mps IS NULL OR device_speed_mps >= 0)
        AND (device_heading_deg IS NULL OR device_heading_deg BETWEEN 0 AND 360)
        AND (fms_speed_mps IS NULL OR fms_speed_mps >= 0)
        AND (position_delta_m IS NULL OR position_delta_m >= 0)
        AND (time_delta_ms IS NULL OR time_delta_ms >= 0)
      )
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gps_sync_samples_fms_coordinates_check'
  ) THEN
    ALTER TABLE gps_sync_samples
      ADD CONSTRAINT gps_sync_samples_fms_coordinates_check
      CHECK (
        (fms_latitude IS NULL AND fms_longitude IS NULL)
        OR (fms_latitude BETWEEN -90 AND 90 AND fms_longitude BETWEEN -180 AND 180)
      )
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gps_sync_samples_pair_status_check'
  ) THEN
    ALTER TABLE gps_sync_samples
      ADD CONSTRAINT gps_sync_samples_pair_status_check
      CHECK (pair_status IN ('pending', 'paired', 'fms_received', 'device_only', 'fms_delayed'))
      NOT VALID;
  END IF;
END $$;

ALTER TABLE gps_sync_samples VALIDATE CONSTRAINT gps_sync_samples_coordinates_check;
ALTER TABLE gps_sync_samples VALIDATE CONSTRAINT gps_sync_samples_accuracy_check;
ALTER TABLE gps_sync_samples VALIDATE CONSTRAINT gps_sync_samples_motion_check;
ALTER TABLE gps_sync_samples VALIDATE CONSTRAINT gps_sync_samples_fms_coordinates_check;
ALTER TABLE gps_sync_samples VALIDATE CONSTRAINT gps_sync_samples_pair_status_check;

UPDATE gps_sync_samples sample
SET job_id = COALESCE(
  (
    SELECT active.id
    FROM active_jobs active
    WHERE active.vehicle_number = sample.vehicle_number
      AND active.device_id = sample.device_id
      AND active.start_time <= sample.captured_at
    ORDER BY active.start_time DESC
    LIMIT 1
  ),
  (
    SELECT report.id
    FROM ops_reports report
    WHERE report.vehicle_number = sample.vehicle_number
      AND report.device_id = sample.device_id
      AND sample.captured_at BETWEEN report.start_time AND report.end_time
    ORDER BY report.start_time DESC
    LIMIT 1
  )
)
WHERE sample.job_id IS NULL;

UPDATE gps_sync_samples
SET pair_status = CASE
  WHEN fms_status = 'received' THEN 'fms_received'
  WHEN fms_status = 'not_configured' THEN 'device_only'
  WHEN fms_status = 'pending' THEN 'pending'
  ELSE 'fms_delayed'
END
WHERE pair_status = 'pending' AND fms_status <> 'pending';

CREATE TABLE IF NOT EXISTS job_gps_summaries (
  job_id TEXT PRIMARY KEY,
  vehicle_number TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_samples INTEGER NOT NULL DEFAULT 0 CHECK (device_samples >= 0),
  fms_samples INTEGER NOT NULL DEFAULT 0 CHECK (fms_samples >= 0),
  paired_samples INTEGER NOT NULL DEFAULT 0 CHECK (paired_samples >= 0),
  attention_samples INTEGER NOT NULL DEFAULT 0 CHECK (attention_samples >= 0),
  last_device_latitude DOUBLE PRECISION,
  last_device_longitude DOUBLE PRECISION,
  last_fms_latitude DOUBLE PRECISION,
  last_fms_longitude DOUBLE PRECISION,
  last_captured_at TIMESTAMPTZ,
  median_position_delta_m DOUBLE PRECISION,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_gps_summaries_vehicle_idx ON job_gps_summaries (vehicle_number, job_id);
CREATE INDEX IF NOT EXISTS job_gps_summaries_device_idx ON job_gps_summaries (device_id, job_id);

INSERT INTO job_gps_summaries (
  job_id, vehicle_number, device_id, device_samples, fms_samples,
  paired_samples, attention_samples, last_device_latitude, last_device_longitude,
  last_fms_latitude, last_fms_longitude, last_captured_at,
  median_position_delta_m, updated_at
)
SELECT
  job_id,
  (array_agg(vehicle_number ORDER BY captured_at DESC))[1],
  (array_agg(device_id ORDER BY captured_at DESC))[1],
  count(*)::int,
  count(*) FILTER (WHERE fms_status = 'received')::int,
  count(*) FILTER (WHERE pair_status = 'paired')::int,
  count(*) FILTER (WHERE pair_status IN ('device_only', 'fms_delayed', 'fms_received'))::int,
  (array_agg(device_latitude ORDER BY captured_at DESC))[1],
  (array_agg(device_longitude ORDER BY captured_at DESC))[1],
  (array_agg(fms_latitude ORDER BY captured_at DESC) FILTER (WHERE fms_latitude IS NOT NULL))[1],
  (array_agg(fms_longitude ORDER BY captured_at DESC) FILTER (WHERE fms_longitude IS NOT NULL))[1],
  max(captured_at),
  percentile_cont(0.5) WITHIN GROUP (ORDER BY position_delta_m) FILTER (WHERE position_delta_m IS NOT NULL),
  now()
FROM gps_sync_samples
WHERE job_id IS NOT NULL
GROUP BY job_id
ON CONFLICT (job_id) DO UPDATE SET
  vehicle_number = EXCLUDED.vehicle_number,
  device_id = EXCLUDED.device_id,
  device_samples = EXCLUDED.device_samples,
  fms_samples = EXCLUDED.fms_samples,
  paired_samples = EXCLUDED.paired_samples,
  attention_samples = EXCLUDED.attention_samples,
  last_device_latitude = EXCLUDED.last_device_latitude,
  last_device_longitude = EXCLUDED.last_device_longitude,
  last_fms_latitude = EXCLUDED.last_fms_latitude,
  last_fms_longitude = EXCLUDED.last_fms_longitude,
  last_captured_at = EXCLUDED.last_captured_at,
  median_position_delta_m = EXCLUDED.median_position_delta_m,
  updated_at = now();

WITH report_coverage AS (
  SELECT
    report.id,
    CASE
      WHEN report.status = 'Cancelled' THEN 'not_applicable'
      WHEN COALESCE(summary.device_samples, 0) = 0 THEN 'no_data'
      WHEN summary.fms_samples > 0 AND summary.paired_samples = summary.device_samples THEN 'paired'
      WHEN summary.fms_samples > 0 THEN 'partial'
      ELSE 'device_only'
    END AS lookup_status
  FROM ops_reports report
  LEFT JOIN job_gps_summaries summary ON summary.job_id = report.id
)
UPDATE ops_reports report
SET
  status = CASE WHEN report.status = 'Cancelled' THEN 'Cancelled' ELSE 'Completed' END,
  gps = CASE report_coverage.lookup_status
    WHEN 'not_applicable' THEN 'Not applicable'
    WHEN 'paired' THEN 'GPS paired'
    WHEN 'partial' THEN 'GPS partially paired'
    WHEN 'device_only' THEN 'Data-FM matched'
    ELSE 'No GPS point'
  END,
  gps_lookup_status = report_coverage.lookup_status,
  gps_lookup_message = CASE report_coverage.lookup_status
    WHEN 'not_applicable' THEN 'Cancelled job recorded.'
    WHEN 'paired' THEN 'Data-FM and Howen FMS GPS points matched by time.'
    WHEN 'partial' THEN 'Data-FM GPS was found; Howen FMS coverage is partial.'
    WHEN 'device_only' THEN 'Data-FM GPS point matched.'
    ELSE 'No Data-FM GPS point has been matched yet.'
  END,
  gps_sync_status = NULL,
  gps_sync_message = NULL
FROM report_coverage
WHERE report.id = report_coverage.id;

INSERT INTO app_settings (setting_key, setting_value, updated_at)
VALUES ('database_schema_version', '2026-08-31.1', now())
ON CONFLICT (setting_key) DO UPDATE
  SET setting_value = EXCLUDED.setting_value,
      updated_at = now();

COMMIT;
