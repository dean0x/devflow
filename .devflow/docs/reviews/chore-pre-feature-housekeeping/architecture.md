# Architecture Review Report

**Branch**: chore/pre-feature-housekeeping -> main
**Date**: 2026-03-20
**PR**: #153

## Issues in Your Changes (BLOCKING)

### HIGH

**Skimmer agent exceeds target line count (143 lines)** - `shared/agents/skimmer.md`
**Confidence**: 82%
- Problem: The agent design guidelines (`docs/reference/agent-design.md`) define Utility agents as 50-80 lines target, and the quality checklist states "Under 150 lines (ideally under 120)". The Skimmer is classified as a Utility agent (line 51 of agent-design.md) but has grown to 143 lines. The rewrite replaced a concise 5-item "Responsibilities" section with a detailed 6-step "Workflow" section that includes full code blocks and a reference table -- content that could be extracted to a `references/` file following the progressive-disclosure pattern used by skills.
- Impact: Agent token overhead on every Skimmer invocation. Utility agents are meant to be lean orientation tools. The rskim flag reference table (lines 74-85) and the fallback code block in Step 2 are reference material, not core workflow.
- Fix: Extract the "rskim Reference" table and detailed fallback instructions into `shared/agents/references/rskim-usage.md` or a Skimmer-specific skill, keeping the agent body under 120 lines. The agent should reference the detail rather than embed it.

**Inconsistent terminology in diagram comments** - `plugins/devflow-implement/commands/implement.md:363`, `plugins/devflow-implement/commands/implement-teams.md:550`, `plugins/devflow-specify/commands/specify.md:140`, `plugins/devflow-specify/commands/specify-teams.md:273`
**Confidence**: 85%
- Problem: The PR updates the Skimmer agent prompt text to say "rskim" in all four commands, but the ASCII diagrams at the bottom of these same files still read `Skimmer agent (codebase overview via skim)` and `Skimmer agent (codebase context via skim)` -- referring to the old "skim" name. These are in files the PR already modified.
- Impact: Misleading documentation within the same PR that renamed the tool. Developers reading the diagram will see "skim" while the prompt text says "rskim", creating confusion about which tool the Skimmer actually uses.
- Fix: Update the diagram lines to use "rskim":
  ```
  # implement.md / implement-teams.md:
  │  └─ Skimmer agent (codebase overview via rskim)

  # specify.md / specify-teams.md:
  │  └─ Skimmer agent (codebase context via rskim)
  ```

### MEDIUM

**`get_mtime()` probes the file twice on the happy path** - `scripts/statusline.sh:15-23`
**Confidence**: 85%
- Problem: The `get_mtime()` function runs `stat -f %m "$1"` to test which variant works (discarding output to `/dev/null`), then runs the same `stat` command again to get the actual value. This means two `stat` syscalls per invocation on the successful branch. The function also has a redundant `&>/dev/null 2>&1` -- `&>` already redirects both stdout and stderr, so `2>&1` is a no-op.
- Impact: Minor inefficiency; the statusline script calls `get_mtime` up to two times per render (line 83, line 203). Not critical, but the pattern is easily improved.
- Fix: Capture the output in the test branch to avoid the double call:
  ```bash
  get_mtime() {
      local result
      if result=$(stat -f %m "$1" 2>/dev/null); then
          echo "$result"
      elif result=$(stat -c %Y "$1" 2>/dev/null); then
          echo "$result"
      else
          echo 0
      fi
  }
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Skimmer escalation boundary is overly strict** - `shared/agents/skimmer.md:141`
**Confidence**: 80%
- Problem: The escalation boundary says "If `npx rskim` fails, report the error (do not attempt manual fallbacks with other tools)." Combined with `tools: ["Bash", "Read"]`, the Skimmer cannot use Grep or Glob even if rskim is unavailable. This is a single point of failure with no graceful degradation -- if the npm registry is down or npx is not installed, the entire orientation phase of `/implement` and `/specify` halts and must be escalated.
- Impact: Reduced resilience. The tool restriction is correct for normal operation (forcing rskim usage), but the complete prohibition on fallback means a transient npm issue blocks the entire workflow. Previous design allowed Grep/Glob as implicit fallbacks.
- Fix: Consider documenting the intentional trade-off in the agent or adding a note for orchestrators about what to do when Skimmer escalates an rskim failure (e.g., spawn an ad-hoc exploration agent with full tools). The tool restriction is architecturally sound; the gap is in the orchestrator's recovery path.

**`sort -V` not universally available** - `scripts/statusline.sh:192`
**Confidence**: 80%
- Problem: The version comparison uses `sort -V` (version sort), which is a GNU coreutils extension. While available on macOS (via Homebrew coreutils or the system `sort` since macOS 10.15+) and most Linux distributions, it is not POSIX and may fail on minimal/older environments (Alpine, BusyBox). The PR specifically addresses portability for `stat` but introduces a new portability assumption with `sort -V`.
- Impact: On systems without `sort -V`, the version comparison would silently produce wrong results (lexicographic sort), potentially showing or hiding the update badge incorrectly. Not critical since the badge is informational only.
- Fix: Either document the GNU sort requirement or use a shell-native version comparison:
  ```bash
  # Simple shell version compare (works everywhere)
  version_lt() {
      [ "$1" = "$2" ] && return 1
      [ "$1" = "$(printf '%s\n%s' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | head -n1)" ]
  }
  ```

## Pre-existing Issues (Not Blocking)

_No critical pre-existing architecture issues detected in the reviewed files._

## Suggestions (Lower Confidence)

- **Filter predicate duplication in init.ts** - `src/cli/commands/init.ts:171,179` (Confidence: 70%) -- The `choices` and `preSelected` filters both enumerate the same set of excluded plugin names (`devflow-core-skills`, `devflow-ambient`) but the `choices` filter now also excludes `devflow-audit-claude` while `preSelected` does not. This is technically correct (audit-claude has `optional: true` so it would not be pre-selected anyway), but the diverging filter conditions are fragile -- a future non-optional plugin that should be hidden would need to be added to both filters independently. Consider extracting a `isUserSelectablePlugin()` predicate.

- **Background subprocess lifetime** - `scripts/statusline.sh:208-215` (Confidence: 65%) -- The `npm view` background subprocess is `disown`-ed but has no timeout. If npm hangs (network timeout defaults to 30s+), the orphaned process persists. Consider adding a timeout: `timeout 10 npm view devflow-kit version 2>/dev/null`.

- **No validation of cached version string** - `scripts/statusline.sh:186` (Confidence: 62%) -- The version cache file is read with `cat` and used directly in string comparison and `sort -V`. If the file is corrupted or contains unexpected content (e.g., npm error message written by a failed previous run), the badge logic could produce odd output. A semver regex check before comparison would add resilience.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The PR is well-structured housekeeping that addresses real issues (skimmer tool enforcement, portability, UX polish). The Skimmer rewrite is a clear improvement -- adding platform-level tool restrictions via the `tools` frontmatter is architecturally superior to prompt-level prohibitions, and the agent-design docs are updated to codify this pattern. The version notification feature is cleanly isolated with good async/cache design.

The two HIGH findings are both consistency issues within the PR's own changes: the Skimmer agent growing beyond its Utility-agent line budget, and stale "skim" references in diagram comments that the PR already partially updated. Both are straightforward to address before merge.
