/**
 * Color contrast math — WCAG 1.4.3 AA (4.5:1) + AAA (7:1).
 *
 * Supports hex (#rgb, #rrggbb), rgb(), rgba(), hsl(), hsla().
 * Adjusts foreground color toward black or white (whichever increases ratio)
 * in small steps until threshold met. Returns null if no solution.
 */

const HEX_RE = /^#?([0-9a-f]{3,8})$/i;
const RGB_RE = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*,?\s*(\d+(?:\.\d+)?)\s*,?\s*(\d+(?:\.\d+)?)\s*(?:[,/]\s*(\d*\.?\d+))?\s*\)$/i;
const HSL_RE = /^hsla?\(\s*(\d+(?:\.\d+)?)\s*,?\s*(\d+(?:\.\d+)?)%\s*,?\s*(\d+(?:\.\d+)?)%\s*(?:[,/]\s*(\d*\.?\d+))?\s*\)$/i;

export function parseColor(s) {
  if (!s) return null;
  s = s.trim();
  let m = HEX_RE.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 4) h = h.split('').map((c) => c + c).join(''); // #rgba
    if (h.length === 6) return {r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1, format: 'hex'};
    if (h.length === 8) return {r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: parseInt(h.slice(6, 8), 16) / 255, format: 'hex'};
  }
  m = RGB_RE.exec(s);
  if (m) return {r: +m[1], g: +m[2], b: +m[3], a: m[4] != null ? +m[4] : 1, format: 'rgb'};
  m = HSL_RE.exec(s);
  if (m) {
    const [r, g, b] = hslToRgb(+m[1], +m[2] / 100, +m[3] / 100);
    return {r, g, b, a: m[4] != null ? +m[4] : 1, format: 'hsl'};
  }
  return null;
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const conv = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  return [Math.round(conv(h + 1/3) * 255), Math.round(conv(h) * 255), Math.round(conv(h - 1/3) * 255)];
}

function relLuminance({r, g, b}) {
  const a = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

export function contrastRatio(c1, c2) {
  const l1 = relLuminance(c1), l2 = relLuminance(c2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Adjust foreground color to meet target contrast against background.
 * Strategy: move toward black or white (whichever wins more contrast) in small steps.
 * Returns adjusted color or null if no solution within 20 iterations.
 */
export function adjustForContrast(fg, bg, target = 4.5) {
  // Translucent foregrounds cannot be auto-resolved to a contrast ratio: the rendered
  // contrast depends on whatever is painted behind them. Rewriting to opaque would destroy
  // the author's intended transparency, and keeping the alpha yields a FALSE guarantee
  // (relLuminance ignores alpha, so the composited render misses the target). Punt to
  // manual review — the caller skips on null.
  if (fg.a != null && fg.a < 1) return null;
  if (contrastRatio(fg, bg) >= target) return fg;
  const bgLum = relLuminance(bg);
  // Move toward whichever endpoint (white=255 / black=0) yields MORE contrast against bg.
  // Compares contrast(white,bg) vs contrast(black,bg) — threshold derived from the WCAG
  // formula itself (their crossover ≈0.179 lum), not a wrong 0.5 midpoint.
  const towardWhite = (1.05 / (bgLum + 0.05)) > ((bgLum + 0.05) / 0.05);
  const target_r = towardWhite ? 255 : 0;
  const target_g = towardWhite ? 255 : 0;
  const target_b = towardWhite ? 255 : 0;
  let r = fg.r, g = fg.g, b = fg.b;
  for (let i = 0; i < 20; i++) {
    r = Math.round(r + (target_r - r) * 0.15);
    g = Math.round(g + (target_g - g) * 0.15);
    b = Math.round(b + (target_b - b) * 0.15);
    const cur = {r, g, b, a: fg.a, format: fg.format};
    if (contrastRatio(cur, bg) >= target) return cur;
  }
  return null;
}

export function colorToString(c) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const [r, g, b] = [c.r, c.g, c.b].map(clamp);
  const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return c.a < 1 ? `rgba(${r}, ${g}, ${b}, ${c.a.toFixed(2)})` : hex;
}
