#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { runDoctor } from "../src/run.js";
import { formatReport } from "../src/format.js";
import { supportsColor } from "../src/colors.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const HELP = `env-triage ${pkg.version}

  Check a project's .env files for the mistakes that break deploys.
  Read-only: it never edits a file and never prints a secret value.

Usage
  npx env-triage [options]

Options
  -e, --env <path>       env file to check            (default: .env)
  -x, --example <path>   example file to compare to   (default: .env.example,
                         falling back to .env.sample and .env.template)
  -s, --scan <dir>       directory to scan for usages (repeatable; default:
                         src, app, lib, pages, server, api if present, else .)
      --ci               also exit 1 on warnings
      --json             machine readable output
      --print-missing    print just \`KEY=\` lines for the missing keys
      --no-color         never emit ANSI colour
  -h, --help             show this help
  -v, --version          show the version

Exit codes
  0  clean (with --ci: no errors and no warnings)
  1  errors found
  2  bad usage
`;

function parseArgs(argv) {
    const options = { scan: [], color: null };
    const errors = [];

    const needsValue = (flag, value) => {
        if (value === undefined || value.startsWith("-")) {
            errors.push(`${flag} needs a value`);
            return false;
        }
        return true;
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        switch (arg) {
            case "-h":
            case "--help":
                options.help = true;
                break;
            case "-v":
            case "--version":
                options.version = true;
                break;
            case "--ci":
                options.ci = true;
                break;
            case "--json":
                options.json = true;
                break;
            case "--print-missing":
                options.printMissing = true;
                break;
            case "--no-color":
                options.color = false;
                break;
            case "--color":
                options.color = true;
                break;
            case "-e":
            case "--env":
                if (needsValue(arg, argv[i + 1])) {
                    options.env = argv[i + 1];
                    i += 1;
                }
                break;
            case "-x":
            case "--example":
                if (needsValue(arg, argv[i + 1])) {
                    options.example = argv[i + 1];
                    i += 1;
                }
                break;
            case "-s":
            case "--scan":
                if (needsValue(arg, argv[i + 1])) {
                    options.scan.push(argv[i + 1]);
                    i += 1;
                }
                break;
            default:
                if (arg.startsWith("-")) {
                    errors.push(`unknown option: ${arg}`);
                } else {
                    errors.push(`unexpected argument: ${arg}`);
                }
        }
    }

    return { options, errors };
}

/** Exit code for a finished run. */
export function exitCodeFor(summary, ci) {
    if (summary.errors > 0) {
        return 1;
    }
    if (ci && summary.warnings > 0) {
        return 1;
    }
    return 0;
}

async function main() {
    const { options, errors } = parseArgs(process.argv.slice(2));

    if (options.help) {
        process.stdout.write(HELP);
        return 0;
    }
    if (options.version) {
        process.stdout.write(`${pkg.version}\n`);
        return 0;
    }
    if (errors.length > 0) {
        process.stderr.write(`${errors.join("\n")}\n\nRun \`env-triage --help\`.\n`);
        return 2;
    }

    const result = await runDoctor({
        env: options.env,
        example: options.example,
        scan: options.scan,
    });

    if (options.printMissing) {
        if (result.missingKeys.length > 0) {
            process.stdout.write(`${result.missingKeys.map((key) => `${key}=`).join("\n")}\n`);
        }
        return 0;
    }

    if (options.json) {
        process.stdout.write(`${JSON.stringify({
            version: pkg.version,
            env: result.env,
            example: result.example,
            scanDirs: result.scanDirs,
            scanned: result.scanned,
            git: result.git,
            findings: result.findings,
            summary: result.summary,
            missingKeys: result.missingKeys,
            ok: result.summary.errors === 0,
        }, null, 2)}\n`);
        return exitCodeFor(result.summary, options.ci);
    }

    const color = options.color === null ? supportsColor(process.stdout) : options.color;
    const envLabel = result.env.exists ? result.env.path : `${result.env.path} (not found)`;
    const exampleLabel = result.example.exists ? result.example.path : `${result.example.path} (not found)`;

    process.stdout.write(`\nenv-triage  ${envLabel} vs ${exampleLabel}  (${result.scanned} source file${result.scanned === 1 ? "" : "s"} scanned)\n\n`);
    process.stdout.write(`${formatReport(result, { color })}\n\n`);

    return exitCodeFor(result.summary, options.ci);
}

main().then(
    (code) => {
        process.exitCode = code;
    },
    (error) => {
        process.stderr.write(`env-triage: ${error?.message ?? error}\n`);
        process.exitCode = 2;
    },
);
