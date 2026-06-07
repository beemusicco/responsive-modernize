/**
 * Parse JSX source + walk every JSXElement, calling visitor with ElementContext.
 * Visitor may return {newAttrs: string} to replace the attrs span verbatim,
 * or {fullReplacement: string} to replace the whole element.
 *
 * Returns: {out: string, edits: number} — transformed source + count of changes.
 *
 * Failure mode: if parse fails (TS-specific syntax, decorators, etc.), returns
 * {out: src, edits: 0, parseError: e.message}. Caller can decide to skip the
 * file or fall back to regex pass.
 *
 * @param {string} src - Raw source code (JSX/TSX)
 * @param {(ctx: ElementContext) => ({newAttrs?: string, fullReplacement?: string} | null | undefined)} visitor
 * @returns {{out: string, edits: number, parseError?: string}}
 */
export function walkJSX(src: string, visitor: (ctx: ElementContext) => ({
    newAttrs?: string;
    fullReplacement?: string;
} | null | undefined)): {
    out: string;
    edits: number;
    parseError?: string;
};
/**
 * JSX AST walker — production-grade replacement for regex-based JSX traversal.
 *
 * Uses acorn + acorn-jsx to parse source files into AST, then visits each
 * JSXElement node with its full ancestor chain. This lets codemods check
 * actual semantic context (e.g. "am I inside a <nav>?") instead of guessing
 * from className tokens, which fails on utility-only Tailwind.
 */
export type ElementContext = {
    /**
     * - Lowercase tag name ('nav', 'div', etc.) or PascalCase component name
     */
    tagName: string;
    attrs: Array<{
        name: string;
        valueStart: number;
        valueEnd: number;
        valueRaw: string;
        kind: "string" | "expression" | "boolean";
    }>;
    /**
     * - Tag names from immediate parent up to root, [] if root
     */
    ancestorTags: Array<string>;
    /**
     * - Byte offset of element start in source
     */
    start: number;
    /**
     * - Byte offset of element end in source
     */
    end: number;
    /**
     * - Byte offset after opening tag close `>`
     */
    openingEnd: number;
    selfClosing: boolean;
    /**
     * - Number of immediate JSXElement children
     */
    childElementCount: number;
    /**
     * - Tag names of immediate JSXElement children
     */
    childTagNames: Array<string>;
};
