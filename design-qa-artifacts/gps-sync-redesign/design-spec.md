# GPS sync dashboard design specification

## Accepted references

- `dashboard-concept.png` — primary Reports workspace at 1600×1000.
- `job-gps-detail-concept.png` — selected job with the GPS detail drawer at 1600×1000.

## Information architecture and copy lock

- Navigation remains Reports, Timeline, Fleet, Settings.
- Reports header: “Operations reports” and “Review jobs and verify time-matched GPS-device and Howen FMS coverage.”
- Primary controls remain date range, Refresh, Print report, global search, Vehicle, Device, Driver, Activity, Status, GPS coverage, and Sort.
- Summary labels: Total jobs, Vehicles operating, GPS paired, Needs attention.
- Primary table: Vehicle, Driver, Activity, Started, Duration, GPS coverage, Last position, Status, Actions.
- Row action: View GPS; existing Print vehicle behavior remains available.
- Detail surface: GPS sync detail, Paired samples, GPS-device samples, Howen FMS samples, Median offset, Last synchronized, GPS device server, Howen FMS, Captured, GPS fix time, GPS device, FMS GPS, Offset, Pair status, Close.
- Thai copy must cover every new visible label and state.

## Design system

- Background: true white `#FFFFFF`; application chrome: black `#111111`; page divider and quiet surface: `#EEF0F2`; muted text: `#68727D`; Songdee red: `#E31B23`; deep red: `#7A1424`.
- Positive paired state: `#14865B`; partial/device-only: `#B57A00`; failed/delayed: `#B3131A`; no data: `#9AA2A9`.
- Typography: existing Sarabun files; content headings 28–32px/800, section headings 16–18px/800, controls 12–13px/700, table content 12px/600, metadata 10–11px/600.
- Geometry: crisp 1px cool-grey borders, 8–10px radii, negligible shadow. Tables and open rails are the container model; avoid nested card grids.
- Icons: existing GPS pin plus restrained 1.8px line icons for source, close, refresh, print, and disclosure controls.
- Motion: 150–180ms drawer/sheet transition and row selection only; honor reduced motion.

## Components and responsive rules

- `GpsCoverageSummary`: one horizontal four-cell summary rail.
- `GpsCoverageRail`: aligned Device and FMS tracks that converge into the job result; segments represent real returned coverage, not decorative data.
- `JobGpsDrawer`: fixed right drawer on desktop, full-width sheet below 900px, independently scrollable, modal accessibility boundary.
- `GpsSampleTable`: dense source-comparison rows with coordinates, speed, offset, and pair state; responsive cards below 680px.
- Existing searchable comboboxes remain non-native and scalable to thousands of options.
- Desktop keeps the table visible. Tablet/mobile retain the current report-card fallback and open GPS detail as a full-width sheet.

## Data behavior

- Every GPS sample may carry a canonical `jobId`. Samples captured outside a job remain unlinked.
- Each row stores independently sourced GPS-device data, raw Howen FMS payload, normalized FMS coordinates/time/speed when available, pairing state, time delta, and position offset. Neither source is supplied by the Android tablet.
- The report page receives aggregate GPS coverage with its existing paginated query.
- The detail endpoint returns only one authorized job’s paginated samples and aggregate coverage.
