import type { ActiveJob, DeviceBinding } from './device';
import type { JobReportInput } from './report';

export function activeJobBelongsToBinding(job: ActiveJob | null, binding: DeviceBinding | null) {
  return Boolean(job && binding
    && job.vehicleNumber === binding.vehicleNumber
    && job.deviceId === binding.deviceId);
}

export function deviceBindingKey(binding: DeviceBinding | null) {
  return binding ? `${binding.deviceId}\u0000${binding.vehicleNumber}` : '';
}

/** The control panel must not accept a new mode until the active-job record
 * has been reconciled for the exact binding currently on screen. */
export function mobileStartupReady(
  bindingChecked: boolean,
  binding: DeviceBinding | null,
  recoveredBindingKey: string | null,
) {
  return bindingChecked
    && (!binding || recoveredBindingKey === deviceBindingKey(binding));
}

export function shouldPreserveLocalBindingWithoutRemote(job: ActiveJob | null, binding: DeviceBinding | null) {
  return activeJobBelongsToBinding(job, binding)
    && (Boolean(job?.pendingReport) || job?.awaitingMovement !== true);
}

/** A started or finalizing job already carries the pair required to finish it.
 * A movement-pending selection is intentionally excluded because an admin may
 * have reassigned the tablet before any work actually began. */
export function recoverBindingFromActiveJob(job: ActiveJob | null, binding: DeviceBinding | null) {
  if (binding) return binding;
  if (!job || (job.awaitingMovement === true && !job.pendingReport)) return null;
  return { vehicleNumber: job.vehicleNumber, deviceId: job.deviceId };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function trimmedText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePendingReport(value: unknown): JobReportInput | null {
  const report = record(value);
  if (!report) return null;
  const id = trimmedText(report.id);
  const vehicleNumber = trimmedText(report.vehicleNumber);
  const deviceId = trimmedText(report.deviceId);
  const mode = trimmedText(report.mode);
  const startTime = trimmedText(report.startTime);
  const endTime = trimmedText(report.endTime);
  const duration = trimmedText(report.duration);
  const start = Date.parse(startTime);
  const end = Date.parse(endTime);
  if (!id || !vehicleNumber || !deviceId || !mode || !duration
    || !Number.isFinite(start) || !Number.isFinite(end) || end < start
    || (report.status !== undefined && report.status !== 'Cancelled')) return null;
  const driverName = trimmedText(report.driverName) || null;
  const driverId = trimmedText(report.driverId) || null;
  return {
    id,
    vehicleNumber,
    deviceId,
    driverName,
    driverId,
    mode,
    startTime,
    endTime,
    duration,
    ...(report.status === 'Cancelled' ? { status: 'Cancelled' as const } : {}),
  };
}

function expectedMode(selected: string) {
  return ({
    '1': 'Load',
    '2': 'Stop vehicle',
    '3': 'Unload',
    '4': 'Break',
    '5': 'Vehicle check',
    '6': 'Refuel',
    '7': 'Vehicle wash',
    '8': 'Park overnight',
    '9': 'Finish work',
  } as Record<string, string>)[selected] || '';
}

export function parseStoredBinding(raw: string | null): DeviceBinding | null {
  if (!raw) return null;
  try {
    const value = record(JSON.parse(raw));
    if (!value) return null;
    const vehicleNumber = trimmedText(value.vehicleNumber);
    const deviceId = trimmedText(value.deviceId);
    return vehicleNumber && deviceId ? { vehicleNumber, deviceId } : null;
  } catch {
    return null;
  }
}

export function parseStoredActiveJob(raw: string | null): ActiveJob | null {
  if (!raw) return null;
  try {
    const value = record(JSON.parse(raw));
    if (!value) return null;
    const vehicleNumber = trimmedText(value.vehicleNumber);
    const deviceId = trimmedText(value.deviceId);
    const selected = trimmedText(value.selected);
    const startedAt = Number(value.startedAt);
    const awaitingMovement = value.awaitingMovement === true;
    if (!vehicleNumber || !deviceId || !/^[1-9]$/.test(selected)
      || !Number.isFinite(startedAt) || startedAt < 0
      || (!awaitingMovement && startedAt <= 0)) return null;
    const rawJobId = trimmedText(value.jobId) || undefined;
    const driverName = trimmedText(value.driverName) || null;
    const driverId = trimmedText(value.driverId) || null;
    const pendingCandidate = parsePendingReport(value.pendingReport);
    const pendingReport = pendingCandidate
      && pendingCandidate.vehicleNumber === vehicleNumber
      && pendingCandidate.deviceId === deviceId
      && pendingCandidate.mode === expectedMode(selected)
      && (!rawJobId || pendingCandidate.id === rawJobId)
      && (startedAt > 0
        ? Date.parse(pendingCandidate.startTime) === startedAt
        : awaitingMovement && pendingCandidate.status === 'Cancelled'
          && pendingCandidate.startTime === pendingCandidate.endTime)
      ? pendingCandidate
      : null;
    const jobId = rawJobId || pendingReport?.id;
    return {
      ...(jobId ? { jobId } : {}),
      vehicleNumber,
      deviceId,
      selected,
      startedAt,
      ...(awaitingMovement ? { awaitingMovement: true } : {}),
      driverName,
      driverId,
      ...(pendingReport ? { pendingReport } : {}),
    };
  } catch {
    return null;
  }
}
