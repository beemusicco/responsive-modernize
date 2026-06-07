export function scanSFC(filePath: any, projectRoot: any): Promise<{
    issues: any[];
    stats: {
        styleBlocks: number;
        scopedBlocks: number;
        mediaQueryCount: number;
        containerQueryCount: number;
    };
}>;
/**
 * Detect Vanilla Extract files (`*.css.ts` / `*.css.js`) and flag for
 * manual responsive review. Vanilla Extract authoring is a runtime JS object
 * passed to `style({...})` — too brittle for regex codemod.
 */
export function scanVanillaExtract(filePath: any, projectRoot: any): Promise<{
    issues: never[];
    stats: {
        vanillaExtract: boolean;
        hardcodedFonts?: undefined;
        mediaQueries?: undefined;
    };
} | {
    issues: any[];
    stats: {
        vanillaExtract: boolean;
        hardcodedFonts: any;
        mediaQueries: any;
    };
}>;
