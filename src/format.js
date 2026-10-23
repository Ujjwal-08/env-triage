/**
 * Turns a diagnosis into text. Pure: same input, same string.
 */

import { createColors } from "./colors.js";

const GROUPS = [
    { severity: "error", heading: "errors", symbol: "✗", color: "red" },
    { severity: "warning", heading: "warnings", symbol: "⚠", color: "yellow" },
    { severity: "info", heading: "info", symbol: "ℹ", color: "cyan" },
];

function plural(count, word) {
    return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function summaryLine(summary) {
    return [
        plural(summary.errors, "error"),
        plural(summary.warnings, "warning"),
        `${summary.info} info`,
    ].join(", ");
}

function hintFor(findings) {
    const ids = new Set(findings.map((item) => item.id));
    if (ids.has("missing")) {
        return "fix: copy the missing keys with `npx dotenv-doctor --print-missing >> .env`";
    }
    if (ids.has("gitignore")) {
        return "fix: add `.env` to .gitignore before the next commit";
    }
    if (ids.has("suspicious-value")) {
        return "fix: rotate the flagged keys and move the real values out of the repo";
    }
    if (ids.has("used-undefined")) {
        return "fix: declare the keys the code reads in .env.example, then fill them in .env";
    }
    if (ids.has("empty")) {
        return "fix: give the empty keys a real value";
    }
    if (ids.size > 0) {
        return "fix: work through the warnings above, or re-run with --ci to make them fail the build";
    }
    return null;
}

/**
 * @param {{findings: Array<object>, summary: object}} result
 * @param {{color?: boolean}} [options]
 * @returns {string}
 */
export function formatReport(result, options = {}) {
    const findings = result?.findings ?? [];
    const summary = result?.summary ?? { errors: 0, warnings: 0, info: 0, total: findings.length };
    const c = createColors(Boolean(options.color));
    const out = [];

    if (findings.length === 0) {
        out.push(`  ${c.green("✓")} no problems found`);
        out.push("");
        out.push(c.green(summaryLine(summary)));
        return out.join("\n");
    }

    for (const group of GROUPS) {
        const items = findings.filter((item) => item.severity === group.severity);
        if (items.length === 0) {
            continue;
        }
        const width = items.reduce((max, item) => Math.max(max, (item.key ?? "").length), 0);
        out.push(c.bold(group.heading));
        for (const item of items) {
            const symbol = c[group.color](group.symbol);
            const key = item.key ? `${c.bold(item.key)}${" ".repeat(width - item.key.length)}  ` : "";
            out.push(`  ${symbol} ${key}${item.message}`);
        }
        out.push("");
    }

    const tone = summary.errors > 0 ? c.red : summary.warnings > 0 ? c.yellow : c.cyan;
    out.push(tone(summaryLine(summary)));
    const hint = hintFor(findings);
    if (hint) {
        out.push(c.dim(hint));
    }
    return out.join("\n");
}
