#!/usr/bin/env node
/**
 * Integration smoke — runs scan against a synthetic multi-stack fixture.
 * Asserts expected anti-patterns are flagged across each stack.
 *
 * Exit 0 = pass, exit 1 = any assertion failed.
 */
import {mkdir, writeFile, readFile, rm} from 'fs/promises';
import {existsSync} from 'fs';
import {spawn} from 'child_process';
import {createServer} from 'http';
import {fileURLToPath} from 'url';
import {dirname, resolve, join} from 'path';
import {runDiagnose} from '../lib/diagnose.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const FIXTURE = '/tmp/rm-test-smoke';

function log(s) { process.stdout.write(`[smoke] ${s}\n`); }
function fail(s) { process.stderr.write(`[smoke FAIL] ${s}\n`); }

async function buildFixture() {
  if (existsSync(FIXTURE)) await rm(FIXTURE, {recursive: true, force: true});
  await mkdir(join(FIXTURE, 'src/vue'), {recursive: true});
  await mkdir(join(FIXTURE, 'src/svelte'), {recursive: true});
  await mkdir(join(FIXTURE, 'src/astro'), {recursive: true});
  await mkdir(join(FIXTURE, 'src/ve'), {recursive: true});
  await mkdir(join(FIXTURE, 'src/scss'), {recursive: true});
  await mkdir(join(FIXTURE, 'src/cssjs'), {recursive: true});

  await writeFile(join(FIXTURE, '.responsive-modernize.json'), JSON.stringify({
    target: {}, framework: 'static',
  }));

  await writeFile(join(FIXTURE, 'src/vue/Card.vue'), `<template><div class="card">x</div></template>
<style scoped>
.card { font-size: 13px; padding: 10px; }
.a { font-size: 10px; }
.b { font-size: 11px; }
@media (min-width: 600px) { .card { padding: 16px; } }
@media (min-width: 768px) { .card { padding: 20px; } }
@media (min-width: 1024px) { .card { padding: 24px; } }
@media (min-width: 1280px) { .card { padding: 32px; } }
.anim { animation: spin 2s; }
</style>`);

  await writeFile(join(FIXTURE, 'src/svelte/Card.svelte'), `<style>
.card { font-size: 12px; }
.a { font-size: 10px; }
.b { font-size: 11px; }
@media (min-width: 640px) { .card { padding: 12px; } }
@media (min-width: 768px) { .card { padding: 16px; } }
@media (min-width: 1024px) { .card { padding: 24px; } }
@media (min-width: 1280px) { .card { padding: 32px; } }
.fade { transition: opacity 0.3s; }
</style>`);

  await writeFile(join(FIXTURE, 'src/astro/Card.astro'), `<div></div>
<style>
.card { font-size: 13px; }
.a { font-size: 10px; }
.b { font-size: 11px; }
@media (min-width: 600px) { .card { padding: 16px; } }
@media (min-width: 1024px) { .card { padding: 24px; } }
@media (min-width: 1280px) { .card { padding: 32px; } }
@media (min-width: 1440px) { .card { padding: 40px; } }
.anim { animation: fade 1s; }
</style>`);

  await writeFile(join(FIXTURE, 'src/ve/styles.css.ts'), `import { style } from '@vanilla-extract/css'
export const card = style({ fontSize: '13px', padding: '10px' })`);

  await writeFile(join(FIXTURE, 'src/scss/main.scss'), `.card {
  font-size: 16px;
  padding: 16px;
  .title { font-size: 14px; }
  .body { font-size: 12px; }
}
@media (min-width: 768px) { .card { padding: 24px; } }`);

  await writeFile(join(FIXTURE, 'src/cssjs/Btn.tsx'), `import styled from 'styled-components';
const Btn = styled.button\`
  font-size: 13px;
  padding: 12px;
  font-size: 10px;
  font-size: 11px;
  @media (min-width: 600px) { padding: 16px; }
  @media (min-width: 768px) { padding: 20px; }
  @media (min-width: 1024px) { padding: 24px; }
  @media (min-width: 1280px) { padding: 32px; }
  animation: pulse 2s;
\`;`);
}

async function runScan() {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [join(ROOT, 'run.mjs'), '--phase', 'scan,report'], {
      cwd: FIXTURE,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('exit', (code) => resolve({code, stdout, stderr}));
    child.on('error', reject);
  });
}

async function runRuntimeDiagnoseSmoke() {
  const runtimeOut = join(FIXTURE, '.responsive-modernize-runtime');
  await mkdir(runtimeOut, {recursive: true});
  const html = `<!doctype html>
<html>
  <head>
    <title>runtime smoke</title>
    <style>
      body { background: #000; color: #fff; }
      button { background: #222; color: #fff; }
      @keyframes transient-shrink {
        from { transform: scale(.5); }
        to { transform: scale(.5); }
      }
      #scaled-animated { animation: transient-shrink 10s linear infinite; }
    </style>
  </head>
  <body>
    <button id="scaled-static" style="width:60px;height:60px;transform:scale(.5)">Scaled</button>
    <button id="scaled-animated" style="width:60px;height:60px">Animated</button>
    <button id="small-bad" style="width:30px;height:30px">Bad</button>
    <p id="contrast-ok">Readable white text on a black page.</p>
    <picture>
      <source srcset="/hero.webp" type="image/webp">
      <img id="picture-img" src="/hero.png" alt="Hero" style="display:block;width:320px;height:auto">
    </picture>
  </body>
</html>`;

  const server = createServer((req, res) => {
    if (req.url === '/hero.png' || req.url === '/hero.webp') {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    res.end(html);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const {port} = server.address();
    return await runDiagnose({
      brief: {target: {url: `http://127.0.0.1:${port}`, routes: ['/']}},
      briefDir: FIXTURE,
      outDir: runtimeOut,
      viewports: [{id: 'mobile-smoke', label: 'Mobile Smoke', width: 360, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true}],
      engines: ['chromium'],
      dryRun: false,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  log('building fixture…');
  await buildFixture();
  log('running scan…');
  const r = await runScan();
  log(`exit ${r.code}, stdout=${r.stdout.length}b stderr=${r.stderr.length}b`);
  if (![0, 1].includes(r.code)) {
    fail(`unexpected exit ${r.code}`);
    fail(`stderr: ${r.stderr.slice(-500)}`);
    process.exit(1);
  }

  const scan = JSON.parse(await readFile(join(FIXTURE, '.responsive-modernize/scan.json'), 'utf8'));
  let failures = 0;
  function assert(cond, label) {
    if (cond) log(`✓ ${label}`);
    else { fail(`✗ ${label}`); failures++; }
  }

  assert(scan.stats.sfcFilesWithBlocks === 3, `3 SFC files (got ${scan.stats.sfcFilesWithBlocks})`);
  assert(scan.stats.sfcStyleBlocksTotal === 3, `3 SFC style blocks (got ${scan.stats.sfcStyleBlocksTotal})`);
  assert(scan.stats.vanillaExtractFiles === 1, `1 Vanilla Extract file (got ${scan.stats.vanillaExtractFiles})`);
  assert(scan.stats.cssInJsFilesWithBlocks === 1, `1 CSS-in-JS file with blocks (got ${scan.stats.cssInJsFilesWithBlocks})`);
  assert(scan.stats.mediaQueryTotal >= 12, `≥12 @media total (got ${scan.stats.mediaQueryTotal})`);
  assert(scan.stats.skippedTailwind === 0, `0 Tailwind skips (got ${scan.stats.skippedTailwind})`);
  assert(scan.stats.skippedParseError === 0, `0 parse-error skips (got ${scan.stats.skippedParseError})`);

  const kinds = {};
  for (const i of scan.issues) kinds[i.kind] = (kinds[i.kind] || 0) + 1;
  assert(kinds['fluid-type-opportunity'] >= 4, `fluid-type-opportunity ≥4 (got ${kinds['fluid-type-opportunity'] || 0})`);
  assert(kinds['mq-bloat-no-cq'] >= 4, `mq-bloat-no-cq ≥4 (got ${kinds['mq-bloat-no-cq'] || 0})`);
  assert(kinds['no-reduced-motion-guard'] >= 3, `no-reduced-motion-guard ≥3 (got ${kinds['no-reduced-motion-guard'] || 0})`);
  assert(kinds['vanilla-extract-manual-review'] === 1, `vanilla-extract-manual-review = 1 (got ${kinds['vanilla-extract-manual-review'] || 0})`);

  // safeWrite leftover check
  const {globby} = await import('globby');
  const tmps = await globby(['**/*.rm-tmp-*'], {cwd: FIXTURE, dot: true});
  assert(tmps.length === 0, `0 .rm-tmp-* leftover (got ${tmps.length})`);

  try {
    log('running runtime diagnose smoke…');
    const diag = await runRuntimeDiagnoseSmoke();
    const touchSamples = diag.issues
      .filter((i) => i.kind === 'touch-target-too-small')
      .flatMap((i) => i.data?.samples || []);
    const imgMissing = diag.issues.filter((i) => i.kind === 'img-missing-dimensions');
    const contrastSamples = diag.issues
      .filter((i) => i.kind === 'low-color-contrast')
      .flatMap((i) => i.data?.samples || []);
    assert(touchSamples.some((s) => s.selector === '#small-bad'), 'runtime diagnose flags genuinely small tap target');
    assert(touchSamples.some((s) => s.selector === '#scaled-static'), 'runtime diagnose flags static transform-shrunk tap target');
    assert(!touchSamples.some((s) => s.selector === '#scaled-animated'), 'runtime diagnose ignores active transform animation snapshot');
    assert(imgMissing.length === 0, `runtime diagnose skips <picture> image dimensions (got ${imgMissing.length})`);
    assert(!contrastSamples.some((s) => s.selector === '#contrast-ok'), 'runtime diagnose respects black body background for contrast');
  } catch (e) {
    if (/Executable doesn't exist|browserType\.launch|Host system is missing dependencies/i.test(e.message || '')) {
      log(`runtime diagnose smoke skipped: ${e.message.split('\n')[0]}`);
    } else {
      throw e;
    }
  }

  await rm(FIXTURE, {recursive: true, force: true});

  if (failures > 0) {
    fail(`${failures} assertion(s) failed`);
    process.exit(1);
  }
  log(`all assertions passed`);
}

main().catch((e) => {
  fail(`error: ${e.message}`);
  process.exit(1);
});
