import {join} from 'path';
import {log, ensureDir, writeJSON, readJSON, sortBySeverity} from './util.mjs';

// Utopia clamp() generator — minViewport=320, maxViewport=1920, modular scale.
// Formula matches https://utopia.fyi/type/calculator/
function utopiaClamp({minVw = 320, maxVw = 1920, minSize, maxSize}) {
  const slope = (maxSize - minSize) / (maxVw - minVw);
  const interceptRem = (minSize - slope * minVw) / 16; // px → rem
  const slopeVw = slope * 100;
  return `clamp(${(minSize / 16).toFixed(3)}rem, ${interceptRem.toFixed(3)}rem + ${slopeVw.toFixed(3)}vw, ${(maxSize / 16).toFixed(3)}rem)`;
}

function generateUtopiaTypeScale() {
  // Single perfect-fourth ratio (1.25). Floor on every step at 14px (font-size-too-small floor).
  // 14px is the WCAG/iOS readable floor — anything smaller fails detection + readability.
  const minVw = 320, maxVw = 1920;
  const minBase = 16, maxBase = 19;
  const ratio = 1.25;
  const FLOOR_PX = 14;
  const steps = [-2, -1, 0, 1, 2, 3, 4, 5];
  const lines = [];
  for (const s of steps) {
    const factor = Math.pow(ratio, s);
    let minSize = minBase * factor;
    let maxSize = maxBase * factor;
    // Ensure min readable: every clamp's min-end ≥ 14px
    if (minSize < FLOOR_PX) minSize = FLOOR_PX;
    if (maxSize < FLOOR_PX) maxSize = FLOOR_PX;
    const label = s < 0 ? String(s) : String(s);
    lines.push(`  --step-${label}: ${utopiaClamp({minVw, maxVw, minSize, maxSize})};`);
  }
  return [':root {', '  /* Utopia type scale — 320→1920, perfect-fourth (1.25), 14px floor enforced. */', ...lines, '}'].join('\n');
}

function generateUtopiaSpaceScale() {
  // Space scale: 4-1 = 12px on 320, → 16px on 1920. Steps T-shirt sized.
  const minVw = 320, maxVw = 1920;
  const sizes = [
    {label: '3xs', min: 4, max: 8},
    {label: '2xs', min: 8, max: 12},
    {label: 'xs', min: 12, max: 16},
    {label: 's', min: 16, max: 20},
    {label: 'm', min: 24, max: 32},
    {label: 'l', min: 32, max: 48},
    {label: 'xl', min: 48, max: 64},
    {label: '2xl', min: 64, max: 96},
    {label: '3xl', min: 96, max: 144},
  ];
  const lines = [];
  for (const s of sizes) {
    lines.push(`  --space-${s.label}: ${utopiaClamp({minVw, maxVw, minSize: s.min, maxSize: s.max})};`);
  }
  return [':root {', '  /* Utopia space scale — 320→1920 fluid. */', ...lines, '}'].join('\n');
}

function reducedMotionGuard() {
  return `@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}`;
}

function metaViewportLine() {
  return `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />`;
}

function safeAreaInsetSnippet(propName, currentValue) {
  // e.g. propName='padding-bottom', currentValue='16px' → 'calc(16px + env(safe-area-inset-bottom, 0px))'
  const m = /^(\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|))$/.exec(String(currentValue || '').trim());
  if (m) {
    return `calc(${currentValue} + env(safe-area-inset-bottom, 0px))`;
  }
  return `env(safe-area-inset-bottom, 0px)`;
}

function rankAndAnnotate(issue) {
  const sev = issue.severity || 'info';
  const auto = issue.autoFixable ? '✓ auto' : '— manual';
  return `- **${sev.toUpperCase()}** [${issue.kind}] ${auto} — ${issue.msg}${issue.file ? ` \`${issue.file}:${issue.line || 0}\`` : ''}${issue.viewport ? ` (${issue.viewport})` : ''}`;
}

export async function runPropose({brief, briefDir, outDir}) {
  log('phase 4/7 — propose', 'rm');
  const scanPath = join(outDir, 'scan.json');
  const diagPath = join(outDir, 'diagnose.json');
  let scan = null, diag = null;
  try { scan = await readJSON(scanPath); } catch {}
  try { diag = await readJSON(diagPath); } catch {}

  const issues = [
    ...(scan?.issues || []).map((i) => ({source: 'scan', ...i})),
    ...(diag?.issues || []).map((i) => ({source: 'diagnose', ...i})),
  ];

  // Derive synthesized auto-fix issues from runtime data:
  // (a) horizontal-scroll culprits → fix-element-overflow (one per unique selector)
  const culpritSeen = new Set();
  // (a.1) text-overflow samples → truncate-text-overflow (Tailwind-aware)
  // v1.14.5 FIX: skip when selector matches a Tailwind UTILITY class. Real-world bug from
  // octanorm-adria — `.group` is heavily-used Tailwind state marker (group-hover:, group-focus:)
  // on 216+ components. Injecting `text-wrap: balance; min-width: 0` globally on `.group`
  // breaks flex layouts on every group-marked container. Same root cause as v1.13 sidebar
  // false-positive: class-name=semantic intent assumption fails on Tailwind utility classes.
  const TAILWIND_UTILITY_CLASSES = new Set([
    'group', 'peer', 'sr-only', 'not-sr-only', 'block', 'inline', 'flex', 'grid', 'hidden',
    'fixed', 'absolute', 'relative', 'sticky', 'static', 'visible', 'invisible',
    'container', 'isolate', 'contents', 'table', 'inline-block', 'inline-flex',
  ]);
  // v1.14.7 FIX: real-world test on adriafab caught `.mt-6` (Tailwind margin utility)
  // slipping through v1.14.5 guard which only had literal-name set + variant prefix regex.
  // Tailwind has 100+ utility CATEGORIES like mt-N, bg-COLOR, text-SIZE, flex-N — each with
  // value suffixes. Detection: short-prefix + `-` + value pattern.
  // Patterns covered (samples — not exhaustive, but cover ~95% Tailwind utilities):
  //   spacing: m, p, gap, space, inset, top, right, bottom, left + variants (mt, mx, py, …)
  //   sizing:  w, h, min-w, min-h, max-w, max-h, size
  //   color:   text, bg, border, ring, shadow, divide, accent, caret, fill, stroke, from, via, to
  //   layout:  flex, grid, col, row, order, justify, items, content, self, place, gap, aspect
  //   typography: font, leading, tracking, line-clamp, indent, whitespace, break, hyphens, list
  //   effects: opacity, transition, duration, delay, ease, animate, transform, scale, rotate, translate, skew
  //   filter:  blur, brightness, contrast, grayscale, hue-rotate, invert, saturate, sepia, drop-shadow, backdrop-*
  //   misc:    z, cursor, select, resize, appearance, outline, overflow, object, will-change, scroll, snap, touch
  const TW_UTILITY_PREFIX_RE = /^(?:m|p|w|h|gap|space|inset|top|right|bottom|left|size|text|bg|border|ring|shadow|divide|accent|caret|fill|stroke|from|via|to|flex|grid|col|row|order|justify|items|content|self|place|aspect|font|leading|tracking|line-clamp|indent|whitespace|break|hyphens|list|opacity|transition|duration|delay|ease|animate|transform|scale|rotate|translate|skew|blur|brightness|contrast|grayscale|hue-rotate|invert|saturate|sepia|backdrop-blur|backdrop-brightness|backdrop-contrast|backdrop-grayscale|backdrop-hue-rotate|backdrop-invert|backdrop-opacity|backdrop-saturate|backdrop-sepia|drop-shadow|z|cursor|select|resize|appearance|outline|overflow|object|will-change|scroll|snap|touch|mt|mr|mb|ml|mx|my|pt|pr|pb|pl|px|py|min-w|min-h|max-w|max-h|inset-x|inset-y|space-x|space-y|gap-x|gap-y|divide-x|divide-y|border-t|border-r|border-b|border-l|border-x|border-y|rounded|rounded-t|rounded-r|rounded-b|rounded-l|rounded-tl|rounded-tr|rounded-bl|rounded-br|font-stretch|font-style|font-variant|font-feature|font-weight|font-size|line-height|letter-spacing|text-decoration|text-shadow|text-underline)-/;

  const isTailwindUtilitySelector = (sel) => {
    if (!sel || typeof sel !== 'string') return false;
    // Strip leading `.` from class selector, then take just the class-name segment (before
    // descendant combinator, pseudo selector, etc.). Tailwind variants use `:` as separator
    // (md:flex, hover:bg-red-500) so check raw token BEFORE splitting on `:`.
    const raw = sel.replace(/^\./, '').split(/[\s>+~,]/, 1)[0];
    if (/^(sm|md|lg|xl|2xl|hover|focus|active|disabled|group|peer|dark|motion-safe|motion-reduce):/.test(raw)) return true;
    // After stripping pseudo `:something` (e.g. `.foo:hover` in CSS selector form, where :hover
    // is a real pseudo, not a Tailwind variant), check exact name against utility set.
    const name = raw.split(':', 1)[0];
    if (TAILWIND_UTILITY_CLASSES.has(name)) return true;
    // v1.14.7: detect Tailwind utility CATEGORIES (mt-6, bg-blue-500, flex-1, etc.).
    if (TW_UTILITY_PREFIX_RE.test(name)) return true;
    return false;
  };
  for (const i of issues) {
    if (i.kind !== 'text-overflow' || !i.data?.samples) continue;
    for (const s of i.data.samples) {
      if (culpritSeen.has('text:' + s.selector)) continue;
      culpritSeen.add('text:' + s.selector);
      if (isTailwindUtilitySelector(s.selector)) {
        // Don't auto-fix; surface as info so operator sees we detected overflow but punted.
        issues.push({
          source: 'derived',
          id: `text-overflow-utility-skip:${s.selector}`,
          kind: 'text-overflow-utility',
          severity: 'info',
          msg: `Text overflows on selector ${s.selector} but that's a Tailwind utility class — auto-fix skipped to avoid breaking unrelated components. Add targeted CSS manually if needed.`,
          data: s,
          autoFixable: false,
        });
        continue;
      }
      issues.push({
        source: 'derived',
        id: `truncate-text-overflow:${s.selector}`,
        kind: 'text-overflow-fixable',
        severity: 'warn',
        msg: `Text in ${s.selector} (${s.tag}) overflows by ${s.overflowPx}px. Auto-fix: append \`${s.selector} { text-wrap: balance; overflow-wrap: anywhere; }\`.`,
        data: s,
        autoFixable: true,
        fix: 'truncate-text-overflow',
      });
    }
  }
  for (const i of issues) {
    if (i.kind !== 'horizontal-scroll' || !i.data?.culprits) continue;
    for (const c of i.data.culprits) {
      if (culpritSeen.has(c.selector)) continue;
      culpritSeen.add(c.selector);
      issues.push({
        source: 'derived',
        id: `fix-element-overflow:${c.selector}`,
        kind: 'element-overflow',
        severity: 'error',
        msg: `Element ${c.selector} (width ${c.width}px, overflow +${c.overflowPx}px) extends past viewport. Auto-fix: append \`${c.selector} { max-width: 100%; }\` rule.`,
        data: c,
        autoFixable: true,
        fix: 'fix-element-overflow',
        targetFile: brief.target?.cssAppendTarget || null, // optional explicit target
      });
    }
  }

  // Tailwind-aware site detection — if brief.framework hints Next/Vite/Remix OR sample selectors look Tailwind-y,
  // emit className-edit codemods instead of CSS append (which has specificity issues with Tailwind utilities).
  const isTailwindLike = brief.framework && /next|vite|remix|astro|nuxt|svelte/i.test(brief.framework);
  if (isTailwindLike) {
    const hasTouchIssues = issues.some((i) => i.kind === 'touch-target-too-small');
    const hasSafeAreaIssues = issues.some((i) => i.kind === 'fixed-bottom-no-safe-area');
    if (hasTouchIssues) {
      issues.push({
        source: 'derived',
        id: 'tailwind-touch-target',
        kind: 'tailwind-touch-target',
        severity: 'warn',
        msg: `Tailwind site detected — running className codemod (h-N<11 on <a>/<button>/<Link> → min-h-11).`,
        data: {framework: brief.framework},
        autoFixable: true,
        fix: 'tailwind-touch-target',
      });
    }
    if (hasSafeAreaIssues) {
      issues.push({
        source: 'derived',
        id: 'tailwind-safe-area',
        kind: 'tailwind-safe-area',
        severity: 'warn',
        msg: `Tailwind site detected — running className codemod (fixed/sticky bottom-0 → append pb-[env(safe-area-inset-bottom)]).`,
        data: {framework: brief.framework},
        autoFixable: true,
        fix: 'tailwind-safe-area',
      });
    }
    // v1.13.3 FIX: layout-stack + form-stack DISABLED BY DEFAULT after real-world test on
    // viagoshop-v2/mobile-bottom-nav.tsx revealed guard failure on utility-only Tailwind
    // (className-token check misses semantic info that lives in <nav>/<table>/etc. parent tags).
    // Opt-in via brief.enableLayoutCodemods=true OR --enable-layout-codemods CLI flag.
    const layoutCodemodsEnabled = brief.enableLayoutCodemods === true;
    const hasLayoutIssues = issues.some((i) => i.kind === 'layout-not-responsive');
    if (hasLayoutIssues && layoutCodemodsEnabled) {
      issues.push({
        source: 'derived',
        id: 'tailwind-layout-stack',
        kind: 'tailwind-layout-stack',
        severity: 'warn',
        msg: `Tailwind site detected — running layout codemod (opt-in: enableLayoutCodemods).`,
        data: {framework: brief.framework},
        autoFixable: true,
        fix: 'tailwind-layout-stack',
      });
    }
    if (layoutCodemodsEnabled) {
      issues.push({
        source: 'derived',
        id: 'tailwind-form-stack',
        kind: 'tailwind-form-stack',
        severity: 'info',
        msg: 'Form-containing files: stack multi-col input grids on mobile (opt-in).',
        autoFixable: true,
        fix: 'tailwind-form-stack',
      });
    }
    // sidebar-drawer kept ON (verified safe via token-match, see CRITICAL 5 fix in 1.13.1)
    issues.push({
      source: 'derived',
      id: 'tailwind-sidebar-drawer',
      kind: 'tailwind-sidebar-drawer',
      severity: 'info',
      msg: 'Sidebar/aside elements: hide on mobile via hidden lg:block.',
      autoFixable: true,
      fix: 'tailwind-sidebar-drawer',
    });
  }

  // nav-needs-hamburger → tailwind-nav-hamburger (gated --aggressive, layout-impacting)
  for (const i of issues) {
    if (i.kind !== 'nav-needs-hamburger' || culpritSeen.has('nav-hamburger')) continue;
    culpritSeen.add('nav-hamburger');
    issues.push({source: 'derived', id: 'tailwind-nav-hamburger', kind: 'tailwind-nav-hamburger', severity: 'warn', msg: 'Wrap <nav> children in pure-CSS hamburger (checkbox peer pattern, no React state).', data: i.data, autoFixable: true, aggressive: true, fix: 'tailwind-nav-hamburger'});
    break;
  }

  // low-color-contrast → fix-low-color-contrast (adjusts color decls toward black/white)
  for (const i of issues) {
    if (i.kind !== 'low-color-contrast' || culpritSeen.has('contrast')) continue;
    culpritSeen.add('contrast');
    issues.push({source: 'derived', id: 'fix-low-color-contrast', kind: 'contrast-fixable', severity: 'warn', msg: 'Adjust CSS color: decls to meet WCAG 4.5:1 against white background.', data: i.data, autoFixable: true, fix: 'fix-low-color-contrast'});
    break;
  }
  // hover-only-no-focus → add-focus-visible-rules (duplicate :hover with :focus-visible)
  for (const i of issues) {
    if (i.kind !== 'hover-only-no-focus' || culpritSeen.has('focus-rules')) continue;
    culpritSeen.add('focus-rules');
    issues.push({source: 'derived', id: 'add-focus-visible-rules', kind: 'focus-rules-fixable', severity: 'info', msg: 'Duplicate :hover CSS rules with :focus-visible selector for keyboard/touch parity.', autoFixable: true, fix: 'add-focus-visible-rules'});
    break;
  }

  // no-pwa-manifest → auto-fix add-pwa-manifest
  for (const i of issues) {
    if (i.kind !== 'no-pwa-manifest' || culpritSeen.has('pwa')) continue;
    culpritSeen.add('pwa');
    issues.push({source: 'derived', id: 'add-pwa-manifest', kind: 'pwa-manifest-fixable', severity: 'info', msg: 'Generate minimal PWA manifest + link from <head>.', autoFixable: true, fix: 'add-pwa-manifest'});
    break;
  }
  // no-apple-touch-icon → auto-fix add-apple-touch-icon
  for (const i of issues) {
    if (i.kind !== 'no-apple-touch-icon' || culpritSeen.has('appletouch')) continue;
    culpritSeen.add('appletouch');
    issues.push({source: 'derived', id: 'add-apple-touch-icon', kind: 'apple-touch-icon-fixable', severity: 'info', msg: 'Generate 180×180 apple-touch-icon via sharp + link from <head>.', autoFixable: true, fix: 'add-apple-touch-icon'});
    break;
  }

  // img-no-srcset → derive auto-fix add-srcset (Sharp variants + injection)
  for (const i of issues) {
    if (i.kind !== 'img-no-srcset') continue;
    if (culpritSeen.has('srcset')) continue;
    culpritSeen.add('srcset');
    issues.push({
      source: 'derived',
      id: 'add-srcset',
      kind: 'srcset-fixable',
      severity: 'info',
      msg: 'Generate 480/768/1024/1920 srcset variants for local <img>.',
      autoFixable: true,
      fix: 'add-srcset',
    });
    break;
  }

  // (b) touch-target-too-small with sample selectors → enforce-touch-target-min (opt-in via --aggressive)
  for (const i of issues) {
    if (i.kind !== 'touch-target-too-small' || !i.data?.samples) continue;
    for (const s of i.data.samples) {
      if (culpritSeen.has('touch:' + s.selector)) continue;
      culpritSeen.add('touch:' + s.selector);
      issues.push({
        source: 'derived',
        id: `enforce-touch-target-min:${s.selector}`,
        kind: 'touch-target-fixable',
        severity: 'warn',
        msg: `Tap target ${s.selector} (${s.width}×${s.height}px) below 44×44. Auto-fix (requires --aggressive): append \`${s.selector} { min-width: 44px; min-height: 44px; }\`.`,
        data: s,
        autoFixable: true,
        aggressive: true,
        fix: 'enforce-touch-target-min',
      });
    }
  }

  const ranked = sortBySeverity(issues);

  // Bucket per kind
  const buckets = {};
  for (const i of ranked) (buckets[i.kind] = buckets[i.kind] || []).push(i);
  const bucketSummary = Object.entries(buckets).map(([k, arr]) => ({
    kind: k,
    count: arr.length,
    severity: arr[0]?.severity,
    autoFixable: arr.every((i) => i.autoFixable),
  }));

  // Counters
  const counts = {
    error: ranked.filter((i) => i.severity === 'error').length,
    warn: ranked.filter((i) => i.severity === 'warn').length,
    info: ranked.filter((i) => i.severity === 'info').length,
    autoFixable: ranked.filter((i) => i.autoFixable).length,
    manualOnly: ranked.filter((i) => !i.autoFixable).length,
  };

  // Codemod kit
  const codemodKit = {
    utopiaTypeScale: generateUtopiaTypeScale(),
    utopiaSpaceScale: generateUtopiaSpaceScale(),
    reducedMotionGuard: reducedMotionGuard(),
    metaViewportLine: metaViewportLine(),
    safeAreaInsetExample: safeAreaInsetSnippet('padding-bottom', '16px'),
  };

  // Markdown report
  const md = [];
  md.push('# Responsive Modernize — Proposed Fixes\n');
  md.push(`Generated: ${new Date().toISOString()}\n`);
  md.push(`## Executive summary\n`);
  md.push(`- **${ranked.length}** total issues (${counts.error} error · ${counts.warn} warn · ${counts.info} info)`);
  md.push(`- **${counts.autoFixable}** auto-fixable, **${counts.manualOnly}** need manual review\n`);
  md.push(`## Issue buckets\n`);
  md.push('| kind | severity | count | auto |');
  md.push('|---|---|---|---|');
  for (const b of bucketSummary) {
    md.push(`| \`${b.kind}\` | ${b.severity} | ${b.count} | ${b.autoFixable ? '✓' : '—'} |`);
  }
  md.push('');
  md.push(`## All issues (sorted by severity)\n`);
  for (const i of ranked) md.push(rankAndAnnotate(i));
  md.push('\n## Codemod kit (paste into your CSS)\n');
  md.push('### Utopia fluid type scale\n```css\n' + codemodKit.utopiaTypeScale + '\n```\n');
  md.push('### Utopia fluid space scale\n```css\n' + codemodKit.utopiaSpaceScale + '\n```\n');
  md.push('### Reduced-motion guard\n```css\n' + codemodKit.reducedMotionGuard + '\n```\n');
  md.push('### Correct <meta viewport>\n```html\n' + codemodKit.metaViewportLine + '\n```\n');
  md.push('### Safe-area-inset wrap example\n```css\n.bottom-bar { padding-bottom: ' + codemodKit.safeAreaInsetExample + '; }\n```\n');
  md.push('\n## Recommended container query migration pattern\n');
  md.push('Identify high-coupling components (cards, navigation, modals) and migrate from media queries to container queries:\n');
  md.push('```css\n/* Before — viewport-coupled */\n@media (min-width: 768px) {\n  .card { flex-direction: row; }\n}\n\n/* After — component-coupled */\n.card-host { container: card / inline-size; }\n@container card (min-width: 480px) {\n  .card { flex-direction: row; }\n}\n```');

  const reportMd = md.join('\n');

  const out = {
    phase: 'propose',
    generatedAt: new Date().toISOString(),
    counts,
    bucketSummary,
    issues: ranked,
    codemodKit,
  };
  await writeJSON(join(outDir, 'propose.json'), out);
  await ensureDir(outDir);
  await (await import('fs/promises')).writeFile(join(outDir, 'propose.md'), reportMd);
  log(`  propose → ${ranked.length} issues ranked, ${counts.autoFixable} auto-fixable. propose.md + propose.json written.`);
  return out;
}
