import {readFile} from 'fs/promises';
import {relative} from 'path';
import {globby} from 'globby';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import * as cheerio from 'cheerio';
import {log, writeJSON, ensureDir} from './util.mjs';
import {scanSFC, scanVanillaExtract} from './sfcScan.mjs';

const DEFAULT_CSS_PATTERNS = ['**/*.{css,scss,sass,less}', '!node_modules/**', '!.next/**', '!.cache/**', '!.responsive-modernize/**', '!dist/**', '!build/**', '!out/**', '!.git/**'];
const DEFAULT_HTML_PATTERNS = ['**/*.html', '!node_modules/**', '!.next/**', '!.cache/**', '!.responsive-modernize/**', '!.git/**'];
const DEFAULT_CSS_IN_JS_PATTERNS = ['src/**/*.{tsx,jsx,ts,js}', 'app/**/*.{tsx,jsx,ts,js}', 'components/**/*.{tsx,jsx,ts,js}', '!node_modules/**', '!.next/**', '!.responsive-modernize/**', '!**/*.css.ts', '!**/*.css.js'];
const DEFAULT_SFC_PATTERNS = ['**/*.{vue,svelte,astro}', '!node_modules/**', '!.next/**', '!.responsive-modernize/**', '!dist/**', '!build/**'];
const DEFAULT_VANILLA_EXTRACT_PATTERNS = ['**/*.css.{ts,js}', '!node_modules/**', '!.next/**', '!.responsive-modernize/**'];

function pushIssue(issues, issue) {
  issues.push({
    id: `${issue.kind}:${issue.file}:${issue.line || 0}`,
    autoFixable: issue.autoFixable ?? false,
    ...issue,
  });
}

async function scanCSS(filePath, projectRoot) {
  const css = await readFile(filePath, 'utf8');
  const rel = relative(projectRoot, filePath);
  const issues = [];
  // Skip files that are clearly Tailwind v4 / non-standard CSS (postcss base can't parse @theme/@apply/@layer).
  // These files are token configs — scan-irrelevant.
  if (/@theme\b|@apply\b|@variant\b|@source\b|@layer\s+/.test(css) || /tailwindcss/i.test(filePath)) {
    return {issues: [], stats: {mediaQueryCount: 0, containerQueryCount: 0, skippedTailwind: true}};
  }
  // SCSS/SASS dedicated parser for nesting + @use/@forward/etc syntax
  const isScss = /\.s(c|a)ss$/i.test(filePath);
  let root;
  try {
    if (isScss) {
      const scssParser = await import('postcss-scss').then((m) => m.default || m).catch(() => null);
      root = scssParser
        ? postcss.parse(css, {from: filePath, parser: scssParser})
        : postcss.parse(css, {from: filePath});
    } else {
      root = postcss.parse(css, {from: filePath});
    }
  } catch (e) {
    // Parse errors are typically Tailwind v4 directives or .scss/.sass syntax — silent skip is better
    // than 79 noise issues that bury real findings.
    return {issues: [], stats: {mediaQueryCount: 0, containerQueryCount: 0, skippedParseError: true}};
  }

  let mediaQueryCount = 0;
  let containerQueryCount = 0;
  const mediaQueryRules = [];
  const hardcodedPxFonts = [];
  const hardcodedPxSpacing = [];
  const fixedFullWidths = [];
  const fixedNoSafeArea = [];
  let hasPrefersReducedMotion = false;
  let hasPrefersColorScheme = false;

  root.walkAtRules((rule) => {
    if (rule.name === 'media') {
      mediaQueryCount++;
      mediaQueryRules.push({params: rule.params, line: rule.source?.start?.line || 0});
      if (/prefers-reduced-motion/.test(rule.params)) hasPrefersReducedMotion = true;
      if (/prefers-color-scheme/.test(rule.params)) hasPrefersColorScheme = true;
    } else if (rule.name === 'container') {
      containerQueryCount++;
    }
  });

  root.walkDecls((decl) => {
    const line = decl.source?.start?.line || 0;

    // Hardcoded px font-size — non-fluid
    if (/^font-size$/i.test(decl.prop)) {
      const v = valueParser(decl.value).nodes[0];
      if (v && v.type === 'word' && /^\d+(\.\d+)?px$/.test(v.value)) {
        const px = parseFloat(v.value);
        if (px > 0 && !/var\(|clamp\(|calc\(/.test(decl.value)) {
          hardcodedPxFonts.push({line, value: decl.value, px});
        }
      }
    }

    // Fixed/absolute positioned bottom without safe-area-inset
    if (/^(bottom|padding-bottom)$/.test(decl.prop)) {
      const parentRule = decl.parent;
      if (parentRule && parentRule.type === 'rule') {
        const posDecl = parentRule.nodes?.find?.((n) => n.type === 'decl' && n.prop === 'position');
        if (posDecl && /^(fixed|sticky)$/.test(posDecl.value)) {
          if (!/safe-area-inset|env\(/.test(decl.value)) {
            fixedNoSafeArea.push({line, selector: parentRule.selector, decl: `${decl.prop}: ${decl.value}`});
          }
        }
      }
    }

    // Hardcoded spacing — padding/margin/gap with px units (auto-migrable to --space-*)
    if (/^(padding|margin|gap|row-gap|column-gap|padding-(top|right|bottom|left)|margin-(top|right|bottom|left))$/i.test(decl.prop)) {
      const m = /^(\d+(?:\.\d+)?)px$/.exec(decl.value.trim());
      if (m && !/var\(|clamp\(|calc\(/.test(decl.value)) {
        const px = parseFloat(m[1]);
        if (px >= 4) hardcodedPxSpacing.push({line, prop: decl.prop, value: decl.value, px});
      }
    }

    // Hardcoded width that exceeds viewport
    if (/^(width|min-width)$/.test(decl.prop)) {
      const v = decl.value;
      const m = /^(\d+)(px|rem|em)$/.exec(v);
      if (m) {
        const val = parseFloat(m[1]);
        const unit = m[2];
        const px = unit === 'px' ? val : unit === 'rem' ? val * 16 : val * 16;
        if (px >= 1200) fixedFullWidths.push({line, prop: decl.prop, value: v, px});
      }
    }
  });

  // Emit issues
  if (mediaQueryCount >= 6 && containerQueryCount === 0) {
    pushIssue(issues, {
      kind: 'mq-bloat-no-cq',
      file: rel,
      line: 0,
      severity: 'warn',
      msg: `${mediaQueryCount} @media rules and 0 @container queries. Likely candidates for component-level CQ migration.`,
      data: {mediaQueries: mediaQueryCount, containerQueries: containerQueryCount},
      autoFixable: false,
    });
  }

  if (hardcodedPxFonts.length >= 3) {
    pushIssue(issues, {
      kind: 'fluid-type-opportunity',
      file: rel,
      line: hardcodedPxFonts[0].line,
      severity: 'info',
      msg: `${hardcodedPxFonts.length} hardcoded px font-sizes — Utopia fluid clamp() scale would replace them.`,
      data: {sites: hardcodedPxFonts},
      autoFixable: true,
      fix: 'inject-utopia-scale',
    });
    // Chained: now that we have a scale, migrate the hardcoded values to tokens
    pushIssue(issues, {
      kind: 'px-font-not-token',
      file: rel,
      line: hardcodedPxFonts[0].line,
      severity: 'info',
      msg: `${hardcodedPxFonts.length} hardcoded px font-sizes can be auto-migrated to var(--step-X) tokens.`,
      data: {sites: hardcodedPxFonts},
      autoFixable: true,
      fix: 'migrate-px-fonts-to-utopia',
    });
  }

  if (hardcodedPxSpacing.length >= 5) {
    pushIssue(issues, {
      kind: 'px-spacing-not-token',
      file: rel,
      line: hardcodedPxSpacing[0].line,
      severity: 'info',
      msg: `${hardcodedPxSpacing.length} hardcoded px spacing values (padding/margin/gap) can be auto-migrated to var(--space-X) tokens.`,
      data: {sites: hardcodedPxSpacing},
      autoFixable: true,
      fix: 'migrate-px-spacing-to-utopia',
    });
  }

  for (const f of fixedNoSafeArea) {
    pushIssue(issues, {
      kind: 'fixed-no-safe-area',
      file: rel,
      line: f.line,
      severity: 'error',
      msg: `position: fixed/sticky '${f.selector}' uses '${f.decl}' without env(safe-area-inset-*) — overlaps iPhone home indicator + Android nav bar.`,
      data: f,
      autoFixable: true,
      fix: 'add-safe-area-inset',
    });
  }

  for (const f of fixedFullWidths) {
    pushIssue(issues, {
      kind: 'fixed-width-overflow',
      file: rel,
      line: f.line,
      severity: 'warn',
      msg: `${f.prop}: ${f.value} — fixed width ≥1200px causes horizontal scroll on every mobile device. Auto-fix: wrap in min(100%, NNpx).`,
      data: f,
      autoFixable: true,
      fix: 'fix-fixed-width-overflow',
    });
  }

  if (!hasPrefersReducedMotion && root.toString().match(/animation|transition.*\d/i)) {
    pushIssue(issues, {
      kind: 'no-reduced-motion-guard',
      file: rel,
      line: 0,
      severity: 'warn',
      msg: 'Animations present but no @media (prefers-reduced-motion: reduce) override. Accessibility risk + Safari iOS preference ignored.',
      autoFixable: true,
      fix: 'inject-reduced-motion-guard',
    });
  }

  return {issues, stats: {mediaQueryCount, containerQueryCount, fontDeclCount: hardcodedPxFonts.length, hasPrefersReducedMotion, hasPrefersColorScheme}};
}

async function scanInlineCSS(html, filePath, projectRoot) {
  // Extract <style> contents + concat, then run scanCSS-style checks.
  const $ = cheerio.load(html);
  const styleBlocks = [];
  $('style').each((_, el) => {
    styleBlocks.push($(el).html() || '');
  });
  if (styleBlocks.length === 0) return {issues: [], stats: {mediaQueryCount: 0, containerQueryCount: 0}};
  const combined = styleBlocks.join('\n/* --- style block --- */\n');
  // Reuse scanCSS by writing to a virtual filename
  const rel = relative(projectRoot, filePath) + '#inline-style';
  // We can't easily pass raw text to scanCSS as it reads file — inline the parse here:
  const issues = [];
  let root;
  try {
    root = postcss.parse(combined, {from: rel});
  } catch (e) {
    return {issues, stats: {mediaQueryCount: 0, containerQueryCount: 0}};
  }
  let mediaQueryCount = 0;
  let containerQueryCount = 0;
  let hasPrefersReducedMotion = false;
  root.walkAtRules((rule) => {
    if (rule.name === 'media') {
      mediaQueryCount++;
      if (/prefers-reduced-motion/.test(rule.params)) hasPrefersReducedMotion = true;
    } else if (rule.name === 'container') containerQueryCount++;
  });
  if (mediaQueryCount >= 6 && containerQueryCount === 0) {
    pushIssue(issues, {
      kind: 'mq-bloat-no-cq',
      file: rel,
      line: 0,
      severity: 'warn',
      msg: `${mediaQueryCount} @media rules in inline <style>, 0 @container. Strong CQ migration candidate (also: extract to .css file).`,
      data: {mediaQueries: mediaQueryCount, containerQueries: containerQueryCount, inline: true},
      autoFixable: false,
    });
  }
  if (!hasPrefersReducedMotion && /animation|transition.*\d/i.test(combined)) {
    pushIssue(issues, {
      kind: 'no-reduced-motion-guard',
      file: rel,
      line: 0,
      severity: 'warn',
      msg: 'Animations present in inline <style> but no @media (prefers-reduced-motion: reduce) override.',
      autoFixable: false,
    });
  }
  return {issues, stats: {mediaQueryCount, containerQueryCount}};
}

/**
 * Fix 5: CSS-in-JS detection.
 *
 * Many React/Vue codebases hold their CSS inside .tsx/.jsx as template literals:
 *   styled.div`color: red; font-size: 14px;`
 *   styled(Component)`...`
 *   css`...` (emotion + linaria)
 *   tw`...` (twin.macro)
 * Extract those bodies and run them through scanCSS — otherwise the project
 * looks responsive-empty when 60% of styles live in JS.
 */
async function scanCSSInJS(filePath, projectRoot) {
  const text = await readFile(filePath, 'utf8');
  const rel = relative(projectRoot, filePath);
  // Detected runtime via imports — used to label findings + populate stats.
  const runtimes = [];
  if (/from\s+['"](?:styled-components|@emotion\/styled)/.test(text)) runtimes.push('styled-components');
  if (/from\s+['"]@emotion\/(?:react|css)/.test(text)) runtimes.push('emotion');
  if (/from\s+['"]twin\.macro/.test(text)) runtimes.push('twin.macro');
  if (/from\s+['"]@linaria\/(?:core|react)/.test(text)) runtimes.push('linaria');
  if (/from\s+['"]@stitches\/(?:react|core)/.test(text)) runtimes.push('stitches');
  if (/from\s+['"]@stylexjs\/stylex/.test(text)) runtimes.push('stylex');
  if (/from\s+['"][^'"]*styled-system\/css/.test(text)) runtimes.push('panda-css');
  if (/from\s+['"]solid-styled(?:-components)?/.test(text)) runtimes.push('solid-styled');
  if (/useStyles\$\s*\(/.test(text)) runtimes.push('qwik');
  // Cheap precheck — any of the supported runtime markers
  if (
    runtimes.length === 0 &&
    !/(styled[.\(]|\bcss`|\btw`|stylex\.create|css\(\{|cva\()/.test(text)
  ) return {issues: [], stats: {cssInJsBlocks: 0}};
  const blocks = [];
  // Template-literal forms (styled-components, emotion, linaria, twin.macro, qwik useStyles$)
  const STYLED_RE = /styled(?:[.<(]\w[\w.]*[>)]?)`([^`]*)`/g;
  const CSS_RE = /\bcss`([^`]*)`/g;
  const TW_RE = /\btw`([^`]*)`/g;
  // Qwik useStyles$(`...`) — same template literal pattern
  const QWIK_RE = /useStyles\$\s*\(\s*`([^`]*)`\s*\)/g;
  for (const re of [STYLED_RE, CSS_RE, TW_RE, QWIK_RE]) {
    let m;
    while ((m = re.exec(text))) blocks.push(m[1]);
  }
  // Object-style forms (Stylex, Panda, Stitches): postcss can't reliably parse synthesized object
  // bodies, so we directly extract `key: value` pairs via regex and emit a clean CSS rule
  // wrapper that postcss CAN parse.
  const OBJECT_STYLE_RE = /(?:stylex\.create|stylex\.props|css|styleVariants|cva|styled)\s*\([^)]*?\{([\s\S]*?)\}\s*\)/g;
  // matches: fontSize: '13px' | "fontSize": "13px" | padding: 10 | gap: '0.5rem'
  const KV_RE = /['"]?([a-zA-Z][a-zA-Z0-9]*)['"]?\s*:\s*['"]?([0-9][^,'"\n}]*)['"]?/g;
  let om;
  while ((om = OBJECT_STYLE_RE.exec(text))) {
    const objBody = om[1];
    const decls = [];
    let km;
    KV_RE.lastIndex = 0;
    while ((km = KV_RE.exec(objBody))) {
      const cssProp = km[1].replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
      let val = km[2].trim();
      // bare number → px (Stitches/styled-components convention)
      if (/^\d+(\.\d+)?$/.test(val)) val = `${val}px`;
      decls.push(`${cssProp}: ${val};`);
    }
    if (decls.length > 0) blocks.push(`.scan-${blocks.length} { ${decls.join(' ')} }`);
  }
  if (blocks.length === 0) return {issues: [], stats: {cssInJsBlocks: 0, runtimes}};
  const combined = blocks.join('\n/* --- css-in-js block --- */\n');
  // Reuse scanCSS-style checks by parsing the combined synthesized CSS.
  const issues = [];
  let root;
  try { root = postcss.parse(combined, {from: rel + '#css-in-js'}); } catch { return {issues, stats: {cssInJsBlocks: blocks.length, parseError: true}}; }
  let mediaQueryCount = 0;
  let containerQueryCount = 0;
  let hasPrefersReducedMotion = false;
  const hardcodedPxFonts = [];
  const hardcodedPxSpacing = [];
  root.walkAtRules((rule) => {
    if (rule.name === 'media') {
      mediaQueryCount++;
      if (/prefers-reduced-motion/.test(rule.params)) hasPrefersReducedMotion = true;
    } else if (rule.name === 'container') containerQueryCount++;
  });
  root.walkDecls((decl) => {
    if (/^font-size$/i.test(decl.prop)) {
      const m = /^(\d+(?:\.\d+)?)px$/.exec(decl.value.trim());
      if (m && !/var\(|clamp\(|calc\(/.test(decl.value)) hardcodedPxFonts.push({value: decl.value, px: parseFloat(m[1])});
    }
    if (/^(padding|margin|gap)$/i.test(decl.prop)) {
      const m = /^(\d+(?:\.\d+)?)px$/.exec(decl.value.trim());
      if (m && parseFloat(m[1]) >= 4) hardcodedPxSpacing.push({value: decl.value, px: parseFloat(m[1])});
    }
  });
  const runtimeNote = runtimes.length ? ` [${runtimes.join(',')}]` : '';
  if (hardcodedPxFonts.length >= 3) {
    pushIssue(issues, {
      kind: 'fluid-type-opportunity',
      file: rel + ` (css-in-js${runtimeNote})`,
      line: 0,
      severity: 'info',
      msg: `${hardcodedPxFonts.length} hardcoded px font-sizes in CSS-in-JS — operator must convert to fluid scale manually (codemod does not edit JS template literals).`,
      data: {sites: hardcodedPxFonts.slice(0, 8), cssInJs: true, blocks: blocks.length, runtimes},
      autoFixable: false,
    });
  }
  if (mediaQueryCount >= 4 && containerQueryCount === 0) {
    pushIssue(issues, {
      kind: 'mq-bloat-no-cq',
      file: rel + ` (css-in-js${runtimeNote})`,
      line: 0,
      severity: 'warn',
      msg: `${mediaQueryCount} @media in CSS-in-JS blocks, 0 @container. Manual CQ migration candidate.`,
      data: {mediaQueries: mediaQueryCount, cssInJs: true, runtimes},
      autoFixable: false,
    });
  }
  if (!hasPrefersReducedMotion && /animation|transition.*\d/i.test(combined)) {
    pushIssue(issues, {
      kind: 'no-reduced-motion-guard',
      file: rel + ` (css-in-js${runtimeNote})`,
      line: 0,
      severity: 'warn',
      msg: `Animations in CSS-in-JS template literals without prefers-reduced-motion override.`,
      data: {cssInJs: true, runtimes},
      autoFixable: false,
    });
  }
  return {issues, stats: {cssInJsBlocks: blocks.length, mediaQueryCount, containerQueryCount, hardcodedPxFonts: hardcodedPxFonts.length, hardcodedPxSpacing: hardcodedPxSpacing.length, runtimes}};
}

async function scanHTML(filePath, projectRoot) {
  const html = await readFile(filePath, 'utf8');
  const rel = relative(projectRoot, filePath);
  const issues = [];
  const $ = cheerio.load(html);

  const meta = $('meta[name="viewport"]').first();
  if (meta.length === 0) {
    pushIssue(issues, {
      kind: 'missing-meta-viewport',
      file: rel,
      line: 0,
      severity: 'error',
      msg: 'Missing <meta name="viewport"> — page renders as 980px desktop on mobile then scales down. The single most catastrophic responsive bug.',
      autoFixable: true,
      fix: 'inject-meta-viewport',
    });
  } else {
    const content = meta.attr('content') || '';
    if (!/width=device-width/.test(content)) {
      pushIssue(issues, {
        kind: 'bad-meta-viewport',
        file: rel,
        line: 0,
        severity: 'error',
        msg: `<meta viewport> exists but missing 'width=device-width': "${content}"`,
        autoFixable: true,
        fix: 'fix-meta-viewport',
      });
    }
    if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?!\.)/.test(content)) {
      pushIssue(issues, {
        kind: 'meta-viewport-blocks-zoom',
        file: rel,
        line: 0,
        severity: 'error',
        msg: `<meta viewport> blocks user zoom — WCAG 1.4.4 violation, blocks accessibility for low-vision users.`,
        data: {content},
        autoFixable: true,
        fix: 'fix-meta-viewport',
      });
    }
  }

  // PWA manifest check + apple-touch-icon — mobile install affordance
  const manifestLink = $('link[rel="manifest"]').first();
  const appleTouchIcon = $('link[rel="apple-touch-icon"]').first();
  if (manifestLink.length === 0) {
    pushIssue(issues, {
      kind: 'no-pwa-manifest',
      file: rel,
      line: 0,
      severity: 'info',
      msg: 'No <link rel="manifest"> — page is not installable as PWA. Mobile share / add-to-home-screen disabled.',
      autoFixable: false,
    });
  }
  if (appleTouchIcon.length === 0 && manifestLink.length > 0) {
    pushIssue(issues, {
      kind: 'no-apple-touch-icon',
      file: rel,
      line: 0,
      severity: 'info',
      msg: '<link rel="manifest"> present but no <link rel="apple-touch-icon"> — iOS Add-to-Home-Screen falls back to a low-res rasterized screenshot.',
      autoFixable: false,
    });
  }

  // images without intrinsic dimensions — split by local vs remote (different handlers)
  const localImgs = [];
  const remoteImgs = [];
  $('img').each((_, el) => {
    const $el = $(el);
    if ($el.attr('width') && $el.attr('height')) return;
    const styleStr = $el.attr('style') || '';
    if (/aspect-ratio/.test(styleStr)) return;
    const src = $el.attr('src') || '';
    if (!src) return;
    if (/^(https?:|\/\/)/i.test(src)) remoteImgs.push({src, alt: ($el.attr('alt') || '').slice(0, 40)});
    else if (!src.startsWith('data:')) localImgs.push({src, alt: ($el.attr('alt') || '').slice(0, 40)});
  });
  if (localImgs.length > 0) {
    pushIssue(issues, {
      kind: 'img-no-dimensions',
      file: rel,
      line: 0,
      severity: 'warn',
      msg: `${localImgs.length} local <img> without width+height attrs or aspect-ratio → CLS predictor.`,
      data: {count: localImgs.length, sites: localImgs},
      autoFixable: true,
      fix: 'add-img-aspect-ratio',
    });
  }
  if (remoteImgs.length > 0) {
    pushIssue(issues, {
      kind: 'img-remote-no-dimensions',
      file: rel,
      line: 0,
      severity: 'warn',
      msg: `${remoteImgs.length} remote <img> without dimensions → fetched + measured by add-remote-img-aspect-ratio.`,
      data: {count: remoteImgs.length, sites: remoteImgs},
      autoFixable: true,
      fix: 'add-remote-img-aspect-ratio',
    });
  }

  return {issues, stats: {hasMetaViewport: meta.length > 0, localImgs: localImgs.length, remoteImgs: remoteImgs.length}};
}

export async function runScan({brief, briefDir, outDir}) {
  await ensureDir(outDir);
  log('phase 1/7 — scan', 'rm');

  const cssPatterns = brief.target?.src || DEFAULT_CSS_PATTERNS;
  const htmlPatterns = brief.target?.html || DEFAULT_HTML_PATTERNS;

  const cssFiles = await globby(cssPatterns, {cwd: briefDir, gitignore: true});
  const htmlFiles = await globby(htmlPatterns, {cwd: briefDir, gitignore: true});

  const cssInJsFiles = await globby(DEFAULT_CSS_IN_JS_PATTERNS, {cwd: briefDir, gitignore: true});
  const sfcFiles = await globby(DEFAULT_SFC_PATTERNS, {cwd: briefDir, gitignore: true});
  const veFiles = await globby(DEFAULT_VANILLA_EXTRACT_PATTERNS, {cwd: briefDir, gitignore: true});
  log(`  scan inputs: ${cssFiles.length} CSS-like, ${htmlFiles.length} HTML, ${cssInJsFiles.length} JS/TSX (css-in-js probe), ${sfcFiles.length} SFC (Vue/Svelte/Astro), ${veFiles.length} Vanilla Extract`);

  const allIssues = [];
  const stats = {filesScanned: 0, mediaQueryTotal: 0, containerQueryTotal: 0, skippedTailwind: 0, skippedParseError: 0, cssInJsBlocksTotal: 0, cssInJsFilesWithBlocks: 0, sfcStyleBlocksTotal: 0, sfcFilesWithBlocks: 0, vanillaExtractFiles: 0};

  for (const f of cssFiles) {
    const full = `${briefDir}/${f}`;
    const {issues, stats: s} = await scanCSS(full, briefDir);
    allIssues.push(...issues);
    stats.filesScanned++;
    stats.mediaQueryTotal += s.mediaQueryCount;
    stats.containerQueryTotal += s.containerQueryCount;
    if (s.skippedTailwind) stats.skippedTailwind++;
    if (s.skippedParseError) stats.skippedParseError++;
  }
  for (const f of htmlFiles) {
    const full = `${briefDir}/${f}`;
    const html = await readFile(full, 'utf8');
    const {issues} = await scanHTML(full, briefDir);
    allIssues.push(...issues);
    const inline = await scanInlineCSS(html, full, briefDir);
    allIssues.push(...inline.issues);
    stats.mediaQueryTotal += inline.stats.mediaQueryCount;
    stats.containerQueryTotal += inline.stats.containerQueryCount;
    stats.filesScanned++;
  }
  for (const f of cssInJsFiles) {
    const full = `${briefDir}/${f}`;
    const r = await scanCSSInJS(full, briefDir);
    if (r.stats.cssInJsBlocks > 0) {
      stats.cssInJsFilesWithBlocks++;
      stats.cssInJsBlocksTotal += r.stats.cssInJsBlocks;
      stats.mediaQueryTotal += r.stats.mediaQueryCount || 0;
      stats.containerQueryTotal += r.stats.containerQueryCount || 0;
      allIssues.push(...r.issues);
    }
  }
  for (const f of sfcFiles) {
    const full = `${briefDir}/${f}`;
    const r = await scanSFC(full, briefDir);
    if (r.stats.styleBlocks > 0) {
      stats.sfcFilesWithBlocks++;
      stats.sfcStyleBlocksTotal += r.stats.styleBlocks;
      stats.mediaQueryTotal += r.stats.mediaQueryCount;
      stats.containerQueryTotal += r.stats.containerQueryCount;
      allIssues.push(...r.issues);
    }
  }
  for (const f of veFiles) {
    const full = `${briefDir}/${f}`;
    const r = await scanVanillaExtract(full, briefDir);
    if (r.stats.vanillaExtract) {
      stats.vanillaExtractFiles++;
      allIssues.push(...r.issues);
    }
  }

  const out = {phase: 'scan', generatedAt: new Date().toISOString(), brief: brief.$schema || null, stats, issues: allIssues};
  await writeJSON(`${outDir}/scan.json`, out);
  const skippedTotal = stats.skippedTailwind + stats.skippedParseError;
  const skippedNote = skippedTotal > 0 ? ` · skipped ${stats.skippedTailwind} Tailwind v4 + ${stats.skippedParseError} parse-error` : '';
  const cssJsNote = stats.cssInJsBlocksTotal > 0 ? ` · ${stats.cssInJsBlocksTotal} css-in-js blocks in ${stats.cssInJsFilesWithBlocks} files` : '';
  const sfcNote = stats.sfcStyleBlocksTotal > 0 ? ` · ${stats.sfcStyleBlocksTotal} SFC <style> blocks in ${stats.sfcFilesWithBlocks} files` : '';
  const veNote = stats.vanillaExtractFiles > 0 ? ` · ${stats.vanillaExtractFiles} Vanilla Extract files` : '';
  log(`  scan → ${allIssues.length} issues, ${stats.mediaQueryTotal} @media, ${stats.containerQueryTotal} @container across ${stats.filesScanned} files${skippedNote}${cssJsNote}${sfcNote}${veNote}`);
  return out;
}
