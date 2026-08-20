import type { JobReportInput } from './report';

export type JobDeliveryResult = 'synced' | 'queued';

type JobDeliveryOperations = {
  enqueue(report: JobReportInput): Promise<void>;
  send(report: JobReportInput): Promise<unknown>;
  remove(reportId: string): Promise<void>;
  markPermanentFailure(reportId: string, message: string): Promise<void>;
  isRetryable(error: unknown): boolean;
  errorMessage(error: unknown): string;
};

export async function deliverJobReport(
  report: JobReportInput,
  operations: JobDeliveryOperations,
): Promise<JobDeliveryResult> {
  try {
    await operations.enqueue(report);
  } catch {
    // If SQLite itself is unavailable, a successful direct request is still
    // preferable to blocking the mounted tablet indefinitely.
    await operations.send(report);
    return 'synced';
  }

  try {
    await operations.send(report);
    await operations.remove(report.id);
    return 'synced';
  } catch (error) {
    if (operations.isRetryable(error)) return 'queued';

    // Keep rejected records as diagnostics. Repeating Done/Cancel re-enqueues
    // the same stable report ID and deliberately enables one operator retry.
    await operations.markPermanentFailure(report.id, operations.errorMessage(error)).catch(() => {
      // Preserve the original API error even if recording diagnostics fails.
    });
    throw error;
  }
}
