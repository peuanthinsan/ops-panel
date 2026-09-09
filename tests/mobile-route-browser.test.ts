import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyMobileRouteBrowser, mobileRouteBrowserReducer } from '../lib/mobile-route-browser.ts';

const routes = (offset: number, count = 50) => Array.from({ length: count }, (_, index) => ({ id: String(offset + index), routeName: `Route ${offset + index + 1}` }));

test('browsing thousands of routes keeps only the requested page and reaches the final route', () => {
  let state = emptyMobileRouteBrowser;
  for (let offset = 0; offset < 2037; offset += 50) {
    const requestId = offset + 1;
    state = mobileRouteBrowserReducer(state, { type: 'request', search: '', offset, requestId });
    assert.equal(state.routes.length, 0);
    state = mobileRouteBrowserReducer(state, { type: 'loaded', routes: routes(offset, Math.min(50, 2037 - offset)), hasMore: offset + 50 < 2037, requestId });
    assert.ok(state.routes.length <= 50);
    assert.equal(state.routes[0].routeName, `Route ${offset + 1}`);
  }
  assert.equal(state.offset, 2000);
  assert.equal(state.routes.at(-1)?.routeName, 'Route 2037');
  assert.equal(state.hasMore, false);
});

test('a changed search removes old choices immediately and ignores stale success or failure', () => {
  let state = mobileRouteBrowserReducer(emptyMobileRouteBrowser, { type: 'request', search: '', offset: 1500, requestId: 1 });
  state = mobileRouteBrowserReducer(state, { type: 'loaded', routes: routes(1500), hasMore: true, requestId: 1 });
  state = mobileRouteBrowserReducer(state, { type: 'request', search: 'เชียงใหม่', offset: 0, requestId: 2 });
  assert.deepEqual(state.routes, []);
  assert.equal(state.offset, 0);
  assert.equal(state.status, 'loading');
  assert.equal(mobileRouteBrowserReducer(state, { type: 'loaded', routes: routes(1550), hasMore: true, requestId: 1 }), state);
  assert.equal(mobileRouteBrowserReducer(state, { type: 'failed', requestId: 1 }), state);
});

test('failed pages retain the requested search and offset for retry, without stale selectable rows', () => {
  let state = mobileRouteBrowserReducer(emptyMobileRouteBrowser, { type: 'request', search: 'North', offset: 50, requestId: 1 });
  state = mobileRouteBrowserReducer(state, { type: 'failed', requestId: 1 });
  assert.equal(state.status, 'error');
  assert.equal(state.search, 'North');
  assert.equal(state.offset, 50);
  assert.deepEqual(state.routes, []);
  state = mobileRouteBrowserReducer(state, { type: 'request', search: state.search, offset: state.offset, requestId: 2 });
  state = mobileRouteBrowserReducer(state, { type: 'loaded', routes: routes(50, 3), hasMore: false, requestId: 2 });
  assert.equal(state.status, 'ready');
  assert.equal(state.routes[0].routeName, 'Route 51');
});

test('a binding reset discards late results from the previous vehicle', () => {
  const state = mobileRouteBrowserReducer(emptyMobileRouteBrowser, { type: 'reset', requestId: 3 });
  assert.equal(mobileRouteBrowserReducer(state, { type: 'loaded', routes: routes(0), hasMore: true, requestId: 2 }), state);
  assert.equal(state.status, 'idle');
  assert.deepEqual(state.routes, []);
});
