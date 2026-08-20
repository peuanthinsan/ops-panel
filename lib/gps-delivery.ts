import type { DeviceGpsSample } from './gps-sample';

export type GpsDeliveryOperations = {
  list(limit: number): Promise<DeviceGpsSample[]>;
  send(sample: DeviceGpsSample): Promise<unknown>;
  remove(sampleId: string): Promise<void>;
  markPermanentFailure(sampleId: string, message: string): Promise<void>;
  isRetryable(error: unknown): boolean;
  errorMessage(error: unknown): string;
};

export type GpsFlushResult = {
  delivered: number;
  permanentFailures: number;
  stoppedOnRetryableFailure: boolean;
};

/**
 * Deliver persisted GPS samples independently of location capture or the
 * tablet's current binding. Historical samples remain valid through binding
 * history, so losing permission or being unbound must not strand the outbox.
 */
export async function flushPendingGpsSamples(
  operations: GpsDeliveryOperations,
  limit = 5,
): Promise<GpsFlushResult> {
  const result: GpsFlushResult = {
    delivered: 0,
    permanentFailures: 0,
    stoppedOnRetryableFailure: false,
  };
  const pending = await operations.list(limit);

  for (const sample of pending) {
    try {
      await operations.send(sample);
      await operations.remove(sample.id);
      result.delivered += 1;
    } catch (error) {
      if (operations.isRetryable(error)) {
        result.stoppedOnRetryableFailure = true;
        break;
      }
      await operations.markPermanentFailure(sample.id, operations.errorMessage(error));
      result.permanentFailures += 1;
    }
  }

  return result;
}
