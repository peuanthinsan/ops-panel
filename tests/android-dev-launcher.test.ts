import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePort, parseConnectedEmulators } from '../scripts/android-emulator.mjs';

test('Android launcher selects only connected emulator devices', () => {
  const output = `List of devices attached
emulator-5554 device product:sdk_gphone64_arm64 model:Pixel_Tablet transport_id:1
emulator-5556 offline transport_id:2
R58M123ABCD device product:tablet model:Physical_Tablet transport_id:3
`;
  assert.deepEqual(parseConnectedEmulators(output), ['emulator-5554']);
});

test('Android launcher validates configured Metro and API ports', () => {
  assert.equal(normalizePort(undefined, 8081, 'Metro'), 8081);
  assert.equal(normalizePort(' 4002 ', 4000, 'API'), 4002);
  assert.equal(normalizePort('65535', 4000, 'API'), 65535);
  assert.throws(() => normalizePort('0', 8081, 'Metro'), /between 1 and 65535/);
  assert.throws(() => normalizePort('8081.5', 8081, 'Metro'), /between 1 and 65535/);
  assert.throws(() => normalizePort('nope', 8081, 'Metro'), /between 1 and 65535/);
});
