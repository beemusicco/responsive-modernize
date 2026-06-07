export function runPropose({ brief, briefDir, outDir }: {
    brief: any;
    briefDir: any;
    outDir: any;
}): Promise<{
    phase: string;
    generatedAt: string;
    counts: {
        error: number;
        warn: number;
        info: number;
        autoFixable: number;
        manualOnly: number;
    };
    bucketSummary: {
        kind: string;
        count: any;
        severity: any;
        autoFixable: any;
    }[];
    issues: any[];
    codemodKit: {
        utopiaTypeScale: string;
        utopiaSpaceScale: string;
        reducedMotionGuard: string;
        metaViewportLine: string;
        safeAreaInsetExample: string;
    };
}>;
