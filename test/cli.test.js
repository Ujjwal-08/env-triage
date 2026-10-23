import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runDoctor } from "../src/run.js";

const BIN = fileURLToPath(new URL("../bin/dotenv-doctor.js", import.meta.url));
const PKG = JSON.parse(
    await import("node:fs").then((fs) => fs.readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")),
);

async function makeProject(files) {
    const dir = await mkdtemp(path.join(tmpdir(), "dotenv-doctor-"));
    for (const [name, content] of Object.entries(files)) {
        const target = path.join(dir, name);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
    }
    return dir;
}

function cli(cwd, args = []) {
    return new Promise((resolve) => {
        execFile(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" }, (error, stdout, stderr) => {
            resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
        });
    });
}

const BROKEN = {
    ".gitignore": "node_modules/\n",
    ".env": [
        "DATABASE_URL=localhost:5432",
        "API_TOKEN=",
        "STRAY_KEY=hello   ",
        "lowercase_key=1",
        "PORT=not-a-port",
        "PORT=also-bad",
        "NO_EQUALS_HERE",
    ].join("\n") + "\n",
    ".env.example": "DATABASE_URL=\nAPI_TOKEN=\nSESSION_SECRET=\nPORT=\n",
    "src/app.js": "export const db = process.env.DATABASE_URL;\nexport const missing = process.env.NOT_DECLARED;\n",
};

const CLEAN = {
    ".gitignore": ".env\n",
    ".env": "API_URL=https://api.example.com\nPORT=3000\n",
    ".env.example": "API_URL=\nPORT=\n",
};

const WARN_ONLY = {
    ".gitignore": ".env\n",
    ".env": "API_URL=https://api.example.com   \nPORT=3000\n",
    ".env.example": "API_URL=\nPORT=\n",
};

test("runDoctor reports the broken project end to end", async (t) => {
    const dir = await makeProject(BROKEN);
    t.after(() => rm(dir, { recursive: true, force: true }));

    const result = await runDoctor({ cwd: dir });
    const ids = new Set(result.findings.map((f) => f.id));

    assert.equal(result.env.exists, true);
    assert.equal(result.example.path, ".env.example");
    assert.equal(result.scanned, 1);
    assert.deepEqual(result.scanDirs, ["src"]);

    assert.ok(ids.has("missing"), "SESSION_SECRET is missing");
    assert.ok(ids.has("empty"), "API_TOKEN is empty");
    assert.ok(ids.has("undocumented"), "STRAY_KEY is undocumented");
    assert.ok(ids.has("used-undefined"), "NOT_DECLARED is used but undefined");
    assert.ok(ids.has("unused"), "STRAY_KEY is never read");
    assert.ok(ids.has("duplicate-key"), "PORT is declared twice");
    assert.ok(ids.has("gitignore"), ".env is not ignored");
    assert.ok(ids.has("parse"), "NO_EQUALS_HERE is malformed");
    assert.ok(ids.has("whitespace"), "STRAY_KEY has trailing whitespace");
    assert.ok(ids.has("casing"), "lowercase_key is not UPPER_SNAKE_CASE");
    assert.ok(ids.has("sanity"), "DATABASE_URL has no scheme");

    assert.deepEqual(result.missingKeys, ["SESSION_SECRET"]);
    assert.ok(result.summary.errors > 0);
});

test("runDoctor falls back through the example file candidates", async (t) => {
    const dir = await makeProject({ ".env": "A=1\n", ".env.sample": "A=\nB=\n", ".gitignore": ".env\n" });
    t.after(() => rm(dir, { recursive: true, force: true }));

    const result = await runDoctor({ cwd: dir });
    assert.equal(result.example.path, ".env.sample");
    assert.deepEqual(result.missingKeys, ["B"]);
});

test("runDoctor honours an explicit env path and scan dir", async (t) => {
    const dir = await makeProject({
        ".env.production": "A=1\n",
        ".env.example": "A=\n",
        ".gitignore": ".env*\n",
        "custom/code.js": "process.env.ONLY_HERE",
    });
    t.after(() => rm(dir, { recursive: true, force: true }));

    const result = await runDoctor({ cwd: dir, env: ".env.production", scan: ["custom"] });
    assert.equal(result.env.path, ".env.production");
    assert.equal(result.scanned, 1);
    assert.ok(result.findings.some((f) => f.id === "used-undefined" && f.key === "ONLY_HERE"));
});

test("a missing .env makes every example key missing", async (t) => {
    const dir = await makeProject({ ".env.example": "A=\nB=\n", ".gitignore": ".env\n" });
    t.after(() => rm(dir, { recursive: true, force: true }));

    const result = await runDoctor({ cwd: dir });
    assert.equal(result.env.exists, false);
    assert.deepEqual(result.missingKeys, ["A", "B"]);
});

test("exit code 1 on errors, 0 when clean", async (t) => {
    const broken = await makeProject(BROKEN);
    const clean = await makeProject(CLEAN);
    t.after(() => Promise.all([
        rm(broken, { recursive: true, force: true }),
        rm(clean, { recursive: true, force: true }),
    ]));

    const bad = await cli(broken);
    assert.equal(bad.code, 1);
    assert.match(bad.stdout, /errors/);
    assert.match(bad.stdout, /SESSION_SECRET/);

    const good = await cli(clean);
    assert.equal(good.code, 0);
    assert.match(good.stdout, /no problems found/);
    assert.match(good.stdout, /0 errors, 0 warnings, 0 info/);
});

test("--ci turns warnings into a failure", async (t) => {
    const dir = await makeProject(WARN_ONLY);
    t.after(() => rm(dir, { recursive: true, force: true }));

    const normal = await cli(dir);
    assert.equal(normal.code, 0);
    assert.match(normal.stdout, /0 errors, 1 warning, 0 info/);

    const ci = await cli(dir, ["--ci"]);
    assert.equal(ci.code, 1);
});

test("--json produces the documented shape and no ANSI", async (t) => {
    const dir = await makeProject(BROKEN);
    t.after(() => rm(dir, { recursive: true, force: true }));

    const run = await cli(dir, ["--json"]);
    assert.equal(run.code, 1);
    assert.ok(!/\u001B\[/.test(run.stdout));

    const payload = JSON.parse(run.stdout);
    assert.equal(payload.version, PKG.version);
    assert.equal(payload.ok, false);
    assert.equal(payload.env.path, ".env");
    assert.equal(payload.example.path, ".env.example");
    assert.equal(typeof payload.scanned, "number");
    assert.ok(Array.isArray(payload.findings));
    assert.deepEqual(Object.keys(payload.summary).sort(), ["errors", "info", "total", "warnings"]);
    assert.deepEqual(Object.keys(payload.findings[0]).sort(), ["id", "key", "lines", "message", "severity"]);
    assert.deepEqual(payload.missingKeys, ["SESSION_SECRET"]);
});

test("--print-missing prints bare KEY= lines and exits 0", async (t) => {
    const dir = await makeProject(BROKEN);
    t.after(() => rm(dir, { recursive: true, force: true }));

    const run = await cli(dir, ["--print-missing"]);
    assert.equal(run.code, 0);
    assert.equal(run.stdout, "SESSION_SECRET=\n");
});

test("--no-color strips ANSI and plain output has none either", async (t) => {
    const dir = await makeProject(BROKEN);
    t.after(() => rm(dir, { recursive: true, force: true }));

    const run = await cli(dir, ["--no-color"]);
    assert.ok(!/\u001B\[/.test(run.stdout));
});

test("--help and --version exit 0", async (t) => {
    const dir = await makeProject(CLEAN);
    t.after(() => rm(dir, { recursive: true, force: true }));

    const help = await cli(dir, ["--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /Usage/);
    assert.match(help.stdout, /--print-missing/);

    const version = await cli(dir, ["-v"]);
    assert.equal(version.code, 0);
    assert.equal(version.stdout.trim(), PKG.version);
});

test("a bad flag exits 2", async (t) => {
    const dir = await makeProject(CLEAN);
    t.after(() => rm(dir, { recursive: true, force: true }));

    const run = await cli(dir, ["--nope"]);
    assert.equal(run.code, 2);
    assert.match(run.stderr, /unknown option/);

    const missingValue = await cli(dir, ["--env"]);
    assert.equal(missingValue.code, 2);
    assert.match(missingValue.stderr, /needs a value/);
});

test("the CLI never prints a secret value", async (t) => {
    const secret = "sk-proj-A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
    const dir = await makeProject({
        ".gitignore": "node_modules/\n",
        ".env": `OPENAI_API_KEY=${secret}\n`,
        ".env.example": "OPENAI_API_KEY=\n",
    });
    t.after(() => rm(dir, { recursive: true, force: true }));

    const text = await cli(dir);
    const json = await cli(dir, ["--json"]);
    assert.ok(!text.stdout.includes(secret));
    assert.ok(!json.stdout.includes(secret));
    assert.match(text.stdout, /OPENAI_API_KEY/);
    assert.match(text.stdout, /looks like a real secret/);
});
