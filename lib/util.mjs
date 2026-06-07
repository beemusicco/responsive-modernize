import {readFile, writeFile, mkdir, stat, rename, unlink} from 'fs/promises';
import {existsSync} from 'fs';
import {dirname, join} from 'path';
import {randomBytes} from 'crypto';

export const SEVERITY = {error: 3, warn: 2, info: 1};

export function log(msg, prefix = 'rm') {
  process.stdout.write(`[${prefix}] ${msg}\n`);
}
export function err(msg, prefix = 'rm') {
  process.stderr.write(`[${prefix}] ERROR: ${msg}\n`);
}

export async function readJSON(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
export async function writeJSON(path, data) {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, JSON.stringify(data, null, 2));
}

export async function discoverBrief(startDir = process.cwd(), HOME = process.env.HOME) {
  let cur = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(cur, '.responsive-modernize.json');
    if (existsSync(candidate)) return candidate;
    if (cur === '/' || cur === HOME) break;
    cur = dirname(cur);
  }
  return null;
}

export function loadViewports(profileIds, viewportsTable) {
  const out = [];
  for (const id of profileIds) {
    const p = viewportsTable.profiles[id];
    if (!p) throw new Error(`Unknown viewport profile: ${id}. Available: ${Object.keys(viewportsTable.profiles).join(', ')}`);
    out.push(p);
  }
  return out;
}

export function resolveViewports(brief, viewportsTable, deep = false) {
  if (Array.isArray(brief.viewports) && brief.viewports.length > 0) {
    return loadViewports(brief.viewports, viewportsTable);
  }
  return loadViewports(deep ? viewportsTable.deep : viewportsTable.defaults, viewportsTable);
}

export function resolveEngines(brief, deep = false) {
  if (Array.isArray(brief.engines) && brief.engines.length > 0) return brief.engines;
  return deep ? ['chromium', 'webkit', 'firefox'] : ['chromium'];
}

export function defaults(brief) {
  return {
    target: brief.target || {},
    framework: brief.framework || 'static',
    thresholds: {
      horizontal_scroll: 'error',
      touch_target_min_px: 44,
      font_size_min_px: 14,
      contrast_ratio_min: 4.5,
      diff_px_pct_max: 0.5,
      ...(brief.thresholds || {}),
    },
    i18n: brief.i18n || null,
    out: brief.out || '.responsive-modernize',
  };
}

export function severityRank(s) {
  return SEVERITY[s] || 0;
}
export function sortBySeverity(issues) {
  return [...issues].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

export async function ensureDir(p) {
  await mkdir(p, {recursive: true});
}

export function urlJoin(base, route) {
  const b = base.replace(/\/$/, '');
  const r = route.startsWith('/') ? route : `/${route}`;
  return `${b}${r}`;
}

/**
 * Expand brief.target.routes × brief.i18n.test_locales using url_pattern.
 *
 * Example:
 *   brief.target.routes = ['/', '/pricing']
 *   brief.i18n = {test_locales: ['sl', 'en'], url_pattern: '/{locale}{route}'}
 *
 * Returns [{route: '/sl/', locale: 'sl', label: 'sl /'},
 *          {route: '/sl/pricing', locale: 'sl', label: 'sl /pricing'},
 *          {route: '/en/', locale: 'en', label: 'en /'},
 *          {route: '/en/pricing', locale: 'en', label: 'en /pricing'}]
 *
 * When i18n is absent or test_locales empty, returns routes 1:1 with locale=null.
 */
export function expandLocaleRoutes(routes, i18n) {
  if (!i18n || !Array.isArray(i18n.test_locales) || i18n.test_locales.length === 0) {
    return routes.map((r) => ({route: r, locale: null, label: r}));
  }
  const pattern = i18n.url_pattern || '/{locale}{route}';
  const out = [];
  for (const loc of i18n.test_locales) {
    for (const r of routes) {
      // Replace {locale} and {route} in pattern.
      // {route}: drop the leading slash to avoid // collision.
      const routeBody = r === '/' ? '' : r;
      const expanded = pattern.replace(/\{locale\}/g, loc).replace(/\{route\}/g, routeBody);
      const normalized = expanded.replace(/\/{2,}/g, '/');
      out.push({route: normalized || '/', locale: loc, label: `${loc} ${r}`});
    }
  }
  return out;
}

export function safeFilename(s) {
  return s.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_|_$/g, '') || 'root';
}

export async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomic file write: write to .rm-tmp-<rand> sibling, fsync, rename over target.
 * Prevents partial-write corruption if process is killed mid-write or hot-reload
 * picks up a half-written file. Safe to call from concurrent handlers (different rands).
 */
export async function safeWrite(filePath, content) {
  const tmp = `${filePath}.rm-tmp-${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(tmp, content);
    await rename(tmp, filePath);
  } catch (e) {
    // Clean up tmp on failure
    try { await unlink(tmp); } catch {}
    throw e;
  }
}

/**
 * HTTP health probe for target.url before Playwright launch.
 * 5s timeout; returns {ok, status?, error?}. Treats 2xx/3xx as healthy,
 * 4xx as healthy-but-warn (page exists, may be auth-gated), 5xx as fail.
 */
export async function probeHealth(url, timeoutMs = 5000) {
  if (!url) return {ok: false, error: 'no url'};
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {method: 'GET', signal: ctrl.signal, redirect: 'follow'});
    clearTimeout(t);
    return {
      ok: res.status < 500,
      status: res.status,
      warn: res.status >= 400 && res.status < 500 ? `4xx response` : null,
    };
  } catch (e) {
    clearTimeout(t);
    return {ok: false, error: e.name === 'AbortError' ? `timeout ${timeoutMs}ms` : e.message};
  }
}
