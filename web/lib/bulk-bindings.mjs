export const maximumBulkBindings = 5000;

export function normalizeBulkBindings(value) {
  if (!Array.isArray(value)) throw new Error('bindings must be an array');
  if (!value.length) throw new Error('bindings must include at least one row');
  if (value.length > maximumBulkBindings) throw new Error(`bindings cannot exceed ${maximumBulkBindings} rows per import`);

  const byDevice = new Map();
  for (const item of value) {
    const vehicleNumber = String(item?.vehicleNumber || '').trim();
    const deviceId = String(item?.deviceId || '').trim();
    if (!vehicleNumber || !deviceId) throw new Error('Every binding requires vehicleNumber and deviceId');
    if (vehicleNumber.length > 80) throw new Error('vehicleNumber is too long');
    if (deviceId.length > 180) throw new Error('deviceId is too long');
    if (byDevice.has(deviceId) && byDevice.get(deviceId) !== vehicleNumber) {
      throw new Error(`Device ${deviceId} appears with more than one vehicle`);
    }
    byDevice.set(deviceId, vehicleNumber);
  }
  return [...byDevice].map(([deviceId, vehicleNumber]) => ({ vehicleNumber, deviceId }));
}
