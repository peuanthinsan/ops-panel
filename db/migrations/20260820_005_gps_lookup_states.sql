ALTER TABLE ops_reports ADD COLUMN IF NOT EXISTS gps_lookup_status TEXT;

ALTER TABLE ops_reports ADD COLUMN IF NOT EXISTS gps_lookup_message TEXT;

CREATE INDEX IF NOT EXISTS ops_reports_gps_lookup_status_idx
  ON ops_reports (gps_lookup_status)
  WHERE gps_lookup_status IS NOT NULL;

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
VALUES ('database_schema_version', '2026-08-20.4', now())
ON CONFLICT (setting_key) DO UPDATE
  SET setting_value = EXCLUDED.setting_value,
      updated_at = now();
