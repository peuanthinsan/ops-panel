import type { DriverIdentity } from './job-flow';

export type DriverIdentityLookup = {
  driverIdentity: DriverIdentity;
  vehicleNumber: string | null;
  deviceId: string | null;
};

type DriverBinding = {
  vehicleNumber: string;
  deviceId: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nullableText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeDriverIdentityLookup(value: unknown): DriverIdentityLookup {
  const lookup = record(value);
  const identity = record(lookup.driverIdentity);
  const driverName = nullableText(identity.driverName);
  const driverId = nullableText(identity.driverId);
  return {
    driverIdentity: driverName || driverId ? { driverName, driverId } : null,
    vehicleNumber: nullableText(lookup.vehicleNumber),
    deviceId: nullableText(lookup.deviceId),
  };
}

export function driverLookupBelongsToBinding(binding: DriverBinding, lookup: DriverIdentityLookup) {
  return lookup.vehicleNumber === binding.vehicleNumber
    && lookup.deviceId === binding.deviceId;
}
