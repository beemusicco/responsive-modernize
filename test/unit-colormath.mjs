#!/usr/bin/env node
/**
 * Unit tests for lib/colorMath.mjs edge cases found in round-6 sparring.
 *
 * Run: node test/unit-colormath.mjs
 * Exit 0 = all pass, exit 1 = any failure.
 */
import {parseColor, contrastRatio, adjustForContrast, colorToString} from '../lib/colorMath.mjs';

const RESET = '\x1b[0m', GREEN = '\x1b[32m', RED = '\x1b[31m';
let pass = 0, fail = 0;

function assert(cond, label, detail = '') {
  if (cond) {
    console.log(`${GREEN}✓${RESET} ${label}`);
    pass++;
  } else {
    console.log(`${RED}✗${RESET} ${label}${detail ? ' — ' + detail : ''}`);
    fail++;
  }
}

// ─────────────────────────────────────────────────────────────────
// parseColor: CSS Color Level 4 space-separated syntax (round-6 BUG 3)
// ─────────────────────────────────────────────────────────────────
console.log('\n── parseColor: CSS Color Level 4 ──');

const c4a = parseColor('rgb(0 0 0 / 0.5)');
assert(c4a !== null, 'rgb(0 0 0 / 0.5) parses', JSON.stringify(c4a));
assert(c4a?.r === 0 && c4a?.g === 0 && c4a?.b === 0, 'rgb(0 0 0/0.5) r/g/b=0', JSON.stringify(c4a));
assert(Math.abs((c4a?.a ?? -1) - 0.5) < 0.001, 'rgb(0 0 0/0.5) alpha=0.5', JSON.stringify(c4a));

const c4b = parseColor('rgb(255 128 0)');
assert(c4b !== null, 'rgb(255 128 0) no-alpha parses');
assert(c4b?.r === 255 && c4b?.g === 128 && c4b?.b === 0, 'rgb(255 128 0) channels correct');

const c4c = parseColor('rgba(10 20 30 / 0.8)');
assert(c4c !== null, 'rgba(10 20 30 / 0.8) parses');
assert(Math.abs((c4c?.a ?? -1) - 0.8) < 0.001, 'rgba alpha=0.8');

// Legacy comma form must still work
assert(parseColor('rgb(255, 0, 0)') !== null, 'rgb(255,0,0) comma form still works');
assert(parseColor('rgba(0,0,0,0.5)') !== null, 'rgba comma form still works');

// HSL no-comma (was already working — regression guard)
const hsl = parseColor('hsl(120 100% 50%)');
assert(hsl !== null, 'hsl(120 100% 50%) no-commas parses');
assert(hsl?.r === 0 && hsl?.g === 255 && hsl?.b === 0, 'hsl(120 100% 50%) = green');

// ─────────────────────────────────────────────────────────────────
// adjustForContrast: direction choice (round-6 BUG 1)
// ─────────────────────────────────────────────────────────────────
console.log('\n── adjustForContrast: direction correctness ──');

// Mid-gray bg (lum≈0.216) — white gives 3.95:1 (fails), black gives 5.32:1 (passes)
// Old code used bgLum<0.5 threshold → moved toward white → null
// Fixed code uses equicontrast formula → moves toward black → finds solution
const gray128 = {r: 128, g: 128, b: 128};
const adj1 = adjustForContrast(gray128, gray128, 4.5);
assert(adj1 !== null, 'mid-gray fg/bg adjustForContrast returns non-null (not stuck going toward white)');
assert(adj1 !== null && contrastRatio(adj1, gray128) >= 4.5, 'adjusted color meets 4.5:1 target vs gray128',
  adj1 ? `contrast=${contrastRatio(adj1, gray128).toFixed(3)} adj=${JSON.stringify(adj1)}` : 'null');
assert(adj1 !== null && adj1.r < 128, 'adjusted color moves toward BLACK (not white) for mid-gray bg',
  adj1 ? `adj.r=${adj1.r}` : 'null');

// Darker gray bg (lum≈0.319) — white gives 2.85, black gives 7.37
const gray153 = {r: 153, g: 153, b: 153};
const adj2 = adjustForContrast({r: 200, g: 200, b: 200}, gray153, 4.5);
assert(adj2 !== null, 'gray153 bg: light fg adjusts toward black');
assert(adj2 !== null && contrastRatio(adj2, gray153) >= 4.5, 'gray153 result meets 4.5:1');

// Very dark bg (lum≈0.045) — white gives 11:1, black gives 1.9:1
// Code should move toward white
const gray60 = {r: 60, g: 60, b: 60};
const adj3 = adjustForContrast({r: 80, g: 80, b: 80}, gray60, 4.5);
assert(adj3 !== null, 'dark bg: fg adjusts toward white');
assert(adj3 !== null && adj3.r > 80, 'dark bg: adjusted color moves toward WHITE', adj3 ? `adj.r=${adj3.r}` : 'null');
assert(adj3 !== null && contrastRatio(adj3, gray60) >= 4.5, 'dark bg result meets 4.5:1');

// Already-passing pair must return fg unchanged
const white = {r: 255, g: 255, b: 255}, black = {r: 0, g: 0, b: 0};
const adj4 = adjustForContrast(white, black, 4.5);
assert(adj4 === white, 'already-passing pair returns fg object identity');

// ─────────────────────────────────────────────────────────────────
// contrastRatio: no division by zero
// ─────────────────────────────────────────────────────────────────
console.log('\n── contrastRatio: edge arithmetic ──');
assert(contrastRatio(black, black) === 1, 'contrastRatio(black,black) = 1 (no div/zero)');
assert(contrastRatio(white, white) === 1, 'contrastRatio(white,white) = 1');
assert(Math.abs(contrastRatio(white, black) - 21) < 0.01, 'contrastRatio(white,black) ≈ 21');

// ─────────────────────────────────────────────────────────────────
// adjustForContrast: alpha channel preservation (round-6 BUG 6, codex-2 find)
// When fg has alpha < 1, returned color must preserve alpha.
// ─────────────────────────────────────────────────────────────────
console.log('\n── adjustForContrast: alpha preservation ──');

const rgba200 = parseColor('rgba(200, 200, 200, 0.5)');
assert(rgba200 !== null, 'rgba(200,200,200,0.5) parses');
if (rgba200) {
  // v1.14.3: translucent fg returns null (skip) rather than adjusting to a misleading
  // opaque color — relLuminance ignores alpha so any "adjusted" value would lie about
  // meeting WCAG when composited over the real bg. apply.mjs:321 skips on null,
  // preserving the author's original transparency.
  const adjAlpha = adjustForContrast(rgba200, {r: 255, g: 255, b: 255}, 4.5);
  assert(adjAlpha === null, 'translucent fg → null (no false WCAG guarantee)',
    adjAlpha ? `got ${JSON.stringify(adjAlpha)}` : 'null');
}

// ─────────────────────────────────────────────────────────────────
// colorToString: out-of-range clamping
// ─────────────────────────────────────────────────────────────────
console.log('\n── colorToString: clamping ──');
assert(colorToString({r: 300, g: -5, b: 127}) === '#ff007f', 'out-of-range values clamped correctly');

// ─────────────────────────────────────────────────────────────────
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
