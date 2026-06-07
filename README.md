# responsive-modernize

> Multi-viewport responsive audit + automatic modernization for any web stack.

[![npm version](https://img.shields.io/npm/v/responsive-modernize.svg)](https://www.npmjs.com/package/responsive-modernize)
[![npm downloads](https://img.shields.io/npm/dw/responsive-modernize.svg)](https://www.npmjs.com/package/responsive-modernize)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![Status](https://img.shields.io/badge/status-alpha-orange.svg)](https://github.com/beemusicco/responsive-modernize/blob/main/CHANGELOG.md)
[![GitHub stars](https://img.shields.io/github/stars/beemusicco/responsive-modernize?style=social)](https://github.com/beemusicco/responsive-modernize/stargazers)

## ⚠️ ALPHA — research-grade tool, expect bugs

This tool **rewrites your source files**. Seven adversarial multi-agent code reviews (Opus + GPT-5.5 + Sonnet, sparring mode) found **46+ real bugs** over 1.13.0 → 1.14.4 — and the bug-finding rate **has NOT plateaued** (round-7 found 10, highest yet). Empirically, expect another 4-10 bugs in the next review round.

**What this means for you**:
- ✅ **Safe to use**: detect / dry-run / audit modes. `responsive-modernize` (no flags) only reads + reports.
- ⚠️ **Use with backup**: `--yes` (apply codemods). Atomic backup created automatically in `.responsive-modernize/backup/`, but git-commit first anyway.
- ❌ **Do NOT run in CI without manual review**: codemod output may need adjustment for your specific framework / file shape. Treat as a productivity boost, not a "trust and merge" tool.
- 🔒 **Layout codemods are opt-in** (`--enable-layout-codemods`) by default because past reviews caught structural bugs in this exact path.

When this README replaces "ALPHA" with "BETA", it means a review round found 0 new bugs. Currently rounds find 4-10 each. Track at [CHANGELOG.md](./CHANGELOG.md).

---

`responsive-modernize` is a CLI that detects responsive anti-patterns across your site (multi-viewport, multi-engine), proposes ranked fixes, applies safe codemods atomically with backup, verifies via pixel-match + re-diagnose, and ships a client-ready report. When residuals remain that need semantic JSX understanding, it can escalate to an LLM agent automatically.

```
phase 1 scan       CSS + HTML + SFC + CSS-in-JS + SCSS + Vanilla Extract AST
phase 2 baseline   Playwright multi-viewport × multi-engine screenshots
phase 3 diagnose   per-viewport runtime checks (overflow, touch, fonts, …)
phase 4 propose    ranked plan + Utopia codemod kit
phase 5 apply      atomic backup + 14 auto-fix handlers
                   ↳ iterative loop (3×) — converge on 0 auto-fixable
phase 6 verify     re-baseline + pixelmatch + re-diagnose
phase 7 report     REPORT.html + sprites + REPORT.md
phase 8 escalate   ESCALATION-BRIEF.md + [RM-ESCALATE] marker
                   ↳ --auto-impeccable: spawn `claude` CLI subprocess
```

> **Quickstart**: [USAGE.md](./USAGE.md) (English) · [UPORABA.md](./UPORABA.md) (Slovenian)

---

## Honest positioning (transparent disclosure)

**This tool IS**:
- A maintained MIT alternative in the px-to-rem / px-to-viewport / responsive-codemod sub-niche, dominated today by abandonware (`postcss-pxtorem` stalled Jan 2024 / 202k weekly DLs / classified "Inactive", `postcss-px-to-viewport` last release July 2019 / 7yr stale, `skovy/css-codemod` dead since Feb 2022)
- A codemod + audit + iterate loop integrating scan → diagnose → auto-fix → verify in one CLI — a workflow that today requires gluing 4+ separate tools (`design-auditor` + `jscodeshift` + `axe-core` + `BackstopJS` + `Lighthouse CI`)
- A Playwright-based runtime auditor with the same technical approach as `design-auditor` (PashaSchool, MIT) plus auto-fix codemods + Core Web Vitals that audit-only tools don't ship

**This tool IS NOT** (verified via 106-agent deep adversarial research, claims refuted 0-3):
- ❌ A **unique** unified pipeline — the components all exist separately as established tools; this just integrates them
- ❌ A **$0 cost differentiator** — `design-auditor`, `Lighthouse`, `Playwright`, `axe-core`, `BackstopJS` are also $0 MIT/Apache
- ❌ A **Fortune-500 / enterprise SaaS replacement** — no SLA, no SOC2/GDPR docs, no support contract, no community trust signals yet, no AI-powered visual diffing dashboard like Percy Visual Review Agent (Oct 2025) / Applitools Eyes 10.22 (Jan 2026) / TestMu Smart Ignore set as the 2026 paid-SaaS baseline

**Best fit**: solo developers + small agencies who want one CLI for the responsive codemod + audit + iterate loop without managing 4 separate tools. Codemods and runtime checks are atomic and idempotent. The visual-diff gap vs Percy/Applitools is partially closed by `--ai-diff` (LLM-judge over pixelmatch diffs to filter intended improvements).

See [Comparison with related tools](#comparison-with-related-tools) below for the verified head-to-head matrix.

---

## Comparison with related tools

Verified against primary sources via 106-agent adversarial research (2026-06-07). Cells marked ✅ are independently confirmed, ⚠️ partial, ❌ missing.

| Feature | responsive-modernize | design-auditor | Lighthouse CI | axe-core | BackstopJS | Percy / Applitools | postcss-pxtorem | polypane |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Runtime audit (Playwright) | ✅ | ✅ | ✅ | ✅ (engine) | ✅ | ✅ | ❌ | ✅ |
| Auto-fix codemods | ✅ 24 | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ px-only | ⚠️ clipboard suggest |
| Core Web Vitals (LCP/INP/CLS) | ✅ | ❌ | ✅ | ❌ | ❌ | ⚠️ | ❌ | ⚠️ |
| WCAG (contrast, focus, target) | ✅ 17 checks | ⚠️ | ⚠️ axe-subset | ✅ canonical | ❌ | ⚠️ | ❌ | ✅ 80+ |
| Multi-stack file types | ✅ 13 | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ CSS | ❌ |
| AI-powered visual diff | ✅ v1.13 | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Web dashboard / team review | ❌ | ❌ | ⚠️ | ⚠️ | ⚠️ HTML | ✅ | ❌ | ❌ |
| CI/CD GitHub Actions integration | ✅ v1.13 | ⚠️ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| MIT / Apache OSS | ✅ | ✅ | ✅ Apache | ✅ MPL | ✅ | ❌ SaaS | ✅ (abandonware) | ❌ paid |
| Cost | $0 + optional Claude OAuth | $0 | $0 | $0 | $0 | $$$$ | $0 | $9/user/mo |
| Maintenance status | ⚠️ new (June 2026) | ✅ | ✅ | ✅ | ✅ (since 2014) | ✅ | ❌ stalled Jan 2024 | ✅ |
| Community trust (stars/DLs) | ⚠️ new | 🆕 | ✅ Google | ✅ 4B+ DLs | ✅ 7.1k★ | ✅ enterprise | ⚠️ 202k/wk DLs | ✅ |

**Honest take**: this tool wins on the auto-fix codemod axis + multi-stack detection + CWV+a11y+visual-diff bundled in one CLI. It loses on community trust, dashboard, and feature breadth vs paid SaaS. Compare its narrow strength axis against your actual workflow before adopting.

---

## CI/CD example (GitHub Actions)

```yaml
# .github/workflows/responsive-modernize.yml
name: responsive-modernize audit

on: pull_request

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm install -g pnpm && pnpm install
      - run: npx playwright install chromium --with-deps
      - run: npm run build && npm run start &
      - run: sleep 5
      - run: node /path/to/responsive-modernize/run.mjs --yes --json-output > audit.json
      - name: Fail on regressions
        run: |
          jq -e '.regressions == 0' audit.json || exit 1
      - uses: actions/upload-artifact@v4
        with:
          name: responsive-audit
          path: .responsive-modernize/REPORT.html
```

Exit codes: `0` (clean), `1` (regressions), `42` (port collision), `43` (infrastructure down).

JSON schema: `{version, residuals, regressions, applied, skipped, phases}` — see `examples/ci-output.json`.

---

## Why?

Most "responsive" sites pass visual inspection on the dev's monitor and break on a 360-px Android. Existing tools either audit-only (Lighthouse, axe) or visual-diff (Percy, Chromatic). None do **scan → diagnose → codemod → iterate → escalate** as one pipeline.

This primitive ships:
- Detection of 11 responsive anti-pattern kinds across **6 input file types** (CSS, HTML inline, JSX/TSX, Vue SFC, Svelte SFC, Astro SFC, Vanilla Extract `.css.ts`, SCSS, plain CSS)
- 14 atomic auto-fix handlers (meta viewport, Utopia fluid type/space scale, safe-area-inset, fixed-width overflow, element-overflow safety, Tailwind className edits, touch-target enforce, image aspect-ratio, …)
- Iterative apply loop that catches post-migrate cascade issues
- Optional LLM agent escalation for residuals that need semantic JSX restructuring (via `claude` CLI subprocess at `$0` marginal cost on operator's OAuth)

---

## Install

```bash
git clone https://github.com/beemusicco/responsive-modernize.git
cd responsive-modernize
pnpm install            # or npm/yarn
npx playwright install chromium webkit firefox
```

Optional: `npm link` to expose `responsive-modernize` globally.

### Optional dependency for `--auto-impeccable`

The `--auto-impeccable` flag spawns the `claude` CLI ([Claude Code](https://claude.ai/code)) as a subprocess to handle residual responsive issues that need semantic JSX understanding. If you want to use it:

```bash
# macOS:
brew install claude  # or download from https://claude.ai/code
claude --login       # authenticate via OAuth ($0 marginal on subscription)
```

Without `claude` CLI installed, the rest of the tool works fine — `--auto-impeccable` becomes a no-op with a clear log message. ESCALATION-BRIEF.md is still generated so you (or any other LLM agent) can handle residuals manually.

Note: `/impeccable` references in docs are a naming convention from the author's internal stack — there is no openclaw or `/impeccable` skill required. The escalation prompt is self-contained in ESCALATION-BRIEF.md.

---

## Quick start

```bash
# In a project root:
echo '{
  "target": {"url": "http://localhost:3000", "routes": ["/", "/about"]},
  "framework": "next"
}' > .responsive-modernize.json

# Audit (no edits):
node /path/to/responsive-modernize/run.mjs

# Audit + auto-fix safe codemods + verify:
node /path/to/responsive-modernize/run.mjs --yes

# Aggressive mode (touch-target enforce, etc.):
node /path/to/responsive-modernize/run.mjs --yes --aggressive

# Full matrix (11 viewports × 3 engines):
node /path/to/responsive-modernize/run.mjs --yes --deep

# Production auto-spawn LLM agent for residuals:
node /path/to/responsive-modernize/run.mjs --yes --auto-impeccable
```

---

## Brief schema — `.responsive-modernize.json`

All fields optional with sensible defaults. Schema in `templates/responsive-modernize.schema.json`.

```json
{
  "$schema": "https://openclaw.dev/schemas/responsive-modernize.json",
  "target": {
    "url": "http://localhost:3000",
    "routes": ["/", "/pricing", "/about"],
    "src": ["src/**/*.{css,scss,tsx,jsx,vue,svelte,astro}"],
    "html": ["**/*.html", "!node_modules/**"]
  },
  "framework": "next",
  "viewports": null,
  "engines": ["chromium"],
  "thresholds": {
    "horizontal_scroll": "error",
    "touch_target_min_px": 44,
    "font_size_min_px": 14,
    "contrast_ratio_min": 4.5,
    "diff_px_pct_max": 0.5
  },
  "out": ".responsive-modernize"
}
```

Defaults if omitted:
- `viewports`: 6 profiles (mobile-m 360, mobile-l 375, mobile-xl 430, tablet-p 768, laptop 1280, desktop 1920)
- `engines`: `["chromium"]` (use `--deep` for chromium+webkit+firefox)
- `framework`: `static` (no JS framework hints)

---

## What gets scanned (by stack)

| Stack | Extension | Coverage |
|---|---|---|
| Plain CSS | `.css` | Full — `@media`, `@container`, `font-size`, `padding/margin`, fixed positions |
| SCSS / SASS | `.scss`, `.sass` | Full — postcss-scss parser handles nesting |
| Less | `.less` | Partial — base postcss parser (may miss nesting) |
| Inline `<style>` in HTML | `.html` | Full |
| **Vue SFC** | `.vue` | `<style>` + `<style scoped>` + `<style lang="scss">` |
| **Svelte SFC** | `.svelte` | `<style>` blocks |
| **Astro SFC** | `.astro` | `<style>` blocks |
| **CSS-in-JS** (styled-components, emotion, twin.macro) | `.tsx`, `.jsx`, `.ts`, `.js` | Template literals (`styled.X\`...\``, `css\`...\``, `tw\`...\``) |
| **Vanilla Extract** | `.css.ts`, `.css.js` | Detection only (flagged for manual review) |
| Tailwind v4 directives | files with `@theme`/`@apply`/`@layer` | Silently skipped (no false-positive parse errors) |

---

## Auto-fix handlers (14 total)

| Order | Issue kind | Auto-fix | Description |
|---|---|---|---|
| 1 | `missing-meta-viewport` | `inject-meta-viewport` | Prepend canonical viewport meta to `<head>` |
| 1 | `meta-viewport-blocks-zoom` | `fix-meta-viewport` | Strip `user-scalable=no` / `maximum-scale=1` |
| 2 | `fluid-type-opportunity` | `inject-utopia-scale` | Append Utopia perfect-fourth fluid scale (320→1920) + form normalize |
| 3 | `no-reduced-motion-guard` | `inject-reduced-motion-guard` | Append `@media (prefers-reduced-motion: reduce)` block |
| 4 | `fixed-no-safe-area` | `add-safe-area-inset` | Wrap bottom value in `calc(... + env(safe-area-inset-bottom))` |
| 5 | `px-font-not-token` | `migrate-px-fonts-to-utopia` | postcss walk: `font-size: NNpx` → `var(--step-X)` |
| 6 | `px-spacing-not-token` | `migrate-px-spacing-to-utopia` | postcss walk: `padding/margin/gap: NNpx` → `var(--space-X)` (incl. shorthand) |
| 7 | `img-no-dimensions` (local) | `add-img-aspect-ratio` | sharp reads W×H → `style="aspect-ratio: W/H"` |
| 8 | `img-remote-no-dimensions` | `add-remote-img-aspect-ratio` | fetch + sharp + cache → `style="aspect-ratio: W/H"` |
| 9 | `fixed-width-overflow` | `fix-fixed-width-overflow` | postcss walk: `width: NNpx (≥600)` → `min(100%, NNpx)` |
| 10 | `element-overflow` (runtime) | `fix-element-overflow` | Append `<sel> { max-width: 100%; box-sizing: border-box; }` to largest CSS |
| 11 | `touch-target-fixable` | `enforce-touch-target-min` | `--aggressive`: null hardcoded width/height <44 + append min sizing |
| 12 | `tailwind-touch-target` | `tailwind-touch-target` | JSX className edit: drop `h-N<11` / `w-N<11`, add `min-h-11` / `min-w-11` |
| 13 | `tailwind-safe-area` | `tailwind-safe-area` | JSX className append: `pb-[env(safe-area-inset-bottom)]` to `fixed/sticky bottom-N` |

**Atomic guarantee**: every touched file backed up to `.responsive-modernize/backup/<rel-path>` before mutation (idempotent — never overwrites pre-iter-1 snapshot). Writes use `safeWrite` tmp+rename pattern — prevents partial-write corruption.

**Idempotency**: re-running `--yes` is safe. Already-migrated values (`var()`, `clamp()`, `calc()`, `env()`) are skipped.

---

## Runtime diagnose (per-viewport)

Each viewport × engine combination runs `page.evaluate()` for:
- **horizontal-scroll** detection + culprit selector locator (top 5 offending elements with sizes)
- **text-overflow** per visible block
- **touch-target-too-small** (<44×44, WCAG 2.5.5 + Apple HIG + Material)
- **font-size-too-small** (<14px floor; 16px prevents iOS auto-zoom)
- **img-missing-dimensions** (CLS predictor)
- **fixed-bottom-no-safe-area** (iPhone home indicator overlap) — uses stylesheet rule walk to avoid false positives after auto-fix
- **zoom-blocked** (`user-scalable=no` / `maximum-scale=1` WCAG 1.4.4 violation)

---

## Standard viewport profiles

Per StatCounter Q1 2026:

| id | dimensions | tier |
|---|---|---|
| mobile-s | 320×568 | deep — iPhone SE 1st |
| **mobile-m** | 360×780 | default — Samsung S |
| **mobile-l** | 375×812 | default — iPhone 11-14 |
| **mobile-xl** | 430×932 | default — iPhone 15 Pro Max |
| **tablet-p** | 768×1024 | default — iPad portrait |
| tablet-l | 1024×768 | deep |
| **laptop** | 1280×800 | default — MacBook |
| laptop-l | 1440×900 | deep |
| **desktop** | 1920×1080 | default — Full HD |
| ultrawide | 2560×1440 | deep — QHD |
| 4k | 3840×2160 | deep — fluid stress test |

`--deep` runs all 11. Custom profiles via `viewports` array.

---

## Output

```
<project>/.responsive-modernize/
├── scan.json                # phase 1 — static analysis
├── baseline/                # phase 2 — full-page screenshots
├── baseline.json
├── diagnose.json            # phase 3 — runtime issues
├── propose.md               # phase 4 — human plan
├── propose.json             # phase 4 — machine plan + codemod kit
├── apply.json               # phase 5 — applied + skipped manifest
├── backup/                  # phase 5 — pre-apply file mirror
├── verify/                  # phase 6 — post-apply screenshots
├── diff/                    # phase 6 — pixelmatch PNG diffs
├── verify.json
├── REPORT.html              # phase 7 — interactive viewer
├── REPORT.md
├── sprite-baseline.png      # phase 7 — N×M grid
├── sprite-verify.png
├── ESCALATION-BRIEF.md      # phase 8 — agent prompt (if residuals)
└── report.json
```

Add `.responsive-modernize/` to your project `.gitignore`.

---

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Clean — no error/warn issues |
| 1 | Issues found — block CI merge |
| 2 | Tool error (dependency missing, brief invalid) |

GitHub Action template:

```yaml
- name: Responsive audit
  run: |
    cd /tmp && git clone https://github.com/beemusicco/responsive-modernize.git
    cd responsive-modernize && pnpm install && npx playwright install chromium
    cd $GITHUB_WORKSPACE && node /tmp/responsive-modernize/run.mjs --url ${{ env.PREVIEW_URL }}
```

---

## Performance

On Apple M4 Pro, against a live dev server:

| Mode | Time |
|---|---|
| Default (1 route × 6 viewports × chromium, phases 1+2+3+4+7) | ~10 s |
| `--yes` (+ apply + iterative + verify) | ~25 s |
| `--deep` (11 viewports × 3 engines × 1 route) | ~75 s |
| `--deep --yes` (full + agent escalate) | ~150 s + agent time |

Cost: $0 marginal. All local Playwright + node. `--auto-impeccable` uses operator's claude OAuth session ($0 on subscription).

---

## Examples

See `examples/` for minimal reproductions of:
- `examples/vanilla-css` — plain CSS with hardcoded px → Utopia migration
- `examples/tailwind-next` — Next.js 16 + Tailwind v4
- `examples/vue-sfc` — Vue 3 SFC with `<style scoped>`
- `examples/svelte` — SvelteKit
- `examples/astro` — Astro SFC
- `examples/scss-nesting` — SCSS with nesting + `@use`

Each example has a `before/` and `after/` snapshot.

---

## Comparison

| Tool | Multi-viewport | Static AST | Runtime | Codemod | Iterative | Multi-stack | Agent |
|---|---|---|---|---|---|---|---|
| **responsive-modernize** | ✓ 6-11 vp | ✓ | ✓ | ✓ 14 | ✓ | ✓ 6 stacks | ✓ |
| Lighthouse | × (1 vp) | × | ✓ | × | × | × | × |
| axe-core | × (DOM) | × | ✓ | × | × | × | × |
| Percy / Chromatic | ✓ | × | × (pixel only) | × | × | × | × |
| PostCSS plugins | × | ✓ | × | ✓ | × | × | × |

---

## Contributing

PRs welcome. See `CONTRIBUTING.md` for development setup, test guidance, and the codemod handler protocol.

Issue templates expect:
- Stack signature (framework, CSS authoring)
- `.responsive-modernize.json` content
- Console log (esp. scan phase + apply manifest)
- Expected vs. actual

---

## License

MIT © beemusicco.

Built initially for the openclaw agency stack. Battle-tested on production Next.js / Tailwind sites (solaronics.si) before open-sourcing.

---

## Acknowledgements

- [Utopia](https://utopia.fyi/) for the fluid type/space scale methodology
- [LogRocket — Container Queries in 2026](https://blog.logrocket.com/container-queries-2026/) for grounding the static analysis playbook
- [Playwright](https://playwright.dev/) for multi-engine multi-viewport rendering
- [postcss](https://postcss.org/) + [cheerio](https://cheerio.js.org/) for AST work
- [sharp](https://sharp.pixelplumbing.com/) for image dimension probing
- [pixelmatch](https://github.com/mapbox/pixelmatch) for visual regression
