import { getMobileDatabase } from './mobile-database';
import type { JobStartInput } from './job-start';
import { parseOutboxPayload } from './outbox-payload';

type PendingJobStartRow = { id: string; payload: string };

export async function enqueueJobStart(jobStart: JobStartInput) {
  const database = await getMobileDatabase();
  await database.runAsync(
    `INSERT INTO pending_job_starts (id, created_at, payload)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       payload = excluded.payload,
       retry_disabled = 0,
       failed_at = NULL,
       last_error = NULL`,
    jobStart.id,
    Date.now(),
    JSON.stringify(jobStart),
  );
}

export async function listPendingJobStarts(limit = 10) {
  const database = await getMobileDatabase();
  const rows = await database.getAllAsync<PendingJobStartRow>(
    'SELECT id, payload FROM pending_job_starts WHERE retry_disabled = 0 ORDER BY created_at ASC LIMIT ?',
    limit,
  );
  const jobStarts: JobStartInput[] = [];
  for (const row of rows) {
    const parsed = parseOutboxPayload<JobStartInput>(row.payload);
    if (parsed.ok) jobStarts.push(parsed.value);
    else await markPendingJobStartPermanentFailure(row.id, parsed.error);
  }
  return jobStarts;
}

export async function removePendingJobStart(id: string) {
  const database = await getMobileDatabase();
  await database.runAsync('DELETE FROM pending_job_starts WHERE id = ?', id);
}

export async function markPendingJobStartPermanentFailure(id: string, message: string) {
  const database = await getMobileDatabase();
  await database.runAsync(
    'UPDATE pending_job_starts SET retry_disabled = 1, failed_at = ?, last_error = ? WHERE id = ?',
    Date.now(),
    message.slice(0, 500),
    id,
  );
}
