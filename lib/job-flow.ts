import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

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
  | { type: 'confirm_day_end' }
  | { type: 'confirm_finish' }
  | { type: 'blocked'; reason: 'waiting_for_movement' | 'not_started' | 'job_in_progress' };

export function isActionUnavailable(snapshot: JobSnapshot, actionNumber: string) {
  return Boolean(snapshot.selected && snapshot.selected !== actionNumber);
}

export function decideAction(actionNumber: string, snapshot: JobSnapshot): ActionDecision {
  if (!snapshot.selected) return actionNumber === '9' ? { type: 'confirm_day_end' } : { type: 'confirm_start' };
  if (snapshot.selected === actionNumber) return { type: 'confirm_finish' };
  return { type: 'blocked', reason: 'job_in_progress' };
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

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const preciseOpsJobIdPattern = /^OPS-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.(\d{3})-[0-9A-F]{12}$/i;

function bangkokIdDate(initiatedAt: number) {
  const shifted = new Date(initiatedAt + BANGKOK_OFFSET_MS);
  if (!Number.isFinite(shifted.getTime())) return null;
  return shifted.toISOString().slice(0, 10).replace(/-/g, '');
}

function jobFingerprint(deviceId: string, actionNumber: string, initiatedAt: number) {
  return bytesToHex(sha256(utf8ToBytes(
    `${deviceId}\u0000${actionNumber}\u0000${initiatedAt}`,
  ))).slice(0, 12).toUpperCase();
}

export function createJobId(deviceId: string, actionNumber: string, initiatedAt: number) {
  const normalizedDeviceId = deviceId.trim();
  const normalizedActionNumber = actionNumber.trim();
  const timestamp = Math.trunc(initiatedAt);
  const visibleDate = bangkokIdDate(timestamp);
  if (!normalizedDeviceId || !normalizedActionNumber || !Number.isFinite(timestamp) || !visibleDate) {
    throw new Error('A valid device, action, and initiation time are required');
  }
  const fingerprint = jobFingerprint(normalizedDeviceId, normalizedActionNumber, timestamp);
  return `JOB-${visibleDate}-${fingerprint}`;
}

export function jobInitiatedAt(jobId: string | null) {
  const value = String(jobId || '');
  const preciseOpsMatch = value.match(preciseOpsJobIdPattern);
  if (preciseOpsMatch) {
    const [, year, month, day, hour, minute, second, millisecond] = preciseOpsMatch;
    const initiatedAt = Date.UTC(
      Number(year), Number(month) - 1, Number(day),
      Number(hour), Number(minute), Number(second), Number(millisecond),
    ) - BANGKOK_OFFSET_MS;
    const shifted = new Date(initiatedAt + BANGKOK_OFFSET_MS);
    const iso = Number.isFinite(shifted.getTime()) ? shifted.toISOString() : '';
    const roundTrip = iso
      ? `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 23).replace(/:/g, '')}`
      : null;
    return initiatedAt > 0 && roundTrip === `${year}${month}${day}-${hour}${minute}${second}.${millisecond}`
      ? initiatedAt
      : null;
  }

  const legacyMatch = value.match(/^OPS-.+-[1-9]-(\d{13})$/);
  if (!legacyMatch) return null;
  const initiatedAt = Number(legacyMatch[1]);
  return Number.isFinite(initiatedAt) && initiatedAt > 0 ? initiatedAt : null;
}
