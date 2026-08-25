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
    setupBody: 'Connect this tablet once. Later vehicle changes require the admin password.',
    vehicle: 'Vehicle number',
    save: 'Save vehicle',
  });
  assert.deepEqual(mobileCopy.th, {
    setupEyebrow: 'ตั้งค่าครั้งแรก',
    setup: 'กรอกหมายเลขรถ',
    setupBody: 'เชื่อมต่อแท็บเล็ตเครื่องนี้เพียงครั้งเดียว การเปลี่ยนรถภายหลังต้องใช้รหัสผ่านผู้ดูแล',
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

test('mobile action cards pin aligned numbers above a compact text group', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../app/index.tsx', import.meta.url)), 'utf8');
  assert.match(source, /<View style=\{\[styles\.actionNumberSlot, compactLandscape && compactStyles\.actionNumberSlot, largeText && accessibilityStyles\.actionNumberSlot\]\}>/);
  assert.match(source, /<View style=\{\[styles\.actionTextSlot, compactLandscape && compactStyles\.actionTextSlot, largeText && accessibilityStyles\.actionTextSlot\]\}>/);
  assert.match(source, /actionNumberSlot: \{ height: '45%',[^}]*justifyContent: 'flex-end'/);
  assert.match(source, /actionTextSlot: \{ flex: 1, minHeight: 0,[^}]*paddingTop: 16/);
  assert.match(source, /actionNumberSlot: \{ height: '38%'/);
  assert.match(source, /actionSub: \{ fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 8 \}/);
  assert.match(source, /numberOfLines=\{largeText \? undefined : compactLandscape \? 2 : 5\}/);
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
  assert.match(source, /dismissConfirmation\(\)[\s\S]*restoreConfirmationTriggerFocus\(\)/);
  assert.match(source, /localStateFinalized[\s\S]*confirmationTriggerNodeRef\.current = findNodeHandle\(headerTitleRef\.current\)/);
  assert.match(source, /clearTimeout\(focusRestoreTimerRef\.current\)/);
});

test('the active-job dialog offers keep on, turn off, and cancel choices', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../app/index.tsx', import.meta.url)), 'utf8');
  assert.match(source, /confirmType === 'finish' \? <Pressable[\s\S]*onPress=\{confirmCancel\}[\s\S]*Cancel job/);
  assert.match(source, /Keep job on/);
  assert.match(source, /Turn off/);
  assert.doesNotMatch(source, /cancelJobButtonRef/);
});

test('cancelling releases a durably saved job without requiring a live binding check', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../app/index.tsx', import.meta.url)), 'utf8');
  const cancelFlow = source.slice(source.indexOf('async function confirmCancel()'), source.indexOf('async function refreshSavedJobs()'));
  assert.match(cancelFlow, /cancellationReportForIntent\(pendingReport/);
  assert.match(cancelFlow, /saveOrQueueJob\(report\)[\s\S]*finalizeActiveJob\(\)[\s\S]*setSelected\(null\)/);
  assert.doesNotMatch(cancelFlow, /fetchVehicleBinding/);
  assert.doesNotMatch(cancelFlow, /Connect to the server before cancelling/);
});

test('confirmation controls announce the exact action they perform', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../app/index.tsx', import.meta.url)), 'utf8');
  assert.match(source, /const confirmationDismissLabel = confirmType === 'start'/);
  assert.match(source, /const confirmationSubmitLabel = confirmType === 'start'/);
  assert.match(source, /accessibilityLabel=\{confirmationDismissLabel\}/);
  assert.match(source, /accessibilityLabel=\{confirmationSubmitLabel\}/);
});

test('job 9 skips movement and offers only cancel or finish-and-view-report', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../app/index.tsx', import.meta.url)), 'utf8');
  const report = await readFile(fileURLToPath(new NodeUrl('../components/MobileJobReport.tsx', import.meta.url)), 'utf8');
  assert.match(source, /decision\.type === 'confirm_day_end'[\s\S]*setSelected\(number\)[\s\S]*setConfirmType\('day_end'\)/);
  assert.match(source, /const immediateDayEnd = confirmType === 'day_end' && selected === '9'/);
  assert.match(source, /confirmType === 'start' \|\| confirmType === 'day_end'\) setSelected\(null\)/);
  assert.match(source, /confirmType === 'day_end' \? \(language === 'en' \? 'Cancel'/);
  assert.match(source, /confirmType === 'day_end'[\s\S]*'Finish and view report'/);
  assert.match(source, /\{confirmType === 'finish' \? <Pressable[\s\S]*Cancel job/);
  assert.match(source, /const finishingDay = selected === '9'/);
  assert.match(source, /const dayReport = completedDayReport/);
  assert.match(source, /setReportDay\(mobileReportDayKey\(dayReport\.endTime\)\)/);
  assert.match(source, /setJobsVisible\(true\)/);
  assert.match(report, /Daily report/);
  assert.match(report, /Timeline/);
  assert.match(report, /Saved jobs/);
  assert.match(report, /รายงานประจำวัน/);
  assert.match(report, /ไทม์ไลน์/);
  assert.match(report, /งานที่บันทึก/);
});

test('mobile saved jobs expose scalable search, filter, and sort controls without native selects', async () => {
  const report = await readFile(fileURLToPath(new NodeUrl('../components/MobileJobReport.tsx', import.meta.url)), 'utf8');
  const app = await readFile(fileURLToPath(new NodeUrl('../app/index.tsx', import.meta.url)), 'utf8');
  const outbox = await readFile(fileURLToPath(new NodeUrl('../lib/job-outbox.ts', import.meta.url)), 'utf8');
  const localApi = await readFile(fileURLToPath(new NodeUrl('../server.js', import.meta.url)), 'utf8');
  const productionApi = await readFile(fileURLToPath(new NodeUrl('../web/lib/server/api.mjs', import.meta.url)), 'utf8');
  assert.match(report, /useDeferredValue\(search\)/);
  assert.match(report, /filterAndSortMobileJobs/);
  assert.match(report, /search: 'Search jobs'/);
  assert.match(report, /<TextInput/);
  assert.match(report, /All months/);
  assert.match(report, /All activities/);
  assert.match(report, /All statuses/);
  assert.match(report, /Newest/);
  assert.match(report, /Longest/);
  assert.match(report, /Search, sort & filter/);
  assert.match(report, /accessibilityState=\{\{ expanded: filtersExpanded \}\}/);
  assert.match(report, /filtersExpanded \? <View/);
  assert.match(report, /activeFilterCount/);
  assert.match(report, /Load more jobs/);
  assert.match(report, /onLoadMore/);
  assert.match(report, /initialNumToRender=\{12\}/);
  assert.match(report, /removeClippedSubviews/);
  assert.match(report, /windowSize=\{9\}/);
  assert.match(report, /reportStatus\(job, language\)/);
  assert.match(report, /syncStatus\(job, language\)/);
  assert.doesNotMatch(report, /<Picker|<select/);
  assert.doesNotMatch(report, /Needs attention/);
  assert.match(app, /fetchDeviceJobs\(binding\.deviceId, binding\.vehicleNumber, query, page\)/);
  assert.match(outbox, /listStoredJobReportsPage/);
  assert.match(outbox, /LIMIT \? OFFSET \?/);
  assert.match(localApi, /queryLocalDeviceJobs\(reports, deviceId, vehicleNumber, query\)/);
  assert.match(productionApi, /getDeviceJobs\(deviceId, vehicleNumber, searchParams\)/);
  assert.match(productionApi, /LIMIT \$\{limitParameter\} OFFSET \$\{offsetParameter\}/);
  assert.doesNotMatch(app, /DEVICE_JOB_HISTORY_LIMIT|listStoredJobReports\([^)]*5000/);
  assert.doesNotMatch(outbox, /limit = 5000|slice\(0, 5000\)/);
  assert.doesNotMatch(localApi, /slice\(0, 5000\)/);
  assert.doesNotMatch(productionApi, /limit = 5000/);
});

test('the header GPS logo replaces the separate Admin text button', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../app/index.tsx', import.meta.url)), 'utf8');
  assert.match(source, /accessibilityLabel=\{language === 'en' \? 'Open admin vehicle settings'/);
  assert.match(source, /onPress=\{openVehicleAdmin\}[\s\S]*<RedGpsPin/);
  assert.doesNotMatch(source, />\{language === 'en' \? 'Admin' : 'ตั้งค่า'\}<\/Text>/);
});

test('admin vehicle changes release startup restoration for the new binding', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../app/index.tsx', import.meta.url)), 'utf8');
  const changeVehicle = source.slice(source.indexOf('async function changeVehicle()'), source.indexOf('function selectAction'));
  assert.match(changeVehicle, /await clearActiveJob\(\)/);
  assert.match(changeVehicle, /setBinding\(next\);\s*setRecoveredBindingKey\(deviceBindingKey\(next\)\)/);
  assert.doesNotMatch(changeVehicle, /setRecoveredBindingKey\(null\)/);
});
