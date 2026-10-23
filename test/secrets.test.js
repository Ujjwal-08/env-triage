import assert from "node:assert/strict";
import test from "node:test";

import { detectSecret, shannonEntropy } from "../src/secrets.js";
import { parseEnv } from "../src/parse-env.js";
import { diagnose } from "../src/diagnose.js";
import { formatReport } from "../src/format.js";

const FAKE_OPENAI = "sk-proj-A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
const FAKE_AWS = "AKIAIOSFODNN7EXAMPLE";
const FAKE_GITHUB = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
const FAKE_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r";

test("an sk- shaped key is detected by pattern name only", () => {
    const hit = detectSecret(FAKE_OPENAI);
    assert.ok(hit);
    assert.equal(hit.pattern, "OpenAI-style secret key");
    assert.ok(!JSON.stringify(hit).includes(FAKE_OPENAI));
});

test("AWS, GitHub, JWT and private key headers are detected", () => {
    assert.equal(detectSecret(FAKE_AWS).pattern, "AWS access key id");
    assert.equal(detectSecret(FAKE_GITHUB).pattern, "GitHub token");
    assert.equal(detectSecret(FAKE_JWT).pattern, "JSON web token");
    assert.equal(detectSecret("-----BEGIN RSA PRIVATE KEY-----").pattern, "private key header");
});

test("long hex and high-entropy base64 are caught generically", () => {
    assert.match(detectSecret("9f1c0b7a4e2d8c6f0a3b5d7e9f1c0b7a4e2d8c6f").pattern, /hex/);
    assert.match(detectSecret("Zm9vYmFyQmF6UXV4MTIzNDU2Nzg5MEFiQ2REZUZn").pattern, /base64/);
});

test("ordinary values are not secrets", () => {
    assert.equal(detectSecret("short"), null);
    assert.equal(detectSecret("development"), null);
    assert.equal(detectSecret("true"), null);
    assert.equal(detectSecret("3000"), null);
    assert.equal(detectSecret("postgres://user:pass@localhost:5432/app"), null);
    assert.equal(detectSecret("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"), null);
    assert.equal(detectSecret(undefined), null);
});

test("shannonEntropy behaves", () => {
    assert.equal(shannonEntropy(""), 0);
    assert.equal(shannonEntropy("aaaa"), 0);
    assert.ok(shannonEntropy("abcdefgh") > 2.9);
});

test("a tracked file makes a suspicious value an error, untracked a warning", () => {
    const env = { path: ".env", entries: parseEnv(`SECRET=${FAKE_OPENAI}\n`).entries, problems: [] };
    const tracked = diagnose({ env, example: { exists: false }, gitTracked: true, gitignore: true });
    const untracked = diagnose({ env, example: { exists: false }, gitTracked: false, gitignore: true });

    const a = tracked.findings.find((f) => f.id === "suspicious-value");
    const b = untracked.findings.find((f) => f.id === "suspicious-value");
    assert.equal(a.severity, "error");
    assert.equal(b.severity, "warning");
    assert.equal(a.key, "SECRET");
});

test("the report never contains the secret value itself", () => {
    const text = [
        `OPENAI_API_KEY=${FAKE_OPENAI}`,
        `AWS_ACCESS_KEY_ID=${FAKE_AWS}`,
        `GITHUB_TOKEN=${FAKE_GITHUB}`,
        `SESSION_JWT=${FAKE_JWT}`,
    ].join("\n");
    const parsed = parseEnv(text);
    const result = diagnose({
        env: { path: ".env", entries: parsed.entries, problems: parsed.problems },
        example: { exists: false },
        gitTracked: true,
        gitignore: true,
    });

    const report = formatReport(result, { color: false });
    const asJson = JSON.stringify(result.findings);

    for (const secret of [FAKE_OPENAI, FAKE_AWS, FAKE_GITHUB, FAKE_JWT]) {
        assert.ok(!report.includes(secret), `report leaked ${secret.slice(0, 6)}...`);
        assert.ok(!asJson.includes(secret), `findings leaked ${secret.slice(0, 6)}...`);
    }
    assert.ok(report.includes("OPENAI_API_KEY"));
    assert.ok(report.includes("the value is not shown"));
    assert.equal(result.findings.filter((f) => f.id === "suspicious-value").length, 4);
});

test("a clean .env raises no suspicious-value finding", () => {
    const parsed = parseEnv("APP_NAME=demo\nPORT=3000\n");
    const result = diagnose({
        env: { path: ".env", entries: parsed.entries, problems: parsed.problems },
        example: { exists: false },
        gitTracked: true,
        gitignore: true,
    });
    assert.equal(result.findings.filter((f) => f.id === "suspicious-value").length, 0);
});
