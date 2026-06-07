import {join} from 'path';
import {chromium, webkit, firefox} from 'playwright';
import {log, ensureDir, writeJSON, urlJoin, safeFilename, probeHealth, expandLocaleRoutes} from './util.mjs';

const ENGINE = {chromium, webkit, firefox};

async function shotPage({browser, engine, viewport, url, outDir, prefersReducedMotion, prefersColorScheme}) {
  const ctx = await browser.newContext({
    viewport: {width: viewport.width, height: viewport.height},
    deviceScaleFactor: viewport.deviceScaleFactor || 1,
    isMobile: !!viewport.isMobile && engine !== 'firefox',
    hasTouch: !!viewport.hasTouch && engine !== 'firefox',
    reducedMotion: prefersReducedMotion ? 'reduce' : 'no-preference',
    colorScheme: prefersColorScheme,
    userAgent: viewport.isMobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
  });
  const page = await ctx.newPage();

  try {
    await page.goto(url, {waitUntil: 'networkidle', timeout: 30_000});
    // Wait briefly for fonts to settle (CLS prevention)
    await page.waitForTimeout(800);
  } catch (e) {
    await ctx.close();
    return {ok: false, error: e.message};
  }

  const file = join(outDir, `${engine}_${viewport.id}.png`);
  const fullDoc = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    title: document.title,
  }));
  await page.screenshot({path: file, fullPage: true});
  await ctx.close();
  return {ok: true, file, fullDoc};
}

export async function runBaseline({brief, briefDir, outDir, viewports, engines, deep, dryRun}) {
  log('phase 2/7 — baseline', 'rm');
  const baseUrl = brief.target?.url;
  if (!baseUrl) {
    log('  no target.url — skipping baseline (static-only mode)');
    return {phase: 'baseline', skipped: true, reason: 'no target.url'};
  }
  const baseRoutes = brief.target?.routes?.length ? brief.target.routes : ['/'];
  const expandedRoutes = expandLocaleRoutes(baseRoutes, brief.i18n);
  const routes = expandedRoutes.map((r) => r.route);
  if (expandedRoutes.some((r) => r.locale)) {
    log(`  i18n: ${baseRoutes.length} base × ${brief.i18n.test_locales.length} locales = ${routes.length} routes`);
  }

  if (dryRun) {
    log(`  dry-run — would shoot ${viewports.length * engines.length * routes.length} screenshots`);
    return {phase: 'baseline', skipped: true, reason: 'dry-run'};
  }

  // Fix 2: pre-flight health probe — fail fast if dev server is dead/timing out
  // instead of running 60+ Playwright shots against an unreachable origin.
  log(`  probing ${baseUrl}…`);
  const health = await probeHealth(baseUrl, 5000);
  if (!health.ok) {
    const reason = `target.url unreachable (${health.error || `HTTP ${health.status}`})`;
    log(`  HEALTH FAIL: ${reason}`);
    return {phase: 'baseline', skipped: true, reason, health};
  }
  if (health.warn) {
    log(`  HEALTH WARN: ${health.warn} — proceeding anyway`);
  } else {
    log(`  health OK (HTTP ${health.status})`);
  }

  const shotDir = join(outDir, 'baseline');
  await ensureDir(shotDir);

  // Color schemes: respect brief.colorSchemes or --deep default.
  // 'light' = no prefers-color-scheme (browser default), 'dark' = forced dark.
  const colorSchemes = brief.colorSchemes && Array.isArray(brief.colorSchemes) && brief.colorSchemes.length
    ? brief.colorSchemes
    : (deep ? ['light', 'dark'] : ['light']);
  if (colorSchemes.length > 1) log(`  color schemes: ${colorSchemes.join(' + ')}`);

  const results = [];
  for (const engine of engines) {
    const browser = await ENGINE[engine].launch({headless: true});
    for (const route of routes) {
      const url = urlJoin(baseUrl, route);
      const routeDir = join(shotDir, safeFilename(route));
      await ensureDir(routeDir);
      for (const viewport of viewports) {
        for (const scheme of colorSchemes) {
          const schemeSuffix = colorSchemes.length > 1 ? `_${scheme}` : '';
          log(`  ${engine} · ${route} · ${viewport.label}${schemeSuffix}`);
          const ctx = await browser.newContext({
            viewport: {width: viewport.width, height: viewport.height},
            deviceScaleFactor: viewport.deviceScaleFactor || 1,
            isMobile: !!viewport.isMobile && engine !== 'firefox',
            hasTouch: !!viewport.hasTouch && engine !== 'firefox',
            colorScheme: scheme,
            userAgent: viewport.isMobile
              ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
              : undefined,
          });
          const page = await ctx.newPage();
          let ok = false, file = null, error = null;
          try {
            await page.goto(url, {waitUntil: 'networkidle', timeout: 30_000});
            await page.waitForTimeout(800);
            // Optional flow simulation — execute steps before screenshot
            const steps = brief.flowSimulation?.steps;
            if (Array.isArray(steps)) {
              for (const step of steps) {
                try {
                  if (step.action === 'wait') await page.waitForTimeout(step.ms || 500);
                  else if (step.action === 'scroll') await page.evaluate((y) => window.scrollTo(0, y), Number(step.value || 0));
                  else if (step.action === 'click' && step.selector) await page.click(step.selector, {timeout: 3000});
                  else if (step.action === 'tap' && step.selector) await page.tap(step.selector, {timeout: 3000});
                  else if (step.action === 'type' && step.selector) await page.fill(step.selector, step.value || '');
                } catch {}
              }
            }
            // Auto-dismiss cookie/consent banners so they don't dominate the screenshot
            if (brief.dismissCookieBanner !== false) {
              await page.evaluate(() => {
                // v1.13.1 FIX: dropped `button:has-text("Accept")` — Playwright pseudo,
                // throws SyntaxError in vanilla querySelector. Text-walk fallback below covers it.
                const selectors = [
                  'button[id*="accept" i]', 'button[class*="accept" i]',
                  'button[aria-label*="accept" i]',
                  '#cookie-accept', '.cookie-accept', '[data-cy*="cookie-accept"]',
                ];
                for (const s of selectors) {
                  // v1.13.3: log instead of silent — operator needs to know cookie banner click failed.
                  try { const b = document.querySelector(s); if (b) { b.click(); return; } } catch (e) { console.warn('[rm:cookie-click]', s, e.message); }
                }
                // Slovenian + EU common patterns. Match affirmative-accept text but
                // EXCLUDE negative/settings context so we don't click "Manage cookies",
                // "I do not accept", "Reject", etc. (substring 'ok' used to match
                // 'cookie'/'book'/'look' → wrong button → corrupt baseline screenshot).
                const ACCEPT_RE = /\b(sprejmi|sprejmem|soglašam|razumem|dovoli|accept|allow|agree|consent|got it|ok)\b/;
                const REJECT_RE = /\b(ne|not|don't|reject|decline|deny|manage|settings|customi[sz]e|preferences|options|only|necessary|nastavitve|zavrni|prilagodi|več)\b/;
                const buttons = document.querySelectorAll('button, a[role="button"]');
                for (const b of buttons) {
                  const t = (b.textContent || '').trim().toLowerCase();
                  if (ACCEPT_RE.test(t) && !REJECT_RE.test(t)) { try { b.click(); return; } catch {} }
                }
              });
              await page.waitForTimeout(400);
            }
            file = join(routeDir, `${engine}_${viewport.id}${schemeSuffix}.png`);
            await page.screenshot({path: file, fullPage: true});
            ok = true;
          } catch (e) {
            error = e.message;
          }
          await ctx.close();
          results.push({engine, route, viewport: viewport.id, colorScheme: scheme, ok, file, error});
        }
      }
    }
    await browser.close();
  }

  const summary = {
    phase: 'baseline',
    generatedAt: new Date().toISOString(),
    baseUrl,
    engines,
    viewports: viewports.map((v) => v.id),
    routes,
    shots: results.length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
  await writeJSON(join(outDir, 'baseline.json'), summary);
  log(`  baseline → ${results.length} shots (${summary.failed} failed)`);
  return summary;
}
