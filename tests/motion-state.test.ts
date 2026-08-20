import assert from 'node:assert/strict';
import test from 'node:test';
import { motionBelongsToBinding, motionStartsJob, normalizeVehicleMotion, type VehicleMotion } from '../lib/motion-state.ts';

const binding = { vehicleNumber: '74-1286', deviceId: 'tablet-101' };

function motion(overrides: Partial<VehicleMotion> = {}): VehicleMotion {
  return {
    moving: false,
    speed: 0,
    sourceStatus: 'configured',
    vehicleNumber: binding.vehicleNumber,
    deviceId: binding.deviceId,
    ...overrides,
  };
}

test('movement starts a job only for the tablet current vehicle binding', () => {
  assert.equal(motionBelongsToBinding(binding, motion()), true);
  assert.equal(motionStartsJob(binding, motion({ moving: true, speed: 12 })), true);
  assert.equal(motionStartsJob(binding, motion({ moving: true, vehicleNumber: '74-9999' })), false);
  assert.equal(motionStartsJob(binding, motion({ moving: true, deviceId: 'tablet-202' })), false);
  assert.equal(motionStartsJob(binding, motion({ moving: true, vehicleNumber: null })), false);
});

test('unavailable or stationary movement never starts a production job', () => {
  assert.equal(motionStartsJob(binding, motion({ moving: false })), false);
  assert.equal(motionStartsJob(binding, motion({ moving: true, sourceStatus: 'unavailable' })), false);
  assert.equal(motionStartsJob(binding, motion({ moving: true, sourceStatus: 'not_configured' })), false);
});

test('motion responses are normalized without inventing movement or speed', () => {
  assert.deepEqual(normalizeVehicleMotion({ moving: 'true', speed: null, sourceStatus: '', vehicleNumber: ' 74-1286 ', deviceId: ' tablet-101 ' }), {
    moving: null,
    speed: null,
    sourceStatus: 'unavailable',
    vehicleNumber: '74-1286',
    deviceId: 'tablet-101',
  });
  assert.equal(normalizeVehicleMotion({ speed: '12.5' }).speed, 12.5);
  assert.equal(normalizeVehicleMotion(null).moving, null);
});
