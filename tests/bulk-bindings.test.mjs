import assert from 'node:assert/strict';
import test from 'node:test';
import { maximumBulkBindings, normalizeBulkBindings } from '../web/lib/bulk-bindings.mjs';

test('bulk fleet import trims rows and deduplicates identical device mappings', () => {
  assert.deepEqual(normalizeBulkBindings([
    { vehicleNumber: ' 70-1234 ', deviceId: ' device-1 ' },
    { vehicleNumber: '70-1234', deviceId: 'device-1' },
  ]), [{ vehicleNumber: '70-1234', deviceId: 'device-1' }]);
});

test('bulk fleet import keeps multiple device IDs for the same vehicle', () => {
  assert.deepEqual(normalizeBulkBindings([
    { vehicleNumber: 'FORD T', deviceId: 'tablet-1' },
    { vehicleNumber: 'FORD T', deviceId: 'tablet-2' },
  ]), [
    { vehicleNumber: 'FORD T', deviceId: 'tablet-1' },
    { vehicleNumber: 'FORD T', deviceId: 'tablet-2' },
  ]);
});

test('bulk fleet import rejects ambiguous and oversized batches', () => {
  assert.throws(() => normalizeBulkBindings([
    { vehicleNumber: '70-1234', deviceId: 'device-1' },
    { vehicleNumber: '70-5678', deviceId: 'device-1' },
  ]), /more than one vehicle/);
  assert.throws(() => normalizeBulkBindings(Array.from({ length: maximumBulkBindings + 1 }, (_, index) => ({
    vehicleNumber: `V-${index}`,
    deviceId: `D-${index}`,
  }))), /cannot exceed/);
});
