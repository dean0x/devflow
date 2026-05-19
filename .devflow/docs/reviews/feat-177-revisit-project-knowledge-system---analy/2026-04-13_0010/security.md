# Security Review Report

**Branch**: feat/177-revisit-project-knowledge-system---analy -> main
**Date**: 2026-04-13_0010
**PR**: #181

## Summary of Scope

Reviewed the full diff against `main` with emphasis on the requested focus areas:
- Path traversal in `legacy-knowledge-purge.ts`, `migrations.ts`, `shadow-overrides-migration.ts`
- Symlink/race on `~/.devflow/migrations.json` atomic writes
- Lock file safety (`.knowledge.lock`, `.knowledge-usage.lock`, `.learning.lock`)
- Injection risk in shell scripts (`background-learning`, `session-start-memory`, `stop-update-memory`)
- Script argument/env validation in `knowledge-usage-scan.cjs`
- Secret/credentials leakage in logs and memory files

Known pitfall `PF-004` (background-learning god script with zero tests) is directly relevant: this PR adds 100+ lines of new logic to that script (D16 staleness check, D7 migration, channel extraction), and one of those additions introduces a new shell-interpolation hazard flagged below.

---

## Issues in Your Changes (BLOCKING)

### HIGH

**Shell interpolation of LLM-sourced path into `node -e` in staleness check** — `scripts/hooks/background-learning:500-504`
**Confidence**: 85%

- Problem: In the new D16 `check_staleness` block, the variable `${stale_ref}` — extracted from `obs.details`/`obs.evidence` (LLM-generated text) via a grep regex — is interpolated directly into a `node -e` JavaScript string as `d.staleReason='code-ref-missing:${stale_ref}'`. The grep regex `[A-Za-z0-9_/.-]+\.(ts|tsx|...)` filters out `'`, `"`, `\`, `;`, `$`, backtick, and newline, so this is not an RCE today — but the design has no defense-in-depth. Any future relaxation of the regex (e.g. allowing `@scope` prefixes, spaces, or unicode) would immediately turn this into JavaScript/shell injection, and the LLM fully controls `obs.details`. The pattern also silently corrupts the staleReason string if the filename legitimately contains an apostrophe via `path.join` normalization.
- Fix: Pass `stale_ref` as a positional argument to node so it's accessed via `process.argv`, not string-interpolated:
  ```bash
  entry_line=$(printf '%s' "$entry_line" | node -e "
    const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    d.mayBeStale=true;
    d.staleReason='code-ref-missing:' + process.argv[1];
    console.log(JSON.stringify(d));
  " "$stale_ref" 2>/dev/null || printf '%s' "$entry_line")
  ```
  Same fix applies to the `[ "$DEBUG" = "true" ] && log "Staleness: ${stale_ref} missing"` line one line below — user-controlled log content already. Treat the `$transcript` and `$filter_module` interpolations at lines 169-176 the same way (pass via `process.argv[1..2]`); the safety currently depends on `$HOME` and `$SCRIPT_DIR` containing no quote characters, which is assumption — not guarantee.

### MEDIUM

**`path.isAbsolute(path.resolve(x))` is always true — CWE-23 guard is a no-op** — `scripts/hooks/knowledge-usage-scan.cjs:15-19`
**Confidence**: 95%

- Problem: The "security" comment promises protection against CWE-23, but `path.resolve()` unconditionally returns an absolute path (resolving relative inputs against `process.cwd()`). The subsequent `if (!path.isAbsolute(cwd))` branch can never be taken. A relative `--cwd` like `../../etc` would silently be resolved against whatever the scanner's current directory happens to be, not rejected. Commit `df18363` presents this as a hardening against path traversal; it does not harden — it only normalizes traversal sequences.
- Fix: Validate the **raw** input before resolving, and anchor resolution to a trusted root:
  ```javascript
  if (!path.isAbsolute(rawCwd)) process.exit(0); // reject relative inputs
  const cwd = path.resolve(rawCwd);
  // Optional: also require that `cwd` starts with an expected prefix
  // (e.g. process.env.HOME or a configured projects root) to prevent
  // callers from pointing the scanner at `/etc`, `/root`, etc.
  ```
  Additionally, since `memoryDir = path.join(cwd, '.memory')` is the only directory touched, verify it resolves under `cwd` using `path.relative(cwd, memoryDir)` and rejecting `..` segments.

**Atomic-write temp files follow symlinks (TOCTOU)** — `src/cli/utils/migrations.ts:119-122`, `src/cli/utils/legacy-knowledge-purge.ts:45-49`, `scripts/hooks/json-helper.cjs:130-143`
**Confidence**: 85%

- Problem: All three `writeFileAtomic` implementations use the predictable pattern `{file}.tmp` and call `fs.writeFile(tmp, ...)` / `fs.writeFileSync(tmp, ...)` with no `flag: 'wx'` or `O_NOFOLLOW`. A local attacker (or a leftover file from a crashed prior run) can pre-create `~/.devflow/migrations.json.tmp` as a symlink to any file the current user can write, and the next migration run will clobber that target with JSON content controlled by Devflow. Same hazard for `decisions.md.tmp`, `pitfalls.md.tmp`, `.learning-manifest.json.tmp`, and the other `.tmp` siblings created under `.memory/`.
- Fix: Use exclusive-create flag so symlink targets cannot be followed on first write, and unlink stale `.tmp` siblings before opening:
  ```typescript
  async function writeFileAtomic(filePath: string, content: string) {
    const tmp = `${filePath}.tmp`;
    try { await fs.unlink(tmp); } catch { /* ok */ }
    await fs.writeFile(tmp, content, { encoding: 'utf-8', flag: 'wx' });
    await fs.rename(tmp, filePath);
  }
  ```
  For CJS (json-helper.cjs), use `fs.writeFileSync(tmp, content, { flag: 'wx' })`. Consider using `fs.open(tmp, 'wx')` + `write` + `fsync` + `close` for true durability across the rename, matching the "POSIX rename ensures readers never observe a partial write" guarantee advertised in the JSDoc.

**`execSync` uses shell interpolation of `process.cwd()`-derived paths** — `src/cli/commands/learn.ts:1185-1188`
**Confidence**: 80%

- Problem: The new D23 block calls `execSync` with a shell string that interpolates `jsonHelperPath` and `filePath` (both derived from `process.cwd()` via `path.join`). If `process.cwd()` — or the user's devflow install dir — contains a `"`, `$`, backtick, or newline character (all legal on Unix), the resulting command becomes a classic command-injection vector. The `execSync` runs whatever the current user can run, so impact is limited to self-harm in the common case; but in CI/automation contexts, cloning a repo into a path like `/tmp/build$(id)` would lead to unexpected execution.
- Fix: Use `execFileSync` or `spawnSync` with an argv array so arguments are not shell-interpreted:
  ```typescript
  import { execFileSync } from 'child_process';
  const result = JSON.parse(
    execFileSync('node', [jsonHelperPath, 'count-active', filePath, type], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim(),
  );
  ```

### LOW

**Manifest `entry.path` from `.learning-manifest.json` used as `fs.existsSync` argument without prefix check** — `scripts/hooks/json-helper.cjs:1371-1385`
**Confidence**: 75% (Suggestions section)

- Problem: `reconcile-manifest` reads the manifest and calls `fs.existsSync(entry.path)` / `fs.readFileSync(entry.path, 'utf8')` on each entry. The manifest is local/project-scoped, so the only way to poison `entry.path` is for a user's project to already contain a compromised `.learning-manifest.json` — but at that point the reconciler will happily read any file on the filesystem, then include it in a content-hash check and potentially return content patterns back via `learningLog()`. Low severity because this is informational only, but it lets a rogue `.learning-manifest.json` probe filesystem existence and read selected sections for anchor regex matches.
- Fix: Verify that `entry.path` is under `baseDir` (or `.memory/` / `.claude/`) before any FS call.

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`.knowledge.lock` mtime-based staleness is attacker-modifiable** — `src/cli/utils/legacy-knowledge-purge.ts:64-70`, `scripts/hooks/json-helper.cjs:404-442` (acquireLock)
**Confidence**: 80%

- Problem: Stale-lock recovery uses `fs.stat(lockDir).mtimeMs` and rmdirs if older than `staleMs` (60s). An attacker with write access to `.memory/` can `touch` the lock dir to keep it "fresh" and deny service to legitimate writers, or remove it to force a lock breakage race. No PID-file check exists to verify the lock holder is still alive, so a crashed legitimate process blocks writes for `staleMs` every time. This is the same pattern in legacy-knowledge-purge, json-helper.cjs, knowledge-usage-scan.cjs, and background-learning — consistency is good, but the whole scheme is weak.
- Fix: Write the lock holder's PID into `{lockDir}/holder.pid` and check `kill -0 <pid>` during stale-check; only break locks held by dead PIDs. Keep the 60s fallback as secondary defense.

**LLM-sourced `obs.pattern`, `obs.details`, `obs.evidence` rendered into Markdown files Claude reads back** — `scripts/hooks/json-helper.cjs:1076-1101`, `1115-1142`, `1244-1272`
**Confidence**: 75%

- Problem: `render-ready` writes LLM output directly into `.claude/commands/self-learning/*.md`, `.claude/skills/self-learning:*/SKILL.md`, and `.memory/knowledge/{decisions,pitfalls}.md`. These files are subsequently read by Claude Code as system context via session-start hooks (TL;DR in session-start-memory) and by the classification/router skills. A malicious-but-trusted LLM response (or a crafted transcript in a poisoned session) could embed fake `<system-reminder>` blocks, `<command-name>` tags, or instructions that the classification hook treats as system context. Devflow already knows framework-injected XML is dangerous — `transcript-filter.cjs` explicitly rejects `<command-name>`, `<system-reminder>`, `<example>` wrappers at ingestion. That rejection should apply symmetrically to **output** too.
- Fix: Before writing `obs.pattern`/`obs.details`/evidence strings into any markdown artifact, scrub framework-reserved tags using the same regex used in `transcript-filter.cjs` (`/^\s*<(command-|local-command-|system-reminder|example)/`). Better, HTML-escape `<` / `>` in LLM strings before interpolation — markdown accepts them literally.

### LOW

**`decoded_signals` output via `console.log(s.join('\n'))` risks JSON-escaping issues** — `scripts/hooks/background-learning:185`
**Confidence**: 70% (Suggestions section)

- Problem: `node -e "const s=JSON.parse(process.argv[1]);console.log(s.join('\n'));"` takes the entire JSONified signals array as argv and blindly joins. If a user message contains `\r\0` or other control characters surviving the upstream filter, those flow into the prompt passed to Claude. Low direct security impact (the model is robust), but it may enable prompt-injection via chosen user content.
- Fix: The upstream `cleanContent` in `transcript-filter.cjs` already caps and trims; if stricter control-character sanitization is desired, extend `capText` to strip `\x00-\x08\x0b-\x1f\x7f`.

---

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`safePath()` path-traversal check in json-helper.cjs is decorative** — `scripts/hooks/json-helper.cjs:52-58`
**Confidence**: 90%

- Problem: The comment acknowledges this: `path.resolve()` normalizes `..` segments so `resolved.includes('..')` only fires when a literal `..` is a directory name post-resolution. That's an unusual filesystem construct, and the check provides no traversal protection. Any caller passing a relative path gets it silently resolved against `process.cwd()`. `safePath` is called with `args[0]` in `render-ready`, `knowledge-append`, `filter-observations`, etc. — arguments that originate from trusted bash callers, but the function's name/comment overstate what it actually guarantees.
- Fix: Either (a) remove the misleading `..` check entirely and rename to `toAbsolute()` with an honest docstring, or (b) reject `path.isAbsolute(filePath) === false` on entry (if all callers already pass absolute paths, this becomes a real guard). This is pre-existing behavior kept verbatim across the diff, but the new `render-ready`, `knowledge-append`, and `reconcile-manifest` ops added in this PR all depend on `safePath` — any real traversal vector would surface through the new ops first.

### LOW

**`echo "$CWD" | sed | tr` for transcript path encoding breaks on CWD with single quotes** — `scripts/hooks/background-learning:140`
**Confidence**: 60% (Suggestions section)

- Problem: Pre-existing. `encoded_cwd` is used to construct `projects_dir`, which is interpolated into `$transcript` and then into the `node -e` string. A `CWD` with `'` would both break the shell path and corrupt the node -e string. Not actually exploitable today since Claude Code's CWD comes from a trusted source, but it's one layer of indirection from the BLOCKING node-e issue above.

---

## Suggestions (Lower Confidence)

- **Manifest `entry.path` is trusted filesystem scan target** — `scripts/hooks/json-helper.cjs:1371` (Confidence: 75%) — See LOW finding above; verify `entry.path` stays under `baseDir` before any FS call.
- **`decoded_signals` control-char pass-through** — `scripts/hooks/background-learning:185` (Confidence: 70%) — Extend upstream sanitization; current risk is prompt-injection via crafted user content, not code execution.
- **`encoded_cwd` sed/tr pipeline brittle on CWD with non-alphanumeric chars** — `scripts/hooks/background-learning:140` (Confidence: 60%) — Pre-existing; not directly exploitable.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 3 | 0 |
| Should Fix | - | 0 | 2 | 0 |
| Pre-existing | - | - | 1 | 1 |

**Security Score**: 6/10

**Recommendation**: CHANGES_REQUESTED

Rationale:
- No CRITICAL findings — the shell-interpolation risk in `check_staleness` is currently defanged by the grep regex, and the execSync risk only fires in exotic cwd paths.
- One HIGH finding (staleness node-e interpolation) and three MEDIUM findings all need addressing before merge. They form a coherent hardening pattern: defense-in-depth on attacker-controlled-adjacent inputs (LLM text, filesystem paths, path traversal guards).
- The `knowledge-usage-scan.cjs` "CWE-23 hardening" commit is misleading enough that it warrants a fix-forward commit — the current code suggests a guarantee it does not provide.
- Symlink/TOCTOU on atomic-write tmp siblings is a consistent, low-cost hardening that applies to 3 files added by this PR. Fixing all three together in a single patch keeps them aligned.
