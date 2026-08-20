import type { DeviceGpsSample } from './gps-sample';
import { getMobileDatabase } from './mobile-database';
import { parseOutboxPayload } from './outbox-payload';

type PendingGpsRow = { id: string; payload: string };

export async function enqueueGpsSample(sample: DeviceGpsSample) {
  const database = await getMobileDatabase();
  await database.runAsync(
    `INSERT INTO pending_gps_samples (id, captured_at, payload)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       payload = excluded.payload,
       retry_disabled = 0,
       failed_at = NULL,
       last_error = NULL`,
    sample.id,
    Date.parse(sample.capturedAt),
    JSON.stringify(sample),
  );
}

export async function listPendingGpsSamples(limit = 5) {
  const database = await getMobileDatabase();
  const rows = await database.getAllAsync<PendingGpsRow>(
    'SELECT id, payload FROM pending_gps_samples WHERE retry_disabled = 0 ORDER BY captured_at ASC LIMIT ?',
    limit,
  );
  const samples: DeviceGpsSample[] = [];
  for (const row of rows) {
    const parsed = parseOutboxPayload<DeviceGpsSample>(row.payload);
    if (parsed.ok) samples.push(parsed.value);
    else await markPendingGpsSamplePermanentFailure(row.id, parsed.error);
  }
  return samples;
}

export async function removePendingGpsSample(id: string) {
  const database = await getMobileDatabase();
  await database.runAsync('DELETE FROM pending_gps_samples WHERE id = ?', id);
}

export async function markPendingGpsSamplePermanentFailure(id: string, message: string) {
  const database = await getMobileDatabase();
  await database.runAsync(
    'UPDATE pending_gps_samples SET retry_disabled = 1, failed_at = ?, last_error = ? WHERE id = ?',
    Date.now(),
    message.slice(0, 500),
    id,
  );
}
