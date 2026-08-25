# Design QA — Operations Reports and Daily Landscape Vehicle Report

## Findings

- No actionable P0, P1, or P2 visual, responsive, accessibility, or core-interaction findings remain.

## Source visual truth

- Operations Reports reference: `/Users/peuan/Downloads/1787646421080.jpg`.
- English daily-report reference: `/Users/peuan/Downloads/messageImage_1787646317635_0.jpg`.
- Thai daily-report reference: `/Users/peuan/Downloads/messageImage_1787646302844_0.jpg`.
- The GPS JSON screenshot was treated as sample data rather than a layout instruction.

## Rendered implementation

- Merged Reports and Timeline dashboard checked at 2048 × 933.
- Responsive dashboard checked at 390 × 844.
- Daily report checked at 2048 × 933 with fixed 297 × 210 mm A4 landscape sheets.
- Latest dashboard alert capture: `/private/tmp/songdee-alert-dashboard-desktop.png` (2048 × 933 px at device scale 1).
- Latest daily-report capture: `/private/tmp/songdee-print-implementation-full.png` (2048 × 933 px at device scale 1).
- Full-view normalized comparison: `/private/tmp/songdee-alert-full-comparison.png` (2650 × 1000 px). The 1572 × 1348 px source was normalized to 1000 px high; the rendered A4 sheet was cropped from the browser viewport and normalized to the same height.
- Focused timeline comparison: `/private/tmp/songdee-alert-timeline-comparison.png` (2400 × 310 px). Source and implementation timeline regions were cropped, scaled to the same width, padded to the same height, and combined side by side.
- The implementation and supplied mockups were opened together for direct comparison at native detail.
- Realistic QA data covered two vehicles, a 19-job Ford T day, GPS speed samples, speeding, harsh braking, every operation mode, locations, distance, and signatures.

## State and interactions tested

- The dashboard exposes one Date range control for the summary, timeline, and Job List; there are no additional dashboard date inputs.
- Choosing Last 7 days (19–25 Aug 2026) updated all three dashboard surfaces to the same range: 20 KPI jobs, two dated vehicle timeline rows, and 20 Job List records.
- One shared search plus Vehicle, Device, Driver, Activity, Status, and GPS filters now control both the embedded Timeline and Job List.
- All six facets accept multiple values. Browser validation selected both vehicles and both Load and Unload; the KPI total, timeline segments, and Job List all resolved to the same five jobs.
- The shared query sends repeated bounded parameters to both the local and production report APIs, with match-any behavior inside each facet and match-all behavior across facets.
- The embedded Timeline no longer exposes duplicate search or job-filter controls; the standalone Timeline route keeps its independent controls.
- The Sort by dropdown was removed. Clicking Vehicle sorted both Job List rows and timeline groups ascending, then descending; Shift-click still supports up to three table-column sorts.
- GPS coverage and top speed are sortable table columns, and the production report query now returns top speed for display and ordering.
- Multi-day timeline results are grouped by date as well as vehicle and driver, so work from different days is never overlaid in one row.
- Print daily report is available only when exactly one vehicle is selected and opens the range end day with that vehicle in the URL.
- Changing the date inside the print toolbar and pressing View date updated only the daily-report route.
- The print toolbar always preserves the required vehicle constraint when changing dates; the daily report never falls back to an arbitrary fleet vehicle.
- A Ford T daily report rendered all 19 jobs, 75.1 km, two alerts, and the speed graph derived from twelve GPS samples.
- Daily print rows use the same `HH:MM:SS` duration calculation and stored-duration fallback as the dashboard; sub-minute jobs no longer collapse to `00:00`.
- Print start/end values, shift times, alert times, KPI durations, print timestamps, and timeline tick labels use `HH:MM:SS`.
- When GPS exists without a place name, print rows show the available device or FMS coordinates instead of “Location unavailable.”
- The Timeline and Job List remain on the same Reports page.
- The Timeline speed graph is drawn over the same time scale as the colored job segments, with one chronological vehicle/day path connecting every available GPS sample across saved jobs.
- Every GPS sample is drawn as a visible point on the speed line; dashboard points expose the exact time and speed in a pointer, keyboard, or touch popup.
- Speeding and harsh-braking alerts now appear on the web timeline and daily print as red downward arrow icons positioned at the alert event time. The dashboard also shows matching alert chips and a pointer, keyboard, or touch popup with `HH:MM:SS` and alert detail.
- The QA day produced a speeding arrow at the exact 92 km/h GPS peak (`07:45:00`) and a harsh-braking arrow at `09:30:00`; both daily-print arrows and chips used those same times.
- Data-FM history now carries its latest `drivername` and `driverrfid` into blank saved-report driver fields without overwriting tablet-captured identity.
- Reports missing a driver expose the existing retry action even when GPS was already matched, so historical rows can be backfilled through the same reconciliation path.
- Activity tooltips include the job's top speed.
- Dashboard and print legends enumerate all operation modes 1–9 with distinct colors.
- The daily report paginates every job across as many landscape A4 sheets as needed: eight jobs on page one, fourteen per continuation sheet, and signatures only on the final sheet.
- Fresh browser checks produced no console warnings or errors.

## Fidelity review

- Hierarchy matches the supplied report: branded masthead, condensed trip row, four KPIs, trip timeline, alert chips, simplified jobs, and three signature fields.
- The user-requested landscape orientation is intentional; the source mockup hierarchy is preserved within a wider, denser A4 composition.
- The nine operation modes use stable, distinct colors while preserving the reference's red, navy, gold, grey, green, and red-alert semantics.
- The speed line has a white halo so it remains legible over colored timeline bars, a dot for every GPS point, a direct scale label, and accessible point/peak descriptions.
- The filled Phosphor caret markers match the mockup's downward red alert arrows without substituting CSS art, text glyphs, or a handcrafted SVG. Their white drop edge stays legible over the speed graph.
- The report uses `/songdee-gps-pin.svg`, the official pin from the product logo, instead of the earlier lettered report-pin asset.
- Live values intentionally replace the sample names, dates, locations, and metrics shown in the mockup.
- At 390 px, report controls and KPI cards reflow without page-level clipping; the wide timeline stays inside its dedicated horizontal scroll container.
- At 390 px, all six shared multi-selects stack cleanly and the Job List switches to cards; at desktop widths, the sortable table keeps readable column widths and contains every row action.

## Comparison history

1. P1: Job List range originally affected data used by the merged Timeline and print action.
2. Interim fix: the scopes were separated, which clarified data ownership but exposed too many date controls on the merged page.
3. P1: Print report could represent an all-time or range result.
4. Fix: the print route always carries one validated `date` and the print page exposes its own daily date picker.
5. P1: the timeline showed activity segments without point-in-time speed.
6. Fix: paginated GPS samples are normalized to Bangkok time and overlaid as an SVG speed series on dashboard and print timelines.
7. P2: the daily report used portrait dimensions after landscape was requested.
8. Fix: print CSS now uses `@page { size: A4 landscape; }` and a fixed 297 × 210 mm sheet.
9. P2: the report masthead used a separate pin containing an “S”.
10. Fix: all daily-report masthead and loading states now use the official Songdee GPS pin.
11. P2: automated native date entry could update the visible input without reaching React state before the action click.
12. Fix: print actions read the actual date input value at click time, while normal controlled input behavior remains intact.
13. P1: a long daily report replaced jobs after the eighth row with an “additional jobs” dashboard reference.
14. Fix: all jobs now flow onto numbered continuation sheets, with repeated report identity and signatures on the final sheet only.
15. P1: speed was only a path and could not expose individual point values.
16. Fix: every GPS sample now has a visible dot and exact speed popup; job tooltips also expose top speed.
17. P2: the legend grouped operation types and did not enumerate modes 1–9.
18. Fix: dashboard and print legends now show every numbered operation mode with its own color.
19. P1: the merged dashboard exposed separate Job List range, report date, and timeline date controls.
20. Fix: one dashboard Date now drives the summary, timeline, Job List, and Print daily report; the print view keeps its own date chooser.
21. P1: consolidating to a single dashboard day removed the Job List's useful multi-day browsing.
22. Fix: the one dashboard control is now a Date range shared by KPIs, dated per-vehicle timeline rows, and the Job List; Print daily report still sends only the range end date.
23. P1: Timeline and Job List had separate search/filter behavior, and each facet accepted only one value.
24. Fix: a shared filter model now carries repeated Vehicle, Device, Driver, Activity, Status, and GPS values into both surfaces.
25. P2: a Sort by dropdown duplicated table sorting and did not make the Timeline order follow the Job List.
26. Fix: sorting now lives in the table headers, including GPS and top speed, and the embedded Timeline consumes the same ordered query.
27. P2: exposing sortable columns at normal desktop widths initially compressed the right side of the table.
28. Fix: the table now uses a bounded horizontal layout with explicit location/action widths and wrapped actions, while mobile keeps its card layout.
29. P1: the daily print table removed seconds from durations, turning a nonzero sub-minute duration such as `00:00:08` into `00:00`; it also discarded GPS coordinates when no place name existed.
30. Fix: print uses the shared duration formatter without truncation and falls back from place name to device coordinates, FMS coordinates, then the unavailable label.
31. P1: Print daily report could open without a selected vehicle, causing the print view to choose the first available fleet vehicle.
32. Fix: the toolbar requires exactly one selected vehicle, row actions carry their row vehicle and date, and the print route refuses a missing vehicle instead of falling back.
33. P1: each saved job owned a separate speed path, so jobs with one GPS sample rendered only a dot and visually appeared to have no line graph.
34. Fix: all samples for one vehicle/day are merged chronologically into one SVG path while retaining every dot and exact time/speed tooltip.
35. P1: Data-FM returned `drivername` and `driverrfid`, but GPS reconciliation discarded them before updating a completed report.
36. Fix: the adapter exposes driver identity with history, and both local and production reconciliation fill only previously blank report driver fields.
37. P1: the web timeline did not render alerts, and daily-print flags were placed at each job's start rather than the underlying alert event time.
38. Fix: one shared alert derivation layer now uses exact GPS peaks, timestamped stored events, and legacy report fallbacks; both dashboard and print render the same event-timed arrows and chips.
39. P2: the first browser interaction pass found that clicking a marker after pointer hover toggled the alert popup closed.
40. Fix: marker state now distinguishes transient hover/focus from a pinned click. The post-fix click exposed `Speeding (92 km/h)` and `07:45:00`, with `aria-expanded="true"`.

## Verification

- `node --test tests/report-query.test.mjs tests/local-report-query.test.mjs tests/report-filter.test.ts tests/dashboard-accessibility.test.ts tests/report-print-pages.test.ts tests/speed-timeline.test.ts` — 25 passed.
- `node --test tests/report-view.test.ts tests/report-print-view.test.ts tests/dashboard-accessibility.test.ts tests/report-print-pages.test.ts` — 22 passed.
- `node --test tests/dashboard-accessibility.test.ts tests/accessibility-compliance.test.ts tests/report-print-pages.test.ts tests/report-print-view.test.ts tests/report-view.test.ts` — 28 passed.
- `npm --prefix web run build` — passed.
- `git diff --check` — passed.
- `node --test tests/speed-timeline.test.ts tests/data-fm-gps.test.mjs tests/dashboard-accessibility.test.ts tests/production-api-boundary.test.ts` — 34 passed.
- Live Data-FM contract check: the documented 20 Aug 2026 history window returned two GPS records with both driver-name and RFID fields; credentials, token, and driver PII were not logged.
- Browser checks: 2048 × 1100 and 390 × 844 dashboard layouts; one shared search; all six listboxes marked multi-select; simultaneous Vehicle and Activity selections; synchronized KPI, Timeline, and Job List results; table-column ascending/descending order propagated to Timeline groups; no Sort by dropdown; no duplicate embedded Timeline search; no page-level mobile overflow; no console warnings or errors — passed.
- Browser print check: 24 Aug Ford T rows retained seconds in start, end, and duration; shift, KPI, alert, print, and axis times rendered with seconds; no framework overlay or console warnings/errors — passed.
- Browser speed check: Ford T rendered one 12-point path with 11 connected line segments on dashboard and print; the 92 km/h point exposed its `07:45:00` tooltip; both legends retained operation modes 1–9 — passed.
- Browser vehicle-scope check: zero or multiple vehicle selections disabled Print daily report; one Ford T selection opened a Ford-only 19-job report; the 700-4172 row action opened only its one-job report; date changes preserved the vehicle query; a vehicle-less URL showed Vehicle required; mobile controls did not clip — passed.
- `node --test tests/timeline-alerts.test.ts tests/speed-timeline.test.ts tests/dashboard-accessibility.test.ts` — 18 passed.
- Browser alert check: 24 Aug rendered two Ford T arrow buttons and two matching chips on the dashboard; the speeding marker popup exposed `07:45:00` and `92 km/h`; the daily print showed the same two decorative arrows and exact-time chips; no console warnings or errors — passed.
- Responsive alert check: 390 × 844 had no page-level horizontal overflow; the timeline remained horizontally scrollable and both arrows stayed aligned with the speed graph — passed.
- Full-view and focused side-by-side comparisons verified typography hierarchy, section rhythm, red/navy/neutral tokens, official logo asset quality, alert copy, and the mockup's arrow/chip treatment. Live data, landscape orientation, the 1–9 legend, speed overlay, and job continuation are intentional deviations — passed.

final result: passed
