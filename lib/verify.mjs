import {readFile, mkdir} from 'fs/promises';
import {existsSync} from 'fs';
import {join, dirname} from 'path';
import {chromium, webkit, firefox} from 'playwright';
import {PNG} from 'pngjs';
import pixelmatch from 'pixelmatch';
import {log, ensureDir, writeJSON, urlJoin, safeFilename, expandLocaleRoutes} from './util.mjs';
import {runDiagnose} from './diagnose.mjs';
import {aiJudgeDiff} from './aiDiff.mjs';

const ENGINE = {chromium, webkit, firefox};

async function shot(browser, viewport, url, engine, file) {
  const ctx = await browser.newContext({
    viewport: {width: viewport.width, height: viewport.height},
    deviceScaleFactor: viewport.deviceScaleFactor || 1,
    isMobile: !!viewport.isMobile && engine !== 'firefox',
    hasTouch: !!viewport.hasTouch && engine !== 'firefox',
  });
  const page = await ctx.newPage();
  try {
    await page.goto(url, {waitUntil: 'networkidle', timeout: 30_000});
    await page.waitForTimeout(800);
  } catch (e) {
    await ctx.close();
    return {ok: false, error: e.message};
  }
  await page.screenshot({path: file, fullPage: true});
  await ctx.close();
  return {ok: true};
}

async function diffPNGs(beforePath, afterPath, diffPath) {
  const before = PNG.sync.read(await readFile(beforePath));
  const after = PNG.sync.read(await readFile(afterPath));
  // Align dimensions to smallest common — fullPage shots can differ if layout shifted
  const W = Math.min(before.width, after.width);
  const H = Math.min(before.height, after.height);
  const diff = new PNG({width: W, height: H});
  const beforeData = Buffer.alloc(W * H * 4);
  const afterData = Buffer.alloc(W * H * 4);
  // Crop both
  for (let y = 0; y < H; y++) {
    before.data.copy(beforeData, y * W * 4, y * before.width * 4, y * before.width * 4 + W * 4);
    after.data.copy(afterData, y * W * 4, y * after.width * 4, y * after.width * 4 + W * 4);
  }
  const pixDiff = pixelmatch(beforeData, afterData, diff.data, W, H, {threshold: 0.1, includeAA: true});
  await mkdir(dirname(diffPath), {recursive: true});
  await (await import('fs/promises')).writeFile(diffPath, PNG.sync.write(diff));
  const total = W * H;
  return {pixelsDiff: pixDiff, totalPixels: total, pctDiff: total ? (pixDiff / total) * 100 : 0, W, H, beforeW: before.width, afterW: after.width};
}

export async function runVerify({brief, briefDir, outDir, viewports, engines, dryRun}) {
  log('phase 6/7 — verify', 'rm');
  const baseUrl = brief.target?.url;
  if (!baseUrl) {
    log('  no target.url — skipping verify');
    return {phase: 'verify', skipped: true, reason: 'no target.url'};
  }
  const baseRoutes = brief.target?.routes?.length ? brief.target.routes : ['/'];
  const routes = expandLocaleRoutes(baseRoutes, brief.i18n).map((r) => r.route);
  if (dryRun) {
    log('  dry-run — skipping verify');
    return {phase: 'verify', skipped: true, reason: 'dry-run'};
  }

  const baselineDir = join(outDir, 'baseline');
  const verifyDir = join(outDir, 'verify');
  const diffDir = join(outDir, 'diff');
  await ensureDir(verifyDir);
  await ensureDir(diffDir);

  if (!existsSync(baselineDir)) {
    log('  no baseline screenshots — run phase 2 first');
    return {phase: 'verify', skipped: true, reason: 'no baseline'};
  }

  const results = [];
  for (const engine of engines) {
    const browser = await ENGINE[engine].launch({headless: true});
    for (const route of routes) {
      const url = urlJoin(baseUrl, route);
      const routeSlug = safeFilename(route);
      const routeBaseDir = join(baselineDir, routeSlug);
      const routeVerifyDir = join(verifyDir, routeSlug);
      const routeDiffDir = join(diffDir, routeSlug);
      await ensureDir(routeVerifyDir);
      await ensureDir(routeDiffDir);
      for (const viewport of viewports) {
        const file = `${engine}_${viewport.id}.png`;
        const beforePath = join(routeBaseDir, file);
        const afterPath = join(routeVerifyDir, file);
        const diffPath = join(routeDiffDir, file);
        log(`  shot ${engine} · ${route} · ${viewport.label}`);
        const s = await shot(browser, viewport, url, engine, afterPath);
        if (!s.ok) {
          results.push({engine, route, viewport: viewport.id, ok: false, error: s.error});
          continue;
        }
        if (!existsSync(beforePath)) {
          results.push({engine, route, viewport: viewport.id, ok: true, noBaseline: true});
          continue;
        }
        try {
          const d = await diffPNGs(beforePath, afterPath, diffPath);
          results.push({engine, route, viewport: viewport.id, ok: true, diff: d, beforePath, afterPath, diffPath});
        } catch (e) {
          results.push({engine, route, viewport: viewport.id, ok: true, diffError: e.message});
        }
      }
    }
    await browser.close();
  }

  // Re-run diagnose to confirm no new runtime issues
  let postDiag = null;
  try {
    log('  re-running diagnose to confirm no new runtime issues…');
    postDiag = await runDiagnose({brief, briefDir, outDir: join(outDir, 'verify-diagnose-tmp'), viewports, engines, dryRun: false});
  } catch (e) {
    log(`  post-apply diagnose failed: ${e.message}`);
  }

  const threshold = brief.thresholds?.diff_px_pct_max ?? 0.5;
  const regressions = results.filter((r) => r.diff && r.diff.pctDiff > threshold);

  // AI-diff: LLM-judge each above-threshold regression to filter intended changes
  // from real regressions. 2026 SaaS parity (Percy/Applitools/TestMu Smart Ignore).
  // Opt-in via brief.aiDiff.enabled or default OFF (uses claude OAuth, $0 marginal).
  const aiCfg = brief.aiDiff || {};
  if (aiCfg.enabled && regressions.length > 0) {
    log(`  ai-diff: judging ${regressions.length} above-threshold regression(s)…`);
    const aiTimeout = aiCfg.timeoutSec || 60;
    for (const reg of regressions.slice(0, aiCfg.maxJudge || 10)) {
      try {
        const verdict = await aiJudgeDiff({
          baselinePath: reg.beforePath,
          verifyPath: reg.afterPath,
          diffPath: reg.diffPath,
          pctDiff: reg.diff.pctDiff,
          threshold,
          route: reg.route,
          viewport: reg.viewport,
          briefDir,
          timeoutSec: aiTimeout,
        });
        reg.aiJudge = verdict;
      } catch (e) {
        reg.aiJudge = {skipped: 'exception', error: e.message};
      }
    }
    // v1.13.1 FIX: skip codes (no-claude, timeout, parse-error, missing-png, spawn-error)
    // were being COUNTED as real regressions. Now: skipped → inconclusive (separate bucket).
    const realRegressions = regressions.filter((r) => r.aiJudge && !r.aiJudge.skipped && r.aiJudge.isRegression === true);
    const inconclusive = regressions.filter((r) => r.aiJudge?.skipped);
    log(`  ai-diff: ${realRegressions.length} confirmed real, ${inconclusive.length} inconclusive (AI skipped), ${regressions.length - realRegressions.length - inconclusive.length} intended improvements`);
  }

  // Element-level diff: for each high-diff route, identify which top-level sections changed
  // by comparing bounding-box regions. Best-effort, helps narrow regression to specific UI.
  if (regressions.length > 0) {
    try {
      const {chromium: cr} = await import('playwright');
      const elemBrowser = await cr.launch({headless: true});
      for (const reg of regressions.slice(0, 3)) {
        const ctx = await elemBrowser.newContext({viewport: {width: 1280, height: 800}});
        const page = await ctx.newPage();
        try {
          await page.goto(urlJoin(brief.target.url, reg.route), {waitUntil: 'networkidle', timeout: 20_000});
          const regions = await page.evaluate(() => {
            const out = [];
            for (const el of document.querySelectorAll('section, article, header, footer, nav, main, [class*="section"], [class*="hero"]')) {
              const r = el.getBoundingClientRect();
              if (r.width < 200 || r.height < 50) continue;
              const cs = window.getComputedStyle(el);
              if (cs.display === 'none' || cs.visibility === 'hidden') continue;
              out.push({selector: el.id ? `#${el.id}` : '.' + String(el.className || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.'), rect: {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}});
              if (out.length >= 8) break;
            }
            return out;
          });
          reg.elementRegions = regions;
        } catch (e) { log(`  [rm:element-regions] failed on ${reg.route}: ${e.message}`); }
        await ctx.close();
      }
      await elemBrowser.close();
    } catch (e) { log(`  [rm:element-regions-browser] launch failed: ${e.message}`); }
  }

  const summary = {
    phase: 'verify',
    generatedAt: new Date().toISOString(),
    threshold,
    shots: results.length,
    regressions: regressions.length,
    results,
    postDiagnose: postDiag ? {issueCount: postDiag.issueCount} : null,
  };
  await writeJSON(join(outDir, 'verify.json'), summary);
  log(`  verify → ${results.length} shots, ${regressions.length} above ${threshold}% diff threshold${postDiag ? `; post-diagnose: ${postDiag.issueCount} runtime issues` : ''}`);
  return summary;
}
