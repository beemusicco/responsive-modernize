export function runPerfGate({ brief, briefDir, outDir, viewports }: {
    brief: any;
    briefDir: any;
    outDir: any;
    viewports: any;
}): Promise<{
    phase: string;
    viewport: any;
    thresholds: {
        LCP_MAX: any;
        INP_MAX: any;
        CLS_MAX: any;
    };
    results: ({
        route: any;
        cwv: any;
        fail: string[];
        error?: undefined;
    } | {
        route: any;
        error: any;
        fail: string[];
        cwv?: undefined;
    })[];
    failures: ({
        route: any;
        fail: string[];
        cwv: any;
        error?: undefined;
    } | {
        route: any;
        fail: string[];
        error: any;
        cwv?: undefined;
    })[];
} | {
    phase: string;
    skipped: boolean;
    reason: string;
}>;
