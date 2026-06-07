export function parseColor(s: any): {
    r: number;
    g: number;
    b: number;
    a: number;
    format: string;
} | null;
export function contrastRatio(c1: any, c2: any): number;
/**
 * Adjust foreground color to meet target contrast against background.
 * Strategy: move toward black or white (whichever wins more contrast) in small steps.
 * Returns adjusted color or null if no solution within 20 iterations.
 */
export function adjustForContrast(fg: any, bg: any, target?: number): any;
export function colorToString(c: any): string;
