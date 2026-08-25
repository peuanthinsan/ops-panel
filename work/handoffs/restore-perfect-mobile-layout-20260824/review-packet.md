# Frozen review packet

Review only this packet. Do not use tools and do not modify files.

## Acceptance target

The user explicitly accepted `/private/tmp/songdee-ops-final-spacing-thai.png` as perfect. The implementation must preserve that exact spacing structure:

- portrait number slot: 45% of the action card, bottom-aligned;
- title and description share one compact text group beneath the number;
- portrait text-group top padding: 16;
- title-to-description margin: 8;
- compact-landscape number slot: 38%;
- compact-landscape text-group top padding: 0;
- all circles in a row remain aligned because each card uses the same number-slot percentage;
- Thai and English strings are unchanged.

## Exact scoped implementation

```tsx
<View style={[styles.actionNumberSlot, compactLandscape && compactStyles.actionNumberSlot]}>
  <Text style={[styles.number, readableStyles.number, compactLandscape && compactStyles.number, unavailable && selected !== number && readableStyles.disabledNumber]}>{number}</Text>
</View>
<View style={[styles.actionTextSlot, compactLandscape && compactStyles.actionTextSlot]}>
  <Text numberOfLines={2} style={[styles.actionTitle, readableStyles.actionTitle, compactLandscape && compactStyles.actionTitle, unavailable && selected !== number && readableStyles.disabledText]}>{language === 'en' ? english : thai}</Text>
  <Text numberOfLines={compactLandscape ? 2 : 5} style={[styles.actionSub, readableStyles.actionSub, compactLandscape && compactStyles.actionSub, unavailable && selected !== number && readableStyles.disabledText]}>{language === 'en' ? englishDescription : thaiDescription}</Text>
</View>
```

```ts
action: { flex: 1, minHeight: 0, borderWidth: 1, borderColor: '#D7DBDF', borderRadius: 8, padding: 10 },
actionNumberSlot: { height: '45%', alignItems: 'center', justifyContent: 'flex-end' },
actionTextSlot: { flex: 1, minHeight: 0, width: '100%', alignItems: 'center', paddingTop: 16 },
```

```ts
actionTitle: { fontSize: 18, lineHeight: 24, textAlign: 'center' },
actionSub: { fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 8 },
```

```ts
actionNumberSlot: { height: '38%' },
actionTextSlot: { paddingTop: 0 },
number: { width: 28, height: 28, borderRadius: 14, fontSize: 14 },
actionTitle: { fontSize: 13, lineHeight: 15 },
actionSub: { fontSize: 10, lineHeight: 12, marginTop: 2 },
```

## Exact focused test assertions

```ts
assert.match(source, /<View style=\{\[styles\.actionNumberSlot, compactLandscape && compactStyles\.actionNumberSlot\]\}>/);
assert.match(source, /<View style=\{\[styles\.actionTextSlot, compactLandscape && compactStyles\.actionTextSlot\]\}>/);
assert.match(source, /actionNumberSlot: \{ height: '45%',[^}]*justifyContent: 'flex-end'/);
assert.match(source, /actionTextSlot: \{ flex: 1, minHeight: 0,[^}]*paddingTop: 16/);
assert.match(source, /actionNumberSlot: \{ height: '38%'/);
assert.match(source, /actionSub: \{ fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 8 \}/);
assert.match(source, /numberOfLines=\{compactLandscape \? 2 : 5\}/);
```

## Proof

- `bun test tests/mobile-ui.test.ts`: 16 passed, 0 failed.
- `bun run typecheck`: passed.
- Restored emulator capture: `/private/tmp/songdee-ops-restored-perfect.png`.
- No file edits occurred after this proof was captured.

## Required verdict

Return `PASS` if the supplied artifact faithfully restores the accepted layout and contains no correctness/layout-regression blocker. Otherwise return `BLOCKED` with a concrete P0/P1/P2 finding.

