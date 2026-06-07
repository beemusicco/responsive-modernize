/**
 * Single-file-component (SFC) scanner — Vue, Svelte, Astro.
 *
 * These frameworks embed CSS inside the same file as the markup:
 *
 *   .vue:     <template>…</template>  <script>…</script>  <style scoped>…</style>
 *   .svelte:  <script>…</script>  <style>…</style>  (no template tag)
 *   .astro:   ---frontmatter---  <html>…<style>…</style>…</html>
 *
 * We extract the <style> block(s), pipe each through postcss for the same
 * responsive checks that scan.mjs runs on plain .css files. SCSS support
 * for `lang="scss"` blocks delegates to postcss-scss.
 *
 * Auto-fix policy: SFC <style> blocks are NOT mutated by the codemod —
 * the brittleness of preserving template/script positions, indent, and
 * `scoped` boundaries isn't worth the risk. Findings here go in propose
 * as manual-review items with the SFC file path + line within the block.
 */
import {readFile} from 'fs/promises';
import {relative} from 'path';
import postcss from 'postcss';

const STYLE_BLOCK_RE = /<style\b([^>]*)>([\s\S]*?)<\/style>/g;

function parseAttrs(attrStr = '') {
  const out = {};
  const RE = /(\w[\w-]*)(?:\s*=\s*("[^"]*"|'[^']*'|\S+))?/g;
  let m;
  while ((m = RE.exec(attrStr))) {
    out[m[1].toLowerCase()] = m[2] ? m[2].replace(/^["']|["']$/g, '') : true;
  }
  return out;
}

async function parseWithLang(css, lang, filePath) {
  if (lang === 'scss' || lang === 'sass') {
    try {
      const scssParser = await import('postcss-scss');
      return postcss.parse(css, {from: filePath, parser: scssParser.default || scssParser});
    } catch {
      // postcss-scss not installed → fall back to base postcss (likely will fail on SCSS features)
    }
  }
  return postcss.parse(css, {from: filePath});
}

function pushIssue(issues, issue) {
  issues.push({id: `${issue.kind}:${issue.file}:${issue.line || 0}`, autoFixable: issue.autoFixable ?? false, ...issue});
}

export async function scanSFC(filePath, projectRoot) {
  const text = await readFile(filePath, 'utf8');
  const rel = relative(projectRoot, filePath);
  const issues = [];
  const stats = {styleBlocks: 0, scopedBlocks: 0, mediaQueryCount: 0, containerQueryCount: 0};

  let blockIdx = 0;
  let m;
  STYLE_BLOCK_RE.lastIndex = 0;
  while ((m = STYLE_BLOCK_RE.exec(text))) {
    const [, rawAttrs, body] = m;
    const attrs = parseAttrs(rawAttrs);
    const lang = (attrs.lang || '').toLowerCase();
    if (attrs.scoped) stats.scopedBlocks++;
    stats.styleBlocks++;
    blockIdx++;
    // Compute first-line of <style> for issue locality (best effort — count newlines up to match)
    const offset = m.index;
    const lineOffset = text.slice(0, offset).split('\n').length;

    let root;
    try { root = await parseWithLang(body, lang, filePath); } catch {
      // Skip un-parseable block (e.g. SCSS without parser installed)
      continue;
    }

    let mediaQueryCount = 0;
    let containerQueryCount = 0;
    let hasReducedMotion = false;
    const hardcodedPxFonts = [];
    root.walkAtRules((rule) => {
      if (rule.name === 'media') {
        mediaQueryCount++;
        if (/prefers-reduced-motion/.test(rule.params)) hasReducedMotion = true;
      } else if (rule.name === 'container') containerQueryCount++;
    });
    root.walkDecls((decl) => {
      if (/^font-size$/i.test(decl.prop)) {
        const fm = /^(\d+(?:\.\d+)?)px$/.exec(decl.value.trim());
        if (fm && !/var\(|clamp\(|calc\(/.test(decl.value)) hardcodedPxFonts.push({px: parseFloat(fm[1]), value: decl.value});
      }
    });

    stats.mediaQueryCount += mediaQueryCount;
    stats.containerQueryCount += containerQueryCount;

    if (hardcodedPxFonts.length >= 3) {
      pushIssue(issues, {
        kind: 'fluid-type-opportunity',
        file: rel + ` (<style#${blockIdx}>)`,
        line: lineOffset,
        severity: 'info',
        msg: `${hardcodedPxFonts.length} hardcoded px font-sizes in SFC <style> block — manual review (codemod does not edit SFC blocks).`,
        data: {sites: hardcodedPxFonts.slice(0, 6), sfc: true, lang: lang || 'css', scoped: !!attrs.scoped},
        autoFixable: false,
      });
    }
    if (mediaQueryCount >= 4 && containerQueryCount === 0) {
      pushIssue(issues, {
        kind: 'mq-bloat-no-cq',
        file: rel + ` (<style#${blockIdx}>)`,
        line: lineOffset,
        severity: 'warn',
        msg: `${mediaQueryCount} @media in SFC <style>, 0 @container. Manual CQ migration candidate.`,
        data: {mediaQueries: mediaQueryCount, sfc: true},
        autoFixable: false,
      });
    }
    if (!hasReducedMotion && /animation|transition.*\d/i.test(body)) {
      pushIssue(issues, {
        kind: 'no-reduced-motion-guard',
        file: rel + ` (<style#${blockIdx}>)`,
        line: lineOffset,
        severity: 'warn',
        msg: 'Animations in SFC <style> without prefers-reduced-motion override.',
        data: {sfc: true},
        autoFixable: false,
      });
    }
  }

  return {issues, stats};
}

/**
 * Detect Vanilla Extract files (`*.css.ts` / `*.css.js`) and flag for
 * manual responsive review. Vanilla Extract authoring is a runtime JS object
 * passed to `style({...})` — too brittle for regex codemod.
 */
export async function scanVanillaExtract(filePath, projectRoot) {
  const text = await readFile(filePath, 'utf8');
  const rel = relative(projectRoot, filePath);
  if (!/(@vanilla-extract\/css|from\s+['"]@vanilla-extract|style\s*\(|styleVariants\s*\(|globalStyle\s*\()/.test(text)) {
    return {issues: [], stats: {vanillaExtract: false}};
  }
  const issues = [];
  // Crude counters
  const fontSizeMatches = text.match(/fontSize\s*:\s*['"`]?\d+px['"`]?/g) || [];
  const mediaMatches = text.match(/'@media\s*\(/g) || [];
  const containerMatches = text.match(/'@container\s/g) || [];
  pushIssue(issues, {
    kind: 'vanilla-extract-manual-review',
    file: rel,
    line: 0,
    severity: 'info',
    msg: `Vanilla Extract file — manual responsive review needed. Found ~${fontSizeMatches.length} hardcoded fontSize, ${mediaMatches.length} @media, ${containerMatches.length} @container.`,
    data: {
      hardcodedFonts: fontSizeMatches.length,
      mediaQueries: mediaMatches.length,
      containerQueries: containerMatches.length,
      vanillaExtract: true,
    },
    autoFixable: false,
  });
  return {issues, stats: {vanillaExtract: true, hardcodedFonts: fontSizeMatches.length, mediaQueries: mediaMatches.length}};
}
