import assert from 'node:assert/strict';
import test from 'node:test';
import { driverLookupBelongsToBinding, normalizeDriverIdentityLookup } from '../lib/driver-identity.ts';

const binding = { vehicleNumber: '74-1286', deviceId: 'android-101' };

test('driver identity lookup is normalized with its vehicle and device correlation', () => {
  assert.deepEqual(normalizeDriverIdentityLookup({
    driverIdentity: { driverName: ' Driver One ', driverId: ' DRV-001 ' },
    vehicleNumber: ' 74-1286 ',
    deviceId: ' android-101 ',
  }), {
    driverIdentity: { driverName: 'Driver One', driverId: 'DRV-001' },
    vehicleNumber: '74-1286',
    deviceId: 'android-101',
  });
});

test('a driver lookup can update only the binding that requested it', () => {
  const current = normalizeDriverIdentityLookup({
    driverIdentity: { driverName: 'Driver One', driverId: 'DRV-001' },
    vehicleNumber: binding.vehicleNumber,
    deviceId: binding.deviceId,
  });
  assert.equal(driverLookupBelongsToBinding(binding, current), true);
  assert.equal(driverLookupBelongsToBinding({ ...binding, vehicleNumber: '74-9999' }, current), false);
  assert.equal(driverLookupBelongsToBinding({ ...binding, deviceId: 'android-202' }, current), false);
});

test('missing or malformed correlation never attaches a driver to a job', () => {
  const malformed = normalizeDriverIdentityLookup({ driverIdentity: { driverName: 'Driver One' } });
  assert.equal(driverLookupBelongsToBinding(binding, malformed), false);
  assert.deepEqual(normalizeDriverIdentityLookup(null), {
    driverIdentity: null,
    vehicleNumber: null,
    deviceId: null,
  });
});
