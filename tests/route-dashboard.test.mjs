import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL as NodeUrl } from 'node:url';
import test from 'node:test';

test('route deviation thresholds accept ordinary hundredth-kilometre values and reset stale feedback', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../web/app/routes-dashboard.jsx', import.meta.url)), 'utf8');
  assert.match(source, /min="0\.01" max="50" step="0\.01"/);
  assert.doesNotMatch(source, /min="0\.01" max="50" step="0\.1"/);
  assert.match(source, /async function saveSettings\(event\) \{[^}]*setError\(''\); setMessage\(''\);/);
});
