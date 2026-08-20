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
