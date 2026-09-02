# Design QA — Job GPS Drawer Redesign

## Result

- No actionable P0, P1, or P2 visual, responsive, accessibility, or core-interaction findings remain.
- The default drawer fits a single 1280 × 832 viewport and a 390 × 844 phone viewport without internal or page-level scrolling.
- The route editor and raw GPS table remain available as deliberate disclosures; opening either may introduce bounded internal scrolling on short screens.

## Source visual truth

- User reference: `/Users/peuan/.codex/attachments/b3cda9f9-890e-4533-9d8f-dcb2620e9116/image-1.png`.
- Source dimensions: 2560 × 1664 device pixels, representing a 1280 × 832 CSS-pixel viewport at device scale 2.
- Normalized source used for comparison: `/private/tmp/songdee-job-drawer-reference-normalized.png`, resized to 1280 × 832.
- The second supplied image showed the Codex prompt rather than an additional product state, so it was not treated as visual design truth.

## Rendered implementation

- Desktop capture: `/private/tmp/songdee-job-drawer-final.png` at 1280 × 832, device scale 1.
- Mobile capture: `/private/tmp/songdee-job-drawer-mobile-final.png` at 390 × 844, device scale 1.
- Route-edit capture from the iteration pass: `/private/tmp/songdee-job-drawer-edit-qa-1.png` at 1280 × 832.
- Browser route: `http://localhost:5173/` using an isolated temporary report, route, and GPS fixture.
- The normalized reference and final desktop capture were opened together in the same comparison input at matching CSS-pixel dimensions.

## Full-view comparison

- The drawer retains the established Songdee red, white, neutral, typography, border, and radius system.
- The assigned-route area is reduced from an always-visible selector and scope form to a 52 px summary row. This restores map area and removes the main source of vertical crowding.
- GPS detail is condensed into a proportional two-value rail aligned with the section title.
- The route map becomes the dominant content area and expands to fill the drawer's remaining height instead of using a short fixed map.
- Route status remains directly under the map, and the two raw GPS records move behind a compact disclosure.
- The print action remains in a fixed footer, so it is always reachable without competing with the map.
- The local capture shows the coordinate fallback because no `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is configured. The live Google map keeps the same map slot and uses the new custom controls.

## Map-control review

- Google default UI is disabled, including its map-type, zoom, fullscreen, street-view, rotate, and scale controls.
- The replacement control system provides Road/Satellite, zoom in, zoom out, fit entire route, and fullscreen when the browser supports it.
- Desktop buttons are 34 px with restrained 16 px Phosphor icons; coarse-pointer devices promote them to 44 px targets.
- Controls use Songdee surface, border, radius, shadow, focus, hover, and active-state tokens rather than Google's default chrome.
- English and Thai accessible labels are present, and the map-type pair reports pressed state.
- P3 environment limitation: the live custom-control overlay could not be rendered against Google locally without a browser key. Source assertions, the optimized build, and the coordinate-fallback render all passed.

## Interaction and responsive checks

- Route editing is hidden by default and exposes its selector only after `Edit route` is activated.
- The selector searches on the server, requests 50 routes at a time, and exposes an explicit `Show 50 more` action. Operators can browse through 1,000+ routes without mounting the entire collection in the drawer.
- Search ranking keeps exact names first, then prefix matches, then substring matches; pagination preserves that ordering across both local and production APIs.
- Option rows accept an optional secondary `companyName` label, so the compact list can distinguish company context when tenant-aware route data is introduced.
- Selecting a route stages the value; no API update happens until the explicit `Apply route` action.
- The safer default scope is `This job`; applying to the entire work period requires an explicit second choice.
- Cancel restores the current saved route and collapses the editor.
- The full route-selection and Apply flow was exercised with `R22-Alternate`, confirmed in the drawer, and restored to `R21-Test` in the isolated fixture.
- `Show GPS points` exposes both recorded rows and collapses back to the one-page state.
- The dialog retains Escape-to-close, scrim close, focus trapping, focus restoration, semantic disclosure state, and a labelled modal.
- At 390 × 844, the drawer, header, scroll region, footer, title, and close button all remain inside the 390 px viewport; document scroll width is also 390 px.
- At 1280 × 832, the drawer measured 680 × 832, its content region measured 679 × 714, and `scrollHeight === clientHeight` and `scrollWidth === clientWidth`.
- No framework error overlay, console warning, or console error was present in the final browser pass.

## Comparison history

1. P1: route selection and “Apply route to” permanently occupied the drawer before an edit was intended.
2. Fix: replaced the form with an assigned-route disclosure and a staged, explicit Cancel/Apply editor.
3. P1: route changes committed immediately from the selector, making the work-period option too easy to apply accidentally.
4. Fix: changed the default to the current job and moved persistence behind `Apply route`.
5. P1: fixed-height content and the always-open GPS table made the primary state exceed one viewport.
6. Fix: converted the content column to a bounded flex layout, let the map consume remaining space, and placed GPS rows behind a disclosure.
7. P2: the map used oversized native Google controls that did not match the product's proportions.
8. Fix: disabled native UI and added a compact, branded control cluster with touch-safe responsive sizing.
9. P2: the 390 px pass exposed a 22.7 px intrinsic grid overflow that clipped the close action.
10. Fix: constrained the drawer's grid track to `minmax(0, 1fr)`, capped it at the viewport, and allowed the header title group to shrink and ellipsize.
11. P1: an unbounded route list would become unusable when a company has hundreds of routes or multiple companies share the product.
12. Fix: added server-ranked search plus bounded offset pagination, a progressive `Show 50 more` path, and optional company context in each option row.

## Verification

- `node --test tests/route-dashboard.test.mjs` — 10 passed.
- `node --test --test-name-pattern='job GPS detail is an accessible, cancellable GPS modal' tests/dashboard-accessibility.test.ts` — 1 passed.
- `node --test --test-name-pattern='route options page through more than 1,000 ranked search results' tests/route-server-contract.test.ts` — 1 passed with 1,009 active routes.
- `npm --prefix web run build` — passed.
- `git diff --check` — passed.
- Browser page identity, nonblank render, error-overlay absence, console health, one-page fit, mobile bounds, editor disclosure, safer scope, Cancel, Apply, and GPS disclosure checks — passed.
- Final normalized visual comparison at 1280 × 832 and mobile review at 390 × 844 — passed.

final result: passed
