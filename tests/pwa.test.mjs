import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../web/', import.meta.url));

test('dashboard exposes an installable manifest and service worker shell', async () => {
  const manifest = await readFile(`${root}app/manifest.js`, 'utf8');
  const worker = await readFile(`${root}public/sw.js`, 'utf8');
  assert.match(manifest, /display: 'standalone'/);
  assert.match(manifest, /start_url: '\/'/);
  assert.match(manifest, /songdee-gps-pin-icon\.svg/);
  assert.match(worker, /self\.addEventListener\('fetch'/);
  assert.match(worker, /request\.mode === 'navigate'/);
  assert.match(worker, /songdee-ops-shell-v2/);
  const register = await readFile(`${root}app/pwa-register.jsx`, 'utf8');
  assert.match(register, /process\.env\.NODE_ENV !== 'production'/);
  assert.match(register, /registration\.unregister\(\)/);
});

test('dashboard GET requests fall back to an offline response cache', async () => {
  const api = await readFile(`${root}app/dashboard-api.js`, 'utf8');
  const session = await readFile(`${root}app/dashboard-session.js`, 'utf8');
  assert.match(api, /readOfflineResponse/);
  assert.match(api, /writeOfflineResponse/);
  assert.match(api, /navigator\.onLine === false/);
  assert.match(api, /Changes cannot be saved until the connection returns/);
  assert.match(session, /localStorage/);
});

test('offline dashboard reads use the cached response and reject writes', async () => {
  const values = new Map();
  const storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] || null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  const previous = {
    localStorage: globalThis.localStorage,
    navigator: globalThis.navigator,
    window: globalThis.window,
    CustomEvent: globalThis.CustomEvent,
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent() {}, setTimeout, clearTimeout } });
  globalThis.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

  try {
    const path = '/api/reports?page=1&pageSize=100';
    const store = await import(`../web/app/offline-store.js?offline-test=${Date.now()}`);
    const expected = { reports: [{ id: 'cached-report' }], pageInfo: { total: 1 } };
    await store.writeOfflineResponse(path, expected);
    const api = await import(`../web/app/dashboard-api.js?offline-test=${Date.now()}`);
    assert.deepEqual(await api.adminFetch(path), expected);
    await assert.rejects(() => api.adminFetch(path, { method: 'POST' }), /Changes cannot be saved until the connection returns/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  }
});
