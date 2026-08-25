# Design QA — Daily Landscape Vehicle Report

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
- Daily report checked at 2048 × 933 with a fixed 297 × 210 mm A4 landscape sheet.
- The implementation and supplied mockups were opened together for direct comparison at native detail.
- Realistic QA data covered two vehicles, four daily jobs, GPS speed samples, speeding, harsh braking, locations, distance, and signatures.

## State and interactions tested

- Job List range, Timeline day, and Report day are independent controls.
- Changing Job List range to Today updated the summary and Job List while the Timeline stayed on 24 Aug 2026 with its own rows.
- Filling Report date with 24 Aug 2026 and pressing Print report opened `/print/portrait?date=2026-08-24&lang=en`.
- Changing the date inside the print toolbar and pressing View date updated only the daily-report route.
- A Ford T daily report rendered three jobs, 45.5 km, two alerts, and the speed graph derived from twelve GPS samples.
- The Timeline and Job List remain on the same Reports page.
- The Timeline speed graph is drawn over the same time scale as the colored job segments, with a separate path for each saved job so unrecorded gaps are not falsely connected.
- The daily report shows at most eight jobs plus an explicit overflow row so the signature footer remains on one A4 sheet.
- Fresh browser checks produced no console warnings or errors.

## Fidelity review

- Hierarchy matches the supplied report: branded masthead, condensed trip row, four KPIs, trip timeline, alert chips, simplified jobs, and three signature fields.
- The user-requested landscape orientation is intentional; the source mockup hierarchy is preserved within a wider, denser A4 composition.
- Load red, unload navy, stop/wait gold, break/other grey, green completion, and red alerts match the reference semantics.
- The speed line has a white halo so it remains legible over colored timeline bars, plus a direct scale label and accessible point/peak description.
- The report uses `/songdee-gps-pin.svg`, the official pin from the product logo, instead of the earlier lettered report-pin asset.
- Live values intentionally replace the sample names, dates, locations, and metrics shown in the mockup.
- At 390 px, report controls and KPI cards reflow without page-level clipping; the wide timeline stays inside its dedicated horizontal scroll container.

## Comparison history

1. P1: Job List range originally affected data used by the merged Timeline and print action.
2. Fix: the embedded Timeline now owns its day query, while Print report owns a separate daily date.
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

## Verification

- `node --test tests/speed-timeline.test.ts tests/dashboard-accessibility.test.ts` — 12 passed.
- `npm --prefix web run build` — passed.
- `git diff --check` — passed.
- Browser checks: desktop, responsive dashboard, independent date scopes, daily-date route switching, official logo pin, speed overlay, landscape one-page fit, and clean console — passed.

final result: passed
