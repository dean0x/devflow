# Performance Review Report

**Branch**: feat/research-release-workflows -> main
**Date**: 2026-05-09

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Research orchestration spawns up to 5 Opus-model Researcher agents in parallel without token budget controls** - `shared/skills/research:orch/SKILL.md:93`, `shared/agents/researcher.md:2-4`, `plugins/devflow-research/commands/research.md:73`
**Confidence**: 85%
- Problem: The research:orch Phase 4 spawns 2-5 `Agent(subagent_type="Researcher")` in a single message, where each Researcher uses `model: opus` (the most expensive model tier). With up to 5 Opus agents running in parallel -- each loading a domain-specific skill, executing a 6-step methodology, performing WebSearch/WebFetch calls, and producing 4K-8K token outputs -- this creates significant cost and latency pressure. The Researcher agent's token budget guidance (`researcher.md:107-109`) says "Target output: ~4K-8K tokens" but places no cap on input consumption. For comparison, the existing `/code-review` pipeline spawns 7-11 reviewer agents but each uses the same model tier (Opus) and is bounded by the diff size. Research agents with web access have unbounded input.
- Fix: Consider using `model: sonnet` for the Researcher agent (aligning with execution-tier agents like Coder, Simplifier, Resolver), or add an explicit input token budget / max-fetch limit in the Researcher agent contract. The research-external and research-technology skills already cap fetches (5 max), which helps, but the agent itself has no aggregate cap across skill + Read + WebFetch operations.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**research-teams.md cross-validation adds 2 extra Agent Teams rounds on top of 5 parallel researchers** - `plugins/devflow-research/commands/research-teams.md:107-131`
**Confidence**: 82%
- Problem: The teams variant of `/research` spawns researcher teammates, then runs up to 2 cross-validation broadcast rounds (Phase 6-7) before convergence. With 5 teammates, each cross-validation round means each teammate reads all other teammates' findings and sends validation messages. This is 5 * (5-1) = 20 message exchanges per round, up to 40 total for 2 rounds, on top of the initial parallel investigation. While cross-validation improves quality, the bounded "max 2 exchange rounds" is good discipline -- but there is no guidance on what happens if a teammate's response to cross-validation is itself very large (each teammate could send multi-KB findings summaries to every other teammate).
- Fix: Add a guidance note in the cross-validation broadcast to keep validation messages concise (e.g., "Limit cross-validation responses to key findings only, not full reports -- reference finding numbers from your initial report"). The research.md (non-teams) variant avoids this entirely by skipping cross-validation, which is the correct performance tradeoff for the base command.

**release-teams.md spawns Agent Teams for a 2-agent debate that could be done inline** - `plugins/devflow-release/commands/release-teams.md:59-101`
**Confidence**: 80%
- Problem: The teams variant creates a full Agent Teams session with version-analyst and changelog-analyst for a release strategy debate. Agent Teams has overhead: team creation, message passing infrastructure, shutdown protocol, and TeamDelete. For only 2 teammates doing a relatively narrow analysis (version bump + changelog scope), the teams overhead may exceed the value of the debate. The base release.md handles this without teams, performing the analysis inline, which is likely faster for most releases.
- Fix: This is a design choice (teams variant exists for users who want debate), so no code change needed. However, the teams variant could note in its description that it is recommended for major releases where version bump rationale is ambiguous, not for routine patch releases -- guiding users toward the more performant base variant for simple cases.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**devflow-ambient plugin's skills array grows with every new orchestration skill** - `src/cli/plugins.ts:121-149`
**Confidence**: 82%
- Problem: The ambient plugin now lists 9 orchestration skills + 12 pattern skills + 6 other skills = 27 skills total in its `skills` array. Each skill is installed to `~/.claude/skills/devflow:{name}/`, and at session start the ambient hook reads classification rules. While skill installation is a one-time build cost and skills are only loaded on-demand via Skill tool invocation (not at session start), the growing list increases `devflow init` time linearly. With 27 skills to copy, the build/install step for the ambient plugin does more I/O than other plugins.
- Fix: This is expected growth -- the ambient plugin is the catch-all for ambient mode. No change needed unless install time becomes noticeable. The on-demand loading architecture (skills loaded only when classified as GUIDED/ORCHESTRATED) already prevents runtime performance impact.

## Suggestions (Lower Confidence)

- **Sequential Phase 2 detection in release:orch reads up to 20 files** - `shared/skills/release:orch/SKILL.md:59-80` (Confidence: 70%) -- The tiered codebase scan for release process detection reads up to 20 files sequentially across 3 tiers. For first-run only, this is acceptable, but could be faster with parallel reads within each tier. The "Max 20 files" cap is good discipline.

- **Researcher agent loads skill dynamically via Skill tool on every invocation** - `shared/agents/researcher.md:47-55` (Confidence: 65%) -- Each Researcher agent calls `Skill(skill="devflow:research-{RESEARCH_TYPE}")` at the start of its execution. Since skills are already installed as markdown files, this is just a file read, but it adds one tool call per researcher. With 5 researchers, that is 5 Skill tool calls. This is negligible overhead compared to the actual research work.

- **research:orch GUIDED mode spawns 1-2 Researcher agents but also loads research:orch skill** - `shared/skills/research:orch/SKILL.md:22-30` (Confidence: 62%) -- For GUIDED depth, the main session loads research:orch then spawns 1-2 Researchers. The orch skill is ~205 lines -- loading it for GUIDED mode where only the first 10 lines of GUIDED behavior are relevant adds unnecessary context. However, this follows the established pattern for all other orch skills (explore:orch, debug:orch all have GUIDED sections).

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 1 | 0 |

**Performance Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The primary performance concern is the Researcher agent using `model: opus` with up to 5 parallel instances and unbounded web input. The architecture is sound -- parallel researchers with bounded cross-validation rounds, lazy config detection for releases, and good caps on file reads and web fetches in individual skills. The "learn once, reuse always" pattern in release:orch eliminates repeated detection overhead after first run. Token budget guidance exists in the Researcher agent but only for output, not input consumption. The cost implications of 5 concurrent Opus agents with web access warrant consideration for the model tier assignment.
