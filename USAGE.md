# How to use `responsive-modernize` — plain-English guide

> Slovenian version: [UPORABA.md](./UPORABA.md)

## What this does in one sentence

**A robot that automatically fixes your website so it works correctly on every device** — iPhone, Samsung, iPad, laptop, ultrawide monitor. No manual CSS digging.

---

## Why you need this

60–75% of visitors hit websites from a **phone**. Half of "responsive" sites look fine on the dev's monitor and break completely on a 360-pixel Android:

- text jumps out of its container
- the button is 30×20 px and your finger misses it
- a fixed footer hides under the iPhone home indicator
- a 1600-px container causes horizontal scroll on every phone
- font sizes are hardcoded to 12 or 10 px — unreadable

None of this is acceptable in 2026. This tool finds all those problems, shows you which elements are broken, and **automatically fixes most of them** without you touching any code.

---

## How to run — 3 steps

### Step 1 — go to the project

```bash
cd ~/projects/myclient
```

### Step 2 — create a brief

A small config file telling the robot WHAT to test.

```bash
cp ~/.openclaw/scripts/responsive-modernize/templates/.responsive-modernize.example.json \
   ./.responsive-modernize.json
```

Open `.responsive-modernize.json` and fix 2–3 things:

```json
{
  "target": {
    "url": "http://localhost:3000",
    "routes": ["/", "/about", "/contact"]
  },
  "framework": "next"
}
```

- `url` — where your dev server runs (usually `localhost:3000` or `localhost:5173`)
- `routes` — which pages to test (`/` is home, add more if you want)
- `framework` — `next` / `vite` / `vue` / `svelte` / `astro` / `static`

Everything else has sensible defaults.

### Step 3 — run the robot

**Look only (no edits):**

```bash
node ~/.openclaw/scripts/responsive-modernize/run.mjs
```

In 30 seconds – 5 minutes (depending on page count) you get a report. No file is modified.

**Auto-fix:**

```bash
node ~/.openclaw/scripts/responsive-modernize/run.mjs --yes
```

Added `--yes`. The robot has permission to change your CSS and JSX, but **backs up every file first**. If anything you don't like, copy back from `.responsive-modernize/backup/`.

**Aggressive mode** (also fixes buttons that aren't large enough):

```bash
node ~/.openclaw/scripts/responsive-modernize/run.mjs --yes --aggressive
```

**Full matrix** (all viewports, all browsers, both color schemes, RTL, etc. — takes ~3 minutes):

```bash
node ~/.openclaw/scripts/responsive-modernize/run.mjs --yes --deep
```

**Auto-escalate** (for issues that need AI judgement):

```bash
node ~/.openclaw/scripts/responsive-modernize/run.mjs --yes --auto-impeccable
```

After all the auto-fixes, the robot launches **another AI agent** that understands context and fixes things like "this button is too small in the Footer, add inline-flex" — semantic edits a human normally does.

---

## What you get

In the `.responsive-modernize/` folder (automatically gitignored):

```
.responsive-modernize/
├── REPORT.html              ← OPEN THIS IN YOUR BROWSER
├── REPORT.md                ← for editor viewing
├── propose.md               ← list of all detected issues
├── sprite-baseline.png      ← "before" image — all viewports at once
├── sprite-verify.png        ← "after" image — if you ran --yes
├── baseline/                ← screenshot of every page × every viewport
├── backup/                  ← original files before fixes
└── ESCALATION-BRIEF.md      ← prompt for the /impeccable agent
```

**Main artifact**: `REPORT.html` — open it in Safari/Chrome. You see scorecards:
- how many issues found
- how many auto-fixed
- viewport grid before/after
- each issue as a color-coded panel

---

## Typical use cases

### Case A — new client

1. Client says: "my site doesn't work on mobile"
2. Take their dev URL (or check locally)
3. `cd ~/projects/<client> && cp template ./.responsive-modernize.json`
4. `node run.mjs` — generate `REPORT.html`
5. Send client a link to `REPORT.html` or tunnel it (`cloudflared`)
6. Agree which fixes: `--yes` for safe, manual for risky
7. Commit, deploy, send before/after sprite

### Case B — pre-deploy CI gate

In GitHub Actions:

```yaml
- run: node ~/.openclaw/scripts/responsive-modernize/run.mjs --url ${{ env.PREVIEW_URL }} --json-output
```

Robot returns:
- `exit 0` = all OK, deploy can go through
- `exit 1` = issues found, block merge
- `exit 2` = robot crashed, check config

### Case C — periodic audit of live clients

Cron once a week or month:

```bash
0 6 * * 1  cd /Users/aimusic/projects/<client> && node ~/.openclaw/scripts/responsive-modernize/run.mjs --url https://<client>.com --json-output > /tmp/<client>-audit.json
```

Send client an automatic report.

---

## What the robot auto-fixes

| Problem | Fix |
|---|---|
| Missing `<meta viewport>` | Inject canonical viewport meta in `<head>` |
| `width: 1600px` | Convert to `min(100%, 1600px)` |
| `font-size: 14px` × many places | Inject Utopia fluid scale (fluid font 320–1920 px) |
| `padding: 16px` (hardcoded) | Add fluid tokens |
| Fixed bottom bar without safe-area | Add `env(safe-area-inset-bottom)` |
| Image without dimensions | Add `aspect-ratio` (local via sharp, remote via fetch) |
| Touch target < 44px (Tailwind) | Add `min-h-11` |
| Animations without reduced-motion guard | Add `@media (prefers-reduced-motion: reduce)` |
| Single element overflowing | Append `max-width: 100%` |

**15 different auto-fixes**, all safe and idempotent (run 10× — does the same thing only once).

---

## What the robot detects but does NOT fix (needs human judgement)

- Text wrapping that has context ("is this an intentional brand name?")
- Layout grids that might break (cards, navigations)
- CSS-in-JS template literals (too brittle to edit)
- Tailwind classNames in `cn(isActive && "h-7")` with logic

**The robot lists these in `ESCALATION-BRIEF.md`**. With `--auto-impeccable`, an AI agent reads the brief and handles them — semantic JSX edits that respect the brand.

---

## FAQ

### The robot broke my site. How do I roll back?

```bash
cp -r .responsive-modernize/backup/* .
```

The robot makes a backup of EVERY file it touches. Originals are in backup.

### How do I know what was applied?

Open `.responsive-modernize/apply.json` — full list of all changes (which file, how many edits).

### What if the dev server isn't running?

The robot detects it: `[rm] HEALTH FAIL: target.url unreachable (timeout 5000ms)`. Run `npm run dev` first.

### What if I just want an audit without fixes?

Just don't pass `--yes`. Default is read-only.

### How long does it take?

- Default (1 page × 6 viewports × Chrome): **~30 seconds**
- `--yes` (auto-fix + verify): **~1 minute**
- `--deep` (11 viewports × 3 browsers): **~3 minutes**
- `--deep --yes --auto-impeccable` (full): **~5–10 minutes**

### Does it cost anything?

**$0**. Everything runs locally (Playwright + Node). The only optional path that uses an API is `--auto-impeccable`, which uses your Claude OAuth → $0 marginal.

### Does it work on WordPress / Webflow / Shopify?

Yes — audit a live site via `--url https://...`. The robot doesn't need source code, just a URL. However it **cannot edit code** that lives in a CMS. For WordPress: translate recommendations into custom CSS.

### Does it replace a designer?

No. The robot is **diagnostic + foundation**. A human decides "is 12px intentional" and "how should the type scale behave at 4K". The robot handles 80% of mechanical work.

### Does it work for Vue / Svelte / Astro?

**Yes** — since v1.6. The scanner reads `<style>` blocks in Vue SFC, Svelte, Astro files. It doesn't edit them (too brittle) but it surfaces problems.

---

## Sanity rules

1. **Always run without `--yes` first** — see the REPORT, see screenshots, see what would be fixed
2. **Commit before `--yes`** — easier to see diff and revert if something breaks
3. **`--aggressive` is opt-in** — aggressive touch-target fixes change layout, not every site wants them
4. **For Tailwind sites**: codemod fixes safe-area and touch targets with high confidence; font and spacing need `--auto-impeccable` or manual
5. **For vanilla CSS sites**: codemod fixes practically all mechanical issues automatically

---

## Concrete example (client solaronics.si)

```bash
cd ~/projects/solaronics-si
# brief exists
node ~/.openclaw/scripts/responsive-modernize/run.mjs --yes --auto-impeccable
```

Result (verified 2026-06-07):
- Pre-apply: 154 issues
- After codemod: 6 issues
- After `/impeccable` agent: ~10 files touch-target fixes, 79% touch-target hit reduction

Client gets:
- `REPORT.html` with before/after images
- `propose.md` listing all detected issues
- 10 commits with minimal diffs (cherry-pickable)
- Honest "what I left for the human" section in `ESCALATION-BRIEF.md`

---

## All commands in one table

| Command | What it does |
|---|---|
| `node run.mjs` | Audit only. No changes. |
| `node run.mjs --yes` | Auto-fixes + verify |
| `node run.mjs --yes --aggressive` | Plus opt-in fixes (touch-target enforce) |
| `node run.mjs --deep` | All viewports × all browsers |
| `node run.mjs --yes --auto-impeccable` | Plus AI agent for semantic fixes |
| `node run.mjs --url https://...` | Quick audit, no brief needed |
| `node run.mjs --json-output` | Structured JSON for CI/scripts |
| `node run.mjs --no-escalate` | Skip agent brief generation |
| `node run.mjs --dry-run` | Validate brief + show plan, no action |
| `node run.mjs --phase scan,report` | Run phase subset |

---

## Need help?

- `REPORT.md` — everything about this run
- `propose.md` — human-readable list of all issues
- `README.md` — full technical documentation
- `CHANGELOG.md` — version history
- `lib/` directory — all phases explained in code comments

Total stack: ~2500 LOC + ~1000 LOC documentation. Readable in 1–2 hours if you're curious.
