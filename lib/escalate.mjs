/**
 * Phase 8 — escalate
 *
 * After --yes + iterative loop converges, if runtime issues remain, generate
 * ESCALATION-BRIEF.md that the orchestrator (Claude session) reads and uses
 * to spawn an LLM agent (Claude Code subprocess by default via --auto-impeccable).
 *
 * Why a file + marker (vs. direct Agent spawn from node)?
 *   run.mjs is a child process; it cannot call the Agent tool. The marker
 *   line on stdout signals the orchestrator to spawn. CI environments without
 *   an orchestrator can still read ESCALATION-BRIEF.md manually.
 */
import {readFile, writeFile} from 'fs/promises';
import {existsSync} from 'fs';
import {join} from 'path';
import {spawn} from 'child_process';
import {log, readJSON} from './util.mjs';

async function loadProjectStack(briefDir) {
  const stackPath = join(briefDir, '.claude-stack.json');
  if (!existsSync(stackPath)) return null;
  try { return await readJSON(stackPath); } catch { return null; }
}

function topKindsWithSamples(diagnoseIssues, maxKinds = 6, maxSamplesPerKind = 5) {
  const byKind = {};
  for (const i of diagnoseIssues) {
    if (!byKind[i.kind]) byKind[i.kind] = {kind: i.kind, severity: i.severity, count: 0, samples: []};
    byKind[i.kind].count++;
    const samples = i.data?.samples || (i.data?.selectors ? i.data.selectors.map((s) => ({selector: s})) : []);
    for (const s of samples) {
      if (byKind[i.kind].samples.length < maxSamplesPerKind) {
        byKind[i.kind].samples.push({...s, route: i.route, viewport: i.viewport});
      }
    }
  }
  return Object.values(byKind).sort((a, b) => b.count - a.count).slice(0, maxKinds);
}

const KIND_PLAYBOOK = {
  'touch-target-too-small': {
    title: 'Touch targets below 44×44',
    why: 'WCAG 2.5.5 + Apple HIG + Material — fingers need 44 px hit area on touch devices.',
    fix_strategy: 'For each sample selector: find the JSX, add Tailwind `min-h-11 inline-flex items-center` (or equivalent CSS) WITHOUT breaking inline link semantics. Skip aria-hidden + sr-only + skip-links. For dense desktop nav at ≥1280 viewport, treat as pointer-only and skip (operator brand call).',
  },
  'font-size-too-small': {
    title: 'Text rendering below 14 px floor',
    why: 'iOS auto-zooms inputs <16 px; <14 px fails readability for low-vision users.',
    fix_strategy: 'CHECK each selector before fixing. mono-cap / .caption / decorative labels / superscript = design-intentional small text (DO NOT bump). Real body content + interactive labels = bump to text-sm (14 px) or text-base (16 px) per context.',
  },
  'img-missing-dimensions': {
    title: '<img> / <Image> without intrinsic dimensions',
    why: 'CLS (Cumulative Layout Shift) predictor. Browser cannot reserve space.',
    fix_strategy: 'For <Image fill> in Next.js — check that parent container has explicit aspect-ratio (Tailwind aspect-square / aspect-[16/9] / etc). If parent already has it, this is a diagnose-engine false positive (engine reads style attr, not Tailwind-compiled CSS). For raw <img>, fetch source + add width/height or style="aspect-ratio: W/H".',
  },
  'fixed-bottom-no-safe-area': {
    title: 'Fixed/sticky bottom elements without safe-area-inset',
    why: 'iPhone home indicator overlaps content on full-screen models.',
    fix_strategy: 'Append `pb-[env(safe-area-inset-bottom)]` to className. If responsive-modernize already auto-fixed via Tailwind codemod and engine still flags, it is a detection limitation (engine reads computed env() not stylesheet rule). Verify by inspecting the source file — if pb-env is present, skip.',
  },
  'text-overflow': {
    title: 'Text blocks overflow container',
    why: 'On narrow viewports, long words / unbreakable strings push width past parent.',
    fix_strategy: 'Add Tailwind `break-words` or `text-wrap: balance` for headings. For URLs, use `break-all`. For animated marquees (whitespace-nowrap + translate animation), this IS the design — skip.',
  },
  'horizontal-scroll': {
    title: 'Document overflows viewport horizontally',
    why: 'Any element wider than viewport breaks mobile layout.',
    fix_strategy: 'Inspect data.culprits selectors. For each, find JSX and either: (a) constrain width via min(100%, NNpx), (b) add overflow-x-hidden on a parent if intentional (e.g. marquee wrapper), (c) make container responsive (flex-wrap, grid-cols-1 md:grid-cols-N).',
  },
};

function renderBrief({brief, briefDir, outDir, stack, kinds, projectName, totalResidual}) {
  const lines = [];
  lines.push(`# Responsive-modernize residual fixes — escalation to LLM agent`);
  lines.push('');
  lines.push(`**Generated**: ${new Date().toISOString()}`);
  lines.push(`**Project**: ${projectName}`);
  lines.push(`**Project dir**: \`${briefDir}\``);
  lines.push(`**Audit out**: \`${outDir}\``);
  lines.push(`**Residual runtime issues**: ${totalResidual}`);
  lines.push('');
  lines.push('## Why this exists');
  lines.push('');
  lines.push('`/responsive-modernize` auto-codemods (Utopia px-to-token, Tailwind safe-area, meta viewport, etc.) already ran. The residuals listed below need semantic JSX/TSX understanding that regex codemods cannot resolve — that is YOUR job.');
  lines.push('');

  if (stack) {
    lines.push('## Project context (from .claude-stack.json)');
    lines.push('');
    lines.push('```yaml');
    lines.push(`framework: ${stack.stack?.framework || stack.framework || 'unknown'}`);
    if (stack.stack?.ui) lines.push(`ui: ${stack.stack.ui.join(', ')}`);
    if (stack.languages) lines.push(`languages: primary=${stack.languages.primary}, secondary=${stack.languages.secondary || 'n/a'}`);
    if (stack.design) {
      lines.push(`brand: ${stack.design.brand || 'n/a'}`);
      lines.push(`voice: ${stack.design.voice || 'n/a'}`);
      lines.push(`primary_color: ${stack.design.primary_color || 'n/a'}`);
      lines.push(`accent_color: ${stack.design.accent_color || 'n/a'}`);
      if (Array.isArray(stack.design.inspiration)) lines.push(`inspiration: ${stack.design.inspiration.join(' / ')}`);
    }
    if (stack.stack?.port_local) lines.push(`dev_url: http://localhost:${stack.stack.port_local}`);
    lines.push('```');
    lines.push('');
  }

  lines.push('## Residual issues by kind (sorted by count)');
  lines.push('');
  for (const k of kinds) {
    const playbook = KIND_PLAYBOOK[k.kind] || {title: k.kind, why: '(no playbook)', fix_strategy: 'Use judgement.'};
    lines.push(`### ${k.kind} — ${k.count} hits (${k.severity})`);
    lines.push('');
    lines.push(`**${playbook.title}**`);
    lines.push('');
    lines.push(`_Why_: ${playbook.why}`);
    lines.push('');
    lines.push(`_Fix strategy_: ${playbook.fix_strategy}`);
    lines.push('');
    if (k.samples.length > 0) {
      lines.push('Top sample selectors:');
      lines.push('');
      for (const s of k.samples) {
        const parts = [];
        if (s.selector) parts.push(`\`${s.selector}\``);
        if (s.tag) parts.push(`tag=${s.tag}`);
        if (s.text) parts.push(`text="${(s.text || '').slice(0, 50)}"`);
        if (s.width && s.height) parts.push(`size=${s.width}×${s.height}`);
        if (s.fontSize) parts.push(`fontSize=${s.fontSize}px`);
        if (s.route) parts.push(`route=${s.route}`);
        if (s.viewport) parts.push(`viewport=${s.viewport}`);
        lines.push(`- ${parts.join(' · ')}`);
      }
      lines.push('');
    }
  }

  lines.push('## Success criteria + when to stop');
  lines.push('');
  lines.push(`This brief was generated when post-apply diagnose still had **${totalResidual} runtime issues** across ${kinds.length} kinds. Stop when ANY of:`);
  lines.push('');
  lines.push(`- Post-edit diagnose issueCount drops by ≥ 50% (target: < ${Math.ceil(totalResidual * 0.5)}) — diminishing returns past this`);
  lines.push('- You have made one focused pass over the top 3 issue kinds — do NOT re-iterate the same kind multiple times');
  lines.push('- A single residual kind has 4 consecutive false-positive judgements (e.g. all hits are intentional brand design) — document why + stop');
  lines.push('- Total files touched ≥ 15 — keep diff reviewable for operator');
  lines.push('- 30 minutes of wall-clock work have passed — escalate the rest back to operator in the report');
  lines.push('');
  lines.push('Do NOT chase the count to zero. The diagnose engine has known false positives (Tailwind aspect-X classes invisible to runtime check, mono-cap 12px intentional brand, marquee whitespace-nowrap design). Document them, do not fix them.');
  lines.push('');
  lines.push('## Process for the agent');
  lines.push('');
  lines.push('1. Read `diagnose.json` for full per-viewport breakdown (all samples)');
  lines.push('2. For each kind, use the fix_strategy as guidance — NOT a rigid script');
  lines.push('3. grep src/ for the selectors → JSX files');
  lines.push('4. Make minimal, brand-consistent edits per the project context above');
  lines.push('5. After edits, run verify: `cd ' + briefDir + ' && node ~/.openclaw/scripts/responsive-modernize/run.mjs --phase diagnose 2>&1 | tail -5`');
  lines.push('6. Report:');
  lines.push('   - Files touched (path + edits per file)');
  lines.push('   - Pre/post diagnose issue counts');
  lines.push('   - Anything skipped + why (brand decisions, false positives)');
  lines.push('   - Any judgement calls + design-system level rework noted (but NOT done — keep diffs minimal)');
  lines.push('');
  lines.push('## Constraints');
  lines.push('');
  lines.push('- Preserve user-facing copy verbatim — only edit className/structure');
  lines.push('- Skip `aria-hidden` / `sr-only` / skip-links');
  lines.push('- DO NOT touch `globals.css` or design tokens — these are component-level decisions');
  lines.push('- DO NOT restart the dev server');
  lines.push('- Keep changes < 10 lines per file when possible');
  return lines.join('\n');
}

export async function runEscalate({brief, briefDir, outDir, verifyResult, postDiagnose}) {
  log('phase 8/8 — escalate', 'rm');

  // Resolve residual count: inline ctx → verify.json on disk → current diagnose.json
  let totalResidual = postDiagnose?.issueCount ?? verifyResult?.postDiagnose?.issueCount;
  if (totalResidual == null) {
    try {
      const v = await readJSON(join(outDir, 'verify.json'));
      totalResidual = v.postDiagnose?.issueCount ?? null;
    } catch {}
  }
  if (totalResidual == null) {
    try {
      const d = await readJSON(join(outDir, 'diagnose.json'));
      totalResidual = d.issueCount ?? 0;
    } catch { totalResidual = 0; }
  }

  if (totalResidual === 0) {
    log('  no residual issues — escalation not needed');
    return {phase: 'escalate', skipped: true, reason: '0 residuals'};
  }

  // Load post-apply diagnose detail — prefer verify-diagnose-tmp, fall back to diagnose.json
  let diag = postDiagnose;
  if (!diag) {
    const tmp = join(outDir, 'verify-diagnose-tmp', 'diagnose.json');
    if (existsSync(tmp)) {
      try { diag = await readJSON(tmp); } catch {}
    }
  }
  if (!diag) {
    try { diag = await readJSON(join(outDir, 'diagnose.json')); } catch {}
  }
  const issues = diag?.issues || [];
  if (issues.length === 0) {
    log('  no diagnose issue detail — skipping escalate');
    return {phase: 'escalate', skipped: true, reason: 'no diagnose detail'};
  }

  const stack = await loadProjectStack(briefDir);
  // Prefer stack name → briefDir basename → URL fallback. Previously URL beat
  // dir basename, which surfaced "http://localhost:3000" as project name.
  const projectName = stack?.name || briefDir.split('/').pop() || brief.target?.url || 'unknown';
  const kinds = topKindsWithSamples(issues);

  const md = renderBrief({brief, briefDir, outDir, stack, kinds, projectName, totalResidual});
  const briefPath = join(outDir, 'ESCALATION-BRIEF.md');
  await writeFile(briefPath, md);

  log(`  brief written: ${briefPath}`);
  // Emit machine-readable marker on stdout. Orchestrator (Claude session) detects this and spawns an Agent.
  console.log(`[RM-ESCALATE: ${briefPath} · ${totalResidual} residuals · project=${projectName}]`);

  return {
    phase: 'escalate',
    skipped: false,
    briefPath,
    totalResidual,
    topKinds: kinds.map((k) => ({kind: k.kind, count: k.count, severity: k.severity})),
    projectName,
  };
}

/**
 * Fix 6: production auto-spawn via claude CLI subprocess.
 *
 * When called with --auto-impeccable, run.mjs spawns `claude --print` as a
 * non-interactive subprocess with the ESCALATION-BRIEF.md as prompt. The
 * subprocess agent uses the operator's OAuth ($0 marginal) and has full
 * file-edit + Bash tool capability with --dangerously-skip-permissions
 * (the operator explicitly opted in via the flag).
 *
 * Caveats:
 *   - requires `claude` CLI on PATH + OAuth session
 *   - --dangerously-skip-permissions means agent edits without per-action prompts
 *   - typical run: 2-5 min wall-clock
 */
export async function runAutoImpeccable({briefPath, briefDir}) {
  log('phase 8b — auto-impeccable subprocess', 'rm');
  if (!existsSync(briefPath)) {
    log(`  no brief at ${briefPath} — skipping`);
    return {skipped: true, reason: 'no brief'};
  }
  const briefContent = await readFile(briefPath, 'utf8');
  const t0 = Date.now();

  return new Promise((resolve) => {
    const args = [
      '--print',
      '--bare',
      '--add-dir', briefDir,
      '--dangerously-skip-permissions',
      '--allowedTools', 'Read,Edit,Write,Glob,Grep,Bash',
      briefContent,
    ];
    log(`  spawning: claude ${args.slice(0, 6).join(' ')} <BRIEF>`);
    const child = spawn('claude', args, {
      cwd: briefDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (b) => {
      const s = b.toString();
      stdout += s;
      // Stream first 100 lines to parent stdout for visibility
      for (const line of s.split('\n')) if (line.trim()) log(`  > ${line.slice(0, 200)}`);
    });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('error', (e) => {
      log(`  spawn error: ${e.message}`);
      resolve({skipped: true, reason: `spawn error: ${e.message}`});
    });
    child.on('exit', (code) => {
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      log(`  auto-impeccable done — exit ${code}, ${dt}s`);
      resolve({
        skipped: false,
        exitCode: code,
        durationSec: parseFloat(dt),
        stdoutTail: stdout.slice(-2000),
        stderrTail: stderr.slice(-1000),
      });
    });
  });
}
