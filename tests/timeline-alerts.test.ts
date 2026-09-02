import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveTimelineAlerts, timelineAlertLabel, timelineAlertPosition } from '../web/lib/timeline-alerts.ts';

test('speeding uses the exact peak GPS timestamp and collapses one speeding episode', () => {
  const reports = [{ id: 'job-1', startTime: '2026-08-25T00:30:00.000Z', topSpeed: 96, deviceGpsSamples: 4 }];
  const alerts = deriveTimelineAlerts(reports, {
    'job-1': [
      { id: 'a', capturedAt: '2026-08-25T00:44:50.000Z', deviceGps: { speedMps: 20 } },
      { id: 'b', capturedAt: '2026-08-25T00:45:00.000Z', deviceGps: { speedMps: 25.56 } },
      { id: 'c', capturedAt: '2026-08-25T00:45:10.000Z', deviceGps: { speedMps: 26.67 } },
      { id: 'd', capturedAt: '2026-08-25T00:45:20.000Z', deviceGps: { speedMps: 10 } },
    ],
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'speeding');
  assert.equal(alerts[0].capturedAt, '2026-08-25T00:45:10.000Z');
  assert.ok(Math.abs((alerts[0].speedKph || 0) - 96.012) < 0.001);
  assert.equal(timelineAlertPosition(alerts[0]), ((7 * 60 + 45 + (10 / 60)) / (24 * 60)) * 100);
  assert.equal(timelineAlertLabel(alerts[0], 'en'), 'Speeding (96 km/h)');
});

test('a sharp speed drop becomes a harsh-braking alert at the later GPS point', () => {
  const alerts = deriveTimelineAlerts([{ id: 'job-2', startTime: '2026-08-25T01:50:00.000Z' }], {
    'job-2': [
      { id: 'fast', capturedAt: '2026-08-25T01:54:50.000Z', deviceGps: { speedMps: 24 } },
      { id: 'brake', capturedAt: '2026-08-25T01:54:55.000Z', deviceGps: { speedMps: 5 } },
    ],
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'harsh-braking');
  assert.equal(alerts[0].capturedAt, '2026-08-25T01:54:55.000Z');
  assert.equal(timelineAlertLabel(alerts[0], 'en'), 'Harsh braking');
});

test('stored alerts keep their event time and legacy flags fall back to the job start', () => {
  const alerts = deriveTimelineAlerts([
    { id: 'exact', startTime: '2026-08-25T00:00:00.000Z', alerts: [{ type: 'harsh braking', time: '08:55:12' }] },
    { id: 'fallback', startTime: '2026-08-25T02:30:00.000Z', harshBraking: true },
  ]);
  assert.deepEqual(alerts.map(alert => [alert.reportId, alert.type, alert.minute]), [
    ['exact', 'harsh-braking', 8 * 60 + 55 + (12 / 60)],
    ['fallback', 'harsh-braking', 9 * 60 + 30],
  ]);
});

test('route deviations use the first confirmed off-route GPS point for the timeline marker', () => {
  const alerts = deriveTimelineAlerts([{
    id: 'route-job',
    startTime: '2026-08-25T00:00:00.000Z',
    routeDeviation: {
      status: 'deviated',
      firstDeviation: {
        startedAt: '2026-08-25T01:23:45.000Z', latitude: 13.7663, longitude: 100.502, startDistanceKm: 1.234, durationSeconds: 180,
      },
    },
  }]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'route-deviation');
  assert.equal(alerts[0].capturedAt, '2026-08-25T01:23:45.000Z');
  assert.equal(alerts[0].minute, 8 * 60 + 23 + (45 / 60));
  assert.equal(timelineAlertLabel(alerts[0], 'en'), 'Route deviation (1.23 km) · 13.76630, 100.50200');
});
