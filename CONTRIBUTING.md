# Contributing to responsive-modernize

Thanks for considering a contribution. The codebase is small (~2000 LOC, single-package), deliberately so. PRs are welcome for any of:

- New stack coverage (Solid SFC, Qwik inline, etc.)
- New auto-fix handlers
- Diagnose engine refinements (false-positive fixes)
- Documentation / examples / test fixtures
- CI: real GitHub Actions workflow tests

## Dev setup

```bash
git clone https://github.com/beemusicco/responsive-modernize.git
cd responsive-modernize
pnpm install
npx playwright install chromium webkit firefox
```

## Project structure

```
responsive-modernize/
├── lib/
│   ├── util.mjs              # shared helpers — safeWrite, probeHealth, walker
│   ├── scan.mjs              # phase 1 — static AST scan
│   ├── sfcScan.mjs           # SFC + Vanilla Extract scanners
│   ├── baseline.mjs          # phase 2 — Playwright screenshots
│   ├── diagnose.mjs          # phase 3 — runtime page.evaluate checks
│   ├── propose.mjs           # phase 4 — ranked plan + Utopia kit
│   ├── apply.mjs             # phase 5 — codemod handlers
│   ├── verify.mjs            # phase 6 — pixelmatch + re-diagnose
│   ├── report.mjs            # phase 7 — HTML/MD/sprite output
│   ├── escalate.mjs          # phase 8 — agent brief + subprocess spawn
│   ├── tailwindCodemod.mjs   # Tailwind className edits
│   └── utopiaMap.mjs         # px → token mapping + APPLY_ORDER
├── templates/                # JSON schemas + example briefs
├── examples/                 # per-stack reproductions
├── run.mjs                   # CLI orchestrator
└── package.json
```

## Adding a new auto-fix handler

1. Add the handler to `HANDLERS` in `lib/apply.mjs`. Each handler is `async ({filePath, briefDir, issue, codemodKit, opts}) → {applied, before, after, reason?, changed?, added?, target?}`.
2. Add an entry to `APPLY_ORDER` in `lib/utopiaMap.mjs` to control sequencing (inject-before-migrate).
3. Either:
   - Emit a corresponding issue with `autoFixable: true` + `fix: '<your-handler-name>'` from `scan.mjs` (static) or `propose.mjs` (derived from runtime data).
4. Add a test fixture to `examples/` showing the before/after.
5. Update `README.md` and `CHANGELOG.md`.

### Handler safety contract

- Always idempotent — if the fix is already present, return `{applied: false, reason: 'already X'}`.
- Use `safeWrite(filePath, content)` from `util.mjs` — never raw `writeFile`.
- Skip values containing `var()` / `clamp()` / `calc()` / `env()` (already migrated).
- For JSX edits, skip `aria-hidden` / `sr-only` / `class="skip"` contexts.
- For SFC / CSS-in-JS, prefer flagging over editing — template literal mutation is too brittle.

## Adding a new stack scanner

For e.g. Qwik `.tsx` with `useStyles$`:

1. Add a new function to `lib/sfcScan.mjs` (or new `lib/<stack>Scan.mjs`) following `scanSFC` / `scanCSSInJS` shape — return `{issues, stats}`.
2. Add a glob pattern + iteration loop in `lib/scan.mjs#runScan`.
3. Update scan summary log + scan.json stats fields.
4. Add fixture under `examples/<stack>/` with at least 3 anti-patterns.
5. Update README "What gets scanned" table.

## Testing

We're test-light intentionally (the primitive is verified by E2E smokes on real codebases). For new contributions:

- Add a fixture under `examples/<your-stack>/` showing realistic before/after.
- Run `node run.mjs --phase scan,report` on the fixture and confirm expected issue counts.
- For codemods, add a `--yes` run and grep the output file to confirm the edit.

## Style

- ES modules (`.mjs`), no transpile step.
- Async/await throughout.
- No emoji in code or commit messages.
- Imports grouped: node builtins → npm → relative.
- Functions documented with intent comments where the *why* isn't obvious (the *what* is in the code).

## Commits

Conventional Commits style:
- `feat(scan): add Solid component scanner`
- `fix(apply): touch-target nulls width on rule with multiple selectors`
- `docs(readme): add Astro example`

Keep one logical change per commit. Squash on merge.

## Releasing

Maintainers:
1. Bump version in `package.json`.
2. Add entry to `CHANGELOG.md`.
3. `git tag v1.X.Y && git push --tags`.
4. `npm publish` (requires npm 2FA).

## Code of conduct

Be excellent to each other. Disagree with ideas, not people. Prefer working code + small PRs over arguments + abstract principles.
