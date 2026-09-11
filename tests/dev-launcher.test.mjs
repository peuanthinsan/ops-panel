import assert from 'node:assert/strict';
import test from 'node:test';
import { getDevConfiguration } from '../scripts/dev.mjs';

test('local dashboard defaults to the same-origin Neon API without a separate API address', () => {
  const config = getDevConfiguration([], { PORT: '4001' });
  assert.equal(config.mode, 'neon');
  assert.equal(config.apiBaseUrl, null);
  assert.equal(config.dashboardPort, '5173');
});

test('an empty API override keeps Neon and the explicit dashboard port', () => {
  const config = getDevConfiguration([], { NEXT_PUBLIC_API_BASE_URL: '  ', SONGDEE_DASHBOARD_PORT: '5174' });
  assert.equal(config.mode, 'neon');
  assert.equal(config.apiBaseUrl, null);
  assert.equal(config.dashboardPort, '5174');
});

test('the JSON API requires an explicit flag and respects its configured port', () => {
  assert.equal(getDevConfiguration(['--json']).apiBaseUrl, 'http://localhost:4000');
  const config = getDevConfiguration(['--json'], { PORT: '4001' });
  assert.equal(config.mode, 'json');
  assert.equal(config.apiBaseUrl, 'http://localhost:4001');
});

test('an explicit external API takes precedence over the local modes', () => {
  for (const args of [[], ['--json']]) {
    const config = getDevConfiguration(args, { NEXT_PUBLIC_API_BASE_URL: ' https://ops.example.com ' });
    assert.equal(config.mode, 'external');
    assert.equal(config.apiBaseUrl, 'https://ops.example.com');
  }
});
