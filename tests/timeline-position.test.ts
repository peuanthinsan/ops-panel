import assert from 'node:assert/strict';
import test from 'node:test';
import { TIMELINE_AXIS_LABELS, timelinePosition } from '../web/lib/timeline-position.ts';

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
