import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL as NodeUrl } from 'node:url';
import test from 'node:test';

async function source(path: string) {
  return readFile(fileURLToPath(new NodeUrl(path, import.meta.url)), 'utf8');
}

test('web controls have visible focus, sufficient targets, reduced motion, and stronger secondary text', async () => {
  const styles = await source('../web/app/styles.css');
  assert.match(styles, /\.main:focus\{outline:none\}\.main:focus-visible\{outline:3px solid #E31B23;outline-offset:-3px\}/);
  assert.match(styles, /button:focus-visible\{outline:3px solid #111;outline-offset:2px;box-shadow:0 0 0 5px #fff\}/);
  assert.match(styles, /\.coverage-state\{min-height:24px\}/);
  assert.match(styles, /\.timeline-track\{height:32px;overflow:visible\}\.timeline-segment\{top:4px;bottom:4px;min-width:24px;min-height:24px\}/);
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{[^}]*animation-duration:\.01ms!important[^}]*transition-duration:\.01ms!important/);
  assert.match(styles, /\.eyebrow,p\{color:#5E6872\}/);
  assert.match(styles, /\.warning-text,\.print-warning\{color:#8A5D00!important\}/);
});

test('date picker uses truthful button semantics and announces complete dates', async () => {
  const reports = await source('../web/app/report-dashboard.jsx');
  assert.match(reports, /function accessibleDayLabel\(day, lang\)/);
  assert.match(reports, /className="calendar-grid" role="group" aria-label=\{monthLabel\}/);
  assert.match(reports, /aria-label=\{accessibleDayLabel\(day, lang\)\}/);
  assert.match(reports, /aria-current=\{day === today \? 'date' : undefined\}/);
  assert.match(reports, /aria-pressed=\{day === draftStart \|\| day === draftEnd\}/);
  assert.doesNotMatch(reports, /role="gridcell"/);
  assert.match(reports, /className="date-popover-actions"[\s\S]*>\{t\.cancel\}<\/button>[\s\S]*>\{t\.apply\}<\/button>/);
});

test('repeated dashboard actions identify their report or tablet to screen readers', async () => {
  const reports = await source('../web/app/report-dashboard.jsx');
  const fleet = await source('../web/app/fleet-dashboard.jsx');
  assert.match(reports, /aria-label=\{`\$\{t\.retry\}: \$\{report\.id\}`\}/);
  assert.match(reports, /aria-label=\{`\$\{g\.viewGps\}: \$\{report\.id\}`\}/);
  assert.match(reports, /aria-label=\{`\$\{t\.printVehicle\}: \$\{report\.vehicleNumber\}`\}/);
  assert.match(fleet, /aria-label=\{`\$\{t\.resetAccess\}: \$\{binding\.deviceId\}`\}/);
  assert.match(fleet, /resetAccess: 'Repair tablet connection'/);
  assert.match(fleet, /vehicle binding, device ID, and saved jobs stay unchanged/);
});

test('data tables and print timelines expose equivalent nonvisual structure', async () => {
  const print = await source('../web/app/print/print-dashboard.jsx');
  const drawer = await source('../web/app/job-gps-drawer.jsx');
  assert.match(print, /<caption className="sr-only">\{lang === 'th' \? 'รายการงานโดยละเอียด' : 'Detailed job list'\}<\/caption>/);
  assert.match(print, /<th scope="col">/);
  assert.match(print, /className="print-timeline-track" role="img" aria-label=\{label\}/);
  assert.match(print, /<span aria-hidden="true" key=\{report\.id/);
  assert.match(print, /useDocumentLanguage\(lang\)/);
  assert.match(drawer, /className="gps-sample-table-wrap" tabIndex=\{0\} aria-label=\{t\.title\}/);
  assert.match(drawer, /<caption className="sr-only">\{t\.title\}<\/caption>/);
});

test('mobile UI supports TalkBack focus, 48dp controls, and an enlarged-text 3x3 tablet grid', async () => {
  const app = await source('../app/index.tsx');
  const report = await source('../components/MobileJobReport.tsx');
  assert.match(app, /const \{ width, height, fontScale \} = useWindowDimensions\(\)/);
  assert.match(app, /const largeText = fontScale >= 1\.3/);
  assert.match(app, /const ACTION_COLUMN_COUNT = 3/);
  assert.match(app, /const actionRows = Array\.from\([\s\S]*actions\.slice\(index \* ACTION_COLUMN_COUNT/);
  assert.doesNotMatch(app, /actionColumnCount = largeText/);
  assert.match(app, /numberOfLines=\{largeText \? undefined : 2\}/);
  assert.match(app, /<View style=\{\[styles\.content,[\s\S]*largeText && accessibilityStyles\.content\]\}>\{actionPanel\}<\/View>/);
  assert.doesNotMatch(app, /<ScrollView contentContainerStyle=\{accessibilityStyles\.content\}>\{actionPanel\}<\/ScrollView>/);
  assert.match(app, /accessibilityStyles = StyleSheet\.create\([\s\S]*content: \{ padding: 6 \}/);
  assert.match(app, /actionNumberSlot: \{ height: '32%' \}/);
  assert.match(app, /headerButton: \{ minWidth: 48, minHeight: 48/);
  assert.match(app, /card: \{ width: '100%', maxWidth: 420, maxHeight: '90%'/);
  assert.match(app, /findNodeHandle\(vehicleAdminTitleRef\.current\)/);
  assert.match(app, /restoreFocusToNode\(savedJobsTriggerNodeRef\.current/);
  assert.match(app, /Tablet connection needs repair/);
  assert.match(report, /findNodeHandle\(reportTitleRef\.current\)/);
  assert.match(report, /Dashboard delivery/);
  assert.match(report, /secondaryButton: \{ minHeight: 48/);
  assert.match(report, /closeButton: \{ width: 48, height: 48/);
});
