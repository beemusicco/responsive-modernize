# Example: Vue SFC `<style scoped>`

Vue 3 single-file components with embedded `<style>` blocks (scoped + lang variants).

## What's detected

| Block | Detection |
|---|---|
| `<style scoped>` | Yes — base CSS parser |
| `<style lang="scss">` | Yes — postcss-scss parser |
| `<style lang="sass">` | Yes |
| `<style>` (root, unscoped) | Yes |

## Anti-patterns flagged

- `font-size: NNpx` ≥3 instances per block → `fluid-type-opportunity`
- `@media` ≥4 instances with 0 `@container` → `mq-bloat-no-cq`
- Animations / transitions without `prefers-reduced-motion` guard → `no-reduced-motion-guard`

## What's NOT auto-fixed in Vue SFC

Codemod **does not edit `<style>` blocks** — preserving template/script positioning + scoped boundaries via regex is too brittle. Findings here go to `propose.md` as manual-review items. For semantic edits, escalate to the agent via `[RM-ESCALATE: ...]` marker.

## Usage

```bash
cd your-vue-project
echo '{
  "target": {"url": "http://localhost:5173"},
  "framework": "vue"
}' > .responsive-modernize.json
node /path/to/responsive-modernize/run.mjs
```

Scan + diagnose + propose run; no auto-mutation of `.vue` files.
