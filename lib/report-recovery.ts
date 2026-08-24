import type { JobReportInput } from './report';

export type FinalReportIntent = 'completed' | 'cancelled';

export function reportIntent(report: JobReportInput): FinalReportIntent {
  return report.status === 'Cancelled' ? 'cancelled' : 'completed';
}

/** Reuse the first durable final payload so an ambiguous response can never
 * change its end time or status under the same idempotency key. */
export function finalReportForIntent(
  existing: JobReportInput | null,
  intent: FinalReportIntent,
  create: () => JobReportInput,
) {
  if (!existing) return create();
  return reportIntent(existing) === intent ? existing : null;
}

/** A driver cancellation may supersede a completion payload that is still
 * holding the tablet in recovery. Keep the same id and timing so the backend
 * either accepts the one logical job or reports an idempotency conflict for
 * admin review; never create a duplicate job to release the tablet. */
export function cancellationReportForIntent(
  existing: JobReportInput | null,
  create: () => JobReportInput,
) {
  if (!existing) return create();
  if (existing.status === 'Cancelled') return existing;
  return { ...existing, status: 'Cancelled' as const };
}
