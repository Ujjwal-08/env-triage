/**
 * Find environment variable reads in source text. Pure: callers hand over
 * `{ file, text }` pairs, this module never touches the filesystem.
 */

const PATTERNS = [
    { re: /process\.env\.([A-Za-z_$][A-Za-z0-9_$]*)/g, group: 1 },
    { re: /process\.env\[\s*(['"`])([A-Za-z_$][A-Za-z0-9_$.]*)\1\s*\]/g, group: 2 },
    { re: /import\.meta\.env\.([A-Za-z_$][A-Za-z0-9_$]*)/g, group: 1 },
    { re: /import\.meta\.env\[\s*(['"`])([A-Za-z_$][A-Za-z0-9_$.]*)\1\s*\]/g, group: 2 },
    { re: /Deno\.env\.get\(\s*(['"`])([A-Za-z_$][A-Za-z0-9_$.]*)\1\s*\)/g, group: 2 },
    { re: /\bgetEnv\(\s*(['"`])([A-Za-z_$][A-Za-z0-9_$.]*)\1\s*\)/g, group: 2 },
];

function lineOf(text, index) {
    let line = 1;
    for (let i = 0; i < index; i += 1) {
        if (text.charCodeAt(i) === 10) {
            line += 1;
        }
    }
    return line;
}

/**
 * @param {Array<{file: string, text: string}>} files
 * @returns {Map<string, Array<{file: string, line: number}>>}
 */
export function scanSource(files) {
    const usages = new Map();
    for (const entry of files ?? []) {
        if (!entry || typeof entry.text !== "string") {
            continue;
        }
        const { file, text } = entry;
        for (const { re, group } of PATTERNS) {
            re.lastIndex = 0;
            let match = re.exec(text);
            while (match !== null) {
                const key = match[group];
                const line = lineOf(text, match.index);
                const list = usages.get(key) ?? [];
                const duplicate = list.some((hit) => hit.file === file && hit.line === line);
                if (!duplicate) {
                    list.push({ file, line });
                }
                usages.set(key, list);
                match = re.exec(text);
            }
        }
    }
    for (const list of usages.values()) {
        list.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
    }
    return usages;
}
