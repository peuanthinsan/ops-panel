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

CREATE INDEX IF NOT EXISTS device_request_nonces_expiry_idx ON device_request_nonces (expires_at);

CREATE TABLE IF NOT EXISTS api_rate_limits (
  scope TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, subject_hash, window_start)
);

CREATE INDEX IF NOT EXISTS api_rate_limits_cleanup_idx ON api_rate_limits (updated_at);
CREATE INDEX IF NOT EXISTS ops_reports_keyset_idx ON ops_reports (start_time DESC, id DESC);
CREATE INDEX IF NOT EXISTS ops_reports_device_id_idx ON ops_reports (device_id, start_time DESC);
CREATE INDEX IF NOT EXISTS ops_reports_driver_name_idx ON ops_reports (driver_name, start_time DESC) WHERE driver_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS ops_reports_status_idx ON ops_reports (status, start_time DESC);

INSERT INTO app_settings (setting_key, setting_value, updated_at)
VALUES ('database_schema_version', '2026-08-19.2', now())
ON CONFLICT (setting_key) DO UPDATE
SET setting_value = EXCLUDED.setting_value, updated_at = now();
