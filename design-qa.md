# Design QA — Merged Reports, Timeline, and A4 Print Report

## Findings

- No actionable P0, P1, or P2 visual, responsive, accessibility, or core-interaction findings remain.

## Source visual truth

- Operations Reports reference: `/Users/peuan/Downloads/1787646421080.jpg` (2850 × 1244).
- English A4 report reference: `/Users/peuan/Downloads/messageImage_1787646317635_0.jpg` (1572 × 1348).
- Thai A4 report reference: `/Users/peuan/Downloads/messageImage_1787646302844_0.jpg` (1558 × 1428).
- The GPS JSON screenshot was treated as example data, not as a design instruction.

## Rendered implementation

- Desktop merged page: `/private/tmp/songdee-merged-reports-desktop-2048x894.png` at a 2048 × 894 viewport.
- Mobile merged page: `/private/tmp/songdee-merged-reports-mobile-final.png` at a 390 × 844 viewport; full-page capture is 390 × 4755 with no page-level horizontal overflow.
- A4 report: `/private/tmp/songdee-merged-print-report-final.png` at a 1440 × 1000 viewport; the rendered sheet is 793.69 × 1122.52 CSS pixels, equivalent to 210 × 297 mm.
- Combined desktop comparison: `/private/tmp/songdee-dashboard-comparison-final.png` (reference left, implementation right).
- Combined print comparison: `/private/tmp/songdee-print-comparison-final.png` (reference left, implementation right).
- Browser captures used device pixel ratio 1. The dashboard source was proportionally normalized from 2850 × 1244 to 2048 × 894 to match the implementation viewport. For the print comparison, the 1572 × 1348 source stayed native while the 1440 × 1263 full-page implementation capture was proportionally fitted and white-padded inside an equal 1572 × 1348 frame.

## Comparison evidence

- Full view: the normalized dashboard comparison verifies the retained sidebar/header/KPI structure and the intentional insertion of the per-vehicle timeline directly above Job list. The normalized print comparison verifies the shared masthead, trip-info row, four-card KPI band, timeline, simplified table, and signature footer hierarchy.
- Focused view: no extra crop was needed because the A4 sheet is already the focused workflow target. The source and final A4 implementation were also opened directly at native resolution after the combined comparison, where logo sharpness, condensed typography, legend colors, job pills, table rules, and signature lines were legible.

## State and interactions tested

- English dashboard using the locally cached five-job audit set: two vehicles, four jobs with GPS, one job needing attention.
- Reports contains KPI cards, the per-vehicle timeline, and the saved-job list in that order.
- Sidebar contains Reports, Fleet, and Settings only; the Reports label includes “Jobs & timeline”.
- The legacy `/timeline` URL resolves to the merged Operations reports page with both timeline and Job list present.
- Timeline filter interaction was exercised: enabling Cancelled increased rendered segments from four to five, and disabling it restored the default completed-only state.
- The header Print report action opened `/print/portrait` for a visible vehicle and date. Per-vehicle print actions use the same portrait route.
- The portrait report rendered five trip-info cells, four KPI cards, four timeline segments, four job rows, and three signature fields. Alert flags remain data-driven.
- Fresh browser tabs produced no console warnings or errors on either the dashboard or portrait print route.

## Fidelity review

- Typography: preserves the existing Sarabun/Arial Songdee hierarchy and the condensed navy masthead typography from the mockup.
- Layout and spacing: the timeline now sits between KPIs and Job list on the main page. The print page uses the mockup sequence—masthead, condensed trip row, KPIs, timeline, simplified jobs, signatures—and remains one fixed A4 portrait sheet.
- Colors: load red, unload navy, stop/wait gold, break/other grey, green completion state, and red alert treatment match the reference semantics. Timeline bars, legends, and print job pills use the same mapping.
- Assets: the existing Songdee logo and report-pin assets are reused at their native aspect ratios; no placeholder imagery or approximate logo was introduced.
- Copy: English and Thai report labels remain available. Live record values intentionally replace the sample names, dates, locations, alerts, and KPIs shown in the mockups.
- Responsive behavior: the merged page becomes a single-column flow at 390 px, saved-job cards render fully, and the timeline remains horizontally scrollable inside its own container.
- Accessibility: route changes still move focus to main content without showing a misleading programmatic focus border; keyboard-triggered focus styles remain available after blur. Native timeline checkboxes and existing labeled report filters are preserved.

## Comparison history

1. P1: Reports and Timeline were separate destinations, so the requested combined workflow was not visible from Reports.
2. Fix: embedded the real timeline into Reports, removed the duplicate Timeline navigation item, and kept `/timeline` as a compatible alias to the merged page.
3. P1: the main Print report action could fall back to the older landscape summary.
4. Fix: the header and per-vehicle print actions now consistently open the screenshot-matched portrait vehicle report.
5. P2: mobile full-page rendering skipped off-screen saved-job card contents because of `content-visibility`.
6. Fix: removed that optimization and confirmed all five cards render at 390 px without overflow.
7. P2: timeline segment and non-load job-pill colors did not match the reference legend.
8. Fix: unified dashboard and print colors to red, navy, gold, and grey; preserved one-page A4 sizing.
9. P3: the report logo emitted an aspect-ratio warning and route focus displayed a persistent red page outline.
10. Fix: preserved the logo ratio and suppressed only the programmatic route-focus outline. Fresh browser-console checks are clean.

## Intentional differences

- The reference dashboard shows a separate Timeline sidebar item; it is intentionally removed because the requested final information architecture combines Timeline with Reports.
- The browser preview shows an Offline mode banner because it is using the app’s cached audit data. This is an environmental state, not part of the print layout.
- The cached vehicle records contain no report-level distance or alert events, so the verified print preview shows an em dash for distance and zero alert flags. The report still renders distance, speeding, and harsh-braking data when supplied.

## Open questions

- None blocking. Live data will determine whether distance and alert values are populated on a given vehicle-day report.

## Implementation checklist

- [x] Merge saved jobs and the per-vehicle timeline under Reports.
- [x] Remove duplicate Timeline navigation while preserving the legacy URL.
- [x] Route header and vehicle print actions to the one-page portrait report.
- [x] Match the mockup hierarchy, semantic colors, bilingual copy, and signature footer.
- [x] Verify desktop, mobile, filter interaction, A4 sizing, console output, focused tests, and production build.

## Follow-up polish

- No P3 visual follow-up is required for this scope.

## Verification

- `node --test tests/dashboard-accessibility.test.ts` — 9 passed.
- `node --test tests/timeline-cancelled-filter.test.ts tests/timeline-position.test.ts` — 6 passed.
- `npm --prefix web run build` — passed.
- Browser checks: desktop, mobile, legacy route, timeline filters, portrait print, A4 dimensions, and clean console — passed.

final result: passed
