export type FleetBinding = {
  vehicleNumber: string;
  deviceId: string;
  deviceKeyId?: string | null;
  deviceAccessEnforced?: boolean;
  deviceAccessLastUsedAt?: string | null;
  lastActivityAt?: string | null;
};

export function normalizeFleetBindings(value: unknown): FleetBinding[] {
  if (!Array.isArray(value)) return [];
  const seenDevices = new Set<string>();
  const bindings: FleetBinding[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const vehicleNumber = typeof item.vehicleNumber === 'string' ? item.vehicleNumber.trim() : '';
    const deviceId = typeof item.deviceId === 'string' ? item.deviceId.trim() : '';
    if (!vehicleNumber || !deviceId || seenDevices.has(deviceId)) continue;
    seenDevices.add(deviceId);
    bindings.push({
      vehicleNumber,
      deviceId,
      ...(typeof item.deviceKeyId === 'string' ? { deviceKeyId: item.deviceKeyId } : {}),
      ...(typeof item.deviceAccessEnforced === 'boolean' ? { deviceAccessEnforced: item.deviceAccessEnforced } : {}),
      ...(typeof item.deviceAccessLastUsedAt === 'string' ? { deviceAccessLastUsedAt: item.deviceAccessLastUsedAt } : {}),
      ...(typeof item.lastActivityAt === 'string' ? { lastActivityAt: item.lastActivityAt } : {}),
    });
  }
  return bindings;
}

export function fleetSnapshotAfterRequest(
  current: FleetBinding[],
  incoming: unknown,
  requestMutationVersion: number,
  currentMutationVersion: number,
) {
  return requestMutationVersion === currentMutationVersion
    ? normalizeFleetBindings(incoming)
    : current;
}
