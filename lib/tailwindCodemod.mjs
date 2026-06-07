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
  if (!/\b(sidebar|aside-?nav|side-?nav)\b/i.test(classes)) return {classes, touched: false};
  // Add `hidden lg:block` so it disappears on mobile but reappears desktop+
  const tokens = classes.split(/\s+/).filter(Boolean);
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
  let totalEdits = 0;
  const out = src.replace(TAG_OPEN_RE, (full, tag, attrs) => {
    const newAttrs = attrs.replace(CLASSNAME_ATTR_RE, (attrM, value) => {
      const skipLinkLike = /sr-only|aria-hidden|"skip|'skip|skip[-_]/i.test(attrs);
      const {value: newValue, edited} = eachStringLiteralIn(value, (str) => {
        const {classes: nc, touched} = mutateClasses(str, {skipLinkLike});
        if (touched) totalEdits++;
        return touched ? nc : str;
      });
      return edited ? attrM.replace(value, newValue) : attrM;
    });
    return `<${tag}${newAttrs}>`;
  });
  return {out, totalEdits};
}

// Walk file → any className= attr (any tag), rewrite string-literal classes inside.
function rewriteAnyClassNames(src, mutateClasses) {
  let totalEdits = 0;
  const out = src.replace(CLASSNAME_ATTR_RE, (attrM, value) => {
    const {value: newValue, edited} = eachStringLiteralIn(value, (str) => {
      const {classes: nc, touched} = mutateClasses(str);
      if (touched) totalEdits++;
      return touched ? nc : str;
    });
    return edited ? attrM.replace(value, newValue) : attrM;
  });
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
