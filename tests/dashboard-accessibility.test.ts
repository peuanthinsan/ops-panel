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
  assert.match(source, /aria-label=\{lang === 'en' \? 'Shared timeline and Job List filters'/);
  assert.match(source, /aria-sort=\{sortKey === key/);
  assert.match(source, /onClick=\{event => changeSort\(key, event\)\}/);
  assert.doesNotMatch(source, /label=\{t\.sort\}|sortOptions/);
  assert.match(source, /className="table-wrap" tabIndex=\{0\}/);
  assert.match(source, /localizedDashboardReportError/);
  assert.match(source, /print: 'Print work report'/);
  assert.match(source, /!report\.driverName \|\| !Number\(report\.deviceGpsSamples\)/);
  assert.match(source, /new URLSearchParams\(\{ workPeriodId: selectedPrintPeriodId, lang \}\)/);
  assert.match(source, /if \(!selectedPrintPeriodId \|\| vehicles\.length !== 1\) return/);
  assert.match(source, /params\.set\('vehicle', vehicles\[0\]\)/);
  assert.match(source, /aria-describedby="daily-print-vehicle-message"/);
  assert.match(source, /dateRange: 'Work started'/);
  assert.match(source, /function DateRangePicker/);
  assert.equal(source.match(/<DateRangePicker\b/g)?.length ?? 0, 1);
  assert.equal(source.match(/<input type="date"/g)?.length ?? 0, 0);
  assert.doesNotMatch(source, /report-date-input|Job list range|Report date/);
  assert.doesNotMatch(source, /window\.location\.assign\(`\/print\/landscape/);
});

test('reports combine the timeline and saved jobs before opening the daily vehicle print', async () => {
  const dashboard = await readFile(fileURLToPath(new NodeUrl('../web/app/report-dashboard.jsx', import.meta.url)), 'utf8');
  const shell = await readFile(fileURLToPath(new NodeUrl('../web/app/page.jsx', import.meta.url)), 'utf8');
  const timeline = await readFile(fileURLToPath(new NodeUrl('../web/app/timeline-dashboard.jsx', import.meta.url)), 'utf8');
  const print = await readFile(fileURLToPath(new NodeUrl('../web/app/print/print-dashboard.jsx', import.meta.url)), 'utf8');
  assert.match(dashboard, /<TimelineDashboard lang=\{lang\} embedded sharedFilters=\{sharedFilters\} \/>/);
  assert.doesNotMatch(dashboard, /embedded sourceReports=\{visibleReports\}/);
  assert.match(timeline, /embedded = false, sourceReports = null, sourceLoading = false, sourceError = '', sharedFilters = null/);
  assert.match(timeline, /const effectiveStartDate = embedded \? String\(sharedQuery\.startDate \|\| ''\) : date/);
  assert.match(timeline, /const effectiveEndDate = embedded \? String\(sharedQuery\.endDate \|\| ''\) : date/);
  assert.match(timeline, /embedded \? !reportMatchesFilters\(report, sharedQuery, lang\)/);
  assert.match(timeline, /const requestFilters = embedded \? sharedQuery/);
  assert.match(timeline, /embedded \? null : <div className="timeline-controls">/);
  assert.match(timeline, /const key = `\$\{report\.workPeriodId \|\| day\}\\u0000\$\{actualDay\}/);
  assert.match(timeline, /className="timeline-row-date"/);
  assert.match(timeline, /\{embedded \? null : <div className="timeline-header-actions">/);
  assert.doesNotMatch(shell, /\{ href: '\/timeline', key: 'timeline' \}/);
  assert.match(print, /className="report-section"/);
  assert.match(print, /className="simple-job-table"/);
  assert.match(print, /className="signature-footer"/);
  assert.match(print, /paginateDailyReportJobs\(summary\.rows\)/);
  assert.match(print, /JOB LIST — CONTINUED/);
  assert.doesNotMatch(print, /additional jobs · see dashboard for details/);
  assert.doesNotMatch(print, /Up to 8 jobs shown/);
});

test('work-period report is anchor-selected, speed-enabled, and uses the official logo pin', async () => {
  const dashboard = await readFile(fileURLToPath(new NodeUrl('../web/app/report-dashboard.jsx', import.meta.url)), 'utf8');
  const timeline = await readFile(fileURLToPath(new NodeUrl('../web/app/timeline-dashboard.jsx', import.meta.url)), 'utf8');
  const speedTimeline = await readFile(fileURLToPath(new NodeUrl('../web/app/speed-timeline.jsx', import.meta.url)), 'utf8');
  const print = await readFile(fileURLToPath(new NodeUrl('../web/app/print/print-dashboard.jsx', import.meta.url)), 'utf8');
  const printStyles = await readFile(fileURLToPath(new NodeUrl('../web/app/print/portrait/portrait-print.css', import.meta.url)), 'utf8');
  assert.match(dashboard, /print: 'Print work report'/);
  assert.match(dashboard, /const sharedFilters = useMemo\(\(\) => \(\{/);
  assert.match(dashboard, /vehicle: vehicles/);
  assert.match(dashboard, /sort: sorts\.map/);
  assert.match(dashboard, /const matchingPrintPeriodIds = \[\.\.\.new Set\(reports\.map/);
  assert.match(dashboard, /matchingPrintPeriodIds\.length === 1/);
  assert.match(timeline, /adminFetchAllReports\(requestFilters\)/);
  assert.match(timeline, /if \(effectiveStartDate && day < effectiveStartDate\) continue/);
  assert.match(timeline, /if \(effectiveEndDate && day > effectiveEndDate\) continue/);
  assert.match(timeline, /<SpeedTimelineOverlay/);
  assert.match(timeline, /reportableOperations\.map\(\(\[number, thai, english\]\)/);
  assert.match(speedTimeline, /mergeReportSpeedSeries\(series\)/);
  assert.match(speedTimeline, /chartPoints\.length > 1/);
  assert.match(speedTimeline, /className="speed-line"/);
  assert.match(speedTimeline, /chartPoints\.map\(point =>/);
  assert.match(speedTimeline, /className=\{`speed-point/);
  assert.match(speedTimeline, /className="speed-point-hit"/);
  assert.match(speedTimeline, /className="speed-point-tooltip" role="tooltip"/);
  assert.doesNotMatch(print, /onDateChange=\{changeReportDate\}|View date|print-date-control/);
  assert.match(print, /workPeriodId: requestedWorkPeriodId/);
  assert.match(print, /src="\/songdee-gps-pin\.svg"/);
  assert.match(print, /startMinute=\{0\} endMinute=\{timelineSpanMinutes\} originTime=\{timelineOrigin\}/);
  assert.match(print, /formatReportDuration\(report\.startTime, report\.endTime, report\.duration\)/);
  assert.doesNotMatch(print, /\.slice\(0, 5\)|function shortTime|durationShort/);
  assert.match(print, /second: '2-digit'/);
  assert.match(print, /printReportLocation\(report, lang\)/);
  assert.match(print, /periodAxis\(summary\.start, summary\.end, lang\)/);
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
  for (const detail of ['start', 'end', 'duration', 'speed', 'vehicle', 'driver', 'device', 'gps', 'location', 'reportId']) assert.match(source, new RegExp(`tooltip\\.segment\\.detail\\.${detail}`));
});

test('dashboard and daily print timelines expose event-timed alert arrows and details', async () => {
  const timeline = await readFile(fileURLToPath(new NodeUrl('../web/app/timeline-dashboard.jsx', import.meta.url)), 'utf8');
  const markers = await readFile(fileURLToPath(new NodeUrl('../web/app/timeline-alerts.jsx', import.meta.url)), 'utf8');
  const print = await readFile(fileURLToPath(new NodeUrl('../web/app/print/print-dashboard.jsx', import.meta.url)), 'utf8');
  assert.match(timeline, /deriveTimelineAlerts\(row\.reports, speedSeries\.samplesByReportId\)/);
  assert.match(timeline, /<TimelineAlertMarkers alerts=\{rowAlerts\}/);
  assert.match(timeline, /<TimelineAlertChips alerts=\{rowAlerts\}/);
  assert.match(timeline, /className="legend-alert-icon" weight="fill"/);
  assert.match(markers, /CaretDownIcon weight="fill"/);
  assert.match(markers, /timelineAlertPosition\(alert, startMinute, endMinute\)/);
  assert.match(markers, /role="tooltip"/);
  assert.match(markers, /formatTimelineAlertTime\(alert, lang\)/);
  assert.match(print, /deriveTimelineAlerts\(summary\.rows, speedSeries\.samplesByReportId\)/);
  assert.match(print, /<TimelineAlertMarkers alerts=\{alerts\} lang=\{lang\} startMinute=\{0\} endMinute=\{timelineSpanMinutes\} interactive=\{false\}/);
  assert.match(print, /<TimelineAlertChips alerts=\{alerts\} lang=\{lang\} limit=\{3\}/);
  assert.doesNotMatch(print, /function alertFor|className="timeline-flag"/);
});

test('large fleet filters use bounded searchable multi-comboboxes instead of native selects', async () => {
  const reports = await readFile(fileURLToPath(new NodeUrl('../web/app/report-dashboard.jsx', import.meta.url)), 'utf8');
  const combobox = await readFile(fileURLToPath(new NodeUrl('../web/app/searchable-combobox.jsx', import.meta.url)), 'utf8');
  assert.doesNotMatch(reports, /<select\b/);
  for (const field of ['vehicle', 'device', 'driver', 'mode', 'status', 'gps']) assert.match(reports, new RegExp(`<SearchableCombobox multiple label=\\{t\\.${field}\\}`));
  assert.match(reports, /<div className="header-vehicle-selector">\s*<SearchableCombobox multiple label=\{t\.vehicle\}/);
  assert.match(reports, /<div className="filter-grid shared-filter-grid">\s*<SearchableCombobox multiple label=\{t\.device\}/);
  const sharedFilterPanel = reports.slice(reports.indexOf('<section className="panel shared-report-filters"'), reports.indexOf('<TimelineDashboard'));
  assert.doesNotMatch(sharedFilterPanel, /label=\{t\.vehicle\}/);
  assert.match(combobox, /MAX_VISIBLE_COMBOBOX_OPTIONS = 100/);
  assert.match(combobox, /matches\.slice\(0, maxResults\)/);
  assert.match(combobox, /role="combobox"/);
  assert.match(combobox, /role="listbox"/);
  assert.match(combobox, /aria-multiselectable=\{multiple \|\| undefined\}/);
  assert.match(combobox, /role="option"/);
  assert.match(combobox, /const next = new Set\(selectedValues\)/);
  assert.match(combobox, /className="multi-combobox-chips"/);
  assert.match(combobox, /aria-activedescendant/);
  assert.match(combobox, /onClick=.*setOpen\(true\)/);
});

test('daily print requires exactly one vehicle and never falls back to a fleet vehicle', async () => {
  const reports = await readFile(fileURLToPath(new NodeUrl('../web/app/report-dashboard.jsx', import.meta.url)), 'utf8');
  const print = await readFile(fileURLToPath(new NodeUrl('../web/app/print/print-dashboard.jsx', import.meta.url)), 'utf8');
  assert.match(reports, /const canPrintDailyReport = Boolean\(selectedPrintPeriodId && vehicles\.length === 1/);
  assert.match(reports, /disabled=\{!canPrintDailyReport\}/);
  assert.match(reports, /printVehicleRequired: 'Select exactly one vehicle in the header\.'/);
  assert.match(reports, /const vehicle = String\(report\.vehicleNumber \|\| ''\)\.trim\(\)/);
  assert.match(reports, /new URLSearchParams\(\{ vehicle, workPeriodId, lang \}\)/);
  assert.match(print, /const vehicle = String\(requestedVehicle \|\| ''\)\.trim\(\)/);
  assert.match(print, /vehicle \? \{ vehicle: \[vehicle\] \} : \{\}/);
  assert.match(print, /if \(!vehicle\) return <MissingVehiclePrintState lang=\{lang\} \/>/);
  assert.doesNotMatch(print, /reports\.find\(report => report\.vehicleNumber\)|bindings\[0\]\?\.vehicleNumber/);
});

test('empty dashboard states guide an administrator to fleet setup without offering an empty print', async () => {
  const reports = await readFile(fileURLToPath(new NodeUrl('../web/app/report-dashboard.jsx', import.meta.url)), 'utf8');
  const timeline = await readFile(fileURLToPath(new NodeUrl('../web/app/timeline-dashboard.jsx', import.meta.url)), 'utf8');
  const fleet = await readFile(fileURLToPath(new NodeUrl('../web/app/fleet-dashboard.jsx', import.meta.url)), 'utf8');
  assert.match(reports, /disabled=\{!canPrintDailyReport\}/);
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
