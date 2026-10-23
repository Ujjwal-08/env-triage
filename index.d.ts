export type Severity = "error" | "warning" | "info";

export type CheckId =
    | "missing"
    | "empty"
    | "undocumented"
    | "used-undefined"
    | "unused"
    | "duplicate-key"
    | "suspicious-value"
    | "gitignore"
    | "parse"
    | "whitespace"
    | "casing"
    | "sanity";

export interface EnvEntry {
    key: string;
    value: string;
    /** 1-based line of the assignment. */
    line: number;
    quoted: boolean;
    /** Last line of the value, differs from `line` for multi-line values. */
    endLine: number;
}

export interface ParseProblem {
    id: "parse" | "whitespace" | "duplicate-key";
    severity: Severity;
    line: number;
    key: string | null;
    message: string;
}

export interface ParseResult {
    entries: EnvEntry[];
    problems: ParseProblem[];
}

export interface Usage {
    file: string;
    line: number;
}

export interface Location {
    file: string;
    line: number;
}

export interface Finding {
    id: CheckId;
    severity: Severity;
    /** `null` for file-level findings such as `gitignore`. */
    key: string | null;
    /** Never contains a secret value. */
    message: string;
    lines: Location[];
}

export interface Summary {
    errors: number;
    warnings: number;
    info: number;
    total: number;
}

export interface DiagnoseResult {
    findings: Finding[];
    summary: Summary;
}

export interface ParsedSide {
    path?: string;
    exists?: boolean;
    entries?: EnvEntry[];
    problems?: ParseProblem[];
}

export interface DiagnoseInput {
    env?: ParsedSide;
    example?: ParsedSide;
    usages?: Map<string, Usage[]> | Record<string, Usage[]> | Array<[string, Usage[]]>;
    /** A boolean applies to both files; the object form sets them apart. */
    gitTracked?: boolean | { env: boolean; example: boolean };
    /** `true` ignored, `false` not ignored, `null` unknown (check skipped). */
    gitignore?: boolean | null;
}

export interface FormatOptions {
    color?: boolean;
}

export interface RunDoctorOptions {
    cwd?: string;
    env?: string;
    example?: string;
    scan?: string[];
}

export interface DoctorResult extends DiagnoseResult {
    cwd: string;
    env: { path: string; exists: boolean; keys: string[] };
    example: { path: string; exists: boolean; keys: string[] };
    scanDirs: string[];
    scanned: number;
    git: { inRepo: boolean; tracked: { env: boolean; example: boolean }; gitignore: boolean | null };
    missingKeys: string[];
}

export declare function parseEnv(text: string): ParseResult;
export declare function entriesToMap(entries: EnvEntry[]): Map<string, EnvEntry>;
export declare function scanSource(files: Array<{ file: string; text: string }>): Map<string, Usage[]>;
export declare function diagnose(input?: DiagnoseInput): DiagnoseResult;
export declare function formatReport(result: DiagnoseResult, options?: FormatOptions): string;
export declare function runDoctor(options?: RunDoctorOptions): Promise<DoctorResult>;
export declare function detectSecret(value: string): { pattern: string } | null;
export declare function shannonEntropy(value: string): number;
export declare function createColors(enabled: boolean): Record<
    "red" | "yellow" | "green" | "cyan" | "dim" | "bold",
    (text: string) => string
>;
export declare function supportsColor(
    stream?: { isTTY?: boolean },
    env?: Record<string, string | undefined>,
): boolean;
export declare const AMBIENT_KEYS: Set<string>;
