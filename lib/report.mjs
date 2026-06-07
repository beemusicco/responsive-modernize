import {writeFile} from 'fs/promises';
import {existsSync} from 'fs';
import {join} from 'path';
import sharp from 'sharp';
import {log, writeJSON, readJSON} from './util.mjs';

async function buildSprite({sources, outPath, columns = 3, tileWidth = 320, label}) {
  if (!sources.length) return null;
  const rows = Math.ceil(sources.length / columns);
  const compositions = [];
  let maxHeight = 0;
  // Pre-scan dimensions to fit
  const resized = [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    if (!existsSync(src.path)) continue;
    const img = sharp(src.path);
    const meta = await img.metadata();
    const scale = tileWidth / (meta.width || tileWidth);
    const newH = Math.round((meta.height || 0) * scale);
    const buf = await img.resize({width: tileWidth}).png().toBuffer();
    resized.push({...src, buffer: buf, width: tileWidth, height: newH, idx: i});
    if (newH > maxHeight) maxHeight = newH;
  }
  if (resized.length === 0) return null;
  // Use uniform tile height = max for grid alignment
  const tileH = maxHeight;
  const canvasW = tileWidth * columns;
  const canvasH = tileH * Math.ceil(resized.length / columns);
  const composites = resized.map((r) => {
    const col = r.idx % columns;
    const row = Math.floor(r.idx / columns);
    return {input: r.buffer, left: col * tileWidth, top: row * tileH};
  });
  await sharp({create: {width: canvasW, height: canvasH, channels: 4, background: {r: 17, g: 17, b: 17, alpha: 1}}})
    .composite(composites)
    .png()
    .toFile(outPath);
  return {outPath, tiles: resized.length, columns, tileWidth, tileHeight: tileH};
}

function htmlEscape(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
}

function htmlViewer({brief, scan, diag, propose, verify}) {
  const baseUrl = brief.target?.url || '';
  const issues = propose?.issues || [];
  const counts = propose?.counts || {error: 0, warn: 0, info: 0};
  const verifyResults = verify?.results || [];
  const rows = verifyResults
    .filter((r) => r.diff)
    .map((r) => `
      <tr>
        <td>${htmlEscape(r.engine)}</td>
        <td>${htmlEscape(r.route)}</td>
        <td>${htmlEscape(r.viewport)}</td>
        <td>${r.diff.pctDiff.toFixed(3)}%</td>
        <td>${r.diff.pixelsDiff} / ${r.diff.totalPixels}</td>
      </tr>`)
    .join('');

  return `<!doctype html>
<html lang="sl"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Responsive Modernize — Report</title>
<style>
:root { --bg: #0a0a0a; --fg: #f0f0f0; --dim: #999; --err: #ef4444; --warn: #f59e0b; --info: #22d3ee; --ok: #10b981; --line: #2a2a2a; }
* { box-sizing: border-box; }
body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 32px; max-width: 1400px; margin-inline: auto; line-height: 1.55; }
h1 { font-size: clamp(1.5rem, 1rem + 2vw, 2.25rem); margin: 0 0 8px; }
h2 { margin: 48px 0 16px; border-bottom: 1px solid var(--line); padding-bottom: 8px; }
.sub { color: var(--dim); margin: 0 0 32px; }
.scorecard { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 24px 0; }
.score { background: #161616; border: 1px solid var(--line); border-radius: 12px; padding: 20px; }
.score b { font-size: 32px; display: block; line-height: 1; margin-bottom: 4px; }
.score .err { color: var(--err); } .score .warn { color: var(--warn); } .score .info { color: var(--info); } .score .ok { color: var(--ok); }
table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); }
th { background: #161616; color: var(--dim); font-weight: 500; }
code { background: #1a1a1a; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
.badge-error { background: #ef444433; color: var(--err); }
.badge-warn { background: #f59e0b33; color: var(--warn); }
.badge-info { background: #22d3ee33; color: var(--info); }
.issues { margin-top: 16px; }
.issue { background: #161616; border-left: 3px solid var(--line); padding: 12px 16px; margin: 8px 0; border-radius: 6px; }
.issue.error { border-left-color: var(--err); }
.issue.warn { border-left-color: var(--warn); }
.issue.info { border-left-color: var(--info); }
.issue .head { display: flex; gap: 12px; align-items: center; margin-bottom: 4px; flex-wrap: wrap; }
.issue .meta { color: var(--dim); font-size: 12px; }
.sprite-wrap { background: #111; padding: 16px; border-radius: 12px; margin: 16px 0; overflow-x: auto; }
.sprite-wrap img { max-width: 100%; height: auto; display: block; }
details { margin: 8px 0; }
summary { cursor: pointer; color: var(--info); padding: 6px 0; }
</style>
</head><body>
<h1>Responsive Modernize Report</h1>
<p class="sub">Target: <code>${htmlEscape(baseUrl || '(static-only)')}</code> · Generated: ${new Date().toISOString()}</p>

<div class="scorecard">
  <div class="score"><b class="err">${counts.error || 0}</b>error</div>
  <div class="score"><b class="warn">${counts.warn || 0}</b>warn</div>
  <div class="score"><b class="info">${counts.info || 0}</b>info</div>
  <div class="score"><b class="ok">${counts.autoFixable || 0}</b>auto-fixable</div>
  <div class="score"><b>${scan?.stats?.mediaQueryTotal ?? 0}</b>@media rules</div>
  <div class="score"><b>${scan?.stats?.containerQueryTotal ?? 0}</b>@container rules</div>
</div>

<h2>Multi-viewport baseline</h2>
<div class="sprite-wrap"><img src="sprite-baseline.png" alt="Baseline grid" /></div>

${verify ? `<h2>Post-apply verify (diff)</h2>
<div class="sprite-wrap"><img src="sprite-verify.png" alt="Post-apply grid" /></div>
<table>
<thead><tr><th>engine</th><th>route</th><th>viewport</th><th>pct diff</th><th>pixels diff</th></tr></thead>
<tbody>${rows}</tbody>
</table>` : ''}

<h2>All issues</h2>
<div class="issues">
${issues.map((i) => `
<div class="issue ${i.severity || 'info'}">
  <div class="head">
    <span class="badge badge-${i.severity || 'info'}">${htmlEscape(i.severity || '?')}</span>
    <code>${htmlEscape(i.kind)}</code>
    ${i.autoFixable ? '<span class="badge badge-info">auto</span>' : ''}
  </div>
  <div>${htmlEscape(i.msg || '')}</div>
  <div class="meta">${i.file ? `<code>${htmlEscape(i.file)}:${i.line || 0}</code>` : ''}${i.viewport ? ` · ${htmlEscape(i.viewport)}` : ''}${i.engine ? ` · ${htmlEscape(i.engine)}` : ''}</div>
  ${i.data ? `<details><summary>details</summary><pre>${htmlEscape(JSON.stringify(i.data, null, 2))}</pre></details>` : ''}
</div>`).join('')}
</div>
</body></html>`;
}

export async function runReport({brief, briefDir, outDir}) {
  log('phase 7/7 — report', 'rm');
  let scan = null, diag = null, propose = null, verify = null, baseline = null, apply = null;
  try { scan = await readJSON(join(outDir, 'scan.json')); } catch {}
  try { diag = await readJSON(join(outDir, 'diagnose.json')); } catch {}
  try { propose = await readJSON(join(outDir, 'propose.json')); } catch {}
  try { verify = await readJSON(join(outDir, 'verify.json')); } catch {}
  try { baseline = await readJSON(join(outDir, 'baseline.json')); } catch {}
  try { apply = await readJSON(join(outDir, 'apply.json')); } catch {}

  // Build baseline sprite
  const baselineDir = join(outDir, 'baseline');
  const baselineSources = [];
  if (baseline?.results) {
    for (const r of baseline.results) {
      if (!r.ok || !r.file) continue;
      baselineSources.push({path: r.file, label: `${r.engine}/${r.viewport}/${r.route}`});
    }
  }
  const spriteBaseline = await buildSprite({sources: baselineSources, outPath: join(outDir, 'sprite-baseline.png'), columns: Math.min(baselineSources.length, 4)});

  // Build verify sprite if exists
  let spriteVerify = null;
  if (verify?.results) {
    const verifySources = verify.results.filter((r) => r.afterPath).map((r) => ({path: r.afterPath, label: `${r.engine}/${r.viewport}/${r.route}`}));
    if (verifySources.length) {
      spriteVerify = await buildSprite({sources: verifySources, outPath: join(outDir, 'sprite-verify.png'), columns: Math.min(verifySources.length, 4)});
    }
  }

  // HTML viewer
  const html = htmlViewer({brief, scan, diag, propose, verify});
  await writeFile(join(outDir, 'REPORT.html'), html);

  // Markdown report
  const md = [];
  md.push('# Responsive Modernize — Report\n');
  md.push(`Target: \`${brief.target?.url || '(static-only)'}\`  `);
  md.push(`Generated: ${new Date().toISOString()}\n`);
  md.push('## Executive summary\n');
  md.push(`- Issues: **${propose?.issues?.length ?? 0}** total (${propose?.counts?.error ?? 0} error · ${propose?.counts?.warn ?? 0} warn · ${propose?.counts?.info ?? 0} info)`);
  md.push(`- Auto-fixable: **${propose?.counts?.autoFixable ?? 0}**, manual: **${propose?.counts?.manualOnly ?? 0}**`);
  md.push(`- CSS scan: ${scan?.stats?.filesScanned ?? 0} files, ${scan?.stats?.mediaQueryTotal ?? 0} @media, ${scan?.stats?.containerQueryTotal ?? 0} @container`);
  md.push(`- Baseline shots: ${baseline?.shots ?? 0} (${baseline?.failed ?? 0} failed)`);
  if (verify) md.push(`- Verify shots: ${verify.shots} · regressions above ${verify.threshold}%: **${verify.regressions}**`);
  if (apply) md.push(`- Applied: **${apply.counts.applied}** fixes, skipped ${apply.counts.skipped}. Backups in \`${apply.backupRoot}/\`.`);
  md.push('\n## Open the HTML report\n');
  md.push(`See \`REPORT.html\` in the same directory for the interactive viewer with sprites and detail panels.`);
  md.push('\n## See also\n');
  md.push('- `scan.json` — static analysis findings');
  md.push('- `diagnose.json` — runtime per-viewport findings');
  md.push('- `propose.md` / `propose.json` — ranked fix plan + codemod kit');
  md.push('- `apply.json` — applied fixes manifest (with backups)');
  md.push('- `verify.json` — post-apply diff + re-run diagnose');
  md.push('- `sprite-baseline.png` / `sprite-verify.png` — multi-viewport grids');
  md.push('- `diff/` — per-viewport pixelmatch diffs');

  await writeFile(join(outDir, 'REPORT.md'), md.join('\n'));

  const summary = {phase: 'report', generatedAt: new Date().toISOString(), spriteBaseline, spriteVerify, files: {report: 'REPORT.md', html: 'REPORT.html'}};
  await writeJSON(join(outDir, 'report.json'), summary);
  log(`  report → REPORT.html + REPORT.md + sprite-baseline.png${spriteVerify ? ' + sprite-verify.png' : ''}`);
  return summary;
}
