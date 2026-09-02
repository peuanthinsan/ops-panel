import crypto from 'node:crypto';

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const actionNumberByMode = new Map([
  ['Load', '1'],
  ['Stop vehicle', '2'],
  ['Unload', '3'],
  ['Break', '4'],
  ['Vehicle check', '5'],
  ['Refuel', '6'],
  ['Vehicle wash', '7'],
  ['Park overnight', '8'],
  ['Finish work', '9'],
]);

export function createServerJobId(deviceId, mode, initiatedAt) {
  const normalizedDeviceId = String(deviceId || '').trim();
  const actionNumber = actionNumberByMode.get(String(mode || '').trim());
  const timestamp = Math.trunc(Number(initiatedAt));
  const shifted = new Date(timestamp + BANGKOK_OFFSET_MS);
  if (!normalizedDeviceId || !actionNumber || !Number.isFinite(timestamp) || !Number.isFinite(shifted.getTime())) {
    throw new Error('A valid device, mode, and initiation time are required');
  }
  const date = shifted.toISOString().slice(0, 10).replace(/-/g, '');
  const fingerprint = crypto.createHash('sha256')
    .update(`${normalizedDeviceId}\u0000${actionNumber}\u0000${timestamp}`)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();
  return `JOB-${date}-${fingerprint}`;
}
