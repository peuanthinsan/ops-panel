# Accessibility audit

Date: 2026-08-25

Target: WCAG 2.2 Level AA for the Next.js dashboard, plus Android accessibility semantics and 48 dp touch targets for the Expo tablet app.

Scope: login and navigation, reports and filters, date picker, GPS details, timeline and job filters, fleet management, print views, the tablet control panel, saved-job reports, confirmation dialogs, vehicle setup, loading/error states, English and Thai labels, keyboard access, screen-reader announcements, contrast, enlarged text, reduced motion, and responsive layouts.

## Implemented changes

### Clear language and recovery

- Renamed the ambiguous **Reset access** action to **Repair tablet connection**.
- The confirmation now explains when to use it and explicitly says that the vehicle binding, device ID, and saved jobs remain unchanged.
- The tablet error screen uses the matching **Tablet connection needs repair** wording and tells the operator what to ask an administrator to do.
- Repeated fleet and report actions include the target device, report, or vehicle in their accessible names.

### Keyboard and focus

- Added a skip-to-content link and route-level focus handoff.
- Added visible keyboard focus styling across links, buttons, inputs, table scroll regions, and timeline controls.
- Date, GPS, and fleet dialogs trap `Tab` / `Shift+Tab`, close with `Escape`, and restore focus to their trigger.
- Searchable comboboxes support Arrow keys, `Home`, `End`, `Enter`, `Escape`, and `Tab` without relying on native selects that cannot scale to the fleet size.
- Timeline filter details close with `Escape` and restore focus to the filter summary.

### Semantics and announcements

- Added modal roles, headings, descriptions, busy states, assertive errors, polite result counts, and explicit English/Thai control labels.
- Added captions and scoped column headers to dashboard, GPS, and print tables.
- Mobile saved-job cards expose one complete TalkBack summary instead of fragmented or duplicated readings.
- The selected, disabled, expanded, checked, and busy states are exposed to assistive technology.
- The document language updates between English and Thai, including print views.

### Timeline and nonvisual equivalents

- Every colored timeline segment is a keyboard-focusable button with activity, status, start/end time including seconds, duration, vehicle, driver, device, GPS count, location, and report ID.
- Hover, keyboard focus, and click expose the same detailed tooltip.
- Timeline rows are named groups and the scrollable timeline has an accessible label.
- Print timelines expose equivalent text while decorative color segments and legend swatches are hidden from screen readers.

### Visual access and responsive use

- Strengthened secondary and warning text colors to pass AA contrast at their rendered sizes.
- Increased small timeline and GPS targets to at least 24 CSS px where WCAG 2.2 permits spacing-based targets, while primary web controls remain 40–44 px high.
- Added reduced-motion handling.
- Removed opacity-only treatment from cancelled mobile timeline entries.
- Verified the dashboard at phone, tablet, and desktop widths.
- Tablet action buttons, language controls, report controls, and close controls use at least 48 dp targets.

### Enlarged mobile text

- The tablet layout detects enlarged system text.
- The nine-job control panel remains a true 3×3 grid in portrait and landscape. At enlarged text sizes, tile padding and internal spacing adapt while job titles and descriptions remain untruncated.
- Titles and descriptions stop truncating, confirmation content scrolls, and compact landscape spacing is disabled.
- Dialog focus moves to the heading and returns to the control that opened it.

## Automated verification

- `node --test tests/accessibility-shortcuts.test.ts tests/accessibility-compliance.test.ts tests/mobile-ui.test.ts tests/dashboard-accessibility.test.ts`: 32 passed.
- `npm run typecheck`: passed.
- `npm run build:web`: passed.
- `git diff --check`: passed.

The focused checks cover modal dismissal and focus restoration wiring, semantic date buttons, target-specific action names, table/print equivalents, contrast tokens, reduced motion, TalkBack focus handoff, 48 dp controls, and the fixed 3×3 enlarged-text grid.

## Rendered verification

- Reports: semantic result list, complete times, searchable filters, date dialog focus restoration, combobox `Home`/`End`, and GPS-dialog `Escape` restoration.
- Timeline: full screen-reader segment detail, pinned status-pill tooltip, completed/cancelled job filters, and filter `Escape` restoration.
- Fleet: responsive table/cards and the non-destructive **Repair tablet connection** confirmation. The repair itself was not activated during testing.
- Responsive views checked at 390 × 844, 1024 × 768, and 1440 × 900.
- Tablet control panel: all nine jobs remained visible in a 3×3 grid in portrait and landscape at 150% Android text size. Both accessibility hierarchies exposed nine complete job labels and descriptions.

Evidence screenshots:

- `/private/tmp/songdee-ops-accessibility-audit/08-timeline-tooltip.jpg`
- `/private/tmp/songdee-ops-accessibility-audit/09-repair-tablet-connection.jpg`
- `/private/tmp/songdee-ops-accessibility-audit/10-fleet-mobile.jpg`
- `/private/tmp/songdee-ops-accessibility-audit/12-reports-tablet-refined.jpg`
- `/private/tmp/songdee-ops-accessibility-audit/20-tablet-150-grid-portrait.png`
- `/private/tmp/songdee-ops-accessibility-audit/21-tablet-150-grid-landscape.png`

## Manual release checks still required

Automated and browser inspection cannot certify every assistive-technology combination. Before declaring formal WCAG conformance, run these release checks:

- Physical Samsung A26 / Android 16 with TalkBack, Switch Access, and a hardware keyboard.
- Android font size and display size at their largest supported settings in portrait and landscape.
- Browser zoom/reflow at 200% and 400%, Windows High Contrast, macOS Increase Contrast, and color inversion.
- English and Thai spoken output with the production data volume and production API error states.

These are validation checks, not known unfixed source defects.
