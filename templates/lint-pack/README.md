# Lint pack template

A lint pack is a small script that catches the faults a linter does not: a removed flag that the docs still name, a plan ID or a tombstone phrase in a comment, and an oversized function. This folder holds a template for one.

You copy the template into your repository and you own the copy. devflow never runs it, installs it or updates it. During `/implement` at the `lean` gate level, Validate runs your `lint-pack` script after your table commands pass. At any other level, nothing runs it.

## Where to find the template

- `$(npm root -g)/devflow-kit/templates/lint-pack/` after a global install of `devflow-kit`.
- `templates/lint-pack/` in the devflow repository.

The folder holds three files:

| File | Purpose |
|---|---|
| `lint-pack.sh` | The script. Copy it, for example to `scripts/lint-pack.sh`. |
| `.lint-pack.conf` | The example config. Copy it to the root of your repository. Every check is off. |
| `README.md` | This file. |

## Wiring

Validate finds the pack under one name, `lint-pack`. Add one of these entries.

- A root `package.json` script. Validate runs it as `npm run -s lint-pack -- <sha>`.

  ```json
  { "scripts": { "lint-pack": "bash scripts/lint-pack.sh" } }
  ```

- A root `Makefile` target. Validate passes the base SHA as `BASE`.

  ```make
  lint-pack:
  	@bash scripts/lint-pack.sh $(BASE)
  ```

Then copy `.lint-pack.conf` to the repository root, turn on the checks you want, and commit both files. The script needs bash 3.2 or newer, git 2.28 or newer, and a POSIX `awk`, `grep`, `sort` and `sed`. It works on the bash 3.2 that macOS ships.

Run it by hand like this:

```bash
bash scripts/lint-pack.sh "$(git merge-base origin/main HEAD)"
```

## What it reads

The script takes one argument: the base commit, as a full 40-digit lower-case SHA that is an ancestor of `HEAD`. It reads the committed change `<base>..HEAD`. It reads `.lint-pack.conf` from the `HEAD` commit, never from the work tree, and only as data. It never sources or evaluates the config. An uncommitted edit to the config changes nothing.

The check of the arguments, the repository and the base run before the config is read.

## Output

All output goes to stdout. The script prints no added text. The last line is always the `LINT_PACK:` line.

```
plan-id src/app.ts:12 tp
stale-symbol docs/guide.md:3 --legacy-mode
pack-changed .lint-pack.conf
LINT_PACK: matches 2
```

| Line | Meaning |
|---|---|
| `<check-id> <path>:<line> <id>` | One match. The check id is `stale-symbol`, `plan-id` or `function-size`. The id is the symbol, the pattern id, or `function-size`. A path keeps the quoted form that git uses for odd names. |
| `+<k> more` | The matches beyond the first 50. Records are sorted by check id, path and line number. |
| `pack-changed <path>` | A pack file that the branch changed. See "No self-silencing". |
| `skipped-binary <path>` | A file that git treats as binary, so the script did not search it. At most 10 are listed, then `+<k> more`. |
| `symbol-cap <n>` | The number of symbols left out because the script searches at most 500. |
| `unsafe-tokens <n>` | The number of symbols dropped because they are longer than 64 bytes or hold characters outside `A-Za-z0-9_.:/-`. |
| `unmatched-diagnostics <n>` | The number of linter diagnostics on a path that is not in the diff. Look at the linter's path form if this is not zero. |
| `dropped-long-lines <n>` | The number of lines longer than 200 bytes that the script did not print. A dropped match still counts in `matches`. |
| `LINT_PACK: clean` | A check ran and found nothing. Exit 0. |
| `LINT_PACK: no-config` | No config at `HEAD`, or no check is enabled. Exit 0. |
| `LINT_PACK: matches <n>` | `n` matches in all, printed or not. Exit 1. |
| `LINT_PACK: error <reason>` | The run could not finish. Exit 2. A pack error is never a pass. |

The error reasons are a closed set: `usage`, `not-a-repo`, `bad-base`, `base-not-ancestor`, `bad-config <line>`, `bad-pattern <id>`, `git-failed`, `linter-missing` and `linter-exit <n>`. A pattern error names the pattern id, or `stale-symbol` or `size-match`.

The same base, the same `HEAD` and the same config give the same bytes on stdout and the same exit code. The script clears the git pathspec variables and the grep variables and sets `LC_ALL=C`. It pins its git calls against hostile `diff.*`, `grep.*`, `color.*` and `core.quotePath` settings.

## The config

One `key=value` per line. A blank line and a line that starts with `#` are skipped. A repeated key adds one more item to its list. A key that takes one value may appear once. An unknown key, a malformed line, an empty value or a repeated single key stops the run with `bad-config <line>`. An enabled check without its required keys stops the run with the line of its `enabled` key.

A glob is a shell glob in which `*` also matches `/`. A pattern is a POSIX extended regular expression. The script rejects `\d`, `\w`, `\s`, `\b`, back-references, and a pattern that matches the empty string. Use `[0-9]`, `[A-Za-z0-9_]` and `[[:space:]]`. Add patterns as data: examples use placeholders such as `ADR-NNN`, never a real ID.

### Check 1: stale symbols

A symbol qualifies when it is on a removed line in the source globs, on no added line, and in no tracked file at `HEAD` outside the doc and help globs. Each line at `HEAD` in the doc and help globs that names the symbol is a match. The search is whole-word and fixed-string, with `git grep` on `HEAD` only.

| Key | Meaning |
|---|---|
| `stale.enabled` | `true` or `false`. Default `false`. Needs `stale.source` and `stale.symbol`. |
| `stale.source` | A glob for the files whose removed lines supply symbols. |
| `stale.doc` | A glob for files that must not name a removed symbol. Default `*.md`. |
| `stale.help` | A glob for help-only files, such as a usage text or a man page. |
| `stale.symbol` | An ERE that pulls symbols out of the removed lines. |
| `stale.min-length` | The shortest symbol to search for, from 1 to 64. The example sets 6. |
| `stale.allow` | A glob for paths whose matches are expected. |

### Check 2: plan IDs and tombstones

Each pattern matches as a whole word on added lines.

| Key | Meaning |
|---|---|
| `ids.enabled` | `true` or `false`. Default `false`. Needs at least one `ids.pattern`. |
| `ids.pattern` | `<id> <ERE>`. The id is 1 to 32 characters of `a-z`, `0-9` and `-`. The pattern follows the first space. |
| `ids.allow` | A glob for paths where such text is fine. The example allows `CHANGELOG.md`. |

### Check 3: function size

The script runs your linter on the work tree, from the repository root. It keeps only the `path:line:` diagnostics that fall inside the lines the branch added. It strips the absolute repository root from a path. A diagnostic on a path that is not in the diff is counted on the `unmatched-diagnostics` line.

| Key | Meaning |
|---|---|
| `size.enabled` | `true` or `false`. Default `false`. Needs at least one `size.arg`. |
| `size.arg` | One word of the linter command per line. The command runs as argv, with no shell. |
| `size.match` | An ERE. A diagnostic line must match it. Default: every line. |
| `size.ok-exit` | An exit status that is not an error. Repeat to add. Default: `0` and `1`. |
| `size.allow` | A glob for paths whose diagnostics are expected. |

An exit status outside `size.ok-exit` gives `linter-exit <n>`. The statuses 126 and 127 give `linter-missing`.

**ESLint.** Run `eslint --format unix` and match the rule name. ESLint 9 moved the `unix` formatter to the package `eslint-formatter-unix`, so install it first.

```
size.arg=npx
size.arg=eslint
size.arg=--format
size.arg=unix
size.match=max-lines-per-function
```

**Clippy.** Print short messages, allow nothing but one lint, and set `too-many-lines-threshold` in `clippy.toml`. Do not use `too_many_arguments`. The short message reads `this function has too many lines (n/m)`, so match that text. Clippy prints to stderr, and the script captures stdout and stderr together. Clippy exits 0, or 101 when it fails to compile.

```
size.arg=cargo
size.arg=clippy
size.arg=--message-format
size.arg=short
size.arg=--
size.arg=-A
size.arg=clippy::all
size.arg=-W
size.arg=clippy::too_many_lines
size.match=too many lines
```

## No self-silencing

A branch must not clear a match by editing the pack. The script never checks its own files: the config and the script are skipped by all three checks. It prints `pack-changed <path>` for each pack file the branch changed, so a reviewer sees the change. The files are:

- `.lint-pack.conf`, including a config that the branch deleted or renamed away.
- The script itself.
- `.gitattributes`, because a `binary` entry hides a file from a search.
- `package.json` or `Makefile`, only when a changed line names `lint-pack`.

The `pack-changed` lines print even when the result is `no-config`. Fix never edits the pack, its config, its build entry or `.gitattributes` to clear a match.

## Limits

- An edited line counts as an added line. An old plan ID on a line that you touch is a match.
- Checks 1 and 2 read committed changes, and the config at `HEAD`. Commit your work before you run the script.
- Check 3 runs the linter on the work tree. It sees a diagnostic only on an added line, which is usually the first line of a function.
- Help globs name help-only files. A file outside the doc and help globs counts as code.
- A symbol that only occurs inside a longer symbol on the same line is not searched on its own.
- A file that git treats as binary, for example through `.gitattributes`, is not searched. The script prints a `skipped-binary` line instead of passing it silently.
- The script searches `HEAD` with `git grep`. It never follows a symlink out of the repository.

## False positives

Fix may not edit the pack, so a match that you judge false halts `/implement` after two Fix attempts. To clear it:

1. Add an allow glob for that path to the matching key: `stale.allow`, `ids.allow` or `size.allow`. For a code line, you can also use the disable comment of your linter.
2. Commit the change.
3. Run Validate again.

The next run prints a `pack-changed .lint-pack.conf` line, so the review sees the change. An allow list is the project's decision, and a human makes it.

## Tests

devflow keeps a fixture suite for the template in `tests/lint-pack-template.test.ts`. It builds real git repositories and compares the output with hand-written expected text. It runs under bash 3.2 on macOS and under bash 5 on Linux.
