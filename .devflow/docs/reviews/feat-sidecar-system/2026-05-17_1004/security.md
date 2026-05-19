# Security Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Path traversal via unvalidated SESSION_ID in sidecar-evaluate** - `scripts/hooks/sidecar-evaluate:56`
**Confidence**: 82%
- Problem: `SESSION_ID` is extracted from JSON input at line 52 and used directly in a file path construction at line 56 (`$PROJECTS_DIR/${SESSION_ID}.jsonl`) without validation. If a malicious `session_id` value contains `../` sequences, it could reference files outside the intended `~/.claude/projects/` directory. The validation regex (`^[a-zA-Z0-9_-]+$`) only appears later at line 128 for the learning session count context, not for the transcript access at line 56.
- Fix: Add the same alphanumeric validation before using SESSION_ID in the path at line 56:
```bash
SESSION_ID=$(printf '%s' "$INPUT" | json_field "session_id" "")
TRANSCRIPT=""

if [ -d "$PROJECTS_DIR" ]; then
  if [ -n "$SESSION_ID" ] && echo "$SESSION_ID" | grep -qE '^[a-zA-Z0-9_-]+$' && [ -f "$PROJECTS_DIR/${SESSION_ID}.jsonl" ]; then
    TRANSCRIPT="$PROJECTS_DIR/${SESSION_ID}.jsonl"
  else
```

Note: The threat is limited because the input comes from Claude Code's hook framework (not direct user input), but defense-in-depth dictates validating before path construction.

**Shell variable interpolation in node -e heredoc strings** - `scripts/hooks/sidecar-evaluate:159`, `scripts/hooks/sidecar-evaluate:241`
**Confidence**: 80%
- Problem: File paths are interpolated directly into `node -e` script strings (e.g., `fs.readFileSync('$MEMORY_DIR/learning-log.jsonl','utf8')`). If `MEMORY_DIR` contains shell metacharacters (unlikely for typical paths but possible with spaces, single quotes, or backslashes in project directory names), this could break the node script or cause unexpected behavior. This differs from lines 174/257 where `process.argv` is used correctly for dynamic data.
- Fix: Pass the file path via `process.argv` instead of shell interpolation:
```bash
EXISTING_IDS=$(node -e "
  const fs=require('fs');
  const lines=fs.readFileSync(process.argv[1],'utf8').trim().split('\n').filter(Boolean);
  const ids=lines.map(l=>{try{return JSON.parse(l).id}catch{return null}}).filter(Boolean);
  process.stdout.write(JSON.stringify(ids));
" -- "$MEMORY_DIR/learning-log.jsonl" 2>/dev/null || echo "[]")
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Config file written without restrictive permissions** - `src/cli/utils/sidecar-config.ts:51`
**Confidence**: 83%
- Problem: `writeConfig` uses `fs.writeFile` without specifying a mode. The config file at `.memory/.sidecar/config.json` controls feature enable/disable state. While this is not sensitive credential data, a permissive umask (e.g., 022) would allow other local users to read and potentially modify the config (toggling sidecar features). The queue file at `.pending-turns.jsonl` already uses `umask 077` in `sidecar-capture:79-81` — the config should follow the same pattern for consistency.
- Fix: Add explicit mode to `writeFile`:
```typescript
await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Marker file race condition between rename and read** - `shared/skills/sidecar/SKILL.md:25` (Confidence: 65%) — The skill instructs "Rename `.memory/.sidecar/{task}.json` to `.memory/.sidecar/{task}.processing` (atomic claim)" followed by "Read the marker content". If two Claude sessions run simultaneously, both could attempt the rename on the same file. The `mv` operation is atomic on the same filesystem, so only one succeeds, but the skill does not explicitly instruct the agent to handle a rename failure (ENOENT) gracefully.

- **No integrity check on marker file content before agent consumption** - `shared/skills/sidecar/SKILL.md:32-93` (Confidence: 62%) — Sidecar agents are instructed to read `.processing` marker files and execute based on their content (file paths, user signals, dialog pairs). If a marker file is corrupted or tampered with (e.g., pointing `pendingTurnsFile` to an arbitrary path), the background agent could read unintended files. The threat model is local-only (requires write access to `.memory/.sidecar/`), which limits real-world risk.

- **Stale .processing file recovery renames without content validation** - `scripts/hooks/sidecar-dispatch:82-84` (Confidence: 68%) — When a `.processing` file is older than 5 minutes, it is renamed back to `.json` for retry. No validation is done on the content before re-queuing. A corrupted or partially-written processing file would be retried indefinitely on a 5-minute cycle.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The sidecar system is well-designed from a security perspective. Key positives:
- Queue files are created with restrictive permissions (umask 077)
- Background loop feedback is prevented via environment variable guards
- Input truncation (2000 chars) prevents unbounded memory consumption
- Session ID is validated before use in the learning batch counter
- User content is passed via `process.argv` (not string interpolation) in the marker-writing codepaths
- Queue overflow is bounded (200 lines triggers truncation to 100)

The two blocking issues are defense-in-depth improvements — the SESSION_ID path traversal has low exploitability (input comes from Claude Code internals) and the node -e interpolation requires unusual project paths to trigger. The config file permissions issue is a consistency gap with the queue file handling. All three are straightforward fixes.

Applies ADR-001: the clean-break approach (removing 8 old hooks and 3 utilities) avoids accumulating compat shims that could become attack surface.
