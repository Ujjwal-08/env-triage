import assert from "node:assert/strict";
import test from "node:test";

import { entriesToMap, parseEnv } from "../src/parse-env.js";

const ids = (result) => result.problems.map((p) => p.id);
const byKey = (result, key) => result.entries.find((e) => e.key === key);

test("parses a plain assignment", () => {
    const result = parseEnv("FOO=bar\n");
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].key, "FOO");
    assert.equal(result.entries[0].value, "bar");
    assert.equal(result.entries[0].line, 1);
    assert.equal(result.entries[0].quoted, false);
    assert.deepEqual(result.problems, []);
});

test("an empty file yields nothing", () => {
    const result = parseEnv("");
    assert.deepEqual(result.entries, []);
    assert.deepEqual(result.problems, []);
});

test("blank lines and comments are skipped but keep line numbers honest", () => {
    const result = parseEnv("# a comment\n\n   \nFOO=bar\n");
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].line, 4);
});

test("double quotes are stripped and escapes expanded", () => {
    const result = parseEnv("FOO=\"one two\"\nBAR=\"a\\nb\"\n");
    assert.equal(byKey(result, "FOO").value, "one two");
    assert.equal(byKey(result, "FOO").quoted, true);
    assert.equal(byKey(result, "BAR").value, "a\nb");
});

test("single quotes keep their contents literal", () => {
    const result = parseEnv("FOO='a\\nb'\n");
    assert.equal(byKey(result, "FOO").value, "a\\nb");
    assert.equal(byKey(result, "FOO").quoted, true);
    assert.ok(ids(result).includes("whitespace"));
});

test("an inline # starts a comment, a quoted # does not", () => {
    const result = parseEnv("FOO=bar # trailing\nBAZ=\"keep # this\"\nQUX=ab#cd\n");
    assert.equal(byKey(result, "FOO").value, "bar");
    assert.equal(byKey(result, "BAZ").value, "keep # this");
    assert.equal(byKey(result, "QUX").value, "ab#cd");
});

test("an export prefix is handled and reported", () => {
    const result = parseEnv("export FOO=1\n");
    assert.equal(byKey(result, "FOO").value, "1");
    assert.ok(ids(result).includes("parse"));
});

test("spaces around = are tolerated and reported", () => {
    const result = parseEnv("KEY = value\n");
    assert.equal(byKey(result, "KEY").value, "value");
    assert.equal(result.problems.filter((p) => p.id === "parse").length, 1);
});

test("multi-line quoted values span lines and record endLine", () => {
    const result = parseEnv("KEY=\"line1\nline2\nline3\"\nAFTER=1\n");
    assert.equal(byKey(result, "KEY").value, "line1\nline2\nline3");
    assert.equal(byKey(result, "KEY").line, 1);
    assert.equal(byKey(result, "KEY").endLine, 3);
    assert.equal(byKey(result, "AFTER").line, 4);
});

test("CRLF line endings parse cleanly", () => {
    const result = parseEnv("A=1\r\nB=2\r\n");
    assert.equal(byKey(result, "A").value, "1");
    assert.equal(byKey(result, "B").value, "2");
    assert.deepEqual(result.problems, []);
});

test("a BOM does not corrupt the first key", () => {
    const result = parseEnv("﻿API_KEY=1\n");
    assert.equal(result.entries[0].key, "API_KEY");
});

test("duplicate keys are reported and the last one wins", () => {
    const result = parseEnv("A=1\nA=2\n");
    assert.equal(result.entries.length, 2);
    assert.ok(ids(result).includes("duplicate-key"));
    assert.equal(entriesToMap(result.entries).get("A").value, "2");
});

test("a line with no = is a parse problem and produces no entry", () => {
    const result = parseEnv("JUST_A_LINE\nA=1\n");
    assert.equal(result.entries.length, 1);
    const parse = result.problems.find((p) => p.id === "parse");
    assert.equal(parse.line, 1);
    assert.match(parse.message, /no `=`/);
});

test("an empty key before = is rejected", () => {
    const result = parseEnv("=orphan\n");
    assert.equal(result.entries.length, 0);
    assert.ok(ids(result).includes("parse"));
});

test("an unbalanced quote does not swallow the next assignment", () => {
    const result = parseEnv("A=\"oops\nB=2\n");
    assert.equal(byKey(result, "A").value, "oops");
    assert.equal(byKey(result, "B").value, "2");
    assert.ok(result.problems.some((p) => p.id === "parse" && /unbalanced/.test(p.message)));
});

test("trailing whitespace in an unquoted value is reported", () => {
    const result = parseEnv("A=bar   \n");
    assert.equal(byKey(result, "A").value, "bar");
    assert.ok(result.problems.some((p) => p.id === "whitespace" && p.key === "A"));
});

test("a hidden carriage return inside a value is reported", () => {
    const result = parseEnv("A=ba\rr\n");
    assert.ok(result.problems.some((p) => p.id === "whitespace" && /carriage return/.test(p.message)));
    assert.equal(byKey(result, "A").value, "bar");
});

test("clean quoted values raise no whitespace problems", () => {
    const result = parseEnv("A=\"plain value\"\nB=plain\n");
    assert.equal(result.problems.length, 0);
});

test("entriesToMap tolerates an empty list", () => {
    assert.equal(entriesToMap([]).size, 0);
    assert.equal(entriesToMap(undefined).size, 0);
});
