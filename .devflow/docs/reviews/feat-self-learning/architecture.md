# Architecture Review Report

**Branch**: feat/self-learning -> main
**Date**: 2026-03-23
**PR**: #160

## Issues in Your Changes (BLOCKING)

### HIGH

**God Script: background-learning is 560 lines with 7+ distinct responsibilities** - `scripts/hooks/background-learning:1-560`
**Confidence**: 92%
- Problem: The `background-learning` script handles logging, lock management, config loading, daily cap tracking, temporal decay computation, transcript extraction, LLM prompt construction, JSON response parsing, observation CRUD, artifact file creation, and observation status management -- all in a single file. This is the shell-script equivalent of a God Class. By comparison, the analogous `background-memory-update` is 257 lines with far fewer responsibilities (transcript extract, prompt, write one file). The script has 40 `jq` invocations performing complex data transformations that are fragile in Bash.
- Impact: Extremely difficult to test (no unit tests exist for this script), debug, or extend. Any change to the observation data model, confidence algorithm, or artifact format requires modifying this monolith. The known pitfall PF-002 flagged the same God-module anti-pattern in `init.ts` -- this introduces the same problem in a new file.
- Fix: Extract the script into discrete functions or separate scripts with single responsibilities:
  1. `lib/decay.sh` -- temporal decay + pruning
  2. `lib/observations.sh` -- observation CRUD (read/update/insert into JSONL)
  3. `lib/artifacts.sh` -- artifact creation from ready observations
  4. `background-learning` -- orchestrator that sources the above and coordinates the LLM call

  Alternatively, move the JSON-heavy logic (decay, observation merge, artifact status tracking) into the TypeScript CLI where it can be properly typed, tested, and refactored. The shell script would then only handle: transcript extraction, LLM invocation, and passing the raw JSON response to a `devflow learn --process-response` command.

---

**Duplicated HookEntry/HookMatcher/Settings interfaces (4 copies)** - `src/cli/commands/learn.ts:11-23`, `src/cli/commands/memory.ts:12-24`, `src/cli/commands/ambient.ts:11-23`, `src/cli/commands/hud.ts:18-24`
**Confidence**: 95%
- Problem: `learn.ts` adds a fourth copy of the identical `HookEntry`, `HookMatcher`, and `Settings` interfaces. These are identical across all four hook management modules. This is a textbook DRY violation that compounds with every new hook-based feature.
- Impact: If the Claude Code settings.json schema changes (e.g., a new required field on HookEntry), all four files must be updated in lockstep. Risk of silent divergence -- one module could parse settings differently from another.
- Fix: Extract shared types to a common module:
  ```typescript
  // src/cli/utils/settings-types.ts
  export interface HookEntry {
    type: string;
    command: string;
    timeout?: number;
  }
  export interface HookMatcher {
    hooks: HookEntry[];
  }
  export interface Settings {
    hooks?: Record<string, HookMatcher[]>;
    [key: string]: unknown;
  }
  ```
  Then import from this shared module in `learn.ts`, `memory.ts`, `ambient.ts`, and `hud.ts`.

---

### MEDIUM

**Dual-layer config loading duplicated between Bash and TypeScript** - `scripts/hooks/background-learning:97-117` and `src/cli/commands/learn.ts:210-225`
**Confidence**: 85%
- Problem: Configuration loading (global `~/.devflow/learning.json` + project `.memory/learning.json` with layered overrides and defaults) is implemented twice: once in Bash (`load_config` function in background-learning) and once in TypeScript (`loadLearningConfig` in learn.ts). Both use the same file paths, same default values, same override semantics.
- Impact: If defaults change (e.g., throttle_minutes from 5 to 3), both implementations must be updated. The Bash version uses `jq` with string interpolation for fallbacks (`jq -r ".max_daily_runs // $MAX_DAILY_RUNS"`), which is subtly different from the TypeScript version that checks types explicitly. This creates behavioral divergence risk.
- Fix: Designate one as the canonical config loader. Option A: The TypeScript CLI writes a resolved config to a known path (e.g., `.memory/.learning-resolved-config.json`) during `devflow learn --enable` or `devflow init`, and the Bash script simply reads that pre-resolved file. Option B: The Bash script calls `devflow learn --resolve-config` to get merged config via stdout.

---

**`ART_DESC` written unsanitized into YAML frontmatter** - `scripts/hooks/background-learning:527-540`
**Confidence**: 82%
- Problem: The `ART_DESC` variable is model-generated content that is written directly into YAML frontmatter via `printf '%s\n' "description: $ART_DESC"`. While `ART_NAME` is sanitized (path traversal stripped), `ART_DESC` is not. A model response containing newlines, colons, or YAML special characters in the description could produce malformed frontmatter that breaks command/skill parsing.
- Impact: Malformed YAML frontmatter could cause Claude Code to fail to load the generated command or skill, silently or with confusing errors.
- Fix: Sanitize `ART_DESC` before writing. At minimum, strip newlines and escape colons:
  ```bash
  ART_DESC=$(echo "$ART_DESC" | tr '\n' ' ' | sed 's/: /-- /g')
  ```
  Better: quote the value in the YAML:
  ```bash
  printf '%s\n' "description: \"$(echo "$ART_DESC" | sed 's/"/\\"/g' | tr '\n' ' ')\"" >> "$ART_PATH"
  ```

---

**Observation data model is implicitly shared between Bash and TypeScript** - `scripts/hooks/background-learning` (entire file) and `src/cli/commands/learn.ts:34-48`
**Confidence**: 88%
- Problem: The `LearningObservation` interface in TypeScript defines the schema, but the Bash script constructs, reads, and modifies these JSON objects entirely through string manipulation and `jq`. There is no validation that the Bash-produced JSON conforms to the TypeScript interface. Fields like `artifact_path` (optional in TS, conditionally added in Bash) could easily drift.
- Impact: A Bash-side change (e.g., renaming `.observations` to `.count`) would silently break the TypeScript `parseLearningLog` and `formatLearningStatus` functions without any compile-time or test-time signal.
- Fix: Add a JSON schema file (e.g., `shared/schemas/learning-observation.json`) that both implementations reference. Alternatively, add integration tests that verify round-trip compatibility: write JSONL from a simulated Bash output, parse it with the TypeScript functions, and assert field presence/types.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**init.ts grows another feature toggle without extraction (PF-002 recurrence)** - `src/cli/commands/init.ts:345-369` and `src/cli/commands/init.ts:717-720`
**Confidence**: 85%
- Problem: Known pitfall PF-002 identified that `init.ts` is a monolith (~765 lines). This PR adds another 30+ lines for the `--learn` feature toggle (prompt block + hook registration block), following the exact same copy-paste pattern as `--ambient` and `--memory`. The resolution from PF-002 ("Extract into `collectInitChoices()`, `executeInstallation()`, `printSummary()`") has not been applied.
- Impact: Every new feature (ambient, memory, learn, hud) adds ~30 lines of near-identical prompt code + ~5 lines of hook wiring. The init handler is now approaching 800+ lines. Future features will continue this pattern.
- Fix: Not blocking for this PR since PF-002 was already deferred as pre-existing. However, the feature toggle registration should be noted as making the refactoring more urgent. Consider extracting a `FeatureToggle` abstraction:
  ```typescript
  interface FeatureToggle {
    name: string;
    cliFlag: string;
    defaultValue: boolean;
    description: string;
    note: string;
    addHook: (settings: string, dir: string) => string;
    removeHook: (settings: string) => string;
  }
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**No shared hook management abstraction across ambient/memory/learn/hud** - `src/cli/commands/`
**Confidence**: 80%
- Problem: All four hook modules (ambient.ts, memory.ts, learn.ts, hud.ts) implement the same pattern: parse settings JSON, find/filter hook entries by marker string, add/remove with cleanup, serialize back. The code structure is nearly identical across all four. This is a codebase-wide OCP violation -- adding a new hook type requires copying the same boilerplate.
- Impact: Maintenance burden scales linearly with hook count. Bug fixes to hook management logic (e.g., handling edge cases in settings cleanup) must be applied to all four files.
- Fix: Extract a shared `HookManager` utility:
  ```typescript
  // src/cli/utils/hook-manager.ts
  export function addHook(settingsJson: string, event: string, marker: string, command: string, timeout?: number): string;
  export function removeHook(settingsJson: string, event: string, marker: string): string;
  export function hasHook(settingsJson: string, event: string, marker: string): boolean;
  ```

## Suggestions (Lower Confidence)

- **Heavy reliance on `jq` for stateful data operations in Bash** - `scripts/hooks/background-learning` (Confidence: 75%) -- The temporal decay loop (`while IFS= read -r line`) processes each JSONL line with multiple `jq` invocations (parse, extract, modify, serialize). For 100 observations, this spawns ~400+ subprocesses. Consider moving decay/pruning to the TypeScript CLI or using a single `jq` slurp-and-transform pass.

- **Learned artifacts written to `.claude/commands/learned/` but no `.claudeignore` or `.gitignore` protection** - `scripts/hooks/background-learning:504-508` (Confidence: 65%) -- Generated commands are written to the project's `.claude/commands/learned/` directory. If this directory is committed to git, auto-generated model content enters version control. Consider adding a `.gitignore` entry for `.claude/commands/learned/` and `.claude/skills/learned-*/` during the init/enable flow.

- **`manifest.ts` uses optional `learn?: boolean` while `memory` is required `boolean`** - `src/cli/utils/manifest.ts` (Confidence: 70%) -- The `learn` field is optional (`learn?: boolean`) while `memory` is required. This inconsistency means manifest-reading code must handle the missing field case for `learn` but not `memory`, despite both being feature toggles with the same lifecycle.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | - | 2 | 2 | - |
| Should Fix | - | - | 1 | - |
| Pre-existing | - | - | 1 | - |

**Architecture Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

### Rationale

The self-learning feature is well-conceived and follows the established hook pattern (stop hook -> background agent -> JSONL state). The CLI integration is clean and consistent with existing commands. However, two significant architectural issues need resolution:

1. **The 560-line God Script** concentrates too much logic in an untestable Bash file. The existing `background-memory-update` (257 lines, 2 jq calls) is the right reference point for script complexity. The learning script (560 lines, 40 jq calls) has outgrown what is reasonable for shell. The JSON-heavy business logic (temporal decay, confidence scoring, observation CRUD, artifact status management) belongs in TypeScript where it can be typed, tested, and refactored.

2. **The interface duplication** (now 4 copies of HookEntry/HookMatcher/Settings) has reached the point where it should be addressed as part of this PR rather than deferred further, since this PR is the one that pushed it past the "tolerable" threshold.

The MEDIUM issues (dual config loading, unsanitized YAML, implicit schema sharing) are real risks but individually not blocking. Collectively they reinforce the recommendation to move more logic to TypeScript.
