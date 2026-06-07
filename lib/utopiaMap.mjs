// Map px values to nearest Utopia scale token.
// Type scale: perfect-fourth (1.25), base 16-19, 320→1920.
// Space scale: T-shirt sized 4-144, 320→1920.
//
// Each step has a (minPx, maxPx) range — we pick a step whose range contains
// the target px, preferring lowest-error match if multiple overlap.

const TYPE_STEPS = [
  // [token, minPx, maxPx, midPx]
  ['--step--2', 10.24, 12.16, 11.20],
  ['--step--1', 12.80, 15.20, 14.00],
  ['--step-0',  16.00, 19.00, 17.50],
  ['--step-1',  20.00, 23.75, 21.88],
  ['--step-2',  25.00, 29.69, 27.35],
  ['--step-3',  31.25, 37.11, 34.18],
  ['--step-4',  39.06, 46.39, 42.73],
  ['--step-5',  48.83, 57.99, 53.41],
];

const SPACE_STEPS = [
  // [token, minPx, maxPx, midPx] — ranges are inclusive-min, exclusive-max
  // to avoid border-case ambiguity (e.g. 8px → 2xs, not 3xs).
  ['--space-3xs', 4, 7.99, 6],
  ['--space-2xs', 8, 11.99, 10],
  ['--space-xs', 12, 15.99, 14],
  ['--space-s', 16, 23.99, 20],
  ['--space-m', 24, 31.99, 28],
  ['--space-l', 32, 47.99, 40],
  ['--space-xl', 48, 63.99, 56],
  ['--space-2xl', 64, 95.99, 80],
  ['--space-3xl', 96, 144, 120],
];

function nearestStep(table, px) {
  if (!Number.isFinite(px) || px <= 0) return null;
  // Find step whose midPx is closest to px, weighted by whether px is in range.
  let best = null;
  let bestScore = Infinity;
  for (const [token, min, max, mid] of table) {
    const inRange = px >= min && px <= max;
    const error = Math.abs(px - mid);
    const score = inRange ? error : error + 100; // strong penalty for out-of-range
    if (score < bestScore) {
      bestScore = score;
      best = {token, min, max, mid, error, inRange};
    }
  }
  // Reject if even the best is wildly out of range (>50% off mid)
  if (best && !best.inRange && best.error > best.mid * 0.5) return null;
  return best;
}

export function typeToken(px) {
  return nearestStep(TYPE_STEPS, px);
}
export function spaceToken(px) {
  return nearestStep(SPACE_STEPS, px);
}

export const APPLY_ORDER = {
  'inject-meta-viewport': 1,
  'fix-meta-viewport': 1,
  'inject-utopia-scale': 2,
  'inject-reduced-motion-guard': 3,
  'add-safe-area-inset': 4,
  'migrate-px-fonts-to-utopia': 5,
  'migrate-px-spacing-to-utopia': 6,
  'add-img-aspect-ratio': 7,
  'add-remote-img-aspect-ratio': 8,
  'fix-fixed-width-overflow': 9,
  'fix-element-overflow': 10,
  'enforce-touch-target-min': 11,
  'tailwind-touch-target': 12,
  'tailwind-safe-area': 13,
  'truncate-text-overflow': 14,
  'tailwind-layout-stack': 15,
  'tailwind-form-stack': 16,
  'tailwind-sidebar-drawer': 17,
  'add-srcset': 18,
  'table-to-cards': 19,
  'add-pwa-manifest': 20,
  'add-apple-touch-icon': 21,
  'fix-low-color-contrast': 22,
  'add-focus-visible-rules': 23,
};
