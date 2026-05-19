# Architecture Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Scope**: 46 files changed (+2451/-5399 lines), 20 commits

## Issues in Your Changes (BLOCKING)

### HIGH

**CLAUDE.md not updated to reflect sidecar architecture** - `CLAUDE.md`
**Confidence**: 95%
- Problem: CLAUDE.md is the project's canonical architectural reference. Five sections still describe the pre-sidecar system: (1) the "Working Memory" paragraph references `prompt-capture-memory`, `stop-update-memory`, background `claude -p --model haiku` updater, `mv`-based atomic handoff, `mkdir`-based lock, and `.working-memory-disabled` sentinel -- all of which are removed or replaced; (2) the "Learning agent" paragraph references `session-end-learning` hook, `devflow learn --run-background`, `.learning-disabled` sentinel; (3) the "Decisions agent" paragraph references `session-end-decisions` hook, `devflow decisions --run-background`, `decisions-agent.ts`; (4) the "Project Structure" `scripts/hooks/` comment lists 13 hooks by name including 8 deleted hooks; (5) the `.memory/` file inventory lists `.working-memory-disabled` and `.learning-disabled` sentinels that no longer exist.
- Impact: Any agent or developer reading CLAUDE.md will form an incorrect mental model of the hook system, the toggle mechanism (sentinel files vs sidecar config.json), and the background execution model (background `claude -p` processes vs in-session sidecar subagents). This affects every downstream workflow that references the architecture doc.
- Fix: Update the five stale sections to describe: 3 sidecar hooks (sidecar-capture/Stop, sidecar-dispatch/UserPromptSubmit, sidecar-evaluate/SessionEnd) + 2 retained hooks (session-start-memory, pre-compact-memory) + sidecar config.json as the single toggle mechanism + marker-file-based dispatch to in-session background subagents.

**Dual-toggle inconsistency: decisions --enable/--disable maintains `.disabled` sentinel AND sidecar config, but other features use config only** - `src/cli/commands/decisions.ts:812-836`
**Confidence**: 82%
- Problem: `decisions --enable` removes `decisions/.disabled` sentinel and writes sidecar config. `decisions --disable` creates the sentinel and writes sidecar config. This dual-write is intentional (session-start-context reads the sentinel, not sidecar config). However, `memory --disable` only writes sidecar config (no sentinel), and `learn --disable` only writes sidecar config (no sentinel). Meanwhile `knowledge --disable` creates `.features/.disabled` sentinel AND writes sidecar config (same dual pattern as decisions). This creates an inconsistent toggle architecture: two features have dual-toggle (decisions, knowledge), two have single-toggle (memory, learning). The design rationale is clear (session-start-context reads sentinels independently), but there is no centralized documentation of which hooks read which source of truth.
- Impact: Future maintainers adding a new feature or modifying the toggle path will not know which pattern to follow. The asymmetry increases the risk of a toggle not being fully honored across all hooks.
- Fix: Add a "Toggle Sources of Truth" table to the sidecar SKILL.md or CLAUDE.md documenting: for each feature, which file(s) control its enabled state, and which hooks read each. Example: `| Feature | sidecar config | sentinel | readers |`. This preserves the current design while making the architecture explicit.

### MEDIUM

**sidecar-evaluate: god-script accumulation risk (415 lines, 5 major sections)** - `scripts/hooks/sidecar-evaluate`
**Confidence**: 85%
- Problem: At 415 lines, sidecar-evaluate handles artifact reinforcement (lines 128-196), learning evaluation with batch accumulation + daily cap + transcript filtering (lines 198-295), decisions evaluation with daily cap + transcript filtering (lines 297-357), knowledge evaluation with throttling + stale slug detection (lines 359-413), plus shared utilities (read_daily_cap, load_existing_ids). This concentrates five distinct responsibilities in one file, violating SRP. The learning and decisions evaluation sections are structurally symmetric (daily cap check, transcript filter, marker write) yet implemented as separate code blocks with subtle differences.
- Impact: Each new feature evaluation added to this hook increases cognitive load and the blast radius of bugs. The symmetric learning/decisions blocks already led to a bug fix commit (75dfbff) that sanitized arithmetic inputs in one section but the fix had to be manually applied to matching code in the other.
- Fix: Extract each evaluation section into a sourced helper (e.g., `sidecar-eval-learning`, `sidecar-eval-decisions`, `sidecar-eval-knowledge`) with a shared daily-cap utility. The main script becomes a ~50-line dispatcher. This keeps the single SessionEnd hook entry point while decomposing responsibilities.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**memory --enable installs hooks AND writes sidecar config, but --disable only writes config -- asymmetry documented but potentially confusing** - `src/cli/commands/memory.ts:324-348`
**Confidence**: 80%
- Problem: The inline comment (line 325-328) explains the asymmetry: `--enable` must install hooks on first use because sidecar hooks are shared across features. `--disable` only writes config because hooks must remain for other features. This is architecturally sound, but the help text says `--enable: Enable working memory via sidecar config` and `--disable: Disable working memory via sidecar config` -- both descriptions suggest only config operations. A user who runs `--disable` then `--enable` may not realize `--enable` also modifies settings.json.
- Fix: Update help text to: `--enable: Enable working memory (installs sidecar hooks if needed)` and `--disable: Disable working memory via sidecar config (hooks preserved for other features)`.

**knowledge toggle writes manifest AND sidecar config** - `src/cli/commands/knowledge/toggle.ts:36-66`
**Confidence**: 80%
- Problem: `handleToggle` for knowledge writes three sources of truth when enabling: (1) `.features/index.json`, (2) sidecar config, (3) devflow manifest. When disabling: (1) `.features/.disabled` sentinel, (2) sidecar config, (3) manifest. These redundant state stores increase the chance of partial writes leaving the system in an inconsistent state (e.g., config says enabled, sentinel says disabled). The manifest write is for backward compatibility with `devflow knowledge --status` display, and the sentinel is for session-start-context gating.
- Fix: Document the three-store rationale as a JSDoc comment on `handleToggle`. Consider whether the manifest write can be removed now that sidecar config is the source of truth for runtime gating (manifest is only relevant for `devflow init` display).

## Pre-existing Issues (Not Blocking)

### MEDIUM

**session-start-context reads decisions sentinel but not sidecar config** - `scripts/hooks/session-start-context:47`
**Confidence**: 85%
- Problem: session-start-context gates the decisions TL;DR section via `decisions/.disabled` sentinel (line 47). This is the only hook that reads a per-feature sentinel in the sidecar system -- all other hooks read sidecar config.json. If a user disables decisions via sidecar config directly (editing the JSON), session-start-context will still inject decisions context because the sentinel file was not created.
- Impact: Low in practice because the CLI always creates/removes the sentinel alongside the config write. But direct JSON edits (or programmatic config updates) would bypass the sentinel.

## Suggestions (Lower Confidence)

- **Marker file schema not formally documented** - `.memory/.sidecar/*.json` (Confidence: 70%) -- The marker files (memory.json, learning.json, decisions.json, knowledge.json) each have different schemas. The schemas are documented in the sidecar SKILL.md as agent prompts, but there is no shared validation. The shell hooks write them and the SKILL.md tells agents how to read them. If either side drifts, the contract breaks silently. Consider a schema comment block at the top of each marker-writing section in the hooks.

- **writeConfig is not atomic (no rename pattern)** - `src/cli/utils/sidecar-config.ts:48-52` (Confidence: 65%) -- writeConfig uses `fs.writeFile` which is not guaranteed atomic on all filesystems. D1 in the source correctly notes this is acceptable for single-threaded CLI use. However, the shell hooks also read this file, and a partial write during CLI execution could produce invalid JSON that `json_field_file` falls back to defaults for. The risk is extremely low (millisecond window), but `writeFileSync` to a `.tmp` then `rename` would eliminate it entirely.

- **Sidecar SKILL.md agent prompts embed full implementation logic** - `shared/skills/sidecar/SKILL.md` (Confidence: 62%) -- The skill file embeds complete agent prompts (159 lines) including file paths, JSON schemas, and promotion thresholds. If the underlying data format changes (e.g., learning-log.jsonl field names), the SKILL.md must be manually updated in sync. The old system had this logic in TypeScript (`decisions-agent.ts`, `learning-agent.ts`) where it was testable. The new system moves it to markdown agent prompts which are not unit-testable.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Architecture Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

## Rationale

The sidecar consolidation is a strong architectural improvement -- reducing 8 hooks + 3 TypeScript utilities to 3 hooks + 1 utility is a meaningful simplification. The separation of concerns between capture (Stop), dispatch (UserPromptSubmit), and evaluate (SessionEnd) maps cleanly to the Claude Code hook lifecycle. The sidecar config.json as a single source of truth for feature toggles is a good replacement for the scattered sentinel-file approach. The marker-file-based communication between evaluate and dispatch is a clean, filesystem-native coordination mechanism. Applies ADR-001 (clean break philosophy -- no migration code for the sentinel-to-config transition).

The two HIGH issues are blocking:
1. CLAUDE.md is the project's canonical architecture reference and must reflect the current system. Every agent and developer consult it.
2. The dual-toggle inconsistency (sentinel + config for some features, config-only for others) needs documentation even if the current implementation is correct.

The MEDIUM issue on sidecar-evaluate's size (415 lines) is a "should address" -- the file works correctly today, but its SRP violation means the next feature evaluation added will push it further toward the god-script pattern that PF-001 area already warns about (avoids PF-001 -- recognizing that this refactor was done to consolidate, but the evaluate hook may be consolidating too much).
