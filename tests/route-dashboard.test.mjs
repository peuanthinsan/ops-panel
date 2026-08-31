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

test('route management computes and saves Google road geometry', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../web/app/routes-dashboard.jsx', import.meta.url)), 'utf8');
  assert.match(source, /normalizeRoutePath\(\(await computeGoogleDrivingRoute\(parsedAnchors, lang\)\)\.path, 700\)/);
  assert.match(source, /JSON\.stringify\(\{ \.\.\.form, routePath \}\)/);
});

test('route maps prefer the current Routes API and retain a directions fallback for the existing key', async () => {
  const loader = await readFile(fileURLToPath(new NodeUrl('../web/lib/google-maps-loader.js', import.meta.url)), 'utf8');
  const map = await readFile(fileURLToPath(new NodeUrl('../web/app/route-map.jsx', import.meta.url)), 'utf8');
  assert.match(loader, /Route\.computeRoutes/);
  assert.match(loader, /new google\.maps\.DirectionsService\(\)/);
  assert.match(map, /new google\.maps\.Data\(\{ map \}\)/);
  assert.doesNotMatch(map, /new google\.maps\.Marker/);
});

test('Google Maps follows the selected dashboard language', async () => {
  const loader = await readFile(fileURLToPath(new NodeUrl('../web/lib/google-maps-loader.js', import.meta.url)), 'utf8');
  const map = await readFile(fileURLToPath(new NodeUrl('../web/app/route-map.jsx', import.meta.url)), 'utf8');
  const page = await readFile(fileURLToPath(new NodeUrl('../web/app/page.jsx', import.meta.url)), 'utf8');
  assert.match(loader, /setOptions\(\{ key, v: 'weekly', language: requestedLanguage, region: 'TH' \}\)/);
  assert.match(loader, /language,\n\s+region: 'TH'/);
  assert.match(map, /loadGoogleMaps\(lang\)/);
  assert.match(map, /computeGoogleDrivingRoute\(routePoints, lang\)/);
  assert.match(page, /localStorage\.setItem\('songdee-language', next\)/);
  assert.match(page, /window\.location\.reload\(\)/);
});

test('the dashboard route assignment selector searches a bounded server result', async () => {
  const selector = await readFile(fileURLToPath(new NodeUrl('../web/app/route-selector.jsx', import.meta.url)), 'utf8');
  const drawer = await readFile(fileURLToPath(new NodeUrl('../web/app/job-gps-drawer.jsx', import.meta.url)), 'utf8');
  assert.match(selector, /\/api\/admin\/job-route-options\?\$\{params\}/);
  assert.match(selector, /limit: '50'/);
  assert.match(selector, /role="combobox"/);
  assert.match(selector, /role="listbox"/);
  assert.match(drawer, /<RouteSelector/);
  assert.doesNotMatch(drawer, /<select id="gps-route-assignment"/);
});
