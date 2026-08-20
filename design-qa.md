# Design QA — Songdee GPS Ops Panel web dashboard

## Result

final result: passed

No actionable P0, P1, or P2 design mismatch remains in the implemented dashboard, fleet administration flow, or print reports.

## Source of truth

- Design handoff: `/Users/peuan/Downloads/design_handoff_songdee_ops_panel/README.md`
- Dashboard reference: `/Users/peuan/Downloads/design_handoff_songdee_ops_panel/Web Dashboard.dc.html`
- A4 portrait reference: `/Users/peuan/Downloads/design_handoff_songdee_ops_panel/Report A4 Portrait.dc.html`
- A4 landscape reference: `/Users/peuan/Downloads/design_handoff_songdee_ops_panel/Report A4 Landscape.dc.html`
- Standalone interaction reference: `/Users/peuan/Downloads/design_handoff_songdee_ops_panel/Songdee Dashboard (Standalone).html`
- Canonical pin asset: `/Users/peuan/songdee-ops-panel/web/public/songdee-gps-pin.svg`

The canonical SVIS pin remains unchanged, as required by the user. The handoff's Thai copy, Sarabun typography, 224 px black sidebar, page padding, red/maroon/grey tokens, table treatment, and print layouts were treated as authoritative. The technician-password card in the reference was intentionally omitted because the user's later requirement explicitly removed technician passwords: first-time binding happens on an unbound tablet, and subsequent changes happen only in Fleet administration.

## Comparison evidence

- Dashboard, source left / implementation right: `design-qa-artifacts/dashboard-source-left-implementation-right.jpg`
- Portrait report, source left / implementation right: `design-qa-artifacts/portrait-source-left-implementation-right.jpg`
- Landscape report, source left / implementation right: `design-qa-artifacts/landscape-source-left-implementation-right.jpg`
- Final dashboard: `design-qa-artifacts/dashboard-final.jpg`
- Responsive mobile state: `design-qa-artifacts/dashboard-mobile-390.jpg`

Desktop comparisons use the same 1280 × 720 browser capture and authenticated Thai state. The source HTML contains dense illustrative fleet data, while the implementation uses the isolated real API fixture. Blank distance, speed, and location values are therefore intentional: the UI does not fabricate unavailable proprietary GPS fields.

## Fidelity review

- Typography: local Sarabun weights 400–800 are used. Heading, eyebrow, KPI, table, helper, and print hierarchy follows the handoff.
- Color: `#E31B23`, `#B3131A`, `#7A1424`, `#06264B`, `#111`, `#68727D`, `#405068`, `#D7DBDF`, `#EEF0F2`, `#F8F9FA`, `#14865B`, and `#B57A00` are used in their prescribed roles.
- Layout: desktop sidebar is 224 px; content padding is 26 px 30 px 60 px. Mobile/tablet navigation and report cards preserve usable touch targets without document-level horizontal overflow.
- Reports table: all 10 handoff columns are present, plus a required actions column for GPS retry and vehicle printing. The table uses the handoff widths and 1080 px minimum width.
- Print: portrait uses two A4 pages; fleet summary uses A4 landscape and paginates only when the fleet exceeds one physical page. Both use the exact pin and live saved jobs.
- Data integrity: unavailable GPS distance, speed, location, and live fleet connectivity remain `—`. Navy driving bars are never inferred from gaps; they appear only if actual driving data exists.

## Interaction and accessibility checks

- Fixed password-only login succeeds; wrong-password handling remains explicit and localized.
- Thai/English switching updates navigation, dashboard, calendar, fleet, settings, and print copy.
- The full calendar supports presets, month navigation, range selection, and a mobile modal layout.
- Search and every parameter filter work together. Header sorting supports Shift-click multi-column sorting with visible numbered precedence up to three keys.
- Timeline renders real jobs from 06:00–19:00 and does not invent driving segments.
- Fleet add, edit, unbind confirmation, search, 10-row pagination, UTF-8 BOM CSV export, and strict CSV import are connected to the API.
- Print report opens the real daily fleet sheet; row-level print opens the two-page vehicle report; both return to the dashboard and expose Print / Save PDF.
- Route navigation resets scroll and moves focus to the main content. Tables, dialogs, inputs, filters, sort direction, status updates, and errors expose accessible labels/roles.
- Browser workflow verification found no application error overlay or failed API request.

## Iteration history

- Fixed an oversized pin in the login/sidebar comparison while preserving the exact source geometry.
- Fixed route-to-route scroll persistence and verified scroll returns to the top.
- Replaced the temporary date inputs with the handoff's full calendar.
- Reconciled exact Thai navigation, report titles, KPI labels, table labels, green token, timeline endpoint, report pagination, and fleet pagination.
- Added multi-column sorting, stationary/high-speed display rules, strict CSV handling, and A4 print routes.
- Compared source and implementation together after the final pass. Remaining visible differences are attributable to real sparse data, extra user-requested filters/actions, and removal of the superseded technician-password flow.

## Verification

- `node --test tests/dashboard-accessibility.test.ts tests/branding.test.ts tests/report-pagination.test.ts tests/report-view.test.ts` — 12/12 passed.
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:4004 npm run build:dashboard` — passed, including `/`, `/admin`, `/timeline`, `/settings`, `/print/portrait`, and `/print/landscape`.

## Dual-GPS release QA — 2026-08-20

### References and method

- Accepted dashboard concept: `/Users/peuan/songdee-ops-panel/design-qa-artifacts/gps-sync-redesign/dashboard-concept.png` (1600 × 1000).
- Accepted job-detail concept: `/Users/peuan/songdee-ops-panel/design-qa-artifacts/gps-sync-redesign/job-gps-detail-concept.png` (1600 × 1000).
- Production desktop capture: `/Users/peuan/songdee-ops-panel/design-qa-artifacts/gps-sync-redesign/dashboard-production-desktop.png` (1600 × 1000).
- Production mobile capture: `/Users/peuan/songdee-ops-panel/design-qa-artifacts/gps-sync-redesign/dashboard-production-mobile.png` (390 × 844).
- Seeded browser captures: `dashboard-browser-desktop.png`, `dashboard-browser-mobile-cards.png`, `job-gps-browser-desktop.png`, and `job-gps-browser-mobile.png` in the same directory.
- Method: authenticated Browser walkthrough against local seeded data and the production Vercel deployment, with desktop and phone viewport inspection, English/Thai switching, modal keyboard dismissal, network observation, and console review.

### Fidelity ledger

- Information architecture: retained Reports, Timeline, Fleet, and Settings; GPS review is embedded in Reports rather than becoming a separate fleet workflow.
- Header and controls: implemented the accepted Operations reports title, source-coverage subtitle, date/search/filter/sort controls, Refresh, and Print report actions. Existing scalable searchable comboboxes remain in place for large fleet datasets.
- Summary hierarchy: implemented Total jobs, Vehicles operating, GPS paired, and Needs attention, followed by the aligned external GPS-device/Howen-FMS coverage rail. An empty fleet displays `0/0`, not a misleading unbound-device message.
- Report rows: added GPS coverage and View GPS while preserving required operational and print actions. Desktop uses the dense table; mobile/tablet use readable report cards without document-level horizontal overflow.
- Detail behavior: implemented a modal right drawer at desktop widths and a full-width sheet on mobile. It shows aggregate counts, source tracks, paginated sample comparison, time delta, position delta, and pair state.
- Visual system: preserved the exact Songdee GPS pin, Sarabun typography, red/black/white/grey shell, 1 px cool-grey borders, restrained radii, and green/amber/red/grey data-state colors from the accepted specification.
- Responsive behavior: verified the production dashboard at 1600 × 1000 and 390 × 844. Controls wrap, cards replace the wide table, and the GPS sheet remains independently usable in both portrait and landscape-capable layouts.
- Copy and localization: all new visible GPS labels and states have English and Thai strings. Backend activity values remain canonical English for filtering and integration.
- Data integrity: concepts use illustrative coverage, while production currently has no fleet records. The production screenshots therefore show the correct empty state; seeded local screenshots verify populated rows and the job-detail interaction without fabricating production data.
- Deliberate deviations: the implementation retains Print vehicle and retry actions required by the existing product, and it shows more source diagnostics in the drawer than the static concept. These additions do not alter the accepted visual hierarchy or core review flow.

### Release verification

- Targeted dashboard, GPS pairing, database, mobile performance, and production-boundary tests — 29/29 passed.
- Expo Android release, GPS outbox, job delivery, and performance tests — 19/19 passed.
- Root TypeScript typecheck — passed.
- Next.js production build — passed.
- Production login, English/Thai dashboard rendering, desktop/mobile layouts, empty state, API requests, and browser console — passed with no application errors.
