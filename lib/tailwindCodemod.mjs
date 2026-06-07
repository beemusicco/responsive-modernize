/**
 * Tailwind-aware className codemods. Two safest patterns:
 *
 * 1. tailwind-touch-target — find <a|button|Link className="..."> with
 *    h-N where N<11 (or w-N<11). Drop those, add min-h-11 / min-w-11.
 *
 * 2. tailwind-safe-area — find any className with `fixed ... bottom-0`
 *    (or `sticky ... bottom-0`) lacking `pb-[env(safe-area-inset-bottom)]`.
 *    Append `pb-[env(safe-area-inset-bottom)]`.
 *
 * Approach: regex over className string content. Robust enough for
 * 90% of Tailwind-only sites (no JSX expression splat etc).
 */
import {readFile} from 'fs/promises';
import {globby} from 'globby';
import {join} from 'path';

// Multi-form className matchers. Each captures the inner class-string content
// so we can pass it through the sanitize functions and re-stitch.
//
// Form A — string literal:    className="..."   or   className='...'
// Form B — JSX expression w/ template: className={`...`}
// Form C — cn()/clsx()/twMerge() string args: className={cn("...", "...")} — we
//          modify only string-literal arguments, leaving variables untouched.

// JSX tag with className= (any of the above forms) — handles multiline attrs
// by allowing whitespace/newlines in `mid` and `rest`.
// SAFE className attr finder — uses balanced-brace walker to handle
// className={cn("a", {b: "c"})} and template literals correctly.
// Returns iterator of {start, end, value, attrStart, attrEnd} for each className attribute.
export function* iterateClassNameAttrs(src) {
  const attrRe = /\bclassName\s*=\s*/g;
  let m;
  while ((m = attrRe.exec(src)) !== null) {
    const valueStart = m.index + m[0].length;
    const ch = src[valueStart];
    if (ch === '{') {
      const end = findBalancedBrace(src, valueStart);
      if (end < 0) continue;
      yield {start: m.index, end, value: src.slice(valueStart, end), kind: 'expr', valueStart, valueEnd: end};
    } else if (ch === '"' || ch === "'") {
      let i = valueStart + 1;
      while (i < src.length && src[i] !== ch) { if (src[i] === '\\') i++; i++; }
      if (i >= src.length) continue;
      yield {start: m.index, end: i + 1, value: src.slice(valueStart, i + 1), kind: 'string', valueStart, valueEnd: i + 1};
    }
  }
}

const TAG_OPEN_RE = /<(a|button|Link)\b([\s\S]*?)>/g;

// Inside an attribute-content block, identify the className value.
const CLASSNAME_ATTR_RE = /className\s*=\s*(\{[\s\S]*?\}|"[^"]*"|'[^']*')/g;

// Extract any string-literal segments from a className value (handles cn()/clsx() args + template literals).
function eachStringLiteralIn(value, mutate) {
  let edited = false;
  // Template literals `...`
  let next = value.replace(/`([^`]*)`/g, (full, body) => {
    const out = mutate(body);
    if (out !== body) { edited = true; return '`' + out + '`'; }
    return full;
  });
  // Single/double quoted strings (most common — also for raw className="...")
  next = next.replace(/(["'])((?:\\.|(?!\1)[\s\S])*?)\1/g, (full, q, body) => {
    const out = mutate(body);
    if (out !== body) { edited = true; return q + out + q; }
    return full;
  });
  return {value: next, edited};
}

// Tailwind size scale: hN = N * 0.25rem = N * 4px (e.g. h-7 = 28px, h-11 = 44px).
const SMALL_H_RE = /(^|\s)h-(\d+)(?=$|\s)/g;
const SMALL_W_RE = /(^|\s)w-(\d+)(?=$|\s)/g;

function sanitizeTouchClasses(classes, opts = {}) {
  // SAFE-MIN scope: drop explicit small h-N / w-N only.
  // Blanket "add min-h-11" was too aggressive — would break inline links
  // in prose where height is intentional. LLM agent escalation handles those.
  const tokens = classes.split(/\s+/).filter(Boolean);
  const out = [];
  let touched = false;
  let hasMinH = false, hasMinW = false;
  for (const t of tokens) {
    if (/^min-h-/.test(t)) hasMinH = true;
    if (/^min-w-/.test(t)) hasMinW = true;
  }
  for (const t of tokens) {
    const hm = /^h-(\d+)$/.exec(t);
    if (hm && parseInt(hm[1], 10) < 11) { touched = true; continue; }
    const wm = /^w-(\d+)$/.exec(t);
    if (wm && parseInt(wm[1], 10) < 11) { touched = true; continue; }
    out.push(t);
  }
  if (touched) {
    if (!hasMinH) out.push('min-h-11');
    if (!hasMinW) out.push('min-w-11');
  }
  return {classes: out.join(' '), touched};
}

// Find matching closing tag at correct nesting depth.
// Returns end-index (inclusive) of `</tagName>` or -1 if not found / nested unbalanced.
// Safer than lazy regex `<tag>([\s\S]*?)</tag>` which truncates on first close (nested or string literal).
export function findClosingTag(src, openEnd, tagName) {
  const openRe = new RegExp(`<${tagName}\\b[^>]*?>`, 'g');
  const closeRe = new RegExp(`<\\/${tagName}\\s*>`, 'g');
  let depth = 1;
  let i = openEnd;
  while (i < src.length && depth > 0) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const nextOpen = openRe.exec(src);
    const nextClose = closeRe.exec(src);
    if (!nextClose) return -1;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      i = nextOpen.index + nextOpen[0].length;
    } else {
      depth--;
      if (depth === 0) return nextClose.index + nextClose[0].length;
      i = nextClose.index + nextClose[0].length;
    }
  }
  return -1;
}

// Find balanced closing brace for JSX expression starting at openIdx (position of `{`).
// Tracks brace depth + skips strings + template literals. Returns position AFTER closing `}`.
export function findBalancedBrace(src, openIdx) {
  if (src[openIdx] !== '{') return -1;
  let depth = 1, i = openIdx + 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') { depth--; i++; if (depth === 0) return i; continue; }
    if (ch === '"' || ch === "'") {
      const quote = ch; i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '`') {
      i++;
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i+1] === '{') {
          const end = findBalancedBrace(src, i + 1);
          if (end < 0) return -1;
          i = end; continue;
        }
        i++;
      }
      i++;
      continue;
    }
    i++;
  }
  return depth === 0 ? i : -1;
}

// Convert `grid-cols-N` (N≥2) without responsive prefix to `grid-cols-1 md:grid-cols-N`.
// Same for `flex-row` → `flex-col md:flex-row`. Skip when responsive variant already present
// or when context indicates intentionally horizontal layout (nav, menu, carousel, marquee).
function stackLayoutClasses(classes) {
  // Skip nav/menu/carousel/marquee/tabs — intentionally horizontal even on mobile
  if (/\b(menu|nav-|nav$|navbar|carousel|swiper|marquee|ticker|tabs?|breadcrumb|toolbar)\b/i.test(classes)) {
    return {classes, touched: false};
  }
  const tokens = classes.split(/\s+/).filter(Boolean);
  const hasRespGrid = tokens.some((t) => /^(sm|md|lg|xl|2xl):grid-cols-/.test(t));
  const hasRespFlexCol = tokens.some((t) => /^(sm|md|lg|xl|2xl):flex-(col|row)/.test(t));
  let touched = false;
  const out = [];
  for (const t of tokens) {
    const gm = /^grid-cols-([2-9]|1[0-2])$/.exec(t);
    const fm = /^flex-row$/.exec(t);
    if (gm && !hasRespGrid) {
      out.push('grid-cols-1', `md:grid-cols-${gm[1]}`);
      touched = true;
      continue;
    }
    if (fm && !hasRespFlexCol) {
      out.push('flex-col', 'md:flex-row');
      touched = true;
      continue;
    }
    out.push(t);
  }
  return {classes: out.join(' '), touched};
}

// Form layout stack: when grid container has form inputs/labels as children,
// `grid-cols-N` (N≥2) without responsive variant → stack on mobile.
// We treat this as a sub-case of layout-stack, but with FORM-aware context (caller passes opt).
function stackFormGridClasses(classes, opts = {}) {
  if (!opts.formContext) return {classes, touched: false};
  // delegate to stackLayoutClasses but without the menu/nav guard (forms don't usually have those names)
  return stackLayoutClasses(classes);
}

// Sidebar/aside drawer: when class contains `sidebar` or `aside` indicator,
// inject `hidden lg:block` so content stacks below on mobile.
function makeSidebarMobileDrawer(classes) {
  if (/\b(hidden|md:hidden|lg:hidden)\b/.test(classes)) return {classes, touched: false};
  // v1.13.1 FIX: require sidebar to be a CLASS TOKEN (exact split-by-space), not substring.
  // `text-sidebar-icon` would otherwise be false-positive treated as sidebar.
  const tokens = classes.split(/\s+/).filter(Boolean);
  if (!tokens.some((t) => /^(sidebar|aside-?nav|side-?nav)$/i.test(t))) return {classes, touched: false};
  // skip if already has responsive show/hide
  if (tokens.some((t) => /^(sm|md|lg|xl|2xl):(block|flex|grid)/.test(t))) return {classes, touched: false};
  tokens.unshift('hidden', 'lg:block');
  return {classes: tokens.join(' '), touched: true};
}

function appendSafeAreaIfNeeded(classes) {
  // Match `fixed ... bottom-N` or `sticky ... bottom-N` (any N >= 0 incl. fractional + arbitrary).
  // Skip when env(safe-area-inset already present.
  if (/pb-\[env\(safe-area-inset|safe-area-inset-bottom/.test(classes)) return {classes, touched: false};
  const BOTTOM_ANY = /\bbottom-(0|[1-9]\d*|\d+\.\d+|\[.+?\]|auto|full|0\.5|1\.5|2\.5|3\.5)\b/;
  const isFixedBottom = /\bfixed\b/.test(classes) && BOTTOM_ANY.test(classes);
  const isStickyBottom = /\bsticky\b/.test(classes) && BOTTOM_ANY.test(classes);
  if (!isFixedBottom && !isStickyBottom) return {classes, touched: false};
  return {classes: `${classes} pb-[env(safe-area-inset-bottom)]`.trim(), touched: true};
}

import {safeWrite} from './util.mjs';

// Walk file → find each opening <a|button|Link …>, locate its className=… attribute,
// and rewrite every string-literal occurrence inside (handles literal, template,
// cn()/clsx() forms, and multiline attr).
function rewriteTagClassNames(src, mutateClasses) {
  // v1.13.2 FIX: rewriteTagClassNames was still using lazy CLASSNAME_ATTR_RE that broke on
  // nested braces. Now delegates to safe iterateClassNameAttrs but with tag filter.
  // Strategy: find <a|button|Link …> open tag spans via balanced parsing, then run
  // iterateClassNameAttrs ONLY within those spans.
  let totalEdits = 0;
  const matches = [];
  const TAG_OPEN_NAME = /<(a|button|Link)\b/g;
  let mTag;
  while ((mTag = TAG_OPEN_NAME.exec(src)) !== null) {
    // Find end of opening tag — must scan past attribute values that may contain >
    let i = mTag.index + mTag[0].length;
    while (i < src.length && src[i] !== '>') {
      const ch = src[i];
      // Skip string attribute values
      if (ch === '"' || ch === "'") {
        const q = ch; i++;
        while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
        i++;
        continue;
      }
      // Skip JSX expression attribute values
      if (ch === '{') {
        const end = findBalancedBrace(src, i);
        if (end < 0) { i = src.length; break; }
        i = end;
        continue;
      }
      i++;
    }
    if (i >= src.length) continue;
    const tagOpenEnd = i + 1; // position after `>`
    matches.push({attrStart: mTag.index + mTag[0].length, attrEnd: tagOpenEnd - 1, tagOpenEnd});
  }
  if (matches.length === 0) return {out: src, totalEdits: 0};
  // For each tag, collect className attrs within range + rewrite
  let out = src;
  const tagFixups = [];
  for (const m of matches) {
    const tagAttrsSrc = src.slice(m.attrStart, m.attrEnd);
    const skipLinkLike = /sr-only|aria-hidden|"skip|'skip|skip[-_]/i.test(tagAttrsSrc);
    const localMatches = [...iterateClassNameAttrs(tagAttrsSrc)];
    if (localMatches.length === 0) continue;
    let newAttrs = tagAttrsSrc;
    for (let i = localMatches.length - 1; i >= 0; i--) {
      const cm = localMatches[i];
      const {value: newValue, edited} = eachStringLiteralIn(cm.value, (str) => {
        const {classes: nc, touched} = mutateClasses(str, {skipLinkLike});
        if (touched) totalEdits++;
        return touched ? nc : str;
      });
      if (edited) newAttrs = newAttrs.slice(0, cm.valueStart) + newValue + newAttrs.slice(cm.valueEnd);
    }
    if (newAttrs !== tagAttrsSrc) tagFixups.push({attrStart: m.attrStart, attrEnd: m.attrEnd, newAttrs});
  }
  for (let i = tagFixups.length - 1; i >= 0; i--) {
    const f = tagFixups[i];
    out = out.slice(0, f.attrStart) + f.newAttrs + out.slice(f.attrEnd);
  }
  return {out, totalEdits};
}

// Walk file → any className= attr (any tag), rewrite string-literal classes inside.
// v1.13.1: SAFE balanced-brace iterator replaces lazy regex that truncated nested {…} expressions.
function rewriteAnyClassNames(src, mutateClasses) {
  let totalEdits = 0;
  // Collect from iterator first; replacement must happen back-to-front to preserve indices.
  const matches = [...iterateClassNameAttrs(src)];
  if (matches.length === 0) return {out: src, totalEdits: 0};
  let out = src;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const {value: newValue, edited} = eachStringLiteralIn(m.value, (str) => {
      const {classes: nc, touched} = mutateClasses(str);
      if (touched) totalEdits++;
      return touched ? nc : str;
    });
    if (edited) out = out.slice(0, m.valueStart) + newValue + out.slice(m.valueEnd);
  }
  return {out, totalEdits};
}

export async function tailwindTouchTargetCodemod({briefDir}) {
  const files = await globby(['src/**/*.{tsx,jsx}', '!node_modules/**', '!.next/**'], {cwd: briefDir, gitignore: true});
  let touchedFiles = 0, totalEdits = 0;
  const edits = [];
  for (const rel of files) {
    const full = join(briefDir, rel);
    const src = await readFile(full, 'utf8');
    const {out, totalEdits: fileEdits} = rewriteTagClassNames(src, sanitizeTouchClasses);
    if (fileEdits > 0) {
      await safeWrite(full, out);
      touchedFiles++;
      totalEdits += fileEdits;
      edits.push({file: rel, edits: fileEdits});
    }
  }
  return {touchedFiles, totalEdits, edits};
}

export async function tailwindLayoutStackCodemod({briefDir}) {
  const files = await globby(['src/**/*.{tsx,jsx}', '!node_modules/**', '!.next/**'], {cwd: briefDir, gitignore: true});
  let touchedFiles = 0, totalEdits = 0;
  const edits = [];
  for (const rel of files) {
    const full = join(briefDir, rel);
    const src = await readFile(full, 'utf8');
    const {out, totalEdits: fileEdits} = rewriteAnyClassNames(src, stackLayoutClasses);
    if (fileEdits > 0) {
      await safeWrite(full, out);
      touchedFiles++;
      totalEdits += fileEdits;
      edits.push({file: rel, edits: fileEdits});
    }
  }
  return {touchedFiles, totalEdits, edits};
}

export async function tailwindFormStackCodemod({briefDir}) {
  const files = await globby(['src/**/*.{tsx,jsx}', '!node_modules/**', '!.next/**'], {cwd: briefDir, gitignore: true});
  let touchedFiles = 0, totalEdits = 0;
  const edits = [];
  for (const rel of files) {
    const full = join(briefDir, rel);
    const src = await readFile(full, 'utf8');
    // Detect form context heuristically: file contains <form, <input, <label, <select, <textarea
    const isFormFile = /<\s*(form|input|select|textarea)\b/i.test(src);
    if (!isFormFile) continue;
    const {out, totalEdits: fileEdits} = rewriteAnyClassNames(src, (cls) => stackFormGridClasses(cls, {formContext: true}));
    if (fileEdits > 0) {
      await safeWrite(full, out);
      touchedFiles++;
      totalEdits += fileEdits;
      edits.push({file: rel, edits: fileEdits});
    }
  }
  return {touchedFiles, totalEdits, edits};
}

export async function tailwindSidebarDrawerCodemod({briefDir}) {
  const files = await globby(['src/**/*.{tsx,jsx}', '!node_modules/**', '!.next/**'], {cwd: briefDir, gitignore: true});
  let touchedFiles = 0, totalEdits = 0;
  const edits = [];
  for (const rel of files) {
    const full = join(briefDir, rel);
    const src = await readFile(full, 'utf8');
    const {out, totalEdits: fileEdits} = rewriteAnyClassNames(src, makeSidebarMobileDrawer);
    if (fileEdits > 0) {
      await safeWrite(full, out);
      touchedFiles++;
      totalEdits += fileEdits;
      edits.push({file: rel, edits: fileEdits});
    }
  }
  return {touchedFiles, totalEdits, edits};
}

/**
 * Nav hamburger codemod — pure CSS approach using checkbox peer state.
 * No React useState needed. Idempotent via `rm-nav-toggle` marker.
 *
 * Transform: <nav>...items...</nav>
 * Into:      <nav data-rm-hamburger>
 *              <input type="checkbox" id="rm-nav-toggle-N" className="peer hidden" />
 *              <label htmlFor="rm-nav-toggle-N" className="md:hidden cursor-pointer text-2xl" aria-label="Menu">☰</label>
 *              <div className="hidden peer-checked:flex flex-col md:flex md:flex-row">
 *                ...items...
 *              </div>
 *            </nav>
 *
 * Only triggers when <nav> has ≥5 immediate-child link-like elements (<a>, <Link>, <button>).
 */
export async function tailwindNavHamburgerCodemod({briefDir}) {
  const files = await globby(['src/**/*.{tsx,jsx}', '!node_modules/**', '!.next/**'], {cwd: briefDir, gitignore: true});
  let touchedFiles = 0, totalEdits = 0;
  const edits = [];
  // v1.13.1: SAFE balanced-tag walker replaces lazy /<nav>([\s\S]*?)<\/nav>/g
  // which truncated on nested <nav> or string-literal "</nav>".
  const NAV_OPEN_RE = /<nav\b([^>]*?)>/g;
  for (const rel of files) {
    const full = join(briefDir, rel);
    const src = await readFile(full, 'utf8');
    let fileEdits = 0;
    let toggleId = 0;
    // Collect transforms back-to-front to preserve indices
    const transforms = [];
    let mTag;
    while ((mTag = NAV_OPEN_RE.exec(src)) !== null) {
      const openStart = mTag.index;
      const openEnd = openStart + mTag[0].length;
      const attrs = mTag[1];
      const closeEnd = findClosingTag(src, openEnd, 'nav');
      if (closeEnd < 0) continue;
      const closeTagLen = '</nav>'.length;
      const children = src.slice(openEnd, closeEnd - closeTagLen);
      // Idempotency: skip if already transformed
      if (/data-rm-hamburger|rm-nav-toggle/.test(attrs) || /rm-nav-toggle/.test(children)) continue;
      // Count item-like children (rough but fine since balanced walker scopes correctly)
      const itemCount = (children.match(/<\s*(a|Link|button)\b/gi) || []).length;
      if (itemCount < 5) continue;
      // v1.13.2 FIX: id + newAttrs were accidentally dropped in v1.13.1 refactor → ReferenceError.
      const id = `rm-nav-toggle-${++toggleId}`;
      const newAttrs = attrs.includes('data-rm-hamburger') ? attrs : attrs + ' data-rm-hamburger';
      const head = `<input type="checkbox" id="${id}" className="peer hidden" aria-label="Toggle menu" /><label htmlFor="${id}" className="md:hidden cursor-pointer inline-flex items-center justify-center w-11 h-11 text-2xl" aria-label="Menu">☰</label>`;
      const wrapped = `<div className="hidden peer-checked:flex flex-col md:flex md:flex-row">${children}</div>`;
      const replacement = `<nav${newAttrs}>${head}${wrapped}</nav>`;
      transforms.push({start: openStart, end: closeEnd, replacement});
      fileEdits++;
    }
    if (fileEdits > 0) {
      // Apply back-to-front
      let out = src;
      for (let i = transforms.length - 1; i >= 0; i--) {
        const t = transforms[i];
        out = out.slice(0, t.start) + t.replacement + out.slice(t.end);
      }
      await safeWrite(full, out);
      touchedFiles++;
      totalEdits += fileEdits;
      edits.push({file: rel, edits: fileEdits});
    }
  }
  return {touchedFiles, totalEdits, edits};
}

export async function tailwindSafeAreaCodemod({briefDir}) {
  const files = await globby(['src/**/*.{tsx,jsx}', '!node_modules/**', '!.next/**'], {cwd: briefDir, gitignore: true});
  let touchedFiles = 0, totalEdits = 0;
  const edits = [];
  for (const rel of files) {
    const full = join(briefDir, rel);
    const src = await readFile(full, 'utf8');
    const {out, totalEdits: fileEdits} = rewriteAnyClassNames(src, appendSafeAreaIfNeeded);
    if (fileEdits > 0) {
      await safeWrite(full, out);
      touchedFiles++;
      totalEdits += fileEdits;
      edits.push({file: rel, edits: fileEdits});
    }
  }
  return {touchedFiles, totalEdits, edits};
}
