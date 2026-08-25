import { getMobileDatabase } from './mobile-database';
import { DEVICE_JOB_PAGE_SIZE, type DeviceJobHistoryPageInfo, type DeviceJobHistorySummary } from './device-job-history';
import type { MobileJobQuery } from './mobile-job-query';
import { parseOutboxPayload } from './outbox-payload';
import type { JobReportInput } from './report';
import type { LocallySavedJob } from './saved-jobs';

type PendingJobRow = { id: string; payload: string; retry_disabled?: number };
type SavedJobRow = { id: string; payload: string; retry_disabled?: number | null };

export type StoredJobHistoryPage = {
  jobs: LocallySavedJob[];
  facets: { months: string[] };
  pageInfo: DeviceJobHistoryPageInfo;
  summary: DeviceJobHistorySummary;
};

export async function enqueueJobReport(report: JobReportInput) {
  const database = await getMobileDatabase();
  const payload = JSON.stringify(report);
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `INSERT INTO saved_job_reports (id, vehicle_number, device_id, end_at, payload)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         vehicle_number = excluded.vehicle_number,
         device_id = excluded.device_id,
         end_at = excluded.end_at,
         payload = excluded.payload`,
      report.id,
      report.vehicleNumber,
      report.deviceId,
      Date.parse(report.endTime),
      payload,
    );
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
      payload,
    );
  });
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

function timestampRange(query: MobileJobQuery) {
  if (query.startAt || query.endAt) {
    const start = query.startAt ? Date.parse(query.startAt) : null;
    const end = query.endAt ? Date.parse(query.endAt) : null;
    return {
      start: Number.isFinite(start) ? start : null,
      end: Number.isFinite(end) ? end : null,
      exactRange: true,
    };
  }
  const key = query.dayKey || query.monthKey;
  if (!key) return null;
  const parts = key.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = query.dayKey ? parts[2] : 1;
  if (!year || !month || !day) return null;
  const start = Date.UTC(year, month - 1, day) - (7 * 60 * 60 * 1000);
  const end = query.dayKey
    ? start + (24 * 60 * 60 * 1000)
    : Date.UTC(year, month, 1) - (7 * 60 * 60 * 1000);
  return { start, end, exactRange: false };
}

function storedJobWhere(query: MobileJobQuery, onlyPending: boolean) {
  const clauses = ['saved.device_id = ?', 'lower(saved.vehicle_number) = lower(?)'];
  const values: Array<string | number> = [];
  const range = timestampRange(query);
  if (range) {
    if (range.start != null) {
      clauses.push('saved.end_at >= ?');
      values.push(range.start);
    }
    if (range.end != null) {
      clauses.push(range.exactRange
        ? "COALESCE(unixepoch(json_extract(saved.payload, '$.startTime')) * 1000, saved.end_at) <= ?"
        : "COALESCE(unixepoch(json_extract(saved.payload, '$.startTime')) * 1000, saved.end_at) < ?");
      values.push(range.end);
    }
  }
  if (query.mode) {
    clauses.push("json_extract(saved.payload, '$.mode') = ?");
    values.push(query.mode);
  }
  if (query.status === 'cancelled') clauses.push("json_extract(saved.payload, '$.status') = 'Cancelled'");
  if (query.status === 'completed') clauses.push("COALESCE(json_extract(saved.payload, '$.status'), 'Completed') <> 'Cancelled'");
  if (query.status === 'pending') clauses.push('pending.id IS NOT NULL', 'pending.retry_disabled = 0');
  if (query.status === 'failed') clauses.push('pending.id IS NOT NULL', 'pending.retry_disabled = 1');
  if (onlyPending) clauses.push('pending.id IS NOT NULL');
  if (query.search.trim()) {
    clauses.push("lower(saved.payload) LIKE ? ESCAPE '\\'");
    const escaped = query.search.trim().toLocaleLowerCase().replace(/[\\%_]/g, value => `\\${value}`);
    values.push(`%${escaped}%`);
  }
  return { clauses, values };
}

function storedJobOrder(sort: MobileJobQuery['sort']) {
  if (sort === 'oldest') return 'saved.end_at ASC, saved.id ASC';
  if (sort === 'duration_desc') return "(saved.end_at - COALESCE(unixepoch(json_extract(saved.payload, '$.startTime')) * 1000, saved.end_at)) DESC, saved.end_at DESC, saved.id DESC";
  if (sort === 'mode_asc') return "lower(json_extract(saved.payload, '$.mode')) ASC, saved.end_at DESC, saved.id DESC";
  return 'saved.end_at DESC, saved.id DESC';
}

export async function listStoredJobReportsPage(
  deviceId: string,
  vehicleNumber: string,
  query: MobileJobQuery,
  requestedPage = 1,
  onlyPending = false,
): Promise<StoredJobHistoryPage> {
  const database = await getMobileDatabase();
  const pageSize = DEVICE_JOB_PAGE_SIZE;
  const pageCandidate = Math.max(1, Math.trunc(requestedPage) || 1);
  const where = storedJobWhere(query, onlyPending);
  const baseValues = [deviceId, vehicleNumber, ...where.values];
  const fromSql = `
    FROM saved_job_reports saved
    LEFT JOIN pending_job_reports pending ON pending.id = saved.id
    WHERE ${where.clauses.join(' AND ')}`;
  const [countRows, summaryRows, monthRows] = await Promise.all([
    database.getAllAsync<{ total: number }>(`SELECT count(*) AS total ${fromSql}`, ...baseValues),
    database.getAllAsync<{ total: number; completed: number; cancelled: number; duration_seconds: number }>(`
      SELECT
        count(*) AS total,
        sum(CASE WHEN COALESCE(json_extract(saved.payload, '$.status'), 'Completed') <> 'Cancelled' THEN 1 ELSE 0 END) AS completed,
        sum(CASE WHEN json_extract(saved.payload, '$.status') = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled,
        COALESCE(sum(MAX(0, saved.end_at - COALESCE(unixepoch(json_extract(saved.payload, '$.startTime')) * 1000, saved.end_at))) / 1000, 0) AS duration_seconds
      ${fromSql}
    `, ...baseValues),
    database.getAllAsync<{ month: string }>(`
      SELECT DISTINCT strftime('%Y-%m', saved.end_at / 1000, 'unixepoch', '+7 hours') AS month
      FROM saved_job_reports saved
      LEFT JOIN pending_job_reports pending ON pending.id = saved.id
      WHERE saved.device_id = ? AND lower(saved.vehicle_number) = lower(?)${onlyPending ? ' AND pending.id IS NOT NULL' : ''}
      ORDER BY month DESC
    `, deviceId, vehicleNumber),
  ]);
  const total = Number(countRows[0]?.total) || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageCandidate, totalPages);
  const offset = (page - 1) * pageSize;
  const savedRows = await database.getAllAsync<SavedJobRow>(`
    SELECT saved.id, saved.payload, pending.retry_disabled
    ${fromSql}
    ORDER BY ${storedJobOrder(query.sort)}
    LIMIT ? OFFSET ?
  `, ...baseValues, pageSize, offset);
  const jobs: LocallySavedJob[] = [];
  for (const row of savedRows) {
    const parsed = parseOutboxPayload<JobReportInput>(row.payload);
    if (parsed.ok) {
      jobs.push({
        report: parsed.value,
        pendingUpload: row.retry_disabled === 0,
        uploadFailed: row.retry_disabled === 1,
      });
      continue;
    }
    await markPendingJobReportPermanentFailure(row.id, parsed.error);
  }
  const summary = summaryRows[0];
  return {
    jobs,
    facets: { months: monthRows.map(row => row.month).filter(Boolean) },
    pageInfo: {
      page,
      pageSize,
      total,
      totalPages,
      start: jobs.length ? offset + 1 : 0,
      end: offset + jobs.length,
      hasNextPage: page < totalPages,
    },
    summary: {
      total,
      completed: Number(summary?.completed) || 0,
      cancelled: Number(summary?.cancelled) || 0,
      durationSeconds: Math.floor(Number(summary?.duration_seconds) || 0),
    },
  };
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
