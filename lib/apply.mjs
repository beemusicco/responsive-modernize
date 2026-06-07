import {readFile, writeFile, copyFile, mkdir} from 'fs/promises';
import {existsSync} from 'fs';
import {join, dirname, relative, resolve, isAbsolute} from 'path';
import * as cheerio from 'cheerio';
import postcss from 'postcss';
import sharp from 'sharp';
import {log, ensureDir, writeJSON, readJSON, fileExists, safeWrite} from './util.mjs';
import {parseColor, contrastRatio, adjustForContrast, colorToString} from './colorMath.mjs';
import {typeToken, spaceToken, APPLY_ORDER} from './utopiaMap.mjs';
import {tailwindTouchTargetCodemod, tailwindSafeAreaCodemod, tailwindLayoutStackCodemod, tailwindFormStackCodemod, tailwindSidebarDrawerCodemod} from './tailwindCodemod.mjs';

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

  'tailwind-form-stack': async ({briefDir}) => {
    const r = await tailwindFormStackCodemod({briefDir});
    if (r.totalEdits === 0) return {applied: false, reason: 'no multi-col grid in form-containing file'};
    return {applied: true, before: '', after: '', changed: r.totalEdits, target: `${r.touchedFiles} form .tsx/.jsx files`};
  },

  'tailwind-sidebar-drawer': async ({briefDir}) => {
    const r = await tailwindSidebarDrawerCodemod({briefDir});
    if (r.totalEdits === 0) return {applied: false, reason: 'no sidebar/aside without responsive show/hide'};
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

  'fix-low-color-contrast': async ({briefDir, issue}) => {
    const samples = issue.data?.samples;
    if (!Array.isArray(samples) || samples.length === 0) return {applied: false, reason: 'no contrast samples'};
    const {globby} = await import('globby');
    const cssCandidates = await globby(['**/*.css', '!node_modules/**', '!.responsive-modernize/**'], {cwd: briefDir, gitignore: true});
    if (cssCandidates.length === 0) return {applied: false, reason: 'no .css file'};
    const {stat: fsStat} = await import('fs/promises');
    let target = null, bestSize = -1;
    for (const c of cssCandidates) {
      const full = join(briefDir, c);
      const st = await fsStat(full);
      if (st.size > bestSize) { bestSize = st.size; target = full; }
    }
    let css = await readFile(target, 'utf8');
    let root;
    try { root = postcss.parse(css, {from: target}); } catch { return {applied: false, reason: 'css parse error'}; }
    let changed = 0;
    const sampleSels = new Set(samples.map((s) => s.selector));
    root.walkRules((rule) => {
      // Match if rule selector includes any of the flagged selectors
      const matches = [...sampleSels].some((s) => rule.selector === s || rule.selector.includes(s));
      if (!matches) return;
      rule.walkDecls('color', (decl) => {
        if (decl.value.includes('var(--rm-contrast-fixed)')) return; // marker — already fixed
        const fg = parseColor(decl.value);
        if (!fg) return;
        // Assume white background as default — caller can pass bg via issue.data.bg if available
        const bg = {r: 255, g: 255, b: 255, a: 1};
        if (contrastRatio(fg, bg) >= 4.5) return;
        const adj = adjustForContrast(fg, bg, 4.5);
        if (!adj) return;
        decl.value = colorToString(adj);
        decl.raws.before = decl.raws.before || ' '; // preserve formatting
        // Add comment marker so we don't loop
        decl.value = decl.value + ' /* --rm-contrast-fixed */';
        changed++;
      });
    });
    if (changed === 0) return {applied: false, reason: 'no color decls eligible for contrast fix'};
    await safeWrite(target, root.toString());
    return {applied: true, before: css, after: root.toString(), changed, target};
  },

  'add-focus-visible-rules': async ({briefDir}) => {
    const {globby} = await import('globby');
    const cssCandidates = await globby(['**/*.css', '!node_modules/**', '!.responsive-modernize/**'], {cwd: briefDir, gitignore: true});
    let totalAdded = 0;
    let touchedFiles = 0;
    for (const rel of cssCandidates) {
      const full = join(briefDir, rel);
      const css = await readFile(full, 'utf8');
      let root;
      try { root = postcss.parse(css, {from: full}); } catch { continue; }
      const allSels = new Set();
      root.walkRules((rule) => allSels.add(rule.selector));
      const toAppend = [];
      root.walkRules((rule) => {
        if (!/:hover\b/.test(rule.selector)) return;
        const focusVer = rule.selector.replace(/:hover\b/g, ':focus-visible');
        if (allSels.has(focusVer)) return;
        // Clone and re-tag
        const clone = rule.clone({selector: focusVer});
        toAppend.push({afterRule: rule, clone});
        allSels.add(focusVer);
      });
      if (toAppend.length === 0) continue;
      for (const {afterRule, clone} of toAppend) afterRule.parent.insertAfter(afterRule, clone);
      await safeWrite(full, root.toString());
      totalAdded += toAppend.length;
      touchedFiles++;
    }
    if (totalAdded === 0) return {applied: false, reason: 'no :hover rules missing :focus-visible counterpart'};
    return {applied: true, before: '', after: '', changed: totalAdded, target: `${touchedFiles} CSS files`};
  },

  'add-pwa-manifest': async ({briefDir}) => {
    // Auto-generate a minimal manifest.webmanifest + add <link rel=manifest> to each HTML.
    const {globby} = await import('globby');
    const htmlFiles = await globby(['**/*.html', '!node_modules/**', '!.responsive-modernize/**', '!.next/**'], {cwd: briefDir, gitignore: true});
    if (htmlFiles.length === 0) return {applied: false, reason: 'no .html files'};
    const manifestPath = join(briefDir, 'manifest.webmanifest');
    let touched = 0, manifestCreated = false;
    if (!existsSync(manifestPath)) {
      const name = (briefDir.split('/').pop() || 'Web App').replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const manifest = {
        name, short_name: name.slice(0, 12),
        start_url: '/', display: 'standalone',
        background_color: '#ffffff', theme_color: '#0f172a',
        icons: [
          {src: '/icon-192.png', sizes: '192x192', type: 'image/png'},
          {src: '/icon-512.png', sizes: '512x512', type: 'image/png'},
        ],
      };
      await safeWrite(manifestPath, JSON.stringify(manifest, null, 2));
      manifestCreated = true;
    }
    for (const rel of htmlFiles) {
      const full = join(briefDir, rel);
      const html = await readFile(full, 'utf8');
      const $ = cheerio.load(html, {xmlMode: false});
      if ($('link[rel="manifest"]').length > 0) continue;
      $('head').append('\n  <link rel="manifest" href="/manifest.webmanifest" />\n');
      await safeWrite(full, $.html());
      touched++;
    }
    if (!manifestCreated && touched === 0) return {applied: false, reason: 'manifest already linked everywhere'};
    return {applied: true, before: '', after: '', changed: touched + (manifestCreated ? 1 : 0), target: `${touched} HTML files, manifest=${manifestCreated ? 'new' : 'reused'}`};
  },

  'add-apple-touch-icon': async ({briefDir}) => {
    // Pick the largest local image referenced from any HTML, resize to 180×180, write apple-touch-icon.png, add <link>.
    const {globby} = await import('globby');
    const sharpMod = (await import('sharp')).default;
    const htmlFiles = await globby(['**/*.html', '!node_modules/**', '!.responsive-modernize/**'], {cwd: briefDir, gitignore: true});
    if (htmlFiles.length === 0) return {applied: false, reason: 'no .html files'};
    // Find a usable source image (favicon, logo, og:image, any <img>)
    let sourceImg = null;
    for (const rel of htmlFiles) {
      const full = join(briefDir, rel);
      const html = await readFile(full, 'utf8');
      const $ = cheerio.load(html, {xmlMode: false});
      const candidates = [
        $('link[rel="icon"]').attr('href'),
        $('meta[property="og:image"]').attr('content'),
        $('img').first().attr('src'),
      ].filter((s) => s && !/^https?:|^\/\/|^data:/.test(s));
      for (const c of candidates) {
        const abs = isAbsolute(c) ? join(briefDir, c.slice(1)) : resolve(dirname(full), c);
        if (existsSync(abs) && /\.(png|jpe?g|webp|svg)$/i.test(abs)) { sourceImg = abs; break; }
      }
      if (sourceImg) break;
    }
    if (!sourceImg) return {applied: false, reason: 'no local source image found to derive apple-touch-icon from'};
    const outPath = join(briefDir, 'apple-touch-icon.png');
    try {
      await sharpMod(sourceImg).resize(180, 180).png().toFile(outPath);
    } catch (e) {
      return {applied: false, reason: `sharp resize failed: ${e.message.slice(0, 80)}`};
    }
    let touched = 0;
    for (const rel of htmlFiles) {
      const full = join(briefDir, rel);
      const html = await readFile(full, 'utf8');
      const $ = cheerio.load(html, {xmlMode: false});
      if ($('link[rel="apple-touch-icon"]').length > 0) continue;
      $('head').append('\n  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />\n');
      await safeWrite(full, $.html());
      touched++;
    }
    return {applied: true, before: '', after: '', changed: touched, target: `apple-touch-icon.png (180×180) generated from ${sourceImg.split('/').pop()}`};
  },

  'table-to-cards': async ({briefDir}) => {
    // Inject responsive CSS + add data-label="<th-text>" to <td> in HTML files (completion).
    // Both halves are required: CSS rule needs the data-label attr to show column header
    // on mobile card view.
    const {globby} = await import('globby');
    const htmlFiles = await globby(['**/*.html', '!node_modules/**', '!.responsive-modernize/**'], {cwd: briefDir, gitignore: true});
    let tdLabeled = 0;
    for (const rel of htmlFiles) {
      const full = join(briefDir, rel);
      const html = await readFile(full, 'utf8');
      const $ = cheerio.load(html, {xmlMode: false});
      let changed = false;
      $('table').each((_, table) => {
        const $tbl = $(table);
        if (!/rm-card-on-mobile/.test($tbl.attr('class') || '')) {
          $tbl.addClass('rm-card-on-mobile');
          changed = true;
        }
        const headers = $tbl.find('thead th').map((_, th) => $(th).text().trim()).get();
        if (headers.length === 0) return;
        $tbl.find('tbody tr').each((_, tr) => {
          $(tr).find('td').each((i, td) => {
            const $td = $(td);
            if (!$td.attr('data-label') && headers[i]) {
              $td.attr('data-label', headers[i]);
              tdLabeled++;
              changed = true;
            }
          });
        });
      });
      if (changed) await safeWrite(full, $.html());
    }
    // CSS rule injection (from v1.10)
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
    if (css.includes('table-to-cards responsive') && tdLabeled === 0) return {applied: false, reason: 'rule already injected, no new <td> labels needed'};
    if (css.includes('table-to-cards responsive')) return {applied: true, before: css, after: css, changed: tdLabeled, target: `${tdLabeled} <td> labels added`};
    const block = `
/* --- injected by /responsive-modernize: table-to-cards responsive at ≤768px --- */
@media (max-width: 768px) {
  table.rm-card-on-mobile, table.rm-card-on-mobile thead, table.rm-card-on-mobile tbody,
  table.rm-card-on-mobile th, table.rm-card-on-mobile td, table.rm-card-on-mobile tr { display: block; }
  table.rm-card-on-mobile thead tr { position: absolute; top: -9999px; left: -9999px; }
  table.rm-card-on-mobile tr { margin-bottom: 1rem; border: 1px solid #e5e7eb; }
  table.rm-card-on-mobile td { position: relative; padding-left: 50%; min-height: 32px; }
  table.rm-card-on-mobile td::before {
    content: attr(data-label);
    position: absolute; left: 12px; top: 12px;
    font-weight: 600; opacity: 0.7;
  }
}
`;
    await safeWrite(target, css + (css.endsWith('\n') ? '' : '\n') + block);
    return {applied: true, before: css, after: css + block, changed: 1 + tdLabeled, target: `${target} + ${tdLabeled} <td> labels`};
  },

  'add-srcset': async ({briefDir}) => {
    // For each local <img src="*.png|jpg"> in HTML files without srcset, generate
    // 480/768/1024/1920 variants via sharp + inject srcset attr.
    const {globby} = await import('globby');
    const sharpMod = (await import('sharp')).default;
    const htmlFiles = await globby(['**/*.html', '!node_modules/**', '!.responsive-modernize/**', '!.next/**'], {cwd: briefDir, gitignore: true});
    let touched = 0, generated = 0;
    for (const rel of htmlFiles) {
      const full = join(briefDir, rel);
      const html = await readFile(full, 'utf8');
      const $ = cheerio.load(html, {xmlMode: false});
      let fileTouched = false;
      const imgs = $('img').toArray();
      for (const el of imgs) {
        const $el = $(el);
        if ($el.attr('srcset')) continue;
        const src = $el.attr('src') || '';
        if (!/\.(png|jpe?g|webp)$/i.test(src) || /^https?:|^\/\//.test(src)) continue;
        const abs = isAbsolute(src) ? join(briefDir, src.slice(1)) : resolve(dirname(full), src);
        if (!existsSync(abs)) continue;
        try {
          const md = await sharpMod(abs).metadata();
          const baseW = md.width || 1920;
          const variants = [480, 768, 1024, 1920].filter((w) => w <= baseW);
          const ext = (src.match(/\.[a-z]+$/i) || ['.jpg'])[0];
          const base = src.replace(/\.[a-z]+$/i, '');
          const srcsetParts = [];
          for (const w of variants) {
            const outFile = `${base}-${w}${ext}`;
            const outAbs = isAbsolute(outFile) ? join(briefDir, outFile.slice(1)) : resolve(dirname(full), outFile);
            if (!existsSync(outAbs)) {
              await sharpMod(abs).resize({width: w}).toFile(outAbs);
              generated++;
            }
            srcsetParts.push(`${outFile} ${w}w`);
          }
          $el.attr('srcset', srcsetParts.join(', '));
          $el.attr('sizes', '(max-width: 768px) 100vw, 50vw');
          fileTouched = true;
        } catch {}
      }
      if (fileTouched) {
        await safeWrite(full, $.html());
        touched++;
      }
    }
    if (generated === 0 && touched === 0) return {applied: false, reason: 'no <img> eligible for srcset generation'};
    return {applied: true, before: '', after: '', changed: touched, added: generated, target: `${touched} HTML files, ${generated} variants generated`};
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
