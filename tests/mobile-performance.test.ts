import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL as NodeUrl } from 'node:url';
import test from 'node:test';

test('mobile startup renders a valid cached binding before remote reconciliation finishes', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../app/index.tsx', import.meta.url)), 'utf8');
  assert.match(source, /if \(local\) setBindingChecked\(true\)/);
  assert.match(source, /requestIdleCallback/);
  assert.doesNotMatch(source, /InteractionManager/);
  assert.doesNotMatch(source, /expo-location|locationPermissionPromiseRef|getForegroundPermissionsAsync/);
  assert.match(source, /requestJobGpsSync/);
});

test('signed device requests reuse the secure credential cache', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../lib/api.ts', import.meta.url)), 'utf8');
  assert.match(source, /let deviceCredentialPromise: Promise<DeviceCredential \| null> \| null = null/);
  assert.match(source, /function cachedDeviceCredential\(\)/);
  assert.match(source, /const credential = await cachedDeviceCredential\(\)/);
  assert.match(source, /deviceCredentialPromise = Promise\.resolve\(credential\)/);
});
