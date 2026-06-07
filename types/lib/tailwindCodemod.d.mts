export function iterateClassNameAttrs(src: any): Generator<{
    start: number;
    end: any;
    value: any;
    kind: string;
    valueStart: number;
    valueEnd: any;
}, void, unknown>;
export function findClosingTag(src: any, openEnd: any, tagName: any): number;
export function findBalancedBrace(src: any, openIdx: any): any;
export function tailwindTouchTargetCodemod({ briefDir }: {
    briefDir: any;
}): Promise<{
    touchedFiles: number;
    totalEdits: number;
    edits: {
        file: string;
        edits: number;
    }[];
}>;
export function tailwindLayoutStackCodemod({ briefDir }: {
    briefDir: any;
}): Promise<{
    touchedFiles: number;
    totalEdits: number;
    edits: {
        file: string;
        edits: number;
    }[];
    parseErrors: {
        file: string;
        error: string;
    }[];
}>;
export function tailwindFormStackCodemod({ briefDir }: {
    briefDir: any;
}): Promise<{
    touchedFiles: number;
    totalEdits: number;
    edits: {
        file: string;
        edits: number;
    }[];
}>;
export function tailwindSidebarDrawerCodemod({ briefDir }: {
    briefDir: any;
}): Promise<{
    touchedFiles: number;
    totalEdits: number;
    edits: {
        file: string;
        edits: number;
    }[];
}>;
/**
 * Nav hamburger codemod — pure CSS approach using checkbox peer state.
 * No React useState needed. Idempotent via `rm-nav-toggle` marker.
 *
 * Transform: <nav>...items...</nav>
 * Into:      <nav data-rm-hamburger>
 *              <input type="checkbox" id="rm-nav-toggle-N" className="peer hidden" />
 *              <label htmlFor="rm-nav-toggle-N" className="md:hidden cursor-pointer text-2xl" aria-label="Menu">☰</label>
 *              <div className="hidden peer-checked:flex flex-col md:flex md:flex-row">
 *                ...items...
 *              </div>
 *            </nav>
 *
 * Only triggers when <nav> has ≥5 immediate-child link-like elements (<a>, <Link>, <button>).
 */
export function tailwindNavHamburgerCodemod({ briefDir }: {
    briefDir: any;
}): Promise<{
    touchedFiles: number;
    totalEdits: number;
    edits: {
        file: string;
        edits: number;
    }[];
}>;
export function tailwindSafeAreaCodemod({ briefDir }: {
    briefDir: any;
}): Promise<{
    touchedFiles: number;
    totalEdits: number;
    edits: {
        file: string;
        edits: number;
    }[];
}>;
