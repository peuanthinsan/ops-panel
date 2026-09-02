# Songdee Ops Panel — build conventions

**What this is**: the real UI of a Thai fleet-operations product (web dashboard of the
Songdee Ops Panel). Components are plain React + hand-written CSS. There is **no
utility framework, no CSS variables, no theme provider** — do not invent Tailwind-style
classes or `var(--*)` tokens; they will not resolve.

## Setup
No provider wrapper is needed; every component is self-contained. Two layout contracts:
- `SpeedTimelineOverlay` and `TimelineAlertMarkers` are absolute-positioned overlays —
  mount them inside a positioned, sized track: `<div style={{position:'relative',height:72}}>…</div>`.
- `JobGpsDrawer` is a fixed full-viewport drawer (`.gps-drawer-layer`) — mount at page level.

## Styling idiom
Style your own layout glue with inline styles or your own CSS. Reuse the DS's class
vocabulary (all defined in `styles.css` → `_ds_bundle.css`) when composing its patterns:
`.main` (page workspace), `.page-header` + `.eyebrow` (page title block),
`.section-heading`, `.primary` (Songdee-red button), `.date-input`, `.timeline-toolbar`.

Palette (hardcoded hex — use these exact values):
- Brand: red `#E31B23`, deep red `#7A1424`, ink `#111`, quiet surface `#EEF0F2`
- Greys: muted text `#68727D`, borders `#D7DBDF`, no-data `#9AA2A9`
- States: paired/ok `#14865B`, partial/warn `#B57A00`, failed `#B3131A`
- Data accents: link/focus blue `#087CA7`, speed line `#006F94`

Type: `Sarabun` (shipped, Thai+Latin, weights 400–800), stack
`Sarabun, "Noto Sans Thai", system-ui, sans-serif`. Geometry: 1px `#D7DBDF` borders,
8–10px radii, minimal shadow.

## Component contracts
- Every component takes `lang: 'en' | 'th'` — the product is bilingual; compose Thai
  content with real Thai copy (see each `<Name>.prompt.md` for verified examples).
- Timestamps are Bangkok ISO strings (`2026-08-20T08:30:00+07:00`); `minute` fields are
  Bangkok minute-of-day (0–1440).
- Dashboards (`FleetDashboard`, `FullReportDashboard`, `RoutesDashboard`,
  `SettingsDashboard`, print dashboards) fetch from the app's API at runtime — in a
  design they render their real offline/prompt shells. For a populated timeline use
  `TimelineDashboard` with `sourceReports` (static data injection, no fetch).
- Known artifact: some empty states embed app-served artwork (`/songdee-gps-pin.svg`)
  that is not part of this bundle — a broken-image glyph appears there; do not rely on
  that illustration.

## Where the truth lives
Read `styles.css` and its imports (`_ds_bundle.css` carries all component CSS and the
`@font-face` set; `fonts/` has the woff2 files) before styling. Per-component API is in
`<Name>.d.ts`; usage patterns in `<Name>.prompt.md`.

## Idiomatic example (verified render)
```tsx
import { TimelineDashboard } from 'songdee-ops-panel';

const reports = [{
  id: 'j-9001', vehicleNumber: 'SD-071', driverName: 'สมชาย ใจดี', mode: 'Load',
  status: 'Completed', workPeriodDate: '2026-08-20',
  workPeriodStartTime: '2026-08-20T07:30:00+07:00',
  startTime: '2026-08-20T08:00:00+07:00', endTime: '2026-08-20T09:10:00+07:00',
  locationName: 'คลังสินค้าบางนา', topSpeed: 62,
}];

export default function Page() {
  return <TimelineDashboard lang="th" sourceReports={reports} />;
}
```
Valid `mode` values: Load, Unload, Stop vehicle, Break, Vehicle check, Refuel,
Vehicle wash, Park overnight, Finish work.
