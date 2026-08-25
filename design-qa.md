# Design QA — Timeline job filters and status pill

**Source visual truth**

- User screenshot: `/var/folders/rg/9whqf0b16kjgfg7xwrp1bn3c0000gn/T/TemporaryItems/NSIRD_screencaptureui_sN88MB/Screenshot 2026-08-25 at 10.15.10 AM.png`
- Source pixels: 546 × 369.
- Target state: English timeline detail tooltip for a completed job. The source showed the status as uncontained green text; the requested change was a compact chip or pill.

**Rendered implementation**

- Focused tooltip capture: `/private/tmp/songdee-timeline-status-pill-crop.jpg`
- Tooltip capture pixels: 356 × 250, cropped from a 1280 × 900 browser viewport at device scale factor 1.
- Desktop filter capture: `/private/tmp/songdee-timeline-filters-final.png` at 1280 × 900.
- Mobile filter capture: `/private/tmp/songdee-timeline-filters-mobile.png` at 390 × 844.
- Normalization: the screenshot and implementation were compared as equivalent tooltip content regions. Absolute pixels differ because the supplied screenshot was captured at a larger browser/display scale; typography, two-column structure, spacing, color, radius, and status treatment were judged at their rendered proportions.

**State and interactions tested**

- Default timeline: all nine job types selected, Completed selected, Cancelled unselected.
- Combined status view: selecting Cancelled while keeping Completed shows both statuses.
- Cancelled-only view: unchecking Completed while keeping Cancelled displayed the single cancelled Refuel record.
- Job-type filtering: clearing all modes and selecting Refuel displayed only that mode.
- Reset restored all nine modes and Completed-only status.
- Print Timeline preserved the selected Refuel + Cancelled-only filters and generated a one-job print summary.
- Desktop and 390 px mobile layouts were rendered; the mobile document width remained equal to the viewport and the filter panel did not create page-level overflow.

**Findings**

- No remaining P0, P1, or P2 visual or interaction findings.
- Fonts and typography: the existing Sarabun hierarchy, optical weights, line heights, and compact tooltip labels remain intact. The status pill uses a smaller 10 px bold label so it reads as metadata rather than competing with the activity title.
- Spacing and layout rhythm: the title and pill share an aligned flex row with an 8 px gap. Tooltip definition-list spacing and the original two-column information structure are preserved. The filter popover uses a three-column desktop grid and two-column mobile grid.
- Colors and visual tokens: Completed uses an accessible dark-green-on-light-green semantic treatment; Cancelled uses dark red on light red. The filter trigger uses existing black, red, grey, and white Songdee tokens.
- Image quality and asset fidelity: this component introduces no new raster, logo, illustration, or icon assets. Existing Songdee brand assets are unchanged.
- Copy and content: all filter, status, job-mode, empty-state, and print behavior is available in English and Thai. The nine job titles come directly from the canonical action list.
- Accessibility: status and mode options use native checkboxes with visible focus treatment; fieldsets and legends group the controls; the filter trigger is a native `details`/`summary`; the timeline buttons retain complete accessible labels and tooltip relationships.

**Comparison evidence**

- The supplied tooltip screenshot and final focused tooltip capture were opened together in one comparison pass.
- The uncontained source status is replaced by a clearly bounded rounded pill while the surrounding activity title, metadata hierarchy, and two-column details remain stable.
- The filter menu had no visual reference image; it was evaluated against the user's requested checkbox behavior, the existing dashboard design system, desktop/mobile captures, and interaction results.

**Comparison history**

1. P2 source issue: Completed appeared as loose text adjacent to the activity title and did not read as a status component.
2. Fix: added a bordered, fully rounded semantic status pill and an aligned tooltip heading row.
3. Requirement expansion: replaced two mutually exclusive cancelled-job buttons with a compact Filter jobs menu containing native status and job-type checkbox chips.
4. Post-fix evidence: completed-only, combined, cancelled-only, single-mode, reset, mobile, and filtered-print states all behaved as intended.

**Implementation checklist**

- [x] Render Completed and Cancelled as semantic pills in timeline tooltips.
- [x] Hide cancelled jobs by default.
- [x] Allow any combination of Completed, Cancelled, and the nine job types.
- [x] Preserve selected filters when printing the timeline.
- [x] Provide English and Thai copy.
- [x] Verify desktop, mobile, keyboard-accessible controls, filtered data, and production build.

**Follow-up polish**

- No P3 follow-up is required for this scoped change.

final result: passed
