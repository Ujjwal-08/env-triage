/**
 * The pure diagnosis engine. Give it parsed files plus a few facts about git
 * and it returns findings. No filesystem, no process, no randomness, no clock.
 */

import { entriesToMap } from "./parse-env.js";
import { detectSecret } from "./secrets.js";

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };

/** Variables the runtime or the shell provides; never flagged as undefined. */
export const AMBIENT_KEYS = new Set([
    "NODE_ENV", "CI", "DEBUG", "NO_COLOR", "FORCE_COLOR", "TERM", "LANG", "TZ",
    "HOME", "PATH", "PWD", "SHELL", "TMPDIR", "TEMP", "TMP", "USER", "USERPROFILE",
    "npm_lifecycle_event", "npm_package_version", "npm_config_user_agent",
]);

const PLACEHOLDERS = new Set([
    "changeme", "change-me", "change_me", "xxx", "todo", "tbd", "replaceme",
    "replace-me", "replace_me", "placeholder", "your-key-here", "your_key_here",
    "yourkeyhere", "your-api-key", "your_api_key", "secret", "...", "<your value>",
]);

const BOOLEAN_VALUES = new Set(["true", "false", "1", "0", "yes", "no", "on", "off"]);

const UPPER_SNAKE = /^[A-Z][A-Z0-9_]*$/;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

function isPlaceholder(value) {
    const v = value.trim().toLowerCase();
    if (v === "") {
        return false;
    }
    if (PLACEHOLDERS.has(v)) {
        return true;
    }
    if (/^<.*>$/.test(v)) {
        return true;
    }
    if (/^x{3,}$/.test(v)) {
        return true;
    }
    if (/^your[-_ ].*(key|token|secret|password|url|here|id)$/.test(v)) {
        return true;
    }
    return false;
}

function isUrlKey(key) {
    return key === "URL" || /_URL$/.test(key) || /_URI$/.test(key);
}

function isPortKey(key) {
    return key === "PORT" || /_PORT$/.test(key);
}

function isBooleanKey(key) {
    return /^ENABLE_/.test(key) || /_ENABLED$/.test(key);
}

function looksLikeUrl(value) {
    if (!URL_SCHEME.test(value)) {
        return false;
    }
    try {
        // eslint-disable-next-line no-new
        new URL(value);
        return true;
    } catch {
        return false;
    }
}

function normalizeFile(file, fallback) {
    return typeof file === "string" && file !== "" ? file : fallback;
}

function normalizeSide(side, fallbackPath) {
    const value = side ?? {};
    return {
        path: normalizeFile(value.path, fallbackPath),
        exists: value.exists !== false,
        entries: value.entries ?? [],
        problems: value.problems ?? [],
    };
}

function normalizeUsages(usages) {
    if (usages instanceof Map) {
        return usages;
    }
    if (Array.isArray(usages)) {
        return new Map(usages);
    }
    if (usages && typeof usages === "object") {
        return new Map(Object.entries(usages));
    }
    return new Map();
}

function normalizeTracked(gitTracked) {
    if (gitTracked && typeof gitTracked === "object") {
        return { env: Boolean(gitTracked.env), example: Boolean(gitTracked.example) };
    }
    const flag = Boolean(gitTracked);
    return { env: flag, example: flag };
}

function finding(id, severity, key, message, lines) {
    return { id, severity, key: key ?? null, message, lines: lines ?? [] };
}

function at(file, line) {
    return { file, line };
}

/**
 * @param {object} input
 * @param {object} input.env parsed `.env` as `{ path, exists, entries, problems }`
 * @param {object} input.example parsed example file, same shape
 * @param {Map<string, Array<{file: string, line: number}>>} input.usages
 * @param {boolean | {env: boolean, example: boolean}} input.gitTracked
 * @param {boolean | null} input.gitignore true when the env file is ignored
 * @returns {{ findings: Array<object>, summary: {errors: number, warnings: number, info: number, total: number} }}
 */
export function diagnose(input = {}) {
    const env = normalizeSide(input.env, ".env");
    const example = normalizeSide(input.example, ".env.example");
    const usages = normalizeUsages(input.usages);
    const tracked = normalizeTracked(input.gitTracked);
    const gitignore = input.gitignore === undefined ? null : input.gitignore;

    const envMap = entriesToMap(env.entries);
    const exampleMap = entriesToMap(example.entries);
    const findings = [];

    // 1. missing - declared in the example, absent from .env
    if (example.exists) {
        for (const [key, entry] of exampleMap) {
            if (!envMap.has(key)) {
                findings.push(finding(
                    "missing",
                    "error",
                    key,
                    `missing from ${env.path} (declared in ${example.path}:${entry.line})`,
                    [at(example.path, entry.line)],
                ));
            }
        }
    }

    // 2. empty - present but blank or still a placeholder
    for (const [key, entry] of envMap) {
        if (entry.value.trim() === "") {
            findings.push(finding(
                "empty",
                "error",
                key,
                `is defined but empty (${env.path}:${entry.line})`,
                [at(env.path, entry.line)],
            ));
        } else if (isPlaceholder(entry.value)) {
            findings.push(finding(
                "empty",
                "error",
                key,
                `is still a placeholder value (${env.path}:${entry.line})`,
                [at(env.path, entry.line)],
            ));
        }
    }

    // 3. undocumented - in .env but missing from the example
    if (example.exists) {
        for (const [key, entry] of envMap) {
            if (!exampleMap.has(key)) {
                findings.push(finding(
                    "undocumented",
                    "warning",
                    key,
                    `set in ${env.path}:${entry.line} but not documented in ${example.path}`,
                    [at(env.path, entry.line)],
                ));
            }
        }
    }

    // 4. used-undefined - the code reads it, nobody defines it
    for (const [key, hits] of usages) {
        if (envMap.has(key) || exampleMap.has(key) || AMBIENT_KEYS.has(key)) {
            continue;
        }
        const first = hits[0];
        const extra = hits.length > 1 ? ` (+${hits.length - 1} more)` : "";
        findings.push(finding(
            "used-undefined",
            "error",
            key,
            `used in ${first.file}:${first.line}${extra} but not defined in ${env.path} or ${example.path}`,
            hits.map((hit) => at(hit.file, hit.line)),
        ));
    }

    // 5. unused - defined but never referenced in the scanned code
    if (usages.size > 0) {
        for (const [key, entry] of envMap) {
            if (usages.has(key) || AMBIENT_KEYS.has(key)) {
                continue;
            }
            findings.push(finding(
                "unused",
                "info",
                key,
                `defined in ${env.path}:${entry.line} but never referenced in the scanned code; it may be used elsewhere`,
                [at(env.path, entry.line)],
            ));
        }
    }

    // 6, 9, 10. duplicate-key / parse / whitespace, straight from the parser
    for (const [side, problems] of [[env, env.problems], [example, example.problems]]) {
        for (const item of problems) {
            findings.push(finding(
                item.id,
                item.severity ?? "warning",
                item.key ?? null,
                `${item.message} (${side.path}:${item.line})`,
                [at(side.path, item.line)],
            ));
        }
    }

    // 7. suspicious-value - a real looking secret sitting in a file
    for (const [side, map, isTracked] of [
        [env, envMap, tracked.env],
        [example, exampleMap, tracked.example],
    ]) {
        if (!side.exists) {
            continue;
        }
        for (const [key, entry] of map) {
            const hit = detectSecret(entry.value);
            if (!hit) {
                continue;
            }
            const where = isTracked ? "a git-tracked file" : "an untracked file";
            findings.push(finding(
                "suspicious-value",
                isTracked ? "error" : "warning",
                key,
                `looks like a real secret in ${where} (${side.path}:${entry.line}, matched: ${hit.pattern}); the value is not shown`,
                [at(side.path, entry.line)],
            ));
        }
    }

    // 8. gitignore
    if (tracked.env) {
        findings.push(finding(
            "gitignore",
            "error",
            null,
            `${env.path} is tracked by git; untrack it with \`git rm --cached ${env.path}\``,
            [at(env.path, 0)],
        ));
    } else if (gitignore === false) {
        findings.push(finding(
            "gitignore",
            "error",
            null,
            `${env.path} is not matched by .gitignore; one commit away from leaking`,
            [at(env.path, 0)],
        ));
    }

    // 11. casing
    const seenCasing = new Set();
    for (const [side, map] of [[env, envMap], [example, exampleMap]]) {
        if (!side.exists) {
            continue;
        }
        for (const [key, entry] of map) {
            if (UPPER_SNAKE.test(key) || seenCasing.has(key)) {
                continue;
            }
            seenCasing.add(key);
            findings.push(finding(
                "casing",
                "info",
                key,
                `is not UPPER_SNAKE_CASE (${side.path}:${entry.line})`,
                [at(side.path, entry.line)],
            ));
        }
    }

    // 12. url / number / boolean sanity, only on the real values in .env
    for (const [key, entry] of envMap) {
        const value = entry.value.trim();
        if (value === "" || isPlaceholder(value)) {
            continue;
        }
        if (isUrlKey(key) && !looksLikeUrl(value)) {
            findings.push(finding(
                "sanity",
                "warning",
                key,
                `is named like a URL but the value has no scheme (${env.path}:${entry.line})`,
                [at(env.path, entry.line)],
            ));
        }
        if (isPortKey(key)) {
            const port = Number(value);
            if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
                findings.push(finding(
                    "sanity",
                    "warning",
                    key,
                    `is named like a port but the value is not a number from 1 to 65535 (${env.path}:${entry.line})`,
                    [at(env.path, entry.line)],
                ));
            }
        }
        if (isBooleanKey(key) && !BOOLEAN_VALUES.has(value.toLowerCase())) {
            findings.push(finding(
                "sanity",
                "warning",
                key,
                `is named like a flag but the value is not boolean-ish (${env.path}:${entry.line})`,
                [at(env.path, entry.line)],
            ));
        }
    }

    findings.sort((a, b) => {
        const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
        if (bySeverity !== 0) {
            return bySeverity;
        }
        if (a.id !== b.id) {
            return a.id < b.id ? -1 : 1;
        }
        const aKey = a.key ?? "";
        const bKey = b.key ?? "";
        if (aKey !== bKey) {
            return aKey < bKey ? -1 : 1;
        }
        const aLine = a.lines[0]?.line ?? 0;
        const bLine = b.lines[0]?.line ?? 0;
        return aLine - bLine;
    });

    const summary = { errors: 0, warnings: 0, info: 0, total: findings.length };
    for (const item of findings) {
        if (item.severity === "error") {
            summary.errors += 1;
        } else if (item.severity === "warning") {
            summary.warnings += 1;
        } else {
            summary.info += 1;
        }
    }

    return { findings, summary };
}
