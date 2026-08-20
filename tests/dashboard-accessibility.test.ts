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
  assert.match(source, /window\.location\.assign\(`\/print\/landscape\?\$\{params\}`\)/);
});

test('print flows separate the combined report from the timeline-only action', async () => {
  const timeline = await readFile(fileURLToPath(new NodeUrl('../web/app/timeline-dashboard.jsx', import.meta.url)), 'utf8');
  const print = await readFile(fileURLToPath(new NodeUrl('../web/app/print/print-dashboard.jsx', import.meta.url)), 'utf8');
  const landscape = await readFile(fileURLToPath(new NodeUrl('../web/app/print/landscape/page.jsx', import.meta.url)), 'utf8');
  assert.match(timeline, /printTimeline: 'Print timeline'/);
  assert.match(timeline, /view: 'timeline'/);
  assert.match(print, /function JobListPrintPage/);
  assert.match(print, /detailedJobPages\.map/);
  assert.match(landscape, /timelineOnly=\{params\.get\('view'\) === 'timeline'\}/);
});

test('job GPS detail is an accessible, cancellable Data-FM-only modal', async () => {
  const reports = await readFile(fileURLToPath(new NodeUrl('../web/app/report-dashboard.jsx', import.meta.url)), 'utf8');
  const source = await readFile(fileURLToPath(new NodeUrl('../web/app/job-gps-drawer.jsx', import.meta.url)), 'utf8');
  assert.match(source, /role="dialog" aria-modal="true" aria-labelledby="gps-detail-title"/);
  assert.match(source, /if \(event\.key === 'Escape'\)/);
  assert.match(source, /if \(event\.key !== 'Tab'\) return/);
  assert.match(source, /previouslyFocused instanceof HTMLElement/);
  assert.match(source, /Data-FM GPS/);
  assert.match(source, /จุด GPS จาก Data-FM/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /data-label=\{t\.coordinates\}/);
  assert.doesNotMatch(source, /Howen|PairingTracks|fmsGps|pairStatus/);
  assert.doesNotMatch(reports, /GpsCoverageOverview|Howen FMS|coverageOverview/);
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
  assert.match(reports, /disabled=\{!totalReports\}/);
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
