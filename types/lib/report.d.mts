export function runReport({ brief, briefDir, outDir }: {
    brief: any;
    briefDir: any;
    outDir: any;
}): Promise<{
    phase: string;
    generatedAt: string;
    spriteBaseline: {
        outPath: any;
        tiles: number;
        columns: number;
        tileWidth: number;
        tileHeight: number;
    } | null;
    spriteVerify: {
        outPath: any;
        tiles: number;
        columns: number;
        tileWidth: number;
        tileHeight: number;
    } | null;
    files: {
        report: string;
        html: string;
    };
}>;
