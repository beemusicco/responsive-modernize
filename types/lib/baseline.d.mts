export function runBaseline({ brief, briefDir, outDir, viewports, engines, deep, dryRun }: {
    brief: any;
    briefDir: any;
    outDir: any;
    viewports: any;
    engines: any;
    deep: any;
    dryRun: any;
}): Promise<{
    phase: string;
    generatedAt: string;
    baseUrl: any;
    engines: any;
    viewports: any;
    routes: any;
    shots: number;
    failed: number;
    results: {
        engine: any;
        route: any;
        viewport: any;
        colorScheme: any;
        ok: boolean;
        file: any;
        error: any;
    }[];
} | {
    phase: string;
    skipped: boolean;
    reason: string;
    health?: undefined;
} | {
    phase: string;
    skipped: boolean;
    reason: string;
    health: {
        ok: boolean;
        status: number;
        warn: string | null;
        error?: undefined;
    } | {
        ok: boolean;
        error: any;
        status?: undefined;
        warn?: undefined;
    };
}>;
