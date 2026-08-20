export type MotionBinding = {
  vehicleNumber: string;
  deviceId: string;
};

export type VehicleMotion = {
  moving: boolean | null;
  speed: number | null;
  sourceStatus: string;
  vehicleNumber: string | null;
  deviceId: string | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nullableText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeVehicleMotion(value: unknown): VehicleMotion {
  const motion = record(value);
  return {
    moving: motion.moving === true ? true : motion.moving === false ? false : null,
    speed: nullableNumber(motion.speed),
    sourceStatus: nullableText(motion.sourceStatus) ?? 'unavailable',
    vehicleNumber: nullableText(motion.vehicleNumber),
    deviceId: nullableText(motion.deviceId),
  };
}

export function motionBelongsToBinding(binding: MotionBinding, motion: VehicleMotion) {
  return motion.vehicleNumber === binding.vehicleNumber
    && motion.deviceId === binding.deviceId;
}

export function motionStartsJob(binding: MotionBinding, motion: VehicleMotion) {
  return motionBelongsToBinding(binding, motion)
    && motion.sourceStatus === 'configured'
    && motion.moving === true;
}
