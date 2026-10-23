import assert from "node:assert/strict";
import test from "node:test";

import { parseEnv } from "../src/parse-env.js";
import { scanSource } from "../src/scan-source.js";
import { diagnose } from "../src/diagnose.js";
import { formatReport } from "../src/format.js";

function side(path, text) {
    const parsed = parseEnv(text);
    return { path, exists: true, entries: parsed.entries, problems: parsed.problems };
}

function check(input) {
    return diagnose({ gitignore: true, gitTracked: false, ...input });
}

const idsOf = (result) => result.findings.map((f) => f.id);
const pick = (result, id) => result.findings.filter((f) => f.id === id);

test("1. missing: an example key absent from .env", () => {
    const hit = check({ env: side(".env", "A=1\n"), example: side(".env.example", "A=\nB=\n") });
    const found = pick(hit, "missing");
    assert.equal(found.length, 1);
    assert.equal(found[0].key, "B");
    assert.equal(found[0].severity, "error");
    assert.equal(found[0].message, "missing from .env (declared in .env.example:2)");
    assert.deepEqual(found[0].lines, [{ file: ".env.example", line: 2 }]);

    const clean = check({ env: side(".env", "A=1\nB=2\n"), example: side(".env.example", "A=\nB=\n") });
    assert.equal(pick(clean, "missing").length, 0);
});

test("2. empty: blank values and placeholders", () => {
    const hit = check({ env: side(".env", "A=\nB=changeme\nC=<your value>\nD=your-api-key\n"), example: { exists: false } });
    assert.equal(pick(hit, "empty").length, 4);
    assert.ok(pick(hit, "empty").every((f) => f.severity === "error"));

    const clean = check({ env: side(".env", "A=1\nB=hunter2\n"), example: { exists: false } });
    assert.equal(pick(clean, "empty").length, 0);
});

test("3. undocumented: a key in .env but not in the example", () => {
    const hit = check({ env: side(".env", "A=1\nB=2\n"), example: side(".env.example", "A=\n") });
    const found = pick(hit, "undocumented");
    assert.equal(found.length, 1);
    assert.equal(found[0].key, "B");
    assert.equal(found[0].severity, "warning");

    const clean = check({ env: side(".env", "A=1\n"), example: side(".env.example", "A=\n") });
    assert.equal(pick(clean, "undocumented").length, 0);
});

test("4. used-undefined: referenced in code, defined nowhere", () => {
    const usages = scanSource([{ file: "src/db.js", text: "const u = process.env.DB_URL;\nconst n = process.env.NODE_ENV;\n" }]);
    const hit = check({ env: side(".env", "A=1\n"), example: side(".env.example", "A=\n"), usages });
    const found = pick(hit, "used-undefined");
    assert.equal(found.length, 1, "NODE_ENV is ambient and must not be flagged");
    assert.equal(found[0].key, "DB_URL");
    assert.equal(found[0].severity, "error");
    assert.match(found[0].message, /src\/db\.js:1/);

    const clean = check({ env: side(".env", "DB_URL=x\n"), example: side(".env.example", "DB_URL=\n"), usages });
    assert.equal(pick(clean, "used-undefined").length, 0);
});

test("5. unused: defined but never referenced", () => {
    const usages = scanSource([{ file: "src/a.js", text: "process.env.USED\n" }]);
    const hit = check({ env: side(".env", "USED=1\nSPARE=2\n"), example: side(".env.example", "USED=\nSPARE=\n"), usages });
    const found = pick(hit, "unused");
    assert.equal(found.length, 1);
    assert.equal(found[0].key, "SPARE");
    assert.equal(found[0].severity, "info");
    assert.match(found[0].message, /may be used elsewhere/);

    assert.equal(pick(check({ env: side(".env", "USED=1\n"), example: { exists: false }, usages }), "unused").length, 0);
});

test("5b. unused is skipped when nothing was scanned", () => {
    const hit = check({ env: side(".env", "A=1\n"), example: { exists: false } });
    assert.equal(pick(hit, "unused").length, 0);
});

test("6. duplicate-key", () => {
    const hit = check({ env: side(".env", "A=1\nB=2\nA=3\n"), example: { exists: false } });
    const found = pick(hit, "duplicate-key");
    assert.equal(found.length, 1);
    assert.equal(found[0].severity, "warning");
    assert.match(found[0].message, /last one wins/);

    assert.equal(pick(check({ env: side(".env", "A=1\nB=2\n"), example: { exists: false } }), "duplicate-key").length, 0);
});

test("8. gitignore: untracked-but-unignored and tracked", () => {
    const env = side(".env", "A=1\n");
    const unignored = diagnose({ env, example: { exists: false }, gitTracked: false, gitignore: false });
    assert.equal(pick(unignored, "gitignore").length, 1);
    assert.match(pick(unignored, "gitignore")[0].message, /not matched by \.gitignore/);

    const tracked = diagnose({ env, example: { exists: false }, gitTracked: { env: true, example: false }, gitignore: true });
    assert.match(pick(tracked, "gitignore")[0].message, /tracked by git/);

    const fine = diagnose({ env, example: { exists: false }, gitTracked: false, gitignore: true });
    assert.equal(pick(fine, "gitignore").length, 0);

    const unknown = diagnose({ env, example: { exists: false }, gitTracked: false, gitignore: null });
    assert.equal(pick(unknown, "gitignore").length, 0);
});

test("9. parse problems surface as warnings with the file name", () => {
    const hit = check({ env: side(".env", "A=1\nNOT_AN_ASSIGNMENT\n"), example: { exists: false } });
    const found = pick(hit, "parse");
    assert.equal(found.length, 1);
    assert.equal(found[0].severity, "warning");
    assert.match(found[0].message, /\.env:2/);

    assert.equal(pick(check({ env: side(".env", "A=1\n"), example: { exists: false } }), "parse").length, 0);
});

test("10. whitespace", () => {
    const hit = check({ env: side(".env", "A=value   \n"), example: { exists: false } });
    assert.equal(pick(hit, "whitespace").length, 1);
    assert.equal(pick(hit, "whitespace")[0].severity, "warning");

    assert.equal(pick(check({ env: side(".env", "A=value\n"), example: { exists: false } }), "whitespace").length, 0);
});

test("11. casing", () => {
    const hit = check({ env: side(".env", "lowerKey=1\nUPPER_KEY=2\n"), example: { exists: false } });
    const found = pick(hit, "casing");
    assert.equal(found.length, 1);
    assert.equal(found[0].key, "lowerKey");
    assert.equal(found[0].severity, "info");

    assert.equal(pick(check({ env: side(".env", "UPPER_KEY=2\n"), example: { exists: false } }), "casing").length, 0);
});

test("12. url, port and boolean sanity", () => {
    const bad = check({
        env: side(".env", "API_URL=localhost:3000\nAPP_PORT=nope\nENABLE_CACHE=maybe\nFEATURE_X_ENABLED=2\n"),
        example: { exists: false },
    });
    const found = pick(bad, "sanity");
    assert.equal(found.length, 4);
    assert.ok(found.every((f) => f.severity === "warning"));
    assert.deepEqual(found.map((f) => f.key).sort(), ["API_URL", "APP_PORT", "ENABLE_CACHE", "FEATURE_X_ENABLED"]);

    const good = check({
        env: side(".env", "API_URL=https://api.example.com\nAPP_PORT=8080\nENABLE_CACHE=true\nFEATURE_X_ENABLED=0\n"),
        example: { exists: false },
    });
    assert.equal(pick(good, "sanity").length, 0);
});

test("summary counts match the findings", () => {
    const result = check({
        env: side(".env", "A=\nlower=1\n"),
        example: side(".env.example", "A=\nB=\n"),
    });
    assert.equal(result.summary.total, result.findings.length);
    assert.equal(result.summary.errors, result.findings.filter((f) => f.severity === "error").length);
    assert.equal(result.summary.warnings, result.findings.filter((f) => f.severity === "warning").length);
    assert.equal(result.summary.info, result.findings.filter((f) => f.severity === "info").length);
    assert.ok(result.summary.errors > 0);
});

test("findings are grouped error, then warning, then info", () => {
    const result = check({
        env: side(".env", "A=\nB=2\nlower=3\n"),
        example: side(".env.example", "A=\nC=\n"),
    });
    const ranks = result.findings.map((f) => ["error", "warning", "info"].indexOf(f.severity));
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
    assert.ok(idsOf(result).includes("missing"));
});

test("diagnose is pure and deterministic", () => {
    const input = () => ({
        env: side(".env", "A=\nB=2\nB=3\nlower=4\n"),
        example: side(".env.example", "A=\nC=\n"),
        usages: scanSource([{ file: "src/x.js", text: "process.env.C; process.env.ZZZ;" }]),
        gitTracked: false,
        gitignore: false,
    });
    const first = diagnose(input());
    const second = diagnose(input());
    assert.deepEqual(first, second);

    const shared = input();
    const before = shared.env.entries.length;
    diagnose(shared);
    diagnose(shared);
    assert.equal(shared.env.entries.length, before);
});

test("diagnose survives being called with nothing", () => {
    const result = diagnose();
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.summary, { errors: 0, warnings: 0, info: 0, total: 0 });
});

test("usages accept a plain object as well as a Map", () => {
    const result = check({
        env: side(".env", "A=1\n"),
        example: { exists: false },
        usages: { ZED: [{ file: "src/a.js", line: 9 }] },
    });
    assert.equal(pick(result, "used-undefined")[0].key, "ZED");
});

test("formatReport emits no ANSI when colour is off", () => {
    const result = check({ env: side(".env", "A=\n"), example: side(".env.example", "A=\nB=\n") });
    const plain = formatReport(result, { color: false });
    assert.ok(!/\u001B\[/.test(plain));
    assert.ok(/\u001B\[/.test(formatReport(result, { color: true })));
    assert.equal(formatReport(result), plain, "colour is off by default");
});

test("formatReport shows the spec line shape, a summary and a fix hint", () => {
    const result = check({ env: side(".env", "A=1\n"), example: side(".env.example", "A=\nDATABASE_URL=\n") });
    const report = formatReport(result, { color: false });
    assert.ok(report.includes("  ✗ DATABASE_URL  missing from .env (declared in .env.example:2)"));
    assert.ok(report.includes("errors"));
    assert.match(report, /1 error, 0 warnings, 0 info/);
    assert.match(report, /npx env-triage --print-missing >> \.env/);
});

test("formatReport pluralises and reports a clean bill of health", () => {
    const clean = formatReport({ findings: [], summary: { errors: 0, warnings: 0, info: 0, total: 0 } });
    assert.match(clean, /no problems found/);
    assert.match(clean, /0 errors, 0 warnings, 0 info/);

    const two = formatReport({
        findings: [
            { id: "parse", severity: "warning", key: null, message: "x", lines: [] },
            { id: "parse", severity: "warning", key: null, message: "y", lines: [] },
        ],
        summary: { errors: 0, warnings: 2, info: 0, total: 2 },
    });
    assert.match(two, /0 errors, 2 warnings, 0 info/);
});

test("scanSource finds every supported access pattern with line numbers", () => {
    const usages = scanSource([{
        file: "src/all.js",
        text: [
            "const a = process.env.ALPHA;",
            "const b = process.env[\"BETA\"];",
            "const c = import.meta.env.GAMMA;",
            "const d = Deno.env.get('DELTA');",
            "const e = getEnv(`EPSILON`);",
        ].join("\n"),
    }]);
    assert.deepEqual([...usages.keys()].sort(), ["ALPHA", "BETA", "DELTA", "EPSILON", "GAMMA"]);
    assert.deepEqual(usages.get("GAMMA"), [{ file: "src/all.js", line: 3 }]);
    assert.deepEqual(usages.get("EPSILON"), [{ file: "src/all.js", line: 5 }]);
    assert.equal(scanSource([]).size, 0);
    assert.equal(scanSource(undefined).size, 0);
});

test("scanSource collects repeat usages across files", () => {
    const usages = scanSource([
        { file: "src/a.js", text: "process.env.SHARED" },
        { file: "src/b.js", text: "\nprocess.env.SHARED" },
    ]);
    assert.deepEqual(usages.get("SHARED"), [
        { file: "src/a.js", line: 1 },
        { file: "src/b.js", line: 2 },
    ]);
});
