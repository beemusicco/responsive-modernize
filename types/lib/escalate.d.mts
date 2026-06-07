export function runEscalate({ brief, briefDir, outDir, verifyResult, postDiagnose }: {
    brief: any;
    briefDir: any;
    outDir: any;
    verifyResult: any;
    postDiagnose: any;
}): Promise<{
    phase: string;
    skipped: boolean;
    reason: string;
    briefPath?: undefined;
    totalResidual?: undefined;
    topKinds?: undefined;
    projectName?: undefined;
} | {
    phase: string;
    skipped: boolean;
    briefPath: any;
    totalResidual: any;
    topKinds: {
        kind: any;
        count: any;
        severity: any;
    }[];
    projectName: any;
    reason?: undefined;
}>;
/**
 * Fix 6: production auto-spawn via claude CLI subprocess.
 *
 * When called with --auto-impeccable, run.mjs spawns `claude --print` as a
 * non-interactive subprocess with the ESCALATION-BRIEF.md as prompt. The
 * subprocess agent uses the operator's OAuth ($0 marginal) and has full
 * file-edit + Bash tool capability with --dangerously-skip-permissions
 * (the operator explicitly opted in via the flag).
 *
 * Caveats:
 *   - requires `claude` CLI on PATH + OAuth session
 *   - --dangerously-skip-permissions means agent edits without per-action prompts
 *   - typical run: 2-5 min wall-clock
 */
export function runAutoImpeccable({ briefPath, briefDir }: {
    briefPath: any;
    briefDir: any;
}): Promise<any>;
