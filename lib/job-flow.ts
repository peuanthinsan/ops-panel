export type JobSnapshot = {
  selected: string | null;
  startedAt: number | null;
  awaitingMovement: boolean;
};

export type DriverIdentity = {
  driverName?: string | null;
  driverId?: string | null;
} | null;

export type ActionDecision =
  | { type: 'confirm_start' }
  | { type: 'confirm_finish' }
  | { type: 'blocked'; reason: 'waiting_for_movement' | 'not_started' | 'job_in_progress' };

export function isActionUnavailable(snapshot: JobSnapshot, actionNumber: string) {
  if (actionNumber === '9') return !snapshot.selected;
  return Boolean(snapshot.selected);
}

export function decideAction(actionNumber: string, snapshot: JobSnapshot): ActionDecision {
  if (actionNumber === '9') {
    if (!snapshot.selected) return { type: 'blocked', reason: 'not_started' };
    return { type: 'confirm_finish' };
  }
  if (snapshot.startedAt || snapshot.awaitingMovement) return { type: 'blocked', reason: 'job_in_progress' };
  return { type: 'confirm_start' };
}

export function idleJobSnapshot(): JobSnapshot {
  return { selected: null, startedAt: null, awaitingMovement: false };
}

export function snapshotDriver(identity: DriverIdentity): DriverIdentity {
  if (!identity) return null;
  const driverName = identity.driverName?.trim() || null;
  const driverId = identity.driverId?.trim() || null;
  return driverName || driverId ? { driverName, driverId } : null;
}

export function reportDriver(startDriver: DriverIdentity, currentDriver: DriverIdentity): DriverIdentity {
  return startDriver ?? snapshotDriver(currentDriver);
}

export function createJobId(deviceId: string, actionNumber: string, initiatedAt: number) {
  const safeDeviceId = deviceId.trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 96);
  if (!safeDeviceId || !actionNumber || !Number.isFinite(initiatedAt)) throw new Error('A valid device, action, and initiation time are required');
  return `OPS-${safeDeviceId}-${actionNumber}-${Math.trunc(initiatedAt)}`;
}

export function jobInitiatedAt(jobId: string | null) {
  const match = String(jobId || '').match(/-(\d{10,})$/);
  if (!match) return null;
  const initiatedAt = Number(match[1]);
  return Number.isFinite(initiatedAt) && initiatedAt > 0 ? initiatedAt : null;
}
