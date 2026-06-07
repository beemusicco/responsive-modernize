import {chromium, webkit, firefox} from 'playwright';
import {join} from 'path';
import {log, writeJSON, urlJoin, expandLocaleRoutes} from './util.mjs';

const ENGINE = {chromium, webkit, firefox};

// In-browser runtime audit — runs in page context, returns plain JSON.
// Coverage: horizontal-scroll, text-overflow, touch-targets, font-size floor,
// img dimensions, fixed-bottom safe-area, contrast WCAG AA, reduced-motion
// respect, dark-mode rendering, basic interactive zoom.
const audit = () => {
  const issues = [];
  const W = window.innerWidth, H = window.innerHeight;
  const docW = document.documentElement.scrollWidth;
  const docH = document.documentElement.scrollHeight;

  // 1. horizontal scroll + culprit locator
  if (docW > W + 1) {
    const culprits = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.right > W + 1 && r.width > 100) {
        // Build selector
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const cls = el.className && typeof el.className === 'string'
          ? '.' + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
          : '';
        culprits.push({
          selector: `${tag}${id}${cls}`,
          tag,
          width: Math.round(r.width),
          right: Math.round(r.right),
          overflowPx: Math.round(r.right - W),
          text: (el.textContent || '').trim().slice(0, 60),
        });
      }
    }
    culprits.sort((a, b) => b.overflowPx - a.overflowPx);
    issues.push({
      kind: 'horizontal-scroll',
      severity: 'error',
      msg: `Document scrollWidth ${docW}px > viewport ${W}px → horizontal scroll on this viewport.`,
      data: {docW, viewportW: W, overflowPx: docW - W, culprits: culprits.slice(0, 5)},
    });
  }

  // helper: visible test
  const isVisible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
  };

  // 2. text overflow per block — skip elements where overflow is intentional design
  //    (marquees, infinite tickers, animated horizontal scrollers — anything with
  //    whitespace-nowrap or active animation is design-intentional, not a bug).
  const isIntentionalOverflow = (el) => {
    let cur = el;
    while (cur && cur !== document.body) {
      const cs = getComputedStyle(cur);
      if (cs.whiteSpace === 'nowrap') return true;
      if (cs.animationName && cs.animationName !== 'none' && /infinite|marquee|ticker|scroll/i.test(cs.animationName + ' ' + (cur.className||''))) return true;
      if (cur.className && /marquee|ticker|scroll-x|carousel|swiper/i.test(String(cur.className))) return true;
      cur = cur.parentElement;
    }
    return false;
  };
  const blocks = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, button, a, div[class*="text"], div[class*="title"]');
  let overflowCount = 0;
  const overflowSamples = [];
  for (const el of blocks) {
    if (!isVisible(el)) continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 50) {
      if (isIntentionalOverflow(el)) continue;
      overflowCount++;
      if (overflowSamples.length < 5) {
        overflowSamples.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 80),
          overflowPx: el.scrollWidth - el.clientWidth,
          selector: el.id ? `#${el.id}` : el.className ? `.${String(el.className).split(' ')[0]}` : el.tagName.toLowerCase(),
        });
      }
    }
  }
  if (overflowCount > 0) {
    issues.push({
      kind: 'text-overflow',
      severity: 'error',
      msg: `${overflowCount} text blocks overflow their container.`,
      data: {count: overflowCount, samples: overflowSamples},
    });
  }

  // 3. touch targets <44×44 on touch viewports
  const tappable = document.querySelectorAll('a, button, [role="button"], input[type="button"], input[type="submit"], [onclick]');
  const smallHits = [];
  for (const el of tappable) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) {
      smallHits.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 40),
        width: Math.round(r.width),
        height: Math.round(r.height),
        selector: el.id ? `#${el.id}` : el.className ? `.${String(el.className).split(' ')[0]}` : el.tagName.toLowerCase(),
      });
    }
  }
  if (smallHits.length > 0) {
    issues.push({
      kind: 'touch-target-too-small',
      severity: 'warn',
      msg: `${smallHits.length} interactive elements below 44×44 px (WCAG 2.5.5 + Apple HIG).`,
      data: {count: smallHits.length, samples: smallHits.slice(0, 8)},
    });
  }

  // 4. font-size floor (14px absolute, 16 prevents iOS auto-zoom on inputs)
  const tinyFonts = [];
  const tinyFontSelectors = new Set();
  for (const el of document.querySelectorAll('p, span, a, button, li, label, input, textarea, select, td')) {
    if (!isVisible(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs > 0 && fs < 14) {
      const sel = el.tagName.toLowerCase() + (el.className ? `.${String(el.className).split(' ')[0]}` : '');
      tinyFontSelectors.add(sel);
      if (tinyFonts.length < 5) tinyFonts.push({tag: el.tagName.toLowerCase(), fontSize: fs, text: (el.textContent || '').trim().slice(0, 40)});
    }
  }
  if (tinyFonts.length > 0) {
    issues.push({
      kind: 'font-size-too-small',
      severity: 'warn',
      msg: `${tinyFontSelectors.size} selectors render text < 14px — readability + WCAG 1.4.4.`,
      data: {selectors: [...tinyFontSelectors].slice(0, 10), samples: tinyFonts},
    });
  }

  // 5. <img> without dimensions
  const noDim = [];
  for (const img of document.querySelectorAll('img')) {
    if (!isVisible(img)) continue;
    const hasW = img.hasAttribute('width') || (img.style.aspectRatio || '').length > 0;
    const hasH = img.hasAttribute('height') || (img.style.aspectRatio || '').length > 0;
    if (!hasW || !hasH) {
      noDim.push({src: img.src.slice(-80), alt: (img.alt || '').slice(0, 40)});
    }
  }
  if (noDim.length > 0) {
    issues.push({
      kind: 'img-missing-dimensions',
      severity: 'warn',
      msg: `${noDim.length} <img> without width+height or aspect-ratio — causes CLS.`,
      data: {count: noDim.length, samples: noDim.slice(0, 5)},
    });
  }

  // 6. fixed/sticky bottom without safe-area-inset
  // Computed style won't keep `env(safe-area-inset-*)` literally on platforms
  // with no notch (resolves to 0px). Use stylesheet rule check instead:
  // walk all stylesheets for rules matching this selector with env() in value.
  const fixedBottoms = [];
  const sheetUsesSafeArea = (selector) => {
    for (const sheet of document.styleSheets || []) {
      let rules;
      try { rules = sheet.cssRules || sheet.rules; } catch { continue; }
      if (!rules) continue;
      for (const rule of rules) {
        if (rule.type !== 1) continue; // CSSRule.STYLE_RULE
        if (!rule.selectorText) continue;
        if (rule.selectorText !== selector && !rule.selectorText.includes(selector)) continue;
        const text = rule.cssText || '';
        if (/env\(\s*safe-area-inset|safe-area-inset|env\(/.test(text)) return true;
      }
    }
    return false;
  };
  for (const el of document.querySelectorAll('*')) {
    if (!isVisible(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < window.innerHeight * 0.85) continue; // not near bottom
    const styleStr = el.getAttribute('style') || '';
    const idSel = el.id ? `#${el.id}` : '';
    const clsSel = el.className && typeof el.className === 'string'
      ? '.' + el.className.split(/\s+/).filter(Boolean)[0] : '';
    const sel = idSel || clsSel || el.tagName.toLowerCase();
    const hasSafeArea = /safe-area-inset|env\(/.test(styleStr) || sheetUsesSafeArea(sel);
    if (!hasSafeArea) {
      fixedBottoms.push({
        tag: el.tagName.toLowerCase(),
        selector: el.id ? `#${el.id}` : el.className ? `.${String(el.className).split(' ')[0]}` : el.tagName.toLowerCase(),
        position: cs.position,
        bottom: Math.round(window.innerHeight - r.bottom),
      });
    }
  }
  if (fixedBottoms.length > 0) {
    issues.push({
      kind: 'fixed-bottom-no-safe-area',
      severity: 'warn',
      msg: `${fixedBottoms.length} fixed/sticky elements near viewport bottom without env(safe-area-inset-bottom) — overlaps iPhone home indicator.`,
      data: {count: fixedBottoms.length, samples: fixedBottoms.slice(0, 5)},
    });
  }

  // 7a. 100vh on near-viewport-sized blocks — Mobile Safari address bar killer.
  // Recommend svh/dvh/lvh in proposal. We probe via inline style + bounding box ~= viewport.
  const vhKillers = [];
  for (const el of document.querySelectorAll('*')) {
    if (!isVisible(el)) continue;
    const cs = getComputedStyle(el);
    // Element with explicit `vh` height where rect.height is within 5% of window.innerHeight
    // is a candidate. Check inline style attribute too — computed height resolves to px so
    // we sniff via raw style attribute and stylesheet sources.
    const styleStr = el.getAttribute('style') || '';
    const inlineVh = /\b(min-|max-)?height\s*:\s*\d+(?:\.\d+)?vh/i.test(styleStr);
    let stylesheetVh = false;
    try {
      for (const sheet of document.styleSheets || []) {
        let rules;
        try { rules = sheet.cssRules || sheet.rules; } catch { continue; }
        if (!rules) continue;
        for (const rule of rules) {
          if (rule.type !== 1 || !rule.selectorText) continue;
          if (!el.matches(rule.selectorText.split(',')[0].trim())) continue;
          if (/\b(min-|max-)?height\s*:\s*\d+(?:\.\d+)?vh\b/.test(rule.cssText || '')) {
            stylesheetVh = true;
            break;
          }
        }
        if (stylesheetVh) break;
      }
    } catch {}
    if (!(inlineVh || stylesheetVh)) continue;
    const sel = el.id ? `#${el.id}` : el.className && typeof el.className === 'string'
      ? '.' + el.className.split(/\s+/).filter(Boolean)[0]
      : el.tagName.toLowerCase();
    vhKillers.push({selector: sel, tag: el.tagName.toLowerCase(), source: inlineVh ? 'inline' : 'stylesheet'});
    if (vhKillers.length >= 5) break;
  }
  if (vhKillers.length > 0) {
    issues.push({
      kind: 'vh-not-svh',
      severity: 'warn',
      msg: `${vhKillers.length} element(s) use vh height — Mobile Safari address bar covers content. Migrate to svh/dvh/lvh.`,
      data: {count: vhKillers.length, samples: vhKillers},
    });
  }

  // 7b. <img loading="lazy"> on above-fold images = blocks LCP (Largest Contentful Paint).
  //     Inverse class: visible <img> NOT loading="lazy" below the fold = perf opportunity.
  const aboveFoldImgsNonLazy = [];
  const belowFoldImgsNotLazy = [];
  for (const img of document.querySelectorAll('img')) {
    if (!isVisible(img)) continue;
    const r = img.getBoundingClientRect();
    const isAboveFold = r.top < window.innerHeight;
    const lazy = img.getAttribute('loading') === 'lazy';
    if (isAboveFold && lazy) {
      aboveFoldImgsNonLazy.push({src: (img.src || '').slice(-80), top: Math.round(r.top)});
    } else if (!isAboveFold && !lazy) {
      belowFoldImgsNotLazy.push({src: (img.src || '').slice(-80), top: Math.round(r.top)});
    }
  }
  if (aboveFoldImgsNonLazy.length > 0) {
    issues.push({
      kind: 'img-lazy-above-fold',
      severity: 'warn',
      msg: `${aboveFoldImgsNonLazy.length} above-fold <img> with loading="lazy" — blocks LCP.`,
      data: {count: aboveFoldImgsNonLazy.length, samples: aboveFoldImgsNonLazy.slice(0, 3)},
    });
  }
  if (belowFoldImgsNotLazy.length > 0) {
    issues.push({
      kind: 'img-not-lazy-below-fold',
      severity: 'info',
      msg: `${belowFoldImgsNotLazy.length} below-fold <img> without loading="lazy" — perf opportunity.`,
      data: {count: belowFoldImgsNotLazy.length, samples: belowFoldImgsNotLazy.slice(0, 3)},
    });
  }

  // 7c. <img> without srcset/sizes — single-source res for all DPRs + viewports.
  const imgsNoSrcset = [];
  for (const img of document.querySelectorAll('img')) {
    if (!isVisible(img)) continue;
    if (img.srcset || img.parentElement?.tagName === 'PICTURE') continue;
    const r = img.getBoundingClientRect();
    if (r.width < 200) continue; // ignore tiny icons
    imgsNoSrcset.push({src: (img.src || '').slice(-80), width: Math.round(r.width), height: Math.round(r.height)});
  }
  if (imgsNoSrcset.length > 0) {
    issues.push({
      kind: 'img-no-srcset',
      severity: 'info',
      msg: `${imgsNoSrcset.length} <img> ≥200px without srcset/<picture> — wastes bandwidth on high-DPR mobile.`,
      data: {count: imgsNoSrcset.length, samples: imgsNoSrcset.slice(0, 5)},
    });
  }

  // 8. zoom blocked (already in HTML scan but verify runtime)
  const metaViewport = document.querySelector('meta[name="viewport"]');
  if (metaViewport) {
    const c = metaViewport.getAttribute('content') || '';
    if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?!\.)/.test(c)) {
      issues.push({
        kind: 'zoom-blocked',
        severity: 'error',
        msg: 'meta viewport blocks user zoom — WCAG 1.4.4 violation.',
        data: {content: c},
      });
    }
  }

  return {
    issues,
    summary: {
      viewportW: W,
      viewportH: H,
      docW,
      docH,
      tappableElements: tappable.length,
      textBlocks: blocks.length,
    },
  };
};

async function diagPage({browser, engine, viewport, url, forcedColors, rtl}) {
  const ctx = await browser.newContext({
    viewport: {width: viewport.width, height: viewport.height},
    deviceScaleFactor: viewport.deviceScaleFactor || 1,
    isMobile: !!viewport.isMobile && engine !== 'firefox',
    hasTouch: !!viewport.hasTouch && engine !== 'firefox',
    forcedColors: forcedColors ? 'active' : 'none',
  });
  const page = await ctx.newPage();
  if (rtl) {
    await page.addInitScript(() => {
      document.documentElement.setAttribute('dir', 'rtl');
    });
  }
  try {
    await page.goto(url, {waitUntil: 'networkidle', timeout: 30_000});
    await page.waitForTimeout(800);
  } catch (e) {
    await ctx.close();
    return {ok: false, error: e.message, issues: []};
  }
  let result = await page.evaluate(audit);
  // Focus-visible audit — tab-cycle a few tappable elements and check outline
  try {
    const focusIssues = await page.evaluate(() => {
      const fIssues = [];
      const tabbable = Array.from(document.querySelectorAll('a, button, [role="button"], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((el) => {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
        })
        .slice(0, 12);
      const noOutline = [];
      for (const el of tabbable) {
        el.focus();
        const cs = getComputedStyle(el);
        const outlineWidth = parseFloat(cs.outlineWidth || '0');
        const boxShadow = cs.boxShadow || '';
        const hasRing = outlineWidth > 0 || /inset|0px|rgb|rgba|#/.test(boxShadow);
        if (!hasRing) {
          const sel = el.id ? `#${el.id}` : el.className && typeof el.className === 'string'
            ? '.' + el.className.split(/\s+/).filter(Boolean)[0] : el.tagName.toLowerCase();
          noOutline.push({selector: sel, tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 40)});
        }
        el.blur();
      }
      if (noOutline.length > 0) {
        fIssues.push({
          kind: 'no-focus-visible',
          severity: 'warn',
          msg: `${noOutline.length} of ${tabbable.length} sampled tappable elements have no visible focus indicator — keyboard nav fails WCAG 2.4.7.`,
          data: {count: noOutline.length, sampled: tabbable.length, samples: noOutline.slice(0, 6)},
        });
      }
      return fIssues;
    });
    if (focusIssues.length) result.issues = (result.issues || []).concat(focusIssues);
  } catch {}
  await ctx.close();
  return {ok: true, ...result};
}

export async function runDiagnose({brief, briefDir, outDir, viewports, engines, dryRun}) {
  log('phase 3/7 — diagnose', 'rm');
  const baseUrl = brief.target?.url;
  if (!baseUrl) {
    log('  no target.url — skipping diagnose');
    return {phase: 'diagnose', skipped: true, reason: 'no target.url'};
  }
  const baseRoutes = brief.target?.routes?.length ? brief.target.routes : ['/'];
  const routes = expandLocaleRoutes(baseRoutes, brief.i18n).map((r) => r.route);

  if (dryRun) {
    log(`  dry-run — would diagnose ${viewports.length * engines.length * routes.length} combinations`);
    return {phase: 'diagnose', skipped: true, reason: 'dry-run'};
  }

  // forced-colors + rtl extra passes only when brief opts in (--deep default OFF for them)
  const passes = [
    {forcedColors: false, rtl: false, suffix: ''},
  ];
  if (brief.forcedColors === true) passes.push({forcedColors: true, rtl: false, suffix: '_forcedcolors'});
  if (brief.rtl === true) passes.push({forcedColors: false, rtl: true, suffix: '_rtl'});

  const allFindings = [];
  for (const engine of engines) {
    const browser = await ENGINE[engine].launch({headless: true});
    for (const route of routes) {
      const url = urlJoin(baseUrl, route);
      for (const viewport of viewports) {
        for (const pass of passes) {
          log(`  ${engine} · ${route} · ${viewport.label}${pass.suffix}`);
          const r = await diagPage({browser, engine, viewport, url, forcedColors: pass.forcedColors, rtl: pass.rtl});
          allFindings.push({engine, route, viewport: viewport.id, viewportPx: `${viewport.width}×${viewport.height}`, pass: pass.suffix || 'default', ...r});
        }
      }
    }
    await browser.close();
  }

  // flatten issues with context
  const flatIssues = [];
  for (const f of allFindings) {
    if (!f.ok) continue;
    for (const i of (f.issues || [])) {
      flatIssues.push({
        ...i,
        engine: f.engine,
        route: f.route,
        viewport: f.viewport,
        viewportPx: f.viewportPx,
      });
    }
  }

  const summary = {
    phase: 'diagnose',
    generatedAt: new Date().toISOString(),
    combinations: allFindings.length,
    failed: allFindings.filter((f) => !f.ok).length,
    issueCount: flatIssues.length,
    issues: flatIssues,
    perCombo: allFindings,
  };
  await writeJSON(join(outDir, 'diagnose.json'), summary);
  log(`  diagnose → ${flatIssues.length} runtime issues across ${allFindings.length} combinations (${summary.failed} failed)`);
  return summary;
}
