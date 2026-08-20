import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiBase } from '../lib/api-base.ts';

test('an explicit API URL wins and trailing slashes are removed', () => {
  assert.equal(resolveApiBase(' https://ops-api.songdee.example/ ', '192.168.1.50:8081'), 'https://ops-api.songdee.example');
  assert.equal(resolveApiBase('https://ops-api.songdee.example/base///'), 'https://ops-api.songdee.example/base');
});

test('an explicit production API URL is accepted', () => {
  assert.equal(resolveApiBase('https://ops.songdee.example', undefined, false), 'https://ops.songdee.example');
  assert.throws(
    () => resolveApiBase('http://ops.songdee.example', undefined, false),
    /must use https:\/\//,
  );
});

test('malformed or unsafe configured API URLs are rejected', () => {
  for (const value of [
    'ops.songdee.example',
    '/relative-api',
    'ftp://ops.songdee.example',
    'https://user:password@ops.songdee.example',
    'https://ops.songdee.example?tenant=fleet',
    'https://ops.songdee.example#api',
  ]) {
    assert.throws(() => resolveApiBase(value), /EXPO_PUBLIC_API_URL/);
  }
});

test('a production build cannot fall back to the Android emulator gateway', () => {
  assert.throws(
    () => resolveApiBase(undefined, '192.168.1.191:8081', false),
    /EXPO_PUBLIC_API_URL is required for production Android builds/,
  );
});

test('a physical Expo tablet uses the development machine LAN host', () => {
  assert.equal(resolveApiBase(undefined, '192.168.1.191:8081'), 'http://192.168.1.191:4000');
});

test('an Expo URI with a protocol is parsed correctly', () => {
  assert.equal(resolveApiBase(undefined, 'exp://192.168.1.25:8081'), 'http://192.168.1.25:4000');
});

test('localhost maps to the Android emulator host gateway', () => {
  assert.equal(resolveApiBase(undefined, 'localhost:8081'), 'http://10.0.2.2:4000');
  assert.equal(resolveApiBase(undefined, '127.0.0.1:8081'), 'http://10.0.2.2:4000');
  assert.equal(resolveApiBase(undefined, 'exp://[::1]:8081'), 'http://10.0.2.2:4000');
});

test('IPv6 development hosts are bracketed exactly once', () => {
  assert.equal(resolveApiBase(undefined, 'exp://[2001:db8::1]:8081'), 'http://[2001:db8::1]:4000');
});

test('a missing or invalid Expo host retains the emulator fallback', () => {
  assert.equal(resolveApiBase(), 'http://10.0.2.2:4000');
  assert.equal(resolveApiBase(undefined, 'not a valid host'), 'http://10.0.2.2:4000');
});
