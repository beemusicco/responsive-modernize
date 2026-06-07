# Security policy

## Supported versions

The latest minor version receives security fixes. Older minors are best-effort.

| Version | Supported |
|---------|-----------|
| 1.7.x   | ✓ active  |
| 1.6.x   | ✓ active  |
| < 1.6   | ✗ end-of-life |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security findings.

Email **security@beemusic.co** with:
- a description of the vulnerability + impact assessment
- reproduction steps (minimal repro preferred)
- affected version(s)
- your suggested fix (optional)

You should receive an acknowledgement within 72 hours. A fix + advisory is published within 14 days for high-severity issues, 30 days for medium.

## Known threat surface

`responsive-modernize` runs Playwright against arbitrary URLs and applies codemods to local files. The threat surface includes:

- **Hostile target URLs** — Playwright executes JavaScript on the target site. Do not point at untrusted dev URLs.
- **Codemod injection** — Auto-fix handlers write files. We use `safeWrite` (tmp + rename) and backup originals, but the principle of least privilege applies — run on a clean working tree, review the diff before commit.
- **`--auto-impeccable` subprocess** — spawns `claude --dangerously-skip-permissions` with file-edit + Bash tools. Operator explicitly opts in. Do NOT enable on untrusted projects.
- **Remote image fetch** (`add-remote-img-aspect-ratio`) — fetches arbitrary URLs from HTML `<img src>`. Risk: SSRF if you point the tool at attacker-controlled HTML. The fetch is cached + sharp-validated.

## Dependency policy

We pin to minor versions in `package.json` and rely on Dependabot for security updates. We do not bundle vendored copies; every dependency is auditable via `pnpm why <pkg>`.

If you find a transitively-vulnerable dep, please report via the email above with `pnpm audit` output.
