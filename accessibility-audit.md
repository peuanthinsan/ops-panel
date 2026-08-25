# Accessibility and power-user audit

Date: 2026-08-25

Scope: web reports date picker, web GPS detail drawer, web fleet confirmation dialog, mobile job confirmation, mobile vehicle-admin dialog, and the main keyboard paths.

## Findings and fixes

1. Web date picker — fixed. It now closes from the outside scrim or `Escape`, traps `Tab`/`Shift+Tab` inside the dialog, announces itself as a modal dialog, and restores focus to the date-range trigger when closed.
2. Web GPS detail drawer — already covered. It closes from the scrim or `Escape`, traps keyboard focus, prevents background scrolling, and restores focus to the triggering control.
3. Web fleet confirmation dialog — already covered. It closes from an outside click or `Escape`, traps focus, and restores focus to the action that opened it.
4. Mobile job confirmation — fixed. Tapping outside the card dismisses the confirmation when it is not saving; Android back and screen-reader escape continue to dismiss it. The existing focus handoff to the modal heading and focus restoration remain in place.
5. Mobile vehicle-admin dialog — fixed. Tapping outside the card, Android back, and screen-reader escape dismiss it when it is not changing the vehicle.

## Power-user shortcuts

- `Escape`: close the active web date picker, GPS drawer, or fleet dialog.
- `Tab` / `Shift+Tab`: cycle only through controls in the active web dialog.
- Outside click/tap: close non-saving dialogs without requiring a precise close button.
- `Enter`: submit the dashboard password and mobile vehicle change form from their inputs.
- Screen-reader escape/back: dismiss mobile dialogs through the platform accessibility action.

## Verification

- `node --test tests/accessibility-shortcuts.test.ts`: 2 passed.
- `node --test tests/mobile-ui.test.ts tests/dashboard-accessibility.test.ts`: 25 passed.
- `npm run typecheck`: passed.
- `npm run build:web`: passed.

The repository-level checks verify the interaction contracts and source wiring. A device-level screen-reader audit still requires running the APK on Android with TalkBack and testing a physical keyboard or emulator keyboard.
