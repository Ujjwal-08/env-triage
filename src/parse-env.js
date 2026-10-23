/**
 * A small dotenv-compatible parser that keeps line numbers and reports the
 * oddities most loaders swallow silently.
 *
 * Pure: no filesystem, no process, no logging.
 */

const EXPORT_PREFIX = /^export[ \t]+/;
const KEY_OK = /^[A-Za-z_][A-Za-z0-9_.]*$/;

// A continuation line of a multi-line value almost never looks like a fresh
// assignment, but a 64-char base64 line of a PEM key can end in `=`. Requiring
// a short line and a short key keeps PEM bodies out of this heuristic.
const ASSIGNMENT_LOOKALIKE = /^[ \t]*(?:export[ \t]+)?[A-Za-z_][A-Za-z0-9_.]{0,47}[ \t]*=/;

function problem(id, line, message, key) {
    return { id, severity: "warning", line, message, key: key ?? null };
}

function looksLikeAssignment(line) {
    return line.length < 60 && ASSIGNMENT_LOOKALIKE.test(line);
}

/**
 * Scan a quoted value starting at `window[0]`, whose first character is the
 * opening quote. Returns the raw (still escaped) inner text.
 */
function readQuoted(window, quoteChar) {
    let raw = "";
    for (let idx = 0; idx < window.length; idx += 1) {
        const line = window[idx];
        if (idx > 0 && looksLikeAssignment(line)) {
            return { raw, endIdx: 0, endCol: -1, closed: false };
        }
        let col = idx === 0 ? 1 : 0;
        while (col < line.length) {
            const ch = line[col];
            if (quoteChar === "\"" && ch === "\\" && col + 1 < line.length) {
                raw += ch + line[col + 1];
                col += 2;
                continue;
            }
            if (ch === quoteChar) {
                return { raw, endIdx: idx, endCol: col, closed: true };
            }
            raw += ch;
            col += 1;
        }
        if (idx < window.length - 1) {
            raw += "\n";
        }
    }
    return { raw, endIdx: 0, endCol: -1, closed: false };
}

function unescapeDouble(raw) {
    return raw.replace(/\\(.)/g, (match, ch) => {
        switch (ch) {
            case "n": return "\n";
            case "r": return "\r";
            case "t": return "\t";
            case "b": return "\b";
            case "f": return "\f";
            case "\\": return "\\";
            case "\"": return "\"";
            case "'": return "'";
            default: return "\\" + ch;
        }
    });
}

function stripInlineComment(value) {
    if (value.startsWith("#")) {
        return "";
    }
    const match = /[ \t]#/.exec(value);
    return match ? value.slice(0, match.index) : value;
}

/**
 * @param {string} text raw contents of a .env style file
 * @returns {{ entries: Array<{key: string, value: string, line: number, quoted: boolean}>, problems: Array<object> }}
 */
export function parseEnv(text) {
    const entries = [];
    const problems = [];
    if (typeof text !== "string" || text === "") {
        return { entries, problems };
    }

    let src = text;
    if (src.charCodeAt(0) === 0xfeff) {
        src = src.slice(1);
    }
    const lines = src
        .split("\n")
        .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));

    const firstSeen = new Map();
    let i = 0;

    while (i < lines.length) {
        const lineNo = i + 1;
        const raw = lines[i];
        i += 1;

        const trimmed = raw.trim();
        if (trimmed === "" || trimmed.startsWith("#")) {
            continue;
        }

        let body = raw.replace(/^[ \t]+/, "");
        if (EXPORT_PREFIX.test(body)) {
            problems.push(problem(
                "parse",
                lineNo,
                "uses an `export ` prefix, which several dotenv loaders keep as part of the key",
            ));
            body = body.replace(EXPORT_PREFIX, "");
        }

        const eq = body.indexOf("=");
        if (eq === -1) {
            problems.push(problem("parse", lineNo, "malformed line: no `=` found"));
            continue;
        }

        const rawKey = body.slice(0, eq);
        const rawValue = body.slice(eq + 1);
        const key = rawKey.trim();

        if (key === "") {
            problems.push(problem("parse", lineNo, "malformed line: empty key before `=`"));
            continue;
        }
        if (rawKey !== key || /^[ \t]/.test(rawValue)) {
            problems.push(problem(
                "parse",
                lineNo,
                "spaces around `=`; some loaders keep them inside the key or the value",
                key,
            ));
        }
        if (!KEY_OK.test(key)) {
            problems.push(problem(
                "parse",
                lineNo,
                "key contains characters that most dotenv loaders reject",
                key,
            ));
        }

        const valueStart = rawValue.replace(/^[ \t]+/, "");
        const quoteChar = valueStart[0];
        let value = "";
        let quoted = false;
        let endLine = lineNo;

        if (quoteChar === "\"" || quoteChar === "'") {
            const window = [valueStart].concat(lines.slice(i));
            const scan = readQuoted(window, quoteChar);
            if (scan.closed) {
                quoted = true;
                endLine = lineNo + scan.endIdx;
                i += scan.endIdx;

                const after = window[scan.endIdx].slice(scan.endCol + 1).trim();
                if (after !== "" && !after.startsWith("#")) {
                    problems.push(problem("parse", lineNo, "unexpected text after the closing quote", key));
                }
                if (scan.raw.includes("\r")) {
                    problems.push(problem("whitespace", endLine, "value contains a hidden carriage return (CR)", key));
                }
                if (quoteChar === "'" && scan.raw.includes("\\n")) {
                    problems.push(problem(
                        "whitespace",
                        endLine,
                        "single-quoted value contains a literal `\\n`; it will not become a newline",
                        key,
                    ));
                }
                value = quoteChar === "\"" ? unescapeDouble(scan.raw) : scan.raw;
                value = value.replace(/\r(?!\n)/g, "");
            } else {
                problems.push(problem(
                    "parse",
                    lineNo,
                    "unbalanced quote; the rest of the line is being read as the value",
                    key,
                ));
                value = valueStart.slice(1);
            }
        } else {
            const stripped = stripInlineComment(valueStart);
            if (/[ \t]$/.test(stripped) && stripped.trim() !== "") {
                problems.push(problem("whitespace", lineNo, "value has trailing whitespace", key));
            }
            if (stripped.includes("\r")) {
                problems.push(problem("whitespace", lineNo, "value contains a hidden carriage return (CR)", key));
            }
            value = stripped.replace(/\r/g, "").trim();
        }

        if (firstSeen.has(key)) {
            problems.push({
                id: "duplicate-key",
                severity: "warning",
                line: lineNo,
                key,
                message: `defined more than once (first at line ${firstSeen.get(key)}, again at line ${lineNo}); the last one wins`,
            });
        } else {
            firstSeen.set(key, lineNo);
        }

        entries.push({ key, value, line: lineNo, quoted, endLine });
    }

    return { entries, problems };
}

/**
 * Collapse parsed entries into a Map where the last definition wins, the same
 * way dotenv loaders behave.
 *
 * @param {Array<{key: string}>} entries
 * @returns {Map<string, object>}
 */
export function entriesToMap(entries) {
    const map = new Map();
    for (const entry of entries ?? []) {
        map.set(entry.key, entry);
    }
    return map;
}
