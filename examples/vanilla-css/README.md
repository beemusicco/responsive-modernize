# Example: vanilla CSS site → Utopia fluid migration

Plain HTML + CSS site with hardcoded px font-sizes, no meta viewport, fixed-width container that overflows mobile.

## Before

`before/index.html` + `before/styles.css` — the typical "responsive in name only" landing page.

Anti-patterns:
- Missing `<meta viewport>` → renders 980px on mobile then scales down
- 8 hardcoded `font-size: NNpx` declarations (10-32px) → no fluid scale
- 14 hardcoded spacing values → no rhythm tokens
- `.huge { width: 1600px; }` → horizontal scroll on every viewport <1600
- Fixed bottom bar with `bottom: 0` → iPhone home indicator overlap
- Animation without `prefers-reduced-motion` guard

## Audit

```bash
cd examples/vanilla-css
cp before/* .
echo '{"target":{},"framework":"static"}' > .responsive-modernize.json
node ../../run.mjs --yes
```

## After

`after/` is the post-`--yes` result. Verify:

```bash
diff before/styles.css after/styles.css
# Expect: --step-* + --space-* tokens injected,
# all font-sizes migrated to var(--step-X),
# all spacings to var(--space-X),
# 1600px → min(100%, 1600px),
# safe-area-inset wrap on .fixed-bar,
# reduced-motion guard appended,
# button/input/select font normalize injected
```

Plus `<meta viewport>` injected into `index.html`.

Final state: 0 runtime issues (scan + diagnose), Lighthouse mobile score boost, CLS predictor cleared.
