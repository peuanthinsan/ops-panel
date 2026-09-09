import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { themeColors, type ThemeColors } from '../lib/theme-colors.ts';
import { createThemePreferenceStore, parseThemePreference, resolveThemeScheme, type ThemePreference } from '../lib/theme-preference.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test('new installs follow the current system theme and manual choices override it', () => {
  assert.equal(resolveThemeScheme('system', 'light'), 'light');
  assert.equal(resolveThemeScheme('system', 'dark'), 'dark');
  assert.equal(resolveThemeScheme('dark', 'light'), 'dark');
  assert.equal(resolveThemeScheme('light', 'dark'), 'light');
  for (const unavailable of [null, undefined, 'unspecified']) {
    assert.equal(resolveThemeScheme('system', unavailable), 'light');
  }
});

test('missing or unrecognized saved preferences recover to the system setting', () => {
  assert.equal(parseThemePreference('dark'), 'dark');
  assert.equal(parseThemePreference('light'), 'light');
  for (const saved of ['system', null, undefined, '', 'DARK', 'automatic', false, {}]) {
    assert.equal(parseThemePreference(saved), 'system');
  }
});

test('hydration restores a valid saved choice without writing the default first', async () => {
  const writes: ThemePreference[] = [];
  const store = createThemePreferenceStore({ read: async () => 'dark', write: async value => { writes.push(value); } });
  assert.equal(store.getPreference(), 'system');
  await store.hydrate();
  assert.equal(store.getPreference(), 'dark');
  assert.deepEqual(writes, []);
});

test('late hydration never overwrites a choice made before or during the read', async () => {
  for (const chooseBeforeRead of [false, true]) {
    const read = deferred<string | null>();
    const store = createThemePreferenceStore({ read: () => read.promise, write: async () => {} });
    if (chooseBeforeRead) await store.setPreference('system');
    const hydration = store.hydrate();
    if (!chooseBeforeRead) await store.setPreference('light');
    read.resolve('dark');
    await hydration;
    assert.equal(store.getPreference(), chooseBeforeRead ? 'system' : 'light');
  }
});

test('rapid choices update immediately and persist in order, including reset to Auto', async () => {
  const firstWrite = deferred<void>();
  const writes: ThemePreference[] = [];
  const updates: ThemePreference[] = [];
  const store = createThemePreferenceStore({
    read: async () => null,
    write: async value => {
      writes.push(value);
      if (writes.length === 1) await firstWrite.promise;
    },
  });
  const unsubscribe = store.subscribe(() => updates.push(store.getPreference()));
  const darkWrite = store.setPreference('dark');
  const lightWrite = store.setPreference('light');
  const autoWrite = store.setPreference('system');
  assert.equal(store.getPreference(), 'system');
  assert.deepEqual(updates, ['dark', 'light', 'system']);
  await Promise.resolve();
  assert.deepEqual(writes, ['dark']);
  firstWrite.resolve();
  await Promise.all([darkWrite, lightWrite, autoWrite]);
  assert.deepEqual(writes, ['dark', 'light', 'system']);
  unsubscribe();
  await store.setPreference('dark');
  assert.deepEqual(updates, ['dark', 'light', 'system']);
});

test('storage failures do not block the theme or later persistence', async () => {
  let stored: ThemePreference = 'system';
  let attempts = 0;
  const store = createThemePreferenceStore({
    read: async () => { throw new Error('storage unavailable'); },
    write: async value => {
      attempts += 1;
      if (attempts === 1) throw new Error('first write failed');
      stored = value;
    },
  });
  await store.hydrate();
  assert.equal(store.getPreference(), 'system');
  await store.setPreference('dark');
  assert.equal(store.getPreference(), 'dark');
  await store.setPreference('light');
  assert.equal(stored, 'light');
});

function contrast(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

test('both palettes keep body, muted, selected, and status text readable', () => {
  const pairs: [keyof ThemeColors, keyof ThemeColors][] = [
    ['text', 'background'], ['text', 'surface'], ['text', 'surfaceMuted'],
    ['textMuted', 'background'], ['textMuted', 'surface'], ['textMuted', 'surfaceMuted'],
    ['textMuted', 'neutralSurface'], ['accent', 'surface'], ['accent', 'accentSurface'],
    ['accentText', 'accentSurface'], ['headerText', 'header'], ['headerMuted', 'header'],
    ['onBrand', 'brand'], ['selectedText', 'selectedSurface'],
    ['successText', 'successSurface'], ['warningText', 'warningSurface'], ['errorText', 'errorSurface'],
  ];
  for (const [scheme, colors] of Object.entries(themeColors)) {
    for (const [text, surface] of pairs) {
      const ratio = contrast(colors[text], colors[surface]);
      assert.ok(ratio >= 4.5, `${scheme} ${text}/${surface} contrast is ${ratio.toFixed(2)}`);
    }
    assert.ok(contrast(colors.inputBorder, colors.surface) >= 3, `${scheme} input border is visible`);
  }
});

test('Android app configuration enables native system appearance support', async () => {
  const config = JSON.parse(await readFile(new URL('../app.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(config.expo.userInterfaceStyle, 'automatic');
  assert.ok(config.expo.plugins.includes('expo-system-ui'));
  assert.ok(pkg.dependencies['expo-system-ui']);
});
