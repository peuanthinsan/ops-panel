import type { TelemetryResult } from './speed-timeline.ts';

type ReportFuelBounds = { startTime?: string | null; endTime?: string | null };
type EmptyFuelStatus = 'no_fuel' | 'loading' | 'unavailable' | 'not_configured';
export type ReportFuelReading =
  | { status: 'received'; totalFuel: number; capturedAt: string }
  | { status: EmptyFuelStatus; totalFuel: null; capturedAt: null };

function emptyReading(status: EmptyFuelStatus): ReportFuelReading {
  return { status, totalFuel: null, capturedAt: null };
}

/** Latest observed Total fuel within this saved job, in the provider's raw units. */
export function reportFuelReading(
  report: ReportFuelBounds,
  telemetry?: TelemetryResult | null,
  loading = true,
): ReportFuelReading {
  const startMs = Date.parse(report.startTime || '');
  const endMs = Date.parse(report.endTime || '');
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return emptyReading('unavailable');
  if (!telemetry || telemetry.status === 'loading') return emptyReading(loading ? 'loading' : 'no_fuel');
  if (telemetry.status === 'not_configured') return emptyReading('not_configured');
  if (telemetry.status !== 'received') return emptyReading('unavailable');

  let latestMs = -Infinity;
  let latest: ReportFuelReading = emptyReading('no_fuel');
  for (const sample of Array.isArray(telemetry.samples) ? telemetry.samples : []) {
    const value = sample?.totalFuel;
    if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') continue;
    const totalFuel = Number(value);
    if (!Number.isFinite(totalFuel) || totalFuel < 0 || typeof sample.capturedAt !== 'string') continue;
    const capturedMs = Date.parse(sample.capturedAt);
    if (!Number.isFinite(capturedMs) || capturedMs < startMs || capturedMs > endMs || capturedMs < latestMs) continue;
    latestMs = capturedMs;
    latest = { status: 'received', totalFuel, capturedAt: sample.capturedAt };
  }
  return latest;
}
