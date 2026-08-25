import assert from 'node:assert/strict';
import test from 'node:test';
import { printReportLocation } from '../web/lib/report-print-view.ts';

test('daily print uses GPS coordinates when no place name is available', () => {
  assert.deepEqual(printReportLocation({
    lastDeviceLatitude: 13.78,
    lastDeviceLongitude: 100.53,
  }, 'en'), {
    name: '13.78000, 100.53000',
    coordinates: '',
  });
});

test('daily print keeps a place name and its GPS coordinates when both exist', () => {
  assert.deepEqual(printReportLocation({
    locationName: 'Vehicle Luangphaeng I',
    lastDeviceLatitude: 13.78,
    lastDeviceLongitude: 100.53,
  }, 'en'), {
    name: 'Vehicle Luangphaeng I',
    coordinates: '13.78000, 100.53000',
  });
});

test('daily print can fall back to FMS coordinates', () => {
  assert.equal(printReportLocation({
    lastFmsLatitude: 14.23,
    lastFmsLongitude: 100.73,
  }, 'en').name, '14.23000, 100.73000');
});
