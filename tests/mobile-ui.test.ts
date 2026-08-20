import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL as NodeUrl } from 'node:url';
import test from 'node:test';
import { driverHeaderText } from '../lib/driver-display.ts';
import { mobileCopy } from '../lib/mobile-copy.ts';
import { mobileOperationErrorMessage } from '../lib/mobile-error-copy.ts';
import { usesCompactLandscapeLayout } from '../lib/mobile-layout.ts';

test('technician setup copy switches fully between English and Thai', () => {
  assert.deepEqual(mobileCopy.en, {
    setupEyebrow: 'ONE-TIME SETUP',
    setup: 'Enter vehicle number',
    setupBody: 'Connect this tablet once. Later vehicle changes must be made in Fleet admin.',
    vehicle: 'Vehicle number',
    save: 'Save vehicle',
  });
  assert.deepEqual(mobileCopy.th, {
    setupEyebrow: 'ตั้งค่าครั้งแรก',
    setup: 'กรอกหมายเลขรถ',
    setupBody: 'เชื่อมต่อแท็บเล็ตเครื่องนี้เพียงครั้งเดียว หากต้องการเปลี่ยนรถภายหลังให้ทำในหน้าจัดการฝูงรถ',
    vehicle: 'หมายเลขรถ',
    save: 'บันทึกหมายเลขรถ',
  });
});

test('Thai job failures never expose raw English API errors', () => {
  assert.equal(
    mobileOperationErrorMessage(new Error('Songdee GPS server is unreachable'), 'th', 'finish'),
    'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ Songdee GPS ได้ กรุณาตรวจสอบเครือข่ายและที่อยู่ API',
  );
  assert.equal(
    mobileOperationErrorMessage(new Error('Vehicle and device were not connected when this job started.'), 'th', 'cancel'),
    'การเชื่อมต่อรถกับอุปกรณ์ไม่ตรงกัน กรุณาติดต่อผู้ดูแลระบบ',
  );
  assert.equal(
    mobileOperationErrorMessage(new Error('Unexpected upstream rejection'), 'th', 'finish'),
    'ไม่สามารถบันทึกงานได้',
  );
  assert.equal(
    mobileOperationErrorMessage(new Error('Report id is already used by a different job.'), 'en', 'finish'),
    'Report id is already used by a different job.',
  );
});

test('driver header distinguishes identified drivers from the waiting state', () => {
  assert.equal(
    driverHeaderText({ driverName: 'Somchai Test', driverId: 'DRV-01' }, 'android-01', 'en'),
    'Driver: Somchai Test · Driver ID: DRV-01',
  );
  assert.equal(
    driverHeaderText({ driverName: null, driverId: 'DRV-02' }, 'android-01', 'th'),
    'รหัสคนขับ: DRV-02',
  );
  assert.equal(
    driverHeaderText(null, 'android-01', 'en'),
    'Waiting for driver identification · Device ID: android-01',
  );
});

test('compact controls are reserved for short landscape screens', () => {
  assert.equal(usesCompactLandscapeLayout(844, 390), true);
  assert.equal(usesCompactLandscapeLayout(1280, 800), false);
  assert.equal(usesCompactLandscapeLayout(390, 844), false);
  assert.equal(usesCompactLandscapeLayout(800, 1280), false);
});

test('production movement detection relies only on the server-side FMS adapter', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../app/index.tsx', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /expo-location|Location\.|deviceGpsStartsJob/);
  assert.match(source, /fetchVehicleMotion\(binding\.deviceId\)/);
  assert.match(source, /motionStartsJob\(binding, motion\)/);
  assert.match(source, /const timer = setInterval\(poll, 2000\)/);
});

test('active jobs trigger server-side GPS reconciliation without sending coordinates', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../app/index.tsx', import.meta.url)), 'utf8');
  assert.match(source, /requestJobGpsSync\(\{[\s\S]*jobId: activeJobId[\s\S]*targetAt: new Date\(serverNowMs\(\)\)\.toISOString\(\)/);
  assert.match(source, /JOB_GPS_SYNC_INTERVAL_MS = 60_000/);
  assert.doesNotMatch(source, /latitude: position\.coords|longitude: position\.coords/);
});

test('confirmation dialogs move screen-reader focus into a modal heading', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../app/index.tsx', import.meta.url)), 'utf8');
  assert.match(source, /findNodeHandle\(confirmationTitleRef\.current\)/);
  assert.match(source, /AccessibilityInfo\.setAccessibilityFocus\(node\)/);
  assert.match(source, /<Modal[\s\S]*onRequestClose=\{dismissConfirmation\}[\s\S]*onShow=\{focusConfirmationTitle\}/);
  assert.match(source, /accessibilityViewIsModal[\s\S]*onAccessibilityEscape=\{dismissConfirmation\}/);
  assert.match(source, /ref=\{confirmationTitleRef\}[\s\S]*accessibilityRole="header"/);
});

test('confirmation dialogs restore focus to the mode or cancel control that opened them', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../app/index.tsx', import.meta.url)), 'utf8');
  assert.match(source, /confirmationTriggerNodeRef\.current = findNodeHandle\(view\)/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*AccessibilityInfo\.setAccessibilityFocus\(node\)/);
  assert.match(source, /rememberConfirmationTrigger\(actionButtonRefs\.current\[number\]\)[\s\S]*selectAction\(number\)/);
  assert.match(source, /rememberConfirmationTrigger\(cancelJobButtonRef\.current\)[\s\S]*setConfirmType\('cancel'\)/);
  assert.match(source, /dismissConfirmation\(\)[\s\S]*restoreConfirmationTriggerFocus\(\)/);
  assert.match(source, /localStateFinalized[\s\S]*confirmationTriggerNodeRef\.current = findNodeHandle\(headerTitleRef\.current\)/);
  assert.match(source, /clearTimeout\(focusRestoreTimerRef\.current\)/);
});

test('confirmation controls announce the exact action they perform', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../app/index.tsx', import.meta.url)), 'utf8');
  assert.match(source, /const confirmationDismissLabel = confirmType === 'start'/);
  assert.match(source, /const confirmationSubmitLabel = confirmType === 'start'/);
  assert.match(source, /accessibilityLabel=\{confirmationDismissLabel\}/);
  assert.match(source, /accessibilityLabel=\{confirmationSubmitLabel\}/);
});
