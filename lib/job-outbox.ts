import { getMobileDatabase } from './mobile-database';
import { parseOutboxPayload } from './outbox-payload';
import type { JobReportInput } from './report';
import type { LocallySavedJob } from './saved-jobs';

type PendingJobRow = { id: string; payload: string; retry_disabled?: number };

export async function enqueueJobReport(report: JobReportInput) {
  const database = await getMobileDatabase();
  await database.runAsync(
    `INSERT INTO pending_job_reports (id, created_at, payload)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       payload = excluded.payload,
       retry_disabled = 0,
       failed_at = NULL,
       last_error = NULL`,
    report.id,
    Date.now(),
    JSON.stringify(report),
  );
}

export async function listPendingJobReports(limit = 10) {
  const database = await getMobileDatabase();
  const rows = await database.getAllAsync<PendingJobRow>(
    'SELECT id, payload FROM pending_job_reports WHERE retry_disabled = 0 ORDER BY created_at ASC LIMIT ?',
    limit,
  );
  const reports: JobReportInput[] = [];
  for (const row of rows) {
    const parsed = parseOutboxPayload<JobReportInput>(row.payload);
    if (parsed.ok) reports.push(parsed.value);
    else await markPendingJobReportPermanentFailure(row.id, parsed.error);
  }
  return reports;
}

export async function listStoredJobReports(limit = 100) {
  const database = await getMobileDatabase();
  const rows = await database.getAllAsync<PendingJobRow>(
    'SELECT id, payload, retry_disabled FROM pending_job_reports ORDER BY created_at DESC LIMIT ?',
    limit,
  );
  const reports: LocallySavedJob[] = [];
  for (const row of rows) {
    const parsed = parseOutboxPayload<JobReportInput>(row.payload);
    if (parsed.ok) reports.push({ report: parsed.value, uploadFailed: Boolean(row.retry_disabled) });
    else await markPendingJobReportPermanentFailure(row.id, parsed.error);
  }
  return reports;
}

export async function removePendingJobReport(id: string) {
  const database = await getMobileDatabase();
  await database.runAsync('DELETE FROM pending_job_reports WHERE id = ?', id);
}

export async function markPendingJobReportPermanentFailure(id: string, message: string) {
  const database = await getMobileDatabase();
  await database.runAsync(
    'UPDATE pending_job_reports SET retry_disabled = 1, failed_at = ?, last_error = ? WHERE id = ?',
    Date.now(),
    message.slice(0, 500),
    id,
  );
}
