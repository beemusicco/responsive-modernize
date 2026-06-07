## Summary

<!-- One sentence on what this PR does + why. -->

## Type

- [ ] Bug fix (existing behaviour was wrong)
- [ ] New feature (new handler / scanner / runtime check)
- [ ] Refactor (no behaviour change)
- [ ] Documentation only
- [ ] CI / tooling

## Coverage

- [ ] Added or updated `test/smoke.mjs` assertions
- [ ] Added `examples/<stack>/` fixture (for new stack support)
- [ ] Updated README + CHANGELOG (for user-visible behaviour)
- [ ] Updated CONTRIBUTING (for handler-protocol changes)

## Handler safety (if this adds an auto-fix handler)

- [ ] Idempotent — re-runs are no-ops if fix already present
- [ ] Uses `safeWrite` from `lib/util.mjs`
- [ ] Skips `var()` / `clamp()` / `calc()` / `env()` values
- [ ] Skips `aria-hidden` / `sr-only` contexts (for JSX edits)
- [ ] Has entry in `APPLY_ORDER` in `lib/utopiaMap.mjs`

## Test

How did you verify? Paste smoke output or describe the manual test.

```
$ node test/smoke.mjs
…
```
