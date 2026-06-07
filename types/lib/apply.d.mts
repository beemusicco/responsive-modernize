export function runApply({ brief, briefDir, outDir, yes, dryRun, aggressive }: {
    brief: any;
    briefDir: any;
    outDir: any;
    yes: any;
    dryRun: any;
    aggressive: any;
}): Promise<{
    phase: string;
    generatedAt: string;
    applied: {
        issue: any;
        fix: any;
        file: any;
        backupPath: any;
        bytesBefore: any;
        bytesAfter: any;
        changed: any;
        added: any;
        skipped: any;
        target: any;
    }[];
    skipped: {
        issue: any;
        reason: any;
    }[];
    backupRoot: any;
    counts: {
        applied: number;
        skipped: number;
    };
} | {
    phase: string;
    skipped: boolean;
    reason: string;
}>;
