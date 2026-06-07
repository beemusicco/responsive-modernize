import {readFile, mkdir} from 'fs/promises';
import {existsSync} from 'fs';
import {join, dirname} from 'path';
import {chromium, webkit, firefox} from 'playwright';
import {PNG} from 'pngjs';
import pixelmatch from 'pixelmatch';
import {log, ensureDir, writeJSON, urlJoin, safeFilename, expandLocaleRoutes} from './util.mjs';
import {runDiagnose} from './diagnose.mjs';

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
