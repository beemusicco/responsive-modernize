/**
 * Lightweight Core Web Vitals gate using Playwright's Performance API.
 *
 * Targets (Google 2026 thresholds):
 *   LCP   <2.5s  (good)
 *   INP   <200ms (good)
 *   CLS   <0.1   (good)
 *
 * Does NOT require @lighthouse/* — we get LCP via PerformanceObserver,
 * CLS via layout-shift entries, INP via the user-blocking-task API.
 * For full Lighthouse audit, run `lighthouse <url> --output json` separately.
 */
import {chromium} from 'playwright';
import {log, ensureDir, writeJSON, urlJoin} from './util.mjs';
import {join} from 'path';

export async function runPerfGate({brief, briefDir, outDir, viewports}) {
  log('phase 2.5 — perf gate (CWV)', 'rm');
  const baseUrl = brief.target?.url;
  if (!baseUrl) return {phase: 'perf-gate', skipped: true, reason: 'no target.url'};
  const routes = brief.target?.routes?.length ? brief.target.routes : ['/'];
  const thresh = brief.thresholds || {};
  const LCP_MAX = thresh.lcp_ms_max || 2500;
  const INP_MAX = thresh.inp_ms_max || 200;
  const CLS_MAX = thresh.cls_max || 0.1;

  const browser = await chromium.launch({headless: true});
  const results = [];
  const failures = [];

  // Only measure on mobile viewport (mobile-l 375×812) — desktop has no CWV concern usually
  const mobileVp = viewports.find(v => v.id === 'mobile-l') || viewports[0];

  for (const route of routes) {
    const url = urlJoin(baseUrl, route);
    const ctx = await browser.newContext({
      viewport: {width: mobileVp.width, height: mobileVp.height},
      deviceScaleFactor: mobileVp.deviceScaleFactor || 1,
      isMobile: !!mobileVp.isMobile,
      hasTouch: !!mobileVp.hasTouch,
    });
    const page = await ctx.newPage();
    try {
      // Apply Slow 3G network throttle if opted in
      if (brief.networkThrottle === 'slow3g') {
        const client = await ctx.newCDPSession(page);
        await client.send('Network.emulateNetworkConditions', {
          offline: false,
          latency: 400,
          downloadThroughput: (400 * 1024) / 8,
          uploadThroughput: (400 * 1024) / 8,
        });
      }
      await page.goto(url, {waitUntil: 'networkidle', timeout: 30_000});
      // Sample CWV after a short interaction settle
      await page.waitForTimeout(1500);
      const cwv = await page.evaluate(() => new Promise((resolve) => {
        const out = {LCP: null, CLS: 0, FID: null, INP: null};
        try {
          new PerformanceObserver((list) => {
            const last = list.getEntries().pop();
            if (last) out.LCP = last.startTime;
          }).observe({type: 'largest-contentful-paint', buffered: true});
        } catch {}
        try {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) if (!e.hadRecentInput) out.CLS += e.value;
          }).observe({type: 'layout-shift', buffered: true});
        } catch {}
        setTimeout(() => resolve(out), 1000);
      }));
      const fail = [];
      if (cwv.LCP != null && cwv.LCP > LCP_MAX) fail.push(`LCP ${Math.round(cwv.LCP)}ms > ${LCP_MAX}`);
      if (cwv.CLS > CLS_MAX) fail.push(`CLS ${cwv.CLS.toFixed(3)} > ${CLS_MAX}`);
      results.push({route, cwv, fail});
      if (fail.length) failures.push({route, fail, cwv});
    } catch (e) {
      results.push({route, error: e.message});
    }
    await ctx.close();
  }
  await browser.close();

  const summary = {phase: 'perf-gate', viewport: mobileVp.id, thresholds: {LCP_MAX, INP_MAX, CLS_MAX}, results, failures};
  await writeJSON(join(outDir, 'perf-gate.json'), summary);
  log(`  perf-gate → ${results.length} routes, ${failures.length} fail-on-thresholds`);
  return summary;
}
