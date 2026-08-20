import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const exactPinPath = 'M90 4C42.5 4 4 42.5 4 90c0 61.8 86 126 86 126s86-64.2 86-126C176 42.5 137.5 4 90 4Z';
const logoFiles = [
  'web/public/songdee-ops-panel-logo.svg',
];
const pinFiles = [
  'assets/songdee-gps-pin.svg',
  'components/RedGpsPin.tsx',
  'web/public/songdee-gps-pin.svg',
  ...logoFiles,
];

test('every mobile and web pin uses the exact SVIS logo artwork', async () => {
  for (const filename of pinFiles) {
    const source = await readFile(path.resolve(filename), 'utf8');
    assert.match(source, new RegExp(exactPinPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(source, /x="52" y="46" width="76" height="30"/);
    assert.match(source, /M52 52 128 97v25L52 77Z/);
  }
});

test('web wordmarks use the exact SVIS pin and no slash', async () => {
  for (const filename of logoFiles) {
    const logo = await readFile(path.resolve(filename), 'utf8');
    assert.match(logo, new RegExp(exactPinPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(logo, />SONGDEE</);
    assert.match(logo, />OPS PANEL</);
    assert.doesNotMatch(logo, />\s*\/\s*</);
  }
});

test('dashboard login renders the complete Ops Panel logo asset', async () => {
  const source = await readFile(path.resolve('web/app/page.jsx'), 'utf8');
  assert.match(source, /src="\/songdee-ops-panel-logo\.svg"/);
  assert.doesNotMatch(source, /className="login-wordmark"/);
});

test('Android launcher and splash assets use the configured pin artwork', async () => {
  const appConfig = JSON.parse(await readFile(path.resolve('app.json'), 'utf8')).expo;
  const splashPlugin = appConfig.plugins.find((plugin: unknown) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen');
  assert.equal(appConfig.icon, './assets/icon.png');
  assert.equal(appConfig.android.adaptiveIcon.foregroundImage, './assets/adaptive-icon.png');
  assert.equal(appConfig.android.adaptiveIcon.backgroundColor, '#111111');
  assert.ok(splashPlugin);
  assert.equal(splashPlugin[1].image, './assets/splash-icon.png');
  assert.equal(splashPlugin[1].backgroundColor, '#111111');
});
