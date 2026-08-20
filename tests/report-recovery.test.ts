import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL as NodeUrl } from 'node:url';
import test from 'node:test';
import { finalReportForIntent, reportIntent } from '../lib/report-recovery.ts';
import type { JobReportInput } from '../lib/report.ts';

const completed: JobReportInput = {
  id: 'OPS-recovery-001',
  vehicleNumber: '74-1286',
  deviceId: 'android-101',
  driverName: 'Driver One',
  driverId: 'DRV-001',
  mode: 'Load',
  startTime: '2026-08-18T01:00:00.000Z',
  endTime: '2026-08-18T01:10:00.000Z',
  duration: '10:00',
};

test('an ambiguous retry reuses the first final report without rebuilding its end time', () => {
  let rebuilds = 0;
  const recovered = finalReportForIntent(completed, 'completed', () => {
    rebuilds += 1;
    return { ...completed, endTime: '2026-08-18T01:20:00.000Z' };
  });
  assert.equal(recovered, completed);
  assert.equal(rebuilds, 0);
});

test('completed and cancelled retry intents cannot overwrite each other', () => {
  const cancelled = { ...completed, status: 'Cancelled' as const };
  assert.equal(reportIntent(completed), 'completed');
  assert.equal(reportIntent(cancelled), 'cancelled');
  assert.equal(finalReportForIntent(cancelled, 'completed', () => completed), null);
  assert.equal(finalReportForIntent(completed, 'cancelled', () => cancelled), null);
});

test('the first finalization creates exactly one payload', () => {
  let creations = 0;
  const created = finalReportForIntent(null, 'cancelled', () => {
    creations += 1;
    return { ...completed, status: 'Cancelled' };
  });
  assert.equal(creations, 1);
  assert.equal(created?.status, 'Cancelled');
});

test('the Android flow persists final payloads before delivery and blocks a motion overwrite', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../app/index.tsx', import.meta.url)), 'utf8');
  assert.match(source, /persistPendingFinalReport\(report\)[\s\S]*saveOrQueueJob\(report\)/);
  assert.match(source, /pendingReportRef\.current = report[\s\S]*persistActiveJob\([\s\S]*pendingReport: report/);
  assert.match(source, /if \(starting \|\| !active \|\| pendingReportRef\.current \|\| !selected\) return;[\s\S]*motionStartsJob\(binding, motion\)/);
  assert.match(source, /if \(localStateFinalized\) \{[\s\S]*updatePendingReport\(null\)/);
});
