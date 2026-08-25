# Hybrid handoff: restore the accepted mobile action layout

## Objective

Restore and preserve the exact mobile action-card layout that the user explicitly called “perfect” immediately before the latest experimental spacing change.

## Ownership and routing

- Active root: Codex Desktop (model/effort surface receipt: `UNKNOWN`; this runtime does not expose `/status`).
- Writer lease: active Codex root only.
- Delegated provider: Claude read-only opposite-provider review.
- Requested review lane: `hybrid-fable-reviewer`, Fable/high, plan permission mode.
- Base ref: `25344d7f4157bbd93bc17c5963c1fe70e11f25ce` on local `main`.
- Git, integration, deployment: out of scope for this correction.

## Allowed implementation paths

- `app/index.tsx`
- `tests/mobile-ui.test.ts`

## Evidence

- User-accepted implementation capture: `/private/tmp/songdee-ops-final-spacing-thai.png`
- User feedback after that capture: “it was perfect just a minute ago”.
- The accepted implementation uses a 45% portrait number slot, a compact title/description group below it, an 8px title-to-description gap, and a 38% compact-landscape number slot.

## Acceptance criteria

1. Restore the user-accepted 8:23 PM layout exactly; do not reinterpret spacing.
2. Number circles remain horizontally aligned within each row.
3. Title and description remain grouped beneath the number.
4. Thai and English copy remain unchanged.
5. Compact landscape remains supported.
6. `bun test tests/mobile-ui.test.ts` and `bun run typecheck` pass.
7. Opposite-provider review finds no correctness or layout-regression blocker in the scoped implementation.

## Permissions

- Reviewer is read-only: do not edit, stage, commit, merge, push, deploy, synchronize `main`, or alter git state.
- Existing dirty-worktree changes belong to the user and must be preserved.

