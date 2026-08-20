import assert from 'node:assert/strict';
import test from 'node:test';
import { observeServerTime, resetServerClockForTests, serverNowMs } from '../lib/server-clock.ts';

test('server clock corrects tablet wall-clock skew using the request midpoint', () => {
  resetServerClockForTests();
  assert.equal(observeServerTime('1787204745000', 1787201200000, 1787201200200), true);
  assert.equal(serverNowMs(1787201200300), 1787204745200);
  resetServerClockForTests();
});

test('invalid server time does not alter the clock', () => {
  resetServerClockForTests();
  assert.equal(observeServerTime('invalid', 1000, 1100), false);
  assert.equal(serverNowMs(1200), 1200);
});
