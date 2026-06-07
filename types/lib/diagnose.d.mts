export function runDiagnose({ brief, briefDir, outDir, viewports, engines, dryRun }: {
    brief: any;
    briefDir: any;
    outDir: any;
    viewports: any;
    engines: any;
    dryRun: any;
}): Promise<{
    phase: string;
    generatedAt: string;
    combinations: number;
    failed: number;
    issueCount: number;
    issues: any[];
    perCombo: any[];
} | {
    phase: string;
    skipped: boolean;
    reason: string;
}>;
