# Example: Next.js 16 + Tailwind v4 site

Real-world stack with Tailwind v4 utility classes. The codemod recognizes the framework and routes to Tailwind className edits (instead of CSS append).

## Coverage on this stack

| Detected | Auto-fixed |
|---|---|
| Missing meta viewport in app/layout.tsx | ✓ |
| `fixed bottom-N` className without `pb-[env(safe-area-inset-bottom)]` | ✓ via `tailwind-safe-area` |
| `<a className="h-7">` tap target <44 | ✓ via `tailwind-touch-target` (drops `h-7`, adds `min-h-11`) |
| CSS-in-JS template literals in `.tsx` | scan flags (not auto-fixed — too brittle) |
| Tailwind v4 `@theme`/`@apply`/`@layer` in globals.css | silently skipped (not a parse error) |

## Usage

```bash
cd your-next-project
echo '{
  "target": {"url": "http://localhost:3000", "routes": ["/", "/pricing"]},
  "framework": "next"
}' > .responsive-modernize.json
node /path/to/responsive-modernize/run.mjs --yes
```

## Residuals → /impeccable agent

For semantic JSX restructuring (touch-targets that don't match the simple `h-N` regex, e.g. dense desktop nav at `py-1`), the orchestrator gets an `ESCALATION-BRIEF.md` and either:

- Spawns Agent inline (when running inside a Claude session — read `[RM-ESCALATE: ...]` marker)
- Runs `--auto-impeccable` to spawn `claude --print` subprocess (production CI, $0 marginal on OAuth)

Real production test: solaronics.si touch-target hits reduced 79% (882 → 186) after `--yes` + agent pass, while preserving the engineered-minimal-industrial B&O/Bauhaus aesthetic per `.claude-stack.json` brand context.
