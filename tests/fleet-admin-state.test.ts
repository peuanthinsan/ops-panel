import assert from 'node:assert/strict';
import test from 'node:test';
import { fleetSnapshotAfterRequest, normalizeFleetBindings } from '../lib/fleet-admin-state.ts';

test('fleet API snapshots are trimmed, validated, and deduplicated by device', () => {
  assert.deepEqual(normalizeFleetBindings([
    { vehicleNumber: ' 74-1286 ', deviceId: ' tablet-101 ', deviceKeyId: 'key-1', deviceAccessEnforced: true, lastActivityAt: '2026-08-19T01:00:00.000Z' },
    { vehicleNumber: '74-9999', deviceId: 'tablet-101' },
    { vehicleNumber: '', deviceId: 'tablet-202' },
    null,
  ]), [{ vehicleNumber: '74-1286', deviceId: 'tablet-101', deviceKeyId: 'key-1', deviceAccessEnforced: true, lastActivityAt: '2026-08-19T01:00:00.000Z' }]);
  assert.deepEqual(normalizeFleetBindings({ deviceBindings: [] }), []);
});

test('a refresh response that started before a mutation cannot overwrite the new fleet state', () => {
  const current = [{ vehicleNumber: '74-2000', deviceId: 'tablet-101' }];
  const stale = [{ vehicleNumber: '74-1000', deviceId: 'tablet-101' }];
  assert.equal(fleetSnapshotAfterRequest(current, stale, 3, 4), current);
  assert.deepEqual(fleetSnapshotAfterRequest(current, stale, 4, 4), stale);
});
