#!/usr/bin/env node
/**
 * Fixture-based test runner.
 *
 * Each fixture is a pair: <name>.input.<ext> + <name>.expected.<ext>
 * OR <name>.input.<ext> + <name>.assertion.json (for structural assertions).
 *
 * Pass: input runs through codemod → diff vs expected = empty.
 * Fail: print first 10 lines of diff + mark FAIL.
 *
 * Test groups map to codemod names:
 *   layout-stack-safe   — tailwindLayoutStackCodemod expected to TRANSFORM
 *   layout-stack-skip   — tailwindLayoutStackCodemod expected to LEAVE UNCHANGED
 *   className-edges     — tailwindLayoutStackCodemod on edge cases (cn(), spread, …)
 *   regressions         — historical real-world bugs that must not recur
 *   contrast            — fix-low-color-contrast handler
 *   jsxWalker           — lib/jsxWalker.mjs primitive assertions
 */
import {readdir, readFile, writeFile, mkdir, rm} from 'fs/promises';
import {join, basename} from 'path';
import {fileURLToPath} from 'url';
import {tailwindLayoutStackCodemod, tailwindSidebarDrawerCodemod} from '../lib/tailwindCodemod.mjs';
import {walkJSX} from '../lib/jsxWalker.mjs';

const __dirname = new URL('.', import.meta.url).pathname;
const FIXTURES = join(__dirname, 'fixtures');
const TMP = '/tmp/rm-fixture-runner';

const RESET = '\x1b[0m', GREEN = '\x1b[32m', RED = '\x1b[31m', DIM = '\x1b[2m';

let pass = 0, fail = 0;
const failures = [];

async function runCodemodAgainstFile({inputPath, expectedPath, codemodFn, group}) {
  // Mirror input into temp briefDir/src
  await rm(TMP, {recursive: true, force: true});
  await mkdir(join(TMP, 'src'), {recursive: true});
  const filename = basename(inputPath).replace('.input.', '.');
  const dest = join(TMP, 'src', filename);
  await writeFile(dest, await readFile(inputPath));
  const r = await codemodFn({briefDir: TMP});
  const actual = await readFile(dest, 'utf8');
  const expected = await readFile(expectedPath, 'utf8');
  return {actual, expected, edits: r.totalEdits, parseErrors: r.parseErrors};
}

async function testLayoutGroup(group) {
  const dir = join(FIXTURES, group);
  let entries;
  try { entries = await readdir(dir); } catch { return; }
  const inputs = entries.filter((f) => f.includes('.input.'));
  for (const inputName of inputs) {
    const name = inputName.replace(/\.input\.[^.]+$/, '');
    const ext = inputName.match(/\.input\.([^.]+)$/)[1];
    const inputPath = join(dir, inputName);
    const expectedPath = join(dir, `${name}.expected.${ext}`);
    try {
      const {actual, expected, edits} = await runCodemodAgainstFile({
        inputPath, expectedPath,
        codemodFn: group === 'regressions' && name.includes('sidebar') ? tailwindSidebarDrawerCodemod : tailwindLayoutStackCodemod,
        group,
      });
      const inputContent = await readFile(inputPath, 'utf8');
      // BUG-R7-06: detect silent no-op regression — codemod makes 0 edits but fixture expects
      // a transform (expected != input). Only triggers when the fixture WAS written expecting
      // a change; skip/false-positive fixtures (expected == input) are not flagged.
      const isTransformGroup = group === 'layout-stack-safe' || (group === 'regressions' && name.includes('sidebar'));
      const noOpRegression = isTransformGroup && edits === 0
        && actual.trim() === inputContent.trim()
        && expected.trim() !== inputContent.trim();
      if (actual.trim() === expected.trim() && !noOpRegression) {
        console.log(`${GREEN}✓${RESET} ${group}/${name}`);
        pass++;
      } else if (noOpRegression) {
        console.log(`${RED}✗${RESET} ${group}/${name} — codemod no-op: 0 edits on transform fixture (regression?)`);
        fail++;
        failures.push({group, name, error: 'no-op: codemod made 0 edits on a transform fixture'});
      } else {
        console.log(`${RED}✗${RESET} ${group}/${name}`);
        const diff = simpleDiff(actual, expected);
        console.log(diff.slice(0, 500));
        fail++;
        failures.push({group, name, diff: diff.slice(0, 300)});
      }
    } catch (e) {
      console.log(`${RED}✗${RESET} ${group}/${name} — ${e.message}`);
      fail++;
      failures.push({group, name, error: e.message});
    }
  }
}

async function testJsxWalkerAssertions() {
  const dir = join(FIXTURES, 'jsxWalker');
  let entries;
  try { entries = await readdir(dir); } catch { return; }
  const inputs = entries.filter((f) => f.includes('.input.'));
  for (const inputName of inputs) {
    const name = inputName.replace(/\.input\.[^.]+$/, '');
    const inputPath = join(dir, inputName);
    const assertionPath = join(dir, `${name}.assertion.json`);
    try {
      const src = await readFile(inputPath, 'utf8');
      const assertion = JSON.parse(await readFile(assertionPath, 'utf8'));
      let navsFound = 0, fragmentFound = false, fragmentChildren = [], complexClassName = null, hasSpread = false;
      walkJSX(src, (ctx) => {
        if (ctx.tagName === 'nav') {
          navsFound++;
          if (ctx.ancestorTags.length > 0) {
            assertion._innerNavAncestors = ctx.ancestorTags;
          }
        }
        if (ctx.tagName === '__FRAGMENT__') {
          fragmentFound = true;
          fragmentChildren = ctx.childTagNames;
        }
        const cls = ctx.attrs.find((a) => a.name === 'className');
        if (cls && cls.kind === 'expression') complexClassName = cls;
        if (ctx.attrs.some((a) => a.name === '__spread__')) hasSpread = true;
      });
      const ok = (
        (assertion.navsFound == null || assertion.navsFound === navsFound) &&
        (assertion.innerNavAncestors == null || JSON.stringify(assertion.innerNavAncestors) === JSON.stringify(assertion._innerNavAncestors)) &&
        (assertion.hasFragment == null || assertion.hasFragment === fragmentFound) &&
        (assertion.fragmentChildTags == null || JSON.stringify(assertion.fragmentChildTags) === JSON.stringify(fragmentChildren)) &&
        (assertion.className_kind == null || (complexClassName && complexClassName.kind === assertion.className_kind)) &&
        (assertion.className_raw == null || (complexClassName && complexClassName.valueRaw === assertion.className_raw)) &&
        (assertion.classNameKind == null || (complexClassName == null && assertion.classNameKind === 'string') || (complexClassName && complexClassName.kind === assertion.classNameKind)) &&
        (assertion.hasSpread == null || assertion.hasSpread === hasSpread)
      );
      if (ok) {
        console.log(`${GREEN}✓${RESET} jsxWalker/${name}`);
        pass++;
      } else {
        console.log(`${RED}✗${RESET} jsxWalker/${name}`);
        console.log(`  expected: ${JSON.stringify(assertion)}`);
        console.log(`  actual: navsFound=${navsFound}, frag=${fragmentFound}, fragKids=${JSON.stringify(fragmentChildren)}, classExpr=${complexClassName?.valueRaw || 'none'}, spread=${hasSpread}`);
        fail++;
      }
    } catch (e) {
      console.log(`${RED}✗${RESET} jsxWalker/${name} — ${e.message}`);
      fail++;
    }
  }
}

function simpleDiff(a, b) {
  const la = a.split('\n'), lb = b.split('\n');
  const out = [];
  const max = Math.max(la.length, lb.length);
  for (let i = 0; i < max; i++) {
    if (la[i] !== lb[i]) {
      out.push(`  - line ${i+1}: ${DIM}got${RESET}      ${la[i] || '<empty>'}`);
      out.push(`  + line ${i+1}: ${DIM}expected${RESET} ${lb[i] || '<empty>'}`);
    }
  }
  return out.join('\n');
}

(async () => {
  console.log('=== responsive-modernize fixture suite ===\n');
  await testLayoutGroup('layout-stack-safe');
  await testLayoutGroup('layout-stack-skip');
  await testLayoutGroup('className-edges');
  await testLayoutGroup('regressions');
  await testJsxWalkerAssertions();
  // contrast group skipped — would require diagnose-stub setup; leave as v1.14.1 follow-up.
  await rm(TMP, {recursive: true, force: true});
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
})();
