export function runVerify({ brief, briefDir, outDir, viewports, engines, dryRun }: {
    brief: any;
    briefDir: any;
    outDir: any;
    viewports: any;
    engines: any;
    dryRun: any;
}): Promise<{
    phase: string;
    generatedAt: string;
    threshold: any;
    shots: number;
    regressions: number;
    results: ({
        engine: any;
        route: any;
        viewport: any;
        ok: boolean;
        error: any;
        noBaseline?: undefined;
        diff?: undefined;
        beforePath?: undefined;
        afterPath?: undefined;
        diffPath?: undefined;
        diffError?: undefined;
    } | {
        engine: any;
        route: any;
        viewport: any;
        ok: boolean;
        noBaseline: boolean;
        error?: undefined;
        diff?: undefined;
        beforePath?: undefined;
        afterPath?: undefined;
        diffPath?: undefined;
        diffError?: undefined;
    } | {
        engine: any;
        route: any;
        viewport: any;
        ok: boolean;
        diff: {
            pixelsDiff: number;
            totalPixels: number;
            pctDiff: number;
            W: number;
            H: number;
            beforeW: any;
            afterW: any;
        };
        beforePath: any;
        afterPath: any;
        diffPath: any;
        error?: undefined;
        noBaseline?: undefined;
        diffError?: undefined;
    } | {
        engine: any;
        route: any;
        viewport: any;
        ok: boolean;
        diffError: any;
        error?: undefined;
        noBaseline?: undefined;
        diff?: undefined;
        beforePath?: undefined;
        afterPath?: undefined;
        diffPath?: undefined;
    })[];
    postDiagnose: {
        issueCount: any;
    } | null;
} | {
    phase: string;
    skipped: boolean;
    reason: string;
}>;
