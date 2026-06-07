export function log(msg: any, prefix?: string): void;
export function err(msg: any, prefix?: string): void;
export function readJSON(path: any): Promise<any>;
export function writeJSON(path: any, data: any): Promise<void>;
export function discoverBrief(startDir?: any, HOME?: any): Promise<any>;
export function loadViewports(profileIds: any, viewportsTable: any): any[];
export function resolveViewports(brief: any, viewportsTable: any, deep?: boolean): any[];
export function resolveEngines(brief: any, deep?: boolean): any;
export function defaults(brief: any): {
    target: any;
    framework: any;
    thresholds: any;
    i18n: any;
    out: any;
};
export function severityRank(s: any): any;
export function sortBySeverity(issues: any): any[];
export function ensureDir(p: any): Promise<void>;
export function urlJoin(base: any, route: any): string;
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
export function expandLocaleRoutes(routes: any, i18n: any): any;
export function safeFilename(s: any): any;
export function fileExists(p: any): Promise<boolean>;
/**
 * Atomic file write: write to .rm-tmp-<rand> sibling, fsync, rename over target.
 * Prevents partial-write corruption if process is killed mid-write or hot-reload
 * picks up a half-written file. Safe to call from concurrent handlers (different rands).
 */
export function safeWrite(filePath: any, content: any): Promise<void>;
/**
 * HTTP health probe for target.url before Playwright launch.
 * 5s timeout; returns {ok, status?, error?}. Treats 2xx/3xx as healthy,
 * 4xx as healthy-but-warn (page exists, may be auth-gated), 5xx as fail.
 */
export function probeHealth(url: any, timeoutMs?: number): Promise<{
    ok: boolean;
    status: number;
    warn: string | null;
    error?: undefined;
} | {
    ok: boolean;
    error: any;
    status?: undefined;
    warn?: undefined;
}>;
export namespace SEVERITY {
    let error: number;
    let warn: number;
    let info: number;
}
