# env-doctor

A read-only checkup for your `.env` files: missing keys, empty values, committed secrets and variables the code reads but nobody defined.

```
$ npx env-doctor

env-doctor  .env vs .env.example  (3 source files scanned)

errors
  ✗ SESSION_SECRET         is still a placeholder value (.env:6)
  ✗ .env is not matched by .gitignore; one commit away from leaking
  ✗ SENTRY_DSN             missing from .env (declared in .env.example:9)
  ✗ DATABASE_REPLICA_URL   used in src/db.js:5 but not defined in .env or .env.example
  ✗ STRIPE_WEBHOOK_SECRET  used in src/billing.js:2 but not defined in .env or .env.example

warnings
  ⚠ API_PORT           defined more than once (first at line 10, again at line 11); the last one wins (.env:11)
  ⚠ uses an `export ` prefix, which several dotenv loaders keep as part of the key (.env:12)
  ⚠ malformed line: no `=` found (.env:13)
  ⚠ DATABASE_URL       is named like a URL but the value has no scheme (.env:3)
  ⚠ ENABLE_SIGNUPS     is named like a flag but the value is not boolean-ish (.env:9)
  ⚠ STRIPE_SECRET_KEY  looks like a real secret in an untracked file (.env:5, matched: Stripe live key); the value is not shown
  ⚠ API_PORT           set in .env:11 but not documented in .env.example
  ⚠ ENABLE_SIGNUPS     set in .env:9 but not documented in .env.example
  ⚠ LEGACY_MODE        set in .env:12 but not documented in .env.example
  ⚠ SMTP_HOST          set in .env:8 but not documented in .env.example
  ⚠ legacyFlag         set in .env:7 but not documented in .env.example
  ⚠ SMTP_HOST          value has trailing whitespace (.env:8)

info
  ℹ legacyFlag      is not UPPER_SNAKE_CASE (.env:7)
  ℹ ENABLE_SIGNUPS  defined in .env:9 but never referenced in the scanned code; it may be used elsewhere
  ℹ LEGACY_MODE     defined in .env:12 but never referenced in the scanned code; it may be used elsewhere
  ℹ SESSION_SECRET  defined in .env:6 but never referenced in the scanned code; it may be used elsewhere
  ℹ SMTP_HOST       defined in .env:8 but never referenced in the scanned code; it may be used elsewhere
  ℹ legacyFlag      defined in .env:7 but never referenced in the scanned code; it may be used elsewhere

5 errors, 12 warnings, 6 info
fix: copy the missing keys with `npx env-doctor --print-missing >> .env`
```

When the project is healthy:

```
$ npx env-doctor

env-doctor  .env vs .env.example  (1 source file scanned)

  ✓ no problems found

0 errors, 0 warnings, 0 info
```

env-doctor never edits a file, never makes a network call, and never prints a secret
value — only the key name and the name of the pattern that matched.

## Install

```sh
npx env-doctor
```

```sh
npm i -D env-doctor
```

## Usage

```sh
env-doctor [options]
```

| Flag | Default | What it does |
| --- | --- | --- |
| `-e, --env <path>` | `.env` | The env file to check |
| `-x, --example <path>` | `.env.example`, then `.env.sample`, `.env.template` | The file it is compared against |
| `-s, --scan <dir>` | `src`, `app`, `lib`, `pages`, `server`, `api` if present, else `.` | Directory to scan for usages (repeatable) |
| `--ci` | off | Also exit 1 on warnings |
| `--json` | off | Machine readable output |
| `--print-missing` | off | Print just `KEY=` lines for the missing keys |
| `--no-color` | auto | Never emit ANSI (also honours `NO_COLOR` and non-TTY output) |
| `-h, --help` | | Show help |
| `-v, --version` | | Show the version |

Exit codes: `0` clean, `1` errors found (with `--ci`, warnings too), `2` bad usage.

Source scanning understands `process.env.X`, `process.env["X"]`, `import.meta.env.X`,
`Deno.env.get("X")` and `getEnv("X")` across `.js .mjs .cjs .jsx .ts .mts .cts .tsx
.svelte .vue .astro`.

Add it to CI:

```yaml
- run: npx env-doctor --ci
```

Top the gaps up without opening an editor:

```sh
npx env-doctor --print-missing >> .env
```

### `--json`

```json
{
  "summary": { "errors": 5, "warnings": 12, "info": 6, "total": 23 },
  "missingKeys": ["SENTRY_DSN"],
  "ok": false,
  "findings": [
    {
      "id": "empty",
      "severity": "error",
      "key": "SESSION_SECRET",
      "message": "is still a placeholder value (.env:6)",
      "lines": [{ "file": ".env", "line": 6 }]
    }
  ]
}
```

## Checks

| id | severity | what it catches |
| --- | --- | --- |
| `missing` | error | In the example file, absent from `.env` |
| `empty` | error | Defined but blank, or still `changeme` / `xxx` / `your-key-here` / `TODO` / `<...>` |
| `undocumented` | warning | In `.env` but not in the example file, which keeps the example honest |
| `used-undefined` | error | Read by the code, defined in neither file, with the `file:line` that reads it |
| `unused` | info | Defined but never referenced in the scanned code; it may be used elsewhere |
| `duplicate-key` | warning | The same key twice in one file; the last one wins |
| `suspicious-value` | error / warning | A real-looking secret (`sk-…`, `AKIA…`, `ghp_…`, JWTs, private key headers, long base64/hex). Error when the file is tracked by git, warning otherwise |
| `gitignore` | error | `.env` is not matched by `.gitignore`, or worse, `git ls-files` shows it tracked |
| `parse` | warning | No `=`, an empty key, unbalanced quotes, spaces around `=`, an `export ` prefix |
| `whitespace` | warning | Trailing whitespace, a hidden CR inside a value, a single-quoted `\n` that will never become a newline |
| `casing` | info | Keys that are not `UPPER_SNAKE_CASE` |
| `sanity` | warning | `*_URL` with no scheme, `*_PORT` that is not 1–65535, `ENABLE_*` / `*_ENABLED` that is not boolean-ish |

`NODE_ENV`, `CI`, `PATH` and other ambient variables are never reported as undefined.

## API

```js
import { parseEnv, scanSource, diagnose, formatReport, runDoctor } from "env-doctor";
```

### `parseEnv(text)`

Parses `.env` text and keeps line numbers. Understands single and double quotes,
escapes, `#` comments (including a `#` inside a quoted value), multi-line quoted
values, an `export ` prefix, CRLF and a BOM.

Returns `{ entries, problems }` where each entry is
`{ key, value, line, quoted, endLine }` and each problem is
`{ id, severity, line, key, message }` with an id of `parse`, `whitespace` or
`duplicate-key`.

```js
parseEnv('export FOO="a\\nb" # note\n');
// entries: [{ key: "FOO", value: "a\nb", line: 1, quoted: true, endLine: 1 }]
// problems: [{ id: "parse", line: 1, message: "uses an `export ` prefix, …" }]
```

### `scanSource(files)`

Takes `[{ file, text }]` and returns `Map<key, [{ file, line }]>`. Pure: it does not
touch the filesystem.

### `diagnose({ env, example, usages, gitTracked, gitignore })`

The pure core. `env` and `example` are `{ path, exists, entries, problems }`
(the output of `parseEnv` plus a path), `usages` is what `scanSource` returned,
`gitTracked` is a boolean or `{ env, example }`, and `gitignore` is `true`,
`false`, or `null` when it cannot be determined.

Returns `{ findings, summary }`. Each finding is
`{ id, severity, key, message, lines }`, sorted error → warning → info, and
deterministic for a given input.

### `formatReport(result, options?)`

Pure. Turns `{ findings, summary }` into the string shown above.
`options.color` defaults to `false`, so the output carries no ANSI unless asked.

### `runDoctor(options?)`

The only function that touches the filesystem. Options:
`{ cwd, env, example, scan }`. Returns the `diagnose` result plus
`{ cwd, env, example, scanDirs, scanned, git, missingKeys }`.

```js
import { runDoctor, formatReport } from "env-doctor";

const result = await runDoctor({ cwd: process.cwd() });
console.log(formatReport(result));
process.exitCode = result.summary.errors > 0 ? 1 : 0;
```

Also exported: `entriesToMap`, `detectSecret`, `shannonEntropy`, `createColors`,
`supportsColor`, `AMBIENT_KEYS`.

## Why

`.env.example` drifts away from `.env` the moment someone adds a variable in a hurry,
and the deploy is where you find out. Meanwhile a trailing space, a `\n` that never
became a newline, or a key that is still `changeme` all fail in ways that look like
something else entirely.

env-doctor reads the two files, reads the code that uses them, and tells you which
line to look at. Zero dependencies, no network, no writes.

## Support

If this saved you some time, you can support the work here:

- **Patreon:** https://www.patreon.com/cw/BABU_ISHU
- **PayPal:** https://www.paypal.com/ncp/payment/SECBQ62TRZZ6Y

## License

MIT
