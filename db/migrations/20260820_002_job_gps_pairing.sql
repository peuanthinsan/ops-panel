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

CREATE INDEX IF NOT EXISTS gps_sync_samples_job_time_idx ON gps_sync_samples (job_id, captured_at DESC) WHERE job_id IS NOT NULL;

ALTER TABLE gps_sync_samples DROP CONSTRAINT IF EXISTS gps_sync_samples_motion_check;
ALTER TABLE gps_sync_samples ADD CONSTRAINT gps_sync_samples_motion_check CHECK (
  (device_speed_mps IS NULL OR device_speed_mps >= 0)
  AND (device_heading_deg IS NULL OR device_heading_deg BETWEEN 0 AND 360)
  AND (fms_speed_mps IS NULL OR fms_speed_mps >= 0)
  AND (position_delta_m IS NULL OR position_delta_m >= 0)
  AND (time_delta_ms IS NULL OR time_delta_ms >= 0)
) NOT VALID;

ALTER TABLE gps_sync_samples DROP CONSTRAINT IF EXISTS gps_sync_samples_fms_coordinates_check;
ALTER TABLE gps_sync_samples ADD CONSTRAINT gps_sync_samples_fms_coordinates_check CHECK (
  (fms_latitude IS NULL AND fms_longitude IS NULL)
  OR (fms_latitude BETWEEN -90 AND 90 AND fms_longitude BETWEEN -180 AND 180)
) NOT VALID;

ALTER TABLE gps_sync_samples DROP CONSTRAINT IF EXISTS gps_sync_samples_pair_status_check;
ALTER TABLE gps_sync_samples ADD CONSTRAINT gps_sync_samples_pair_status_check
  CHECK (pair_status IN ('pending', 'paired', 'fms_received', 'device_only', 'fms_delayed')) NOT VALID;

ALTER TABLE gps_sync_samples VALIDATE CONSTRAINT gps_sync_samples_motion_check;
ALTER TABLE gps_sync_samples VALIDATE CONSTRAINT gps_sync_samples_fms_coordinates_check;
ALTER TABLE gps_sync_samples VALIDATE CONSTRAINT gps_sync_samples_pair_status_check;

UPDATE gps_sync_samples sample
SET job_id = COALESCE(
  (SELECT active.id FROM active_jobs active WHERE active.vehicle_number = sample.vehicle_number AND active.device_id = sample.device_id AND active.start_time <= sample.captured_at ORDER BY active.start_time DESC LIMIT 1),
  (SELECT report.id FROM ops_reports report WHERE report.vehicle_number = sample.vehicle_number AND report.device_id = sample.device_id AND sample.captured_at BETWEEN report.start_time AND report.end_time ORDER BY report.start_time DESC LIMIT 1)
)
WHERE sample.job_id IS NULL;

UPDATE gps_sync_samples SET pair_status = CASE
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
  job_id, vehicle_number, device_id, device_samples, fms_samples, paired_samples,
  attention_samples, last_device_latitude, last_device_longitude, last_fms_latitude,
  last_fms_longitude, last_captured_at, median_position_delta_m, updated_at
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
  vehicle_number = EXCLUDED.vehicle_number, device_id = EXCLUDED.device_id,
  device_samples = EXCLUDED.device_samples, fms_samples = EXCLUDED.fms_samples,
  paired_samples = EXCLUDED.paired_samples, attention_samples = EXCLUDED.attention_samples,
  last_device_latitude = EXCLUDED.last_device_latitude, last_device_longitude = EXCLUDED.last_device_longitude,
  last_fms_latitude = EXCLUDED.last_fms_latitude, last_fms_longitude = EXCLUDED.last_fms_longitude,
  last_captured_at = EXCLUDED.last_captured_at,
  median_position_delta_m = EXCLUDED.median_position_delta_m,
  updated_at = now();

INSERT INTO app_settings (setting_key, setting_value, updated_at)
VALUES ('database_schema_version', '2026-08-20.1', now())
ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now();
