/**
 * The one impure module: it reads files and asks git questions, then hands
 * everything to the pure `diagnose`.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { parseEnv } from "./parse-env.js";
import { scanSource } from "./scan-source.js";
import { diagnose } from "./diagnose.js";

const run = promisify(execFile);

const EXAMPLE_CANDIDATES = [".env.example", ".env.sample", ".env.template"];
const DEFAULT_SCAN_DIRS = ["src", "app", "lib", "pages", "server", "api"];
const SOURCE_EXTENSIONS = new Set([
    ".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx",
    ".svelte", ".vue", ".astro",
]);
const SKIP_DIRS = new Set([
    "node_modules", ".git", "dist", "build", "out", "coverage", ".next",
    ".nuxt", ".svelte-kit", ".output", ".cache", ".turbo", "vendor",
]);

const MAX_FILES = 5000;
const MAX_FILE_BYTES = 1024 * 1024;

async function readIfPresent(file) {
    try {
        return await readFile(file, "utf8");
    } catch {
        return null;
    }
}

async function isDirectory(target) {
    try {
        return (await stat(target)).isDirectory();
    } catch {
        return false;
    }
}

async function collectSourceFiles(cwd, dirs) {
    const files = [];
    const queue = dirs.map((dir) => path.resolve(cwd, dir));
    while (queue.length > 0 && files.length < MAX_FILES) {
        const current = queue.shift();
        let listing;
        try {
            listing = await readdir(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const item of listing) {
            if (item.isDirectory()) {
                if (!SKIP_DIRS.has(item.name) && !item.name.startsWith(".")) {
                    queue.push(path.join(current, item.name));
                }
                continue;
            }
            if (!item.isFile() || !SOURCE_EXTENSIONS.has(path.extname(item.name))) {
                continue;
            }
            const full = path.join(current, item.name);
            let info;
            try {
                info = await stat(full);
            } catch {
                continue;
            }
            if (info.size > MAX_FILE_BYTES) {
                continue;
            }
            const text = await readIfPresent(full);
            if (text !== null) {
                files.push({
                    file: path.relative(cwd, full).split(path.sep).join("/"),
                    text,
                });
            }
            if (files.length >= MAX_FILES) {
                break;
            }
        }
    }
    files.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    return files;
}

async function gitSays(cwd, args) {
    try {
        await run("git", args, { cwd, windowsHide: true });
        return true;
    } catch {
        return false;
    }
}

function gitignoreMatches(text, relative) {
    const base = relative.split("/").pop();
    let matched = null;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line === "" || line.startsWith("#")) {
            continue;
        }
        const negated = line.startsWith("!");
        const pattern = (negated ? line.slice(1) : line).replace(/^\/+/, "").replace(/\/+$/, "");
        const regex = new RegExp(
            "^" + pattern
                .split("")
                .map((ch) => {
                    if (ch === "*") return "[^/]*";
                    if (ch === "?") return "[^/]";
                    return ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
                })
                .join("") + "$",
        );
        if (regex.test(relative) || regex.test(base)) {
            matched = !negated;
        }
    }
    return matched;
}

async function gitFacts(cwd, envPath, examplePath) {
    const inRepo = await gitSays(cwd, ["rev-parse", "--is-inside-work-tree"]);
    const tracked = {
        env: inRepo && await gitSays(cwd, ["ls-files", "--error-unmatch", "--", envPath]),
        example: inRepo && await gitSays(cwd, ["ls-files", "--error-unmatch", "--", examplePath]),
    };
    if (inRepo) {
        return { inRepo, tracked, gitignore: await gitSays(cwd, ["check-ignore", "-q", "--", envPath]) };
    }
    const text = await readIfPresent(path.resolve(cwd, ".gitignore"));
    if (text === null) {
        return { inRepo, tracked, gitignore: null };
    }
    return { inRepo, tracked, gitignore: gitignoreMatches(text, envPath) === true };
}

async function resolveExample(cwd, requested) {
    const candidates = requested ? [requested] : EXAMPLE_CANDIDATES;
    for (const candidate of candidates) {
        const text = await readIfPresent(path.resolve(cwd, candidate));
        if (text !== null) {
            return { path: candidate, text, exists: true };
        }
    }
    return { path: requested ?? EXAMPLE_CANDIDATES[0], text: "", exists: false };
}

async function resolveScanDirs(cwd, requested) {
    if (requested && requested.length > 0) {
        return requested;
    }
    const found = [];
    for (const dir of DEFAULT_SCAN_DIRS) {
        if (await isDirectory(path.resolve(cwd, dir))) {
            found.push(dir);
        }
    }
    return found.length > 0 ? found : ["."];
}

/**
 * Read the project and diagnose it.
 *
 * @param {{cwd?: string, env?: string, example?: string, scan?: string[]}} [options]
 * @returns {Promise<object>}
 */
export async function runDoctor(options = {}) {
    const cwd = options.cwd ?? process.cwd();
    const envPath = options.env ?? ".env";

    const envText = await readIfPresent(path.resolve(cwd, envPath));
    const example = await resolveExample(cwd, options.example);
    const scanDirs = await resolveScanDirs(cwd, options.scan);
    const sourceFiles = await collectSourceFiles(cwd, scanDirs);
    const usages = scanSource(sourceFiles);
    const git = await gitFacts(cwd, envPath, example.path);

    const envParsed = parseEnv(envText ?? "");
    const exampleParsed = parseEnv(example.text);

    const envSide = {
        path: envPath,
        exists: envText !== null,
        entries: envParsed.entries,
        problems: envParsed.problems,
    };
    const exampleSide = {
        path: example.path,
        exists: example.exists,
        entries: exampleParsed.entries,
        problems: exampleParsed.problems,
    };

    const result = diagnose({
        env: envSide,
        example: exampleSide,
        usages,
        gitTracked: git.tracked,
        gitignore: git.gitignore,
    });

    return {
        ...result,
        cwd,
        env: { path: envSide.path, exists: envSide.exists, keys: envParsed.entries.map((e) => e.key) },
        example: { path: exampleSide.path, exists: exampleSide.exists, keys: exampleParsed.entries.map((e) => e.key) },
        scanDirs,
        scanned: sourceFiles.length,
        git: { inRepo: git.inRepo, tracked: git.tracked, gitignore: git.gitignore },
        missingKeys: result.findings.filter((item) => item.id === "missing").map((item) => item.key),
    };
}
