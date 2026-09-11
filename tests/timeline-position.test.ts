import assert from 'node:assert/strict';
import test from 'node:test';
import { assignTimelineLanes, formatTimelineTime, TIMELINE_AXIS_LABELS, timelinePosition, timelineRangePosition } from '../web/lib/timeline-position.ts';

function closeTo(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} should be close to ${expected}`);
}

test('the operations timeline covers the complete Bangkok day', () => {
  assert.deepEqual(TIMELINE_AXIS_LABELS, ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00', '24:00']);
  const position = timelinePosition('2026-08-17T19:00:00.000Z', '2026-08-17T20:00:00.000Z');
  assert.ok(position);
  closeTo(position.left, 8.3333333333);
  closeTo(position.width, 4.1666666667);
});

test('an overnight job remains visible through the end of its start day', () => {
  const position = timelinePosition('2026-08-18T16:30:00.000Z', '2026-08-18T18:00:00.000Z');
  assert.ok(position);
  closeTo(position.left, 97.9166666667);
  closeTo(position.width, 2.0833333333);
});

test('same-minute events retain second-level separation', () => {
  const vehicleCheck = timelinePosition('2026-08-26T03:53:09.000Z', '2026-08-26T03:53:15.000Z');
  const refuel = timelinePosition('2026-08-26T03:53:44.000Z', '2026-08-26T03:53:56.000Z');
  assert.ok(vehicleCheck);
  assert.ok(refuel);
  assert.ok(refuel.left > vehicleCheck.left);
});

test('short events use their real duration instead of a five-minute block', () => {
  const position = timelinePosition('2026-08-26T03:53:09.000Z', '2026-08-26T03:53:15.000Z');
  assert.ok(position);
  assert.ok(position.width < 0.01, `expected a sub-minute width, got ${position.width}%`);
});

test('work-period geometry preserves a six-second vehicle check and the following refuel', () => {
  const origin = Date.parse('2026-08-31T03:11:00Z');
  const end = Date.parse('2026-08-31T03:15:00Z');
  const check = timelineRangePosition('2026-08-31T03:14:09Z', '2026-08-31T03:14:15Z', origin, end);
  const refuel = timelineRangePosition('2026-08-31T03:14:30Z', '2026-08-31T03:14:49Z', origin, end);
  assert.ok(check);
  assert.ok(refuel);
  closeTo(check.width, (6 / 240) * 100);
  assert.ok(check.left + check.width < refuel.left);
  assert.equal(assignTimelineLanes([refuel, check]).laneCount, 1);
});

test('overlapping jobs and nearby small markers receive distinct visible lanes', () => {
  const layout = assignTimelineLanes([
    { id: 'later', left: 30, width: 10 },
    { id: 'long', left: 10, width: 30 },
    { id: 'tiny', left: 50, width: 0.01 },
    { id: 'next-tiny', left: 51, width: 0.01 },
  ], 2);
  const lanes = Object.fromEntries(layout.segments.map(segment => [segment.id, segment.lane]));
  assert.notEqual(lanes.long, lanes.later);
  assert.notEqual(lanes.tiny, lanes['next-tiny']);
  assert.equal(layout.laneCount, 2);
  assert.equal(layout.segments.find(segment => segment.id === 'tiny')?.width, 0.01);
});

test('zero-duration events at the timeline boundary remain renderable', () => {
  const end = Date.parse('2026-08-31T03:14:15Z');
  assert.deepEqual(timelineRangePosition('2026-08-31T03:14:15Z', '2026-08-31T03:14:15Z', end - 6000, end), { left: 100, width: 0 });
  const layout = assignTimelineLanes([{ left: 97, width: 2 }, { left: 100, width: 0 }], 2);
  assert.equal(layout.laneCount, 2);
});

test('timeline labels distinguish the start and end within the same minute', () => {
  for (const lang of ['en', 'th']) {
    assert.equal(formatTimelineTime('2026-08-31T03:14:09Z', lang), '10:14:09');
    assert.equal(formatTimelineTime('2026-08-31T03:14:15Z', lang), '10:14:15');
  }
  assert.equal(formatTimelineTime('invalid'), '—');
});
