import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL as NodeUrl } from 'node:url';
import test from 'node:test';

test('web date picker supports Escape, outside click, focus trapping, and focus restoration', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../web/app/report-dashboard.jsx', import.meta.url)), 'utf8');
  assert.match(source, /className="picker-scrim"/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.key !== 'Tab'/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /previousFocusRef\.current/);
  assert.match(source, /target\?\.focus\(\)/);
});

test('mobile modals support outside-tap and accessibility escape dismissal', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../app/index.tsx', import.meta.url)), 'utf8');
  assert.match(source, /<Pressable accessible=\{false\} onPress=\{dismissConfirmation\}/);
  assert.match(source, /onAccessibilityEscape=\{dismissConfirmation\}/);
  assert.match(source, /<Pressable accessible=\{false\} onPress=\{dismissVehicleAdmin\} style=\{vehicleAdminStyles\.backdrop\}/);
  assert.match(source, /onAccessibilityEscape=\{dismissVehicleAdmin\}/);
});
