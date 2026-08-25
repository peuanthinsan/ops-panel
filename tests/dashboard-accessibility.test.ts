import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL as NodeUrl } from 'node:url';
import test from 'node:test';
import { localizedDashboardAdminError, localizedDashboardReportError } from '../lib/dashboard-errors.ts';

test('Thai dashboard errors stay localized, including unknown server failures', () => {
  assert.equal(
    localizedDashboardAdminError('Unexpected upstream rejection', 'th'),
    'ไม่สามารถดำเนินการได้ กรุณาลองอีกครั้ง',
  );
  assert.equal(
    localizedDashboardReportError('Could not reach the Songdee Ops server.', 'th', 'ไม่สามารถโหลดรายงานได้'),
    'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ Songdee Ops ได้',
  );
  assert.equal(
    localizedDashboardReportError('Unexpected upstream rejection', 'th', 'ไม่สามารถโหลดรายงานได้'),
    'ไม่สามารถโหลดรายงานได้',
  );
  assert.equal(
    localizedDashboardReportError('Report not found', 'en', 'Could not load reports.'),
    'Report not found',
  );
});

test('dashboard login supports explicit Enter submission and route focus does not scroll past navigation', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../web/app/page.jsx', import.meta.url)), 'utf8');
  assert.match(source, /<form className="login-card" onSubmit=\{submit\}>/);
  assert.match(source, /event\.key === 'Enter'/);
  assert.match(source, /event\.currentTarget\.form\?\.requestSubmit\(\)/);
  assert.match(source, /focus\(\{ preventScroll: true \}\)/);
});

test('reports expose labeled filters and sort direction to assistive technology', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../web/app/report-dashboard.jsx', import.meta.url)), 'utf8');
  assert.match(source, /aria-label=\{lang === 'en' \? 'Report filters'/);
  assert.match(source, /aria-sort=\{sortKey === key/);
  assert.match(source, /className="table-wrap" tabIndex=\{0\}/);
  assert.match(source, /localizedDashboardReportError/);
  assert.match(source, /print: 'Print report'/);
  assert.match(source, /new URLSearchParams\(\{ date: selectedPrintDate, lang \}\)/);
  assert.match(source, /className="date-input report-date-input"/);
  assert.doesNotMatch(source, /window\.location\.assign\(`\/print\/landscape/);
});

test('reports combine the timeline and saved jobs before opening the one-page vehicle print', async () => {
  const dashboard = await readFile(fileURLToPath(new NodeUrl('../web/app/report-dashboard.jsx', import.meta.url)), 'utf8');
  const shell = await readFile(fileURLToPath(new NodeUrl('../web/app/page.jsx', import.meta.url)), 'utf8');
  const timeline = await readFile(fileURLToPath(new NodeUrl('../web/app/timeline-dashboard.jsx', import.meta.url)), 'utf8');
  const print = await readFile(fileURLToPath(new NodeUrl('../web/app/print/print-dashboard.jsx', import.meta.url)), 'utf8');
  assert.match(dashboard, /<TimelineDashboard lang=\{lang\} embedded \/>/);
  assert.doesNotMatch(dashboard, /embedded sourceReports=\{visibleReports\}/);
  assert.match(timeline, /embedded = false, sourceReports = null/);
  assert.match(timeline, /embedded \? null : <button className="primary"/);
  assert.doesNotMatch(shell, /\{ href: '\/timeline', key: 'timeline' \}/);
  assert.match(print, /className="report-section"/);
  assert.match(print, /className="simple-job-table"/);
  assert.match(print, /className="signature-footer"/);
});

test('daily report is landscape, date-selectable, speed-enabled, and uses the official logo pin', async () => {
  const dashboard = await readFile(fileURLToPath(new NodeUrl('../web/app/report-dashboard.jsx', import.meta.url)), 'utf8');
  const timeline = await readFile(fileURLToPath(new NodeUrl('../web/app/timeline-dashboard.jsx', import.meta.url)), 'utf8');
  const print = await readFile(fileURLToPath(new NodeUrl('../web/app/print/print-dashboard.jsx', import.meta.url)), 'utf8');
  const printStyles = await readFile(fileURLToPath(new NodeUrl('../web/app/print/portrait/portrait-print.css', import.meta.url)), 'utf8');
  assert.match(dashboard, /dateRange: 'Job list range'/);
  assert.match(dashboard, /reportDate: 'Report date'/);
  assert.match(timeline, /adminFetchAllReports\(\{ startDate: targetDate, endDate: targetDate \}\)/);
  assert.match(timeline, /<SpeedTimelineOverlay/);
  assert.match(print, /onDateChange=\{changeReportDate\}/);
  assert.match(print, /'View date'/);
  assert.match(print, /src="\/songdee-gps-pin\.svg"/);
  assert.match(print, /startMinute=\{6 \* 60\} endMinute=\{24 \* 60\}/);
  assert.match(printStyles, /@page\{size:A4 landscape;margin:0\}/);
  assert.match(printStyles, /width:297mm;height:210mm/);
});

test('job GPS detail is an accessible, cancellable GPS modal', async () => {
  const reports = await readFile(fileURLToPath(new NodeUrl('../web/app/report-dashboard.jsx', import.meta.url)), 'utf8');
  const source = await readFile(fileURLToPath(new NodeUrl('../web/app/job-gps-drawer.jsx', import.meta.url)), 'utf8');
  assert.match(source, /role="dialog" aria-modal="true" aria-labelledby="gps-detail-title"/);
  assert.match(source, /if \(event\.key === 'Escape'\)/);
  assert.match(source, /if \(event\.key !== 'Tab'\) return/);
  assert.match(source, /previouslyFocused instanceof HTMLElement/);
  assert.match(source, /GPS detail/);
  assert.match(source, /จุด GPS/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /data-label=\{t\.coordinates\}/);
  assert.doesNotMatch(source, /Howen|PairingTracks|fmsGps|pairStatus/);
  assert.doesNotMatch(reports, /GpsCoverageOverview|Howen FMS|coverageOverview/);
});

test('timeline segments expose detailed tooltips to pointer, keyboard, and touch users', async () => {
  const source = await readFile(fileURLToPath(new NodeUrl('../web/app/timeline-dashboard.jsx', import.meta.url)), 'utf8');
  assert.match(source, /type="button"\s+className="timeline-segment"/);
  assert.match(source, /aria-label=\{segment\.accessibleLabel\}/);
  assert.match(source, /aria-describedby=/);
  assert.match(source, /onMouseEnter=/);
  assert.match(source, /onFocus=/);
  assert.match(source, /onClick=/);
  assert.match(source, /role="tooltip"/);
  assert.match(source, /event\.key === 'Escape'/);
  for (const detail of ['start', 'end', 'duration', 'vehicle', 'driver', 'device', 'gps', 'location', 'reportId']) assert.match(source, new RegExp(`tooltip\\.segment\\.detail\\.${detail}`));
});

test('large fleet filters use bounded searchable comboboxes instead of native selects', async () => {
  const reports = await readFile(fileURLToPath(new NodeUrl('../web/app/report-dashboard.jsx', import.meta.url)), 'utf8');
  const combobox = await readFile(fileURLToPath(new NodeUrl('../web/app/searchable-combobox.jsx', import.meta.url)), 'utf8');
  assert.doesNotMatch(reports, /<select\b/);
  assert.match(reports, /<SearchableCombobox label=\{t\.vehicle\}/);
  assert.match(reports, /<SearchableCombobox label=\{t\.device\}/);
  assert.match(reports, /<SearchableCombobox label=\{t\.driver\}/);
  assert.match(combobox, /MAX_VISIBLE_COMBOBOX_OPTIONS = 100/);
  assert.match(combobox, /matches\.slice\(0, maxResults\)/);
  assert.match(combobox, /role="combobox"/);
  assert.match(combobox, /role="listbox"/);
  assert.match(combobox, /role="option"/);
  assert.match(combobox, /aria-activedescendant/);
  assert.match(combobox, /onClick=.*setOpen\(true\)/);
});

test('empty dashboard states guide an administrator to fleet setup without offering an empty print', async () => {
  const reports = await readFile(fileURLToPath(new NodeUrl('../web/app/report-dashboard.jsx', import.meta.url)), 'utf8');
  const timeline = await readFile(fileURLToPath(new NodeUrl('../web/app/timeline-dashboard.jsx', import.meta.url)), 'utf8');
  const fleet = await readFile(fileURLToPath(new NodeUrl('../web/app/fleet-dashboard.jsx', import.meta.url)), 'utf8');
  assert.match(reports, /disabled=\{!printDate \|\| \(!totalReports && !hasAnyReportData\)\}/);
  assert.match(reports, /href="\/admin"/);
  assert.match(reports, /emptyTitle: 'No jobs recorded yet'/);
  assert.match(reports, /Math\.max\(fleetSize, activeVehicles\)/);
  assert.doesNotMatch(reports, /Math\.max\(fleetSize, activeVehicles\) \|\| '—'/);
  assert.match(timeline, /emptyTitle: 'No timeline activity yet'/);
  assert.match(fleet, /empty: 'No vehicles connected yet'/);
});

test('fleet bindings use a dedicated mobile card layout instead of a clipped desktop table', async () => {
  const fleet = await readFile(fileURLToPath(new URL('../web/app/fleet-dashboard.jsx', import.meta.url)), 'utf8');
  const styles = await readFile(fileURLToPath(new URL('../web/app/styles.css', import.meta.url)), 'utf8');
  assert.match(fleet, /className="fleet-cards"/);
  assert.match(fleet, /function BindingCard/);
  assert.match(styles, /\.fleet-table-wrap\{display:none\}\.fleet-cards\{display:grid/);
});
