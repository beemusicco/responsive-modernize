import {readFile, writeFile, copyFile, mkdir} from 'fs/promises';
import {existsSync} from 'fs';
import {join, dirname, relative, resolve, isAbsolute} from 'path';
import * as cheerio from 'cheerio';
import postcss from 'postcss';
import sharp from 'sharp';
import {log, ensureDir, writeJSON, readJSON, fileExists, safeWrite} from './util.mjs';
import {typeToken, spaceToken, APPLY_ORDER} from './utopiaMap.mjs';
import {tailwindTouchTargetCodemod, tailwindSafeAreaCodemod, tailwindLayoutStackCodemod} from './tailwindCodemod.mjs';

// Per-fix handler registry. Each returns {applied: bool, before, after, reason?}.
const HANDLERS = {
  'inject-meta-viewport': async ({filePath, briefDir}) => {
    const html = await readFile(filePath, 'utf8');
    const $ = cheerio.load(html, {xmlMode: false});
    if ($('meta[name="viewport"]').length > 0) return {applied: false, reason: 'meta viewport already present'};
    const tag = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />';
    if ($('head').length > 0) {
      $('head').prepend('\n  ' + tag + '\n');
    } else {
      // Add a head if missing — rare
      $('html').prepend(`<head>\n  ${tag}\n</head>`);
    }
    const out = $.html();
    await safeWrite(filePath, out);
    return {applied: true, before: html, after: out};
  },

  'fix-meta-viewport': async ({filePath}) => {
    const html = await readFile(filePath, 'utf8');
    const $ = cheerio.load(html, {xmlMode: false});
    const meta = $('meta[name="viewport"]').first();
    if (meta.length === 0) return {applied: false, reason: 'no meta viewport to fix'};
    meta.attr('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
    const out = $.html();
    await safeWrite(filePath, out);
    return {applied: true, before: html, after: out};
  },

  'inject-utopia-scale': async ({filePath, codemodKit}) => {
    const css = await readFile(filePath, 'utf8');
    // Only inject if no fluid scale yet
    if (/--step-0|--space-s\b/.test(css)) return {applied: false, reason: 'utopia scale already present'};
    const banner = '\n/* --- injected by /responsive-modernize: Utopia fluid type + space scale --- */\n';
    // Normalize browser button/form font defaults to readable floor (13.33px → 16px+).
    const normalize = '\n/* normalize browser form defaults to scale floor (kills <14px button text) */\nbutton, input, select, textarea { font: inherit; font-size: var(--step-0); }\n';
    const out = css + banner + codemodKit.utopiaTypeScale + '\n\n' + codemodKit.utopiaSpaceScale + '\n' + normalize;
    await safeWrite(filePath, out);
    return {applied: true, before: css, after: out};
  },

  'inject-reduced-motion-guard': async ({filePath, codemodKit}) => {
    const css = await readFile(filePath, 'utf8');
    if (/prefers-reduced-motion/.test(css)) return {applied: false, reason: 'guard already present'};
    const banner = '\n/* --- injected by /responsive-modernize: respect prefers-reduced-motion --- */\n';
    const out = css + banner + codemodKit.reducedMotionGuard + '\n';
    await safeWrite(filePath, out);
    return {applied: true, before: css, after: out};
  },

  'migrate-px-fonts-to-utopia': async ({filePath}) => {
    const css = await readFile(filePath, 'utf8');
    let root;
    try { root = postcss.parse(css, {from: filePath}); } catch (e) {
      return {applied: false, reason: `parse error: ${e.message.split('\n')[0]}`};
    }
    let changed = 0;
    let skipped = 0;
    root.walkDecls((decl) => {
      if (!/^font-size$/i.test(decl.prop)) return;
      const m = /^(\d+(?:\.\d+)?)px$/.exec(decl.value.trim());
      if (!m) return;
      if (/var\(|clamp\(|calc\(/.test(decl.value)) return;
      const px = parseFloat(m[1]);
      const tok = typeToken(px);
      if (!tok) { skipped++; return; }
      decl.value = `var(${tok.token})`;
      changed++;
    });
    if (changed === 0) return {applied: false, reason: 'no migrable px font-sizes found'};
    const out = root.toString();
    await safeWrite(filePath, out);
    return {applied: true, before: css, after: out, changed, skipped};
  },

  'migrate-px-spacing-to-utopia': async ({filePath}) => {
    const css = await readFile(filePath, 'utf8');
    let root;
    try { root = postcss.parse(css, {from: filePath}); } catch (e) {
      return {applied: false, reason: `parse error: ${e.message.split('\n')[0]}`};
    }
    let changed = 0;
    let skipped = 0;
    const SPACING_RE = /^(padding|margin|gap|row-gap|column-gap|padding-(top|right|bottom|left)|margin-(top|right|bottom|left))$/i;
    root.walkDecls((decl) => {
      if (!SPACING_RE.test(decl.prop)) return;
      if (/var\(|clamp\(|calc\(|env\(/.test(decl.value)) return;
      // Split shorthand on whitespace; map each px token independently
      const tokens = decl.value.trim().split(/\s+/);
      const PX_RE = /^(\d+(?:\.\d+)?)px$/;
      let cellChanged = 0;
      const newTokens = tokens.map((t) => {
        const m = PX_RE.exec(t);
        if (!m) return t;
        const px = parseFloat(m[1]);
        if (px < 4) return t;
        const tok = spaceToken(px);
        if (!tok) { skipped++; return t; }
        cellChanged++;
        return `var(${tok.token})`;
      });
      // Only rewrite if every px token was either replaced or skipped (no non-px tokens like 'auto' polluting)
      if (cellChanged > 0) {
        decl.value = newTokens.join(' ');
        changed += cellChanged;
      }
    });
    if (changed === 0) return {applied: false, reason: 'no migrable px spacing values found'};
    const out = root.toString();
    await safeWrite(filePath, out);
    return {applied: true, before: css, after: out, changed, skipped};
  },

  'fix-fixed-width-overflow': async ({filePath}) => {
    const css = await readFile(filePath, 'utf8');
    let root;
    try { root = postcss.parse(css, {from: filePath}); } catch (e) {
      return {applied: false, reason: `parse error: ${e.message.split('\n')[0]}`};
    }
    let changed = 0;
    root.walkDecls((decl) => {
      if (!/^(width|min-width|max-width)$/i.test(decl.prop)) return;
      const m = /^(\d+(?:\.\d+)?)px$/.exec(decl.value.trim());
      if (!m) return;
      if (/min\(|var\(|clamp\(|calc\(/.test(decl.value)) return;
      const px = parseFloat(m[1]);
      if (px < 600) return; // tiny values not overflow-causing
      // Replace `width: 1600px` → `width: min(100%, 1600px)` (works for max-width too — desktop matches, mobile shrinks)
      decl.value = `min(100%, ${px}px)`;
      changed++;
    });
    if (changed === 0) return {applied: false, reason: 'no fixed widths ≥600px found'};
    const out = root.toString();
    await safeWrite(filePath, out);
    return {applied: true, before: css, after: out, changed};
  },

  'truncate-text-overflow': async ({briefDir, issue}) => {
    const {globby} = await import('globby');
    const cssCandidates = await globby(['**/*.css', '!node_modules/**', '!.responsive-modernize/**', '!.next/**'], {cwd: briefDir, gitignore: true});
    if (cssCandidates.length === 0) return {applied: false, reason: 'no .css file to append rule to'};
    const {stat: fsStat} = await import('fs/promises');
    let target = null, bestSize = -1;
    for (const c of cssCandidates) {
      const full = join(briefDir, c);
      const st = await fsStat(full);
      if (st.size > bestSize) { bestSize = st.size; target = full; }
    }
    const css = await readFile(target, 'utf8');
    const sel = issue.data?.selector;
    if (!sel) return {applied: false, reason: 'no selector context'};
    const rule = `${sel} { text-wrap: balance; overflow-wrap: anywhere; min-width: 0; }`;
    if (css.includes(rule)) return {applied: false, reason: 'rule already appended'};
    const banner = '\n/* --- injected by /responsive-modernize: prevent text overflow on narrow viewports --- */\n';
    const out = css + (css.endsWith('\n') ? '' : '\n') + banner + rule + '\n';
    await safeWrite(target, out);
    return {applied: true, before: css, after: out, changed: 1, target};
  },

  'fix-element-overflow': async ({filePath, briefDir, issue}) => {
    // Append `selector { max-width: 100%; box-sizing: border-box; }` to the target CSS file.
    // Strategy: append to the largest .css file in target.src (or briefDir's first .css). Idempotent — checks for existing rule.
    const {globby} = await import('globby');
    const cssCandidates = await globby(['**/*.css', '!node_modules/**', '!.responsive-modernize/**', '!.next/**'], {cwd: briefDir, gitignore: true});
    if (cssCandidates.length === 0) return {applied: false, reason: 'no .css file in project to append rule to'};
    // Pick largest css
    const {stat: fsStat} = await import('fs/promises');
    let target = null, bestSize = -1;
    for (const c of cssCandidates) {
      const full = join(briefDir, c);
      const st = await fsStat(full);
      if (st.size > bestSize) { bestSize = st.size; target = full; }
    }
    const css = await readFile(target, 'utf8');
    const sel = issue.data?.selector;
    if (!sel) return {applied: false, reason: 'no selector context'};
    const rule = `${sel} { max-width: 100%; box-sizing: border-box; }`;
    if (css.includes(rule)) return {applied: false, reason: 'rule already appended'};
    const banner = '\n/* --- injected by /responsive-modernize: prevent element overflow --- */\n';
    const out = css + (css.endsWith('\n') ? '' : '\n') + banner + rule + '\n';
    await safeWrite(target, out);
    return {applied: true, before: css, after: out, changed: 1, target};
  },

  'tailwind-touch-target': async ({briefDir}) => {
    const r = await tailwindTouchTargetCodemod({briefDir});
    if (r.totalEdits === 0) return {applied: false, reason: 'no Tailwind h-N (N<11) on <a>/<button>/<Link>'};
    return {applied: true, before: '', after: '', changed: r.totalEdits, target: `${r.touchedFiles} .tsx/.jsx files`};
  },

  'tailwind-layout-stack': async ({briefDir}) => {
    const r = await tailwindLayoutStackCodemod({briefDir});
    if (r.totalEdits === 0) return {applied: false, reason: 'no grid-cols-N/flex-row without responsive variant'};
    return {applied: true, before: '', after: '', changed: r.totalEdits, target: `${r.touchedFiles} .tsx/.jsx files`};
  },

  'tailwind-safe-area': async ({briefDir}) => {
    const r = await tailwindSafeAreaCodemod({briefDir});
    if (r.totalEdits === 0) return {applied: false, reason: 'no fixed/sticky bottom-0 without safe-area'};
    return {applied: true, before: '', after: '', changed: r.totalEdits, target: `${r.touchedFiles} .tsx/.jsx files`};
  },

  'enforce-touch-target-min': async ({filePath, briefDir, issue, opts}) => {
    if (!opts?.aggressive) return {applied: false, reason: '--aggressive flag required (layout-impacting)'};
    const {globby} = await import('globby');
    const cssCandidates = await globby(['**/*.css', '!node_modules/**', '!.responsive-modernize/**', '!.next/**'], {cwd: briefDir, gitignore: true});
    if (cssCandidates.length === 0) return {applied: false, reason: 'no .css file to append rule to'};
    const {stat: fsStat} = await import('fs/promises');
    let target = null, bestSize = -1;
    for (const c of cssCandidates) {
      const full = join(briefDir, c);
      const st = await fsStat(full);
      if (st.size > bestSize) { bestSize = st.size; target = full; }
    }
    let css = await readFile(target, 'utf8');
    const sel = issue.data?.selector;
    if (!sel) return {applied: false, reason: 'no selector context'};

    // Two-step: (a) walk postcss + null any explicit width/height < 44px on this selector;
    // (b) append a touch-target rule that forces min sizing.
    let root;
    try { root = postcss.parse(css, {from: target}); } catch (e) {
      return {applied: false, reason: `parse error: ${e.message.split('\n')[0]}`};
    }
    let nulled = 0;
    root.walkRules((rule) => {
      if (rule.selector !== sel) return;
      for (const decl of [...rule.nodes]) {
        if (decl.type !== 'decl') continue;
        if (/^(width|height)$/i.test(decl.prop)) {
          const m = /^(\d+(?:\.\d+)?)px$/.exec(decl.value.trim());
          if (m && parseFloat(m[1]) < 44) { decl.remove(); nulled++; }
        }
      }
    });
    css = root.toString();

    const rule = `${sel} { min-width: 44px; min-height: 44px; display: inline-block; }`;
    if (css.includes(rule)) return {applied: false, reason: 'rule already appended'};
    const banner = '\n/* --- injected by /responsive-modernize --aggressive: WCAG 2.5.5 touch target min --- */\n';
    const out = css + (css.endsWith('\n') ? '' : '\n') + banner + rule + '\n';
    await safeWrite(target, out);
    return {applied: true, before: css, after: out, changed: 1 + nulled, target};
  },

  'add-remote-img-aspect-ratio': async ({filePath, briefDir, issue}) => {
    const {createHash} = await import('crypto');
    const html = await readFile(filePath, 'utf8');
    const $ = cheerio.load(html, {xmlMode: false});
    const cacheDir = join(briefDir, '.responsive-modernize', 'cache');
    await mkdir(cacheDir, {recursive: true});
    let added = 0, skipped = 0;
    const imgs = $('img').toArray();
    for (const el of imgs) {
      const $el = $(el);
      if ($el.attr('width') || $el.attr('height')) continue;
      const styleStr = $el.attr('style') || '';
      if (/aspect-ratio/.test(styleStr)) continue;
      const src = $el.attr('src') || '';
      if (!/^(https?:)/i.test(src)) continue;
      const hash = createHash('sha1').update(src).digest('hex').slice(0, 12);
      const cachePath = join(cacheDir, `${hash}.json`);
      let meta = null;
      try {
        if (existsSync(cachePath)) {
          meta = JSON.parse(await readFile(cachePath, 'utf8'));
        } else {
          const res = await fetch(src);
          if (!res.ok) { skipped++; continue; }
          const buf = Buffer.from(await res.arrayBuffer());
          const md = await sharp(buf).metadata();
          if (!md.width || !md.height) { skipped++; continue; }
          meta = {width: md.width, height: md.height, src};
          await writeFile(cachePath, JSON.stringify(meta));
        }
        const newStyle = `${styleStr ? styleStr.replace(/;?\s*$/, '; ') : ''}aspect-ratio: ${meta.width} / ${meta.height};`;
        $el.attr('style', newStyle);
        added++;
      } catch {
        skipped++;
      }
    }
    if (added === 0) return {applied: false, reason: `no remote <img> tagged (skipped=${skipped})`};
    const out = $.html();
    await safeWrite(filePath, out);
    return {applied: true, before: html, after: out, added, skipped};
  },

  'add-img-aspect-ratio': async ({filePath, briefDir, issue}) => {
    const html = await readFile(filePath, 'utf8');
    const $ = cheerio.load(html, {xmlMode: false});
    let added = 0;
    let skipped = 0;
    const imgs = $('img').toArray();
    for (const el of imgs) {
      const $el = $(el);
      const hasW = $el.attr('width');
      const hasH = $el.attr('height');
      const styleStr = $el.attr('style') || '';
      if (hasW || hasH || /aspect-ratio/.test(styleStr)) continue;
      const src = $el.attr('src') || '';
      if (!src) { skipped++; continue; }
      // Only resolve local files for safety. Skip http(s):// and data: URIs.
      if (/^(https?:|data:|\/\/)/i.test(src)) { skipped++; continue; }
      const abs = isAbsolute(src) ? join(briefDir, src.slice(1)) : resolve(dirname(filePath), src);
      if (!existsSync(abs)) { skipped++; continue; }
      try {
        const meta = await sharp(abs).metadata();
        if (!meta.width || !meta.height) { skipped++; continue; }
        const newStyle = `${styleStr ? styleStr.replace(/;?\s*$/, '; ') : ''}aspect-ratio: ${meta.width} / ${meta.height};`;
        $el.attr('style', newStyle);
        added++;
      } catch {
        skipped++;
      }
    }
    if (added === 0) return {applied: false, reason: `no local <img> resolved (skipped=${skipped})`};
    const out = $.html();
    await safeWrite(filePath, out);
    return {applied: true, before: html, after: out, added, skipped};
  },

  'add-safe-area-inset': async ({filePath, issue}) => {
    const css = await readFile(filePath, 'utf8');
    const line = issue.line;
    const decl = issue.data?.decl;
    if (!line || !decl) return {applied: false, reason: 'missing line or decl context'};
    const lines = css.split('\n');
    const idx = line - 1;
    if (!lines[idx] || !lines[idx].includes(decl.split(':')[0])) {
      // Heuristic: target line may have shifted — bail to manual
      return {applied: false, reason: 'line context drifted — manual review'};
    }
    // Wrap value in calc(... + env(safe-area-inset-bottom))
    const [prop, ...rest] = decl.split(':');
    const value = rest.join(':').trim();
    const newValue = `calc(${value} + env(safe-area-inset-bottom, 0px))`;
    lines[idx] = lines[idx].replace(decl, `${prop}: ${newValue}`);
    const out = lines.join('\n');
    await safeWrite(filePath, out);
    return {applied: true, before: css, after: out};
  },
};

async function backupFile(filePath, backupRoot, briefDir) {
  const rel = relative(briefDir, filePath);
  const dest = join(backupRoot, rel);
  await ensureDir(dirname(dest));
  // Idempotent: never overwrite the original snapshot. In iter 2+, dest already
  // holds the pre-iter-1 file; copying again would replace it with iter-1's
  // modified version, destroying the recoverable original.
  if (!existsSync(dest)) {
    await copyFile(filePath, dest);
  }
  return dest;
}

export async function runApply({brief, briefDir, outDir, yes, dryRun, aggressive}) {
  log('phase 5/7 — apply' + (aggressive ? ' (--aggressive)' : ''), 'rm');
  if (dryRun) {
    log('  dry-run — skipping apply');
    return {phase: 'apply', skipped: true, reason: 'dry-run'};
  }

  let proposal = null;
  try { proposal = await readJSON(join(outDir, 'propose.json')); } catch {}
  if (!proposal) {
    log('  no propose.json — run phase 4 first');
    return {phase: 'apply', skipped: true, reason: 'no proposal'};
  }

  if (!yes) {
    log('  apply requires --yes (safety gate). Showing what WOULD be applied:');
    const autoFixable = proposal.issues.filter((i) => i.autoFixable);
    for (const i of autoFixable.slice(0, 20)) {
      log(`    [${i.severity}] ${i.kind} — ${i.fix || '?'} on ${i.file}:${i.line || 0}`);
    }
    return {phase: 'apply', skipped: true, reason: '--yes required'};
  }

  const backupRoot = join(outDir, 'backup');
  await ensureDir(backupRoot);

  const applied = [];
  const skipped = [];
  const codemodKit = proposal.codemodKit;

  // Deterministic apply order: inject scale before migrate to it.
  const orderedIssues = [...proposal.issues].sort((a, b) => {
    const ra = APPLY_ORDER[a.fix] ?? 99;
    const rb = APPLY_ORDER[b.fix] ?? 99;
    return ra - rb;
  });

  // De-duplicate: same file × same fix kind = apply once
  const dedupe = new Set();
  for (const issue of orderedIssues) {
    if (!issue.autoFixable || !issue.fix) {
      skipped.push({issue, reason: 'not auto-fixable'});
      continue;
    }
    if (issue.aggressive && !aggressive) {
      skipped.push({issue, reason: '--aggressive flag required'});
      continue;
    }
    // Derived (synth) issues sometimes have no specific file → handler picks target itself
    const filePath = issue.file ? join(briefDir, issue.file) : briefDir;
    if (issue.file && !(await fileExists(filePath))) {
      skipped.push({issue, reason: 'file missing'});
      continue;
    }
    const dedupKey = `${filePath}::${issue.fix}`;
    if (dedupe.has(dedupKey)) {
      skipped.push({issue, reason: 'already applied this fix to this file'});
      continue;
    }
    const handler = HANDLERS[issue.fix];
    if (!handler) {
      skipped.push({issue, reason: `unknown fix handler: ${issue.fix}`});
      continue;
    }
    try {
      const backupPath = issue.file ? await backupFile(filePath, backupRoot, briefDir) : null;
      const r = await handler({filePath, briefDir, issue, codemodKit, opts: {aggressive}});
      if (r.applied) {
        dedupe.add(dedupKey);
        applied.push({
          issue, fix: issue.fix, file: issue.file,
          backupPath: backupPath ? relative(briefDir, backupPath) : null,
          bytesBefore: r.before.length, bytesAfter: r.after.length,
          changed: r.changed, added: r.added, skipped: r.skipped,
          target: r.target ? relative(briefDir, r.target) : null,
        });
        const extra = r.changed != null ? ` (${r.changed} declarations)` : r.added != null ? ` (${r.added} added, ${r.skipped} skipped)` : '';
        const where = issue.file || (r.target ? relative(briefDir, r.target) : 'derived');
        log(`  ✓ ${issue.fix} on ${where}${extra}`);
      } else {
        skipped.push({issue, reason: r.reason});
      }
    } catch (e) {
      skipped.push({issue, reason: `handler error: ${e.message}`});
    }
  }

  const summary = {
    phase: 'apply',
    generatedAt: new Date().toISOString(),
    applied,
    skipped,
    backupRoot: relative(briefDir, backupRoot),
    counts: {applied: applied.length, skipped: skipped.length},
  };
  await writeJSON(join(outDir, 'apply.json'), summary);
  log(`  apply → ${applied.length} fixes applied, ${skipped.length} skipped. Backups at ${summary.backupRoot}/`);
  return summary;
}
