import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import createExpoConfig from '../app.config.js';

async function readJson(filename: string) {
  return JSON.parse(await readFile(path.resolve(filename), 'utf8'));
}

test('Ops Panel has a separate Android application identity', async () => {
  const { expo } = await readJson('app.json');
  assert.equal(expo.owner, 'peuanthinsan');
  assert.equal(expo.slug, 'songdee-ops-panel');
  assert.equal(expo.scheme, 'songdeeops');
  assert.equal(expo.android.package, 'com.songdeedev.opspanel');
  assert.equal(expo.android.versionCode, undefined, 'EAS remote versioning owns the Android build number.');
  assert.equal(expo.orientation, 'default');
  assert.deepEqual(expo.platforms, ['android']);
  assert.equal(expo.plugins.includes('expo-location'), false, 'The tablet is not a GPS source.');
  assert.equal(
    expo.extra?.eas?.projectId,
    '0825171f-7773-4a62-a7f7-899e6f4d75cf',
    'The Android app must stay linked to the dedicated Songdee Ops Panel EAS project.',
  );
});

test('EAS profiles produce an installable preview APK and a production AAB', async () => {
  const eas = await readJson('eas.json');
  assert.equal(eas.cli.appVersionSource, 'remote');
  assert.equal(eas.build.preview.android.buildType, 'apk');
  assert.equal(eas.build.preview.distribution, 'internal');
  assert.equal(eas.build.preview.environment, 'preview');
  assert.equal(eas.build.preview.autoIncrement, true);
  assert.equal(eas.build.production.android.buildType, 'app-bundle');
  assert.equal(eas.build.production.environment, 'production');
  assert.equal(eas.build.production.autoIncrement, true);
  assert.doesNotMatch(JSON.stringify(eas), /songdee-svis|com\.songdeedev\.svis/i);
});

test('EAS release configuration requires a safe public API origin', () => {
  const previousBuild = process.env.EAS_BUILD;
  const previousApi = process.env.EXPO_PUBLIC_API_URL;
  const config = { name: 'Songdee Ops Panel' };

  try {
    process.env.EAS_BUILD = 'true';
    delete process.env.EXPO_PUBLIC_API_URL;
    assert.throws(() => createExpoConfig({ config }), /EXPO_PUBLIC_API_URL is required/);

    process.env.EXPO_PUBLIC_API_URL = 'relative-api';
    assert.throws(() => createExpoConfig({ config }), /absolute http:\/\/ or https:\/\/ URL/);

    process.env.EXPO_PUBLIC_API_URL = 'http://ops.songdee.example';
    assert.throws(() => createExpoConfig({ config }), /must use https:\/\//);

    process.env.EXPO_PUBLIC_API_URL = 'https://ops.songdee.example';
    assert.equal(createExpoConfig({ config }), config);
  } finally {
    if (previousBuild === undefined) delete process.env.EAS_BUILD;
    else process.env.EAS_BUILD = previousBuild;
    if (previousApi === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = previousApi;
  }
});

test('the Android API client passes the runtime development flag', async () => {
  const source = await readFile(path.resolve('lib/api.ts'), 'utf8');
  assert.match(source, /resolveApiBase\([^;]+,\s*__DEV__\)/);
});

test('EAS archives exclude dashboard, QA, and previously downloaded release artifacts', async () => {
  const ignore = await readFile(path.resolve('.easignore'), 'utf8');
  assert.match(ignore, /^web\/$/m);
  assert.match(ignore, /^design-qa-artifacts\/$/m);
  assert.match(ignore, /^releases\/$/m);
  assert.match(ignore, /^\*\.apk$/m);
  assert.doesNotMatch(ignore, /^(app|assets|components|lib)\/$/m);
});
