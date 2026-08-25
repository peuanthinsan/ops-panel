# Design QA — Accepted mobile action-grid layout

**Source visual truth**

- User-accepted emulator capture: `/private/tmp/songdee-ops-final-spacing-thai.png`
- Source pixels: 1344 × 2992 at Android density 480 dpi, approximately 448 × 997 dp including system bars.

**Rendered implementation**

- Restored emulator capture: `/private/tmp/songdee-ops-restored-perfect.png`
- Implementation pixels: 1344 × 2992 at Android density 480 dpi, approximately 448 × 997 dp including system bars.
- Side-by-side comparison: `/private/tmp/songdee-ops-accepted-restored-comparison.png`
- Normalization: neither source nor implementation was rescaled before comparison; the equal-size captures were placed side by side.

**State**

- Thai control panel, vehicle `Ford T`, no active or selected job, portrait orientation.
- Primary interaction checked: open the password-protected vehicle dialog, submit the existing `Ford T` binding, return to the action grid, and dismiss the unconfirmed action dialog used during keyboard verification.
- React Native and Android runtime error logs checked after the interaction; no errors were present.

**Findings**

- No remaining P0, P1, or P2 visual findings.
- Fonts and typography: existing product fonts, weights, line heights, wrapping, and hierarchy match the accepted capture.
- Spacing and layout rhythm: number circles use the accepted 45% portrait slot, with the compact title-and-description group directly beneath it. Every circle is horizontally aligned within its row.
- Colors and visual tokens: red, black, grey, and white product tokens are unchanged.
- Image quality and asset fidelity: the Songdee GPS pin remains sharp and unchanged.
- Copy and content: all nine Thai titles and descriptions match the accepted capture.
- The only visible difference in the full comparison is the device status-bar clock.

**Comparison evidence**

- The equal-size full-view comparison includes the complete 3 × 3 action grid, so a separate crop would not reveal additional detail.
- Card boundaries, circle positions, title baselines, description wrapping, and bottom whitespace match between the accepted and restored captures.

**Comparison history**

1. P2: variable text stacks caused circle misalignment between cards in the same row.
2. P2: the first fixed-slot correction aligned the circles but introduced excessive whitespace.
3. The layout was adjusted to a 45% portrait number slot followed by a compact title/description group; the user explicitly accepted this capture as perfect.
4. A later spacing experiment was rejected and reverted exactly.
5. Final side-by-side review found only the status-bar clock difference and no P0, P1, or P2 issue.

**Implementation checklist**

- [x] Restore the exact accepted portrait spacing.
- [x] Keep circles aligned across every row.
- [x] Preserve Thai and English title/description copy.
- [x] Preserve the compact landscape variant.
- [x] Verify no selected or active job remains after QA.

final result: passed
