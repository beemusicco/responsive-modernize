#!/usr/bin/env node
/**
 * responsive-modernize CLI orchestrator.
 *
 * 7-phase pipeline:
 *   1. scan      static CSS+HTML AST anti-patterns
 *   2. baseline  Playwright multi-viewport screenshots
 *   3. diagnose  runtime per-viewport checks (horizontal-scroll, touch, fonts, etc)
 *   4. propose   ranked fix plan + Utopia clamp scale + reduced-motion guard + CQ patterns
 *   5. apply     atomic backup + safe auto-fixes (gated by --yes)
 *   6. verify    re-baseline + pixelmatch + re-run diagnose
 *   7. report    REPORT.html (interactive) + REPORT.md (deliverable) + sprites
 *
 * Usage:
 *   responsive-modernize                       # discover .responsive-modernize.json, run 1+2+3+4+7
 *   responsive-modernize --brief PATH          # explicit brief
 *   responsive-modernize --phase 1,3,4         # run subset
 *   responsive-modernize --yes                 # enable phase 5 (apply) + phase 6 (verify)
 *   responsive-modernize --deep                # all viewports + 3 engines (chromium+webkit+firefox)
 *   responsive-modernize --dry-run             # validate brief + show plan
 *   responsive-modernize --url URL             # quick-mode: no brief, just audit one URL
 *
 * Exit codes:
 *   0  clean (no issues OR --dry-run completed)
 *   1  issues found (severity error or warn)
 *   2  tool error (Playwright crash, brief invalid, etc)
 */
import {readFile, writeFile} from 'fs/promises';
import {fileURLToPath} from 'url';
import {dirname, resolve, join} from 'path';

import {log, err, readJSON, ensureDir, discoverBrief, resolveViewports, resolveEngines, defaults} from './lib/util.mjs';
import {runScan} from './lib/scan.mjs';
import {runBaseline} from './lib/baseline.mjs';
import {runDiagnose} from './lib/diagnose.mjs';
import {runPropose} from './lib/propose.mjs';
import {runApply} from './lib/apply.mjs';
import {runVerify} from './lib/verify.mjs';
import {runReport} from './lib/report.mjs';
import {runEscalate, runAutoImpeccable} from './lib/escalate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ARGS = process.argv.slice(2);
const flag = (name) => {
  const i = ARGS.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = ARGS[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const briefArg = flag('brief');
const phasesArg = flag('phase');
const urlArg = flag('url');
const yes = !!flag('yes');
const deep = !!flag('deep');
const dryRun = !!flag('dry-run');
const aggressive = !!flag('aggressive');
const noEscalate = !!flag('no-escalate');
const autoImpeccable = !!flag('auto-impeccable');
const jsonOutput = !!flag('json-output');

async function loadBriefOrSynth() {
  if (urlArg) {
    log(`quick-mode: synth brief for url ${urlArg}`);
    return {
      brief: {target: {url: urlArg, routes: ['/']}, viewports: null, engines: null},
      briefDir: process.cwd(),
      synthetic: true,
    };
  }
  const briefPath = briefArg ? resolve(briefArg) : await discoverBrief();
  if (!briefPath) {
    err('no .responsive-modernize.json found in cwd or parents.');
    err('  → create from template: cp ' + join(__dirname, 'templates/.responsive-modernize.example.json') + ' ./.responsive-modernize.json');
    err('  → or --url <URL> for quick mode');
    err('  → or --brief <path> for explicit');
    process.exit(2);
  }
  log(`brief: ${briefPath}`);
  return {brief: await readJSON(briefPath), briefDir: dirname(briefPath), syntheticPath: briefPath};
}

async function checkPlaywright() {
  try {
    await import('playwright');
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const t0 = Date.now();
  const {brief, briefDir} = await loadBriefOrSynth();
  const merged = defaults(brief);
  const outDir = resolve(briefDir, merged.out);
  await ensureDir(outDir);

  // Load viewports table
  const viewportsTable = await readJSON(join(__dirname, 'templates/viewports.json'));
  const viewports = resolveViewports(brief, viewportsTable, deep);
  const engines = resolveEngines(brief, deep);

  // Resolve phases
  const PHASES = ['scan', 'baseline', 'diagnose', 'propose', 'apply', 'verify', 'report', 'escalate'];
  let selected;
  if (phasesArg) {
    const want = String(phasesArg).split(',').map((s) => s.trim());
    selected = want.map((w) => {
      if (PHASES.includes(w)) return w;
      const idx = parseInt(w, 10);
      if (!isNaN(idx) && idx >= 1 && idx <= 7) return PHASES[idx - 1];
      throw new Error(`unknown phase: ${w}`);
    });
  } else {
    // Default: scan, baseline, diagnose, propose, report. Apply+verify gated on --yes. Escalate gated on --yes AND not --no-escalate.
    selected = ['scan', 'baseline', 'diagnose', 'propose'];
    if (yes) selected.push('apply', 'verify');
    selected.push('report');
    if (yes && !noEscalate) selected.push('escalate');
  }

  log(`plan: phases=${selected.join('→')}, viewports=${viewports.length}, engines=${engines.join('+')}, deep=${deep}, dryRun=${dryRun}, yes=${yes}, aggressive=${aggressive}, autoImpeccable=${autoImpeccable}`);

  // Check Playwright if any of phases 2,3,6 selected
  const wantsPw = selected.some((p) => ['baseline', 'diagnose', 'verify'].includes(p));
  if (wantsPw) {
    const ok = await checkPlaywright();
    if (!ok) {
      err('Playwright not installed. Install with:');
      err('  cd ' + __dirname + ' && pnpm install && npx playwright install chromium' + (deep ? ' webkit firefox' : ''));
      process.exit(2);
    }
  }

  const results = {};
  let issueCount = 0;
  const MAX_ITER = 3;

  for (const phase of selected) {
    try {
      if (phase === 'scan') results.scan = await runScan({brief, briefDir, outDir});
      else if (phase === 'baseline') results.baseline = await runBaseline({brief, briefDir, outDir, viewports, engines, deep, dryRun});
      else if (phase === 'diagnose') results.diagnose = await runDiagnose({brief, briefDir, outDir, viewports, engines, dryRun});
      else if (phase === 'propose') results.propose = await runPropose({brief, briefDir, outDir});
      else if (phase === 'apply') {
        // Snapshot pre-apply diagnose so iterative loop doesn't overwrite the baseline measurement
        try {
          const {readFile: rf, writeFile: wf} = await import('fs/promises');
          const buf = await rf(join(outDir, 'diagnose.json'), 'utf8');
          await wf(join(outDir, 'diagnose-initial.json'), buf);
        } catch {}
        results.apply = await runApply({brief, briefDir, outDir, yes, dryRun, aggressive});
        // Iterative loop: post-apply cascade discovery (e.g. .btn padding shrinks after migrate).
        // Fix 8: each iteration phase wrapped in try/catch — if a sub-phase crashes
        // (Playwright timeout, postcss parse error in mid-edit file, etc), break the loop
        // cleanly so verify+report still run on the partial-apply state.
        if (yes && !dryRun && results.apply.counts?.applied > 0) {
          for (let iter = 2; iter <= MAX_ITER; iter++) {
            log(`iteration ${iter}/${MAX_ITER} — re-scan + re-diagnose + re-propose + re-apply`);
            try {
              await runScan({brief, briefDir, outDir});
              await runDiagnose({brief, briefDir, outDir, viewports, engines, dryRun: false});
              const reprop = await runPropose({brief, briefDir, outDir});
              const nextAutoFixable = reprop.counts?.autoFixable ?? 0;
              if (nextAutoFixable === 0) {
                log(`iteration ${iter} — converged (0 new auto-fixable)`);
                break;
              }
              const reapply = await runApply({brief, briefDir, outDir, yes, dryRun: false, aggressive});
              results.apply.iterations = (results.apply.iterations || 1) + 1;
              results.apply.counts.applied += reapply.counts?.applied || 0;
              if ((reapply.counts?.applied || 0) === 0) {
                log(`iteration ${iter} — converged (nothing new applied)`);
                break;
              }
            } catch (e) {
              err(`iteration ${iter} crashed: ${e.message} — continuing to verify with partial-apply state`);
              results.apply.iterationCrash = {iter, error: e.message};
              break;
            }
          }
        }
      }
      else if (phase === 'verify') results.verify = await runVerify({brief, briefDir, outDir, viewports, engines, dryRun});
      else if (phase === 'report') results.report = await runReport({brief, briefDir, outDir});
      else if (phase === 'escalate') {
        results.escalate = await runEscalate({brief, briefDir, outDir, verifyResult: results.verify});
        // Fix 6: production auto-spawn via claude CLI subprocess (opt-in).
        if (autoImpeccable && results.escalate?.briefPath) {
          results.autoImpeccable = await runAutoImpeccable({briefPath: results.escalate.briefPath, briefDir});
          // Re-diagnose after subprocess agent edits for delta measurement
          try {
            log('post-auto-impeccable re-diagnose for delta…');
            results.postAgentDiagnose = await runDiagnose({brief, briefDir, outDir, viewports, engines, dryRun: false});
            log(`delta: residuals ${results.escalate.totalResidual} → ${results.postAgentDiagnose.issueCount}`);
          } catch (e) {
            err(`post-agent diagnose failed: ${e.message}`);
          }
        }
      }
    } catch (e) {
      err(`phase ${phase} failed: ${e.message}`);
      err(e.stack);
      process.exit(2);
    }
  }

  // Issue counting → exit code
  if (results.propose) {
    issueCount = (results.propose.counts.error || 0) + (results.propose.counts.warn || 0);
  } else if (results.scan) {
    issueCount = results.scan.issues?.filter((i) => i.severity !== 'info').length || 0;
  }

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  log(`done in ${dt}s — ${issueCount} non-info issues. out → ${outDir}`);

  if (jsonOutput) {
    // Read version from package.json — keeps single source of truth, no hardcoded drift
    let pkgVersion = 'unknown';
    try {
      const pkg = JSON.parse(await (await import('fs/promises')).readFile(join(__dirname, 'package.json'), 'utf8'));
      pkgVersion = pkg.version;
    } catch {}
    const summary = {
      version: pkgVersion,
      generatedAt: new Date().toISOString(),
      durationSec: parseFloat(dt),
      nonInfoIssueCount: issueCount,
      outDir,
      counts: results.propose?.counts || null,
      bucketSummary: results.propose?.bucketSummary || null,
      applyCounts: results.apply?.counts || null,
      verify: results.verify ? {shots: results.verify.shots, regressions: results.verify.regressions, postDiagnoseCount: results.verify.postDiagnose?.issueCount} : null,
      escalate: results.escalate ? {residual: results.escalate.totalResidual, brief: results.escalate.briefPath} : null,
      exitCode: issueCount > 0 ? 1 : 0,
    };
    console.log(JSON.stringify(summary));
  }

  process.exit(issueCount > 0 ? 1 : 0);
}

main().catch((e) => {
  err(e.message);
  if (process.env.RM_DEBUG) err(e.stack);
  process.exit(2);
});
