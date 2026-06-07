export function runScan({ brief, briefDir, outDir }: {
    brief: any;
    briefDir: any;
    outDir: any;
}): Promise<{
    phase: string;
    generatedAt: string;
    brief: any;
    stats: {
        filesScanned: number;
        mediaQueryTotal: number;
        containerQueryTotal: number;
        skippedTailwind: number;
        skippedParseError: number;
        cssInJsBlocksTotal: number;
        cssInJsFilesWithBlocks: number;
        sfcStyleBlocksTotal: number;
        sfcFilesWithBlocks: number;
        vanillaExtractFiles: number;
    };
    issues: any[];
}>;
