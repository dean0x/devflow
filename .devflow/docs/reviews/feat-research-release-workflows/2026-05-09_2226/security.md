# Security Review Report

**Branch**: feat/research-release-workflows -> main
**Date**: 2026-05-09

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**release:orch Build & Test comment says "expressed as intent fields, not raw shell" but surrounding context is ambiguous** - `shared/skills/release:orch/SKILL.md:117`
**Confidence**: 82%
- Problem: The RELEASE-FLOW.md config schema in Phase 3 includes a `## Build & Test` section with the comment `{Commands: npm run build, npm test, etc. -- expressed as intent fields, not raw shell}`. This phrasing is contradictory: it says "Commands" followed by shell-like examples (`npm run build, npm test`), then clarifies "intent fields, not raw shell." While the Iron Law (line 13-18) correctly forbids executing shell strings from config, this example text in the schema template could mislead an implementor into storing raw shell commands in RELEASE-FLOW.md despite the intent. The Phase 4 reference to "Build command from RELEASE_CONFIG" and "Test command from RELEASE_CONFIG" (lines 157-158) further blurs the distinction between intent-mapped operations and raw shell strings.
- Fix: Rewrite the Build & Test section template to use unambiguous intent-field examples:
  ```yaml
  ## Build & Test

  build_tool: npm | cargo | go | python
  test_tool: npm | cargo | go | python
  ```
  Remove shell-like command strings from the template entirely. Update Phase 4 references from "Build command" to "Build intent" and "Test command" to "Test intent."

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Researcher agent dynamic skill name constructed from user-controlled RESEARCH_TYPE without validation** - `shared/agents/researcher.md:52`
**Confidence**: 85%
- Problem: The Researcher agent constructs the skill name to load as `devflow:research-{RESEARCH_TYPE}` (line 52). While the RESEARCH_TYPE comes from the orchestrator (not raw user input), the orchestrator's Phase 2 "infers" research types from the user's prompt. The only enforcement that RESEARCH_TYPE is one of the five allowed values (`codebase | external | market | competitor | technology`) is the Research Types table at line 28-34. There is no explicit validation step in the Researcher agent itself before the Skill tool call. If the orchestrator passes a malformed type, the Skill call would attempt to load `devflow:research-{arbitrary-string}`. This is a defense-in-depth concern -- the Skill tool is sandboxed and would simply fail to find a non-existent skill, so the blast radius is limited to a failed research type (not code execution), but it violates defense-in-depth principles.
- Fix: Add an explicit validation paragraph to the Researcher agent before the Skill call:
  ```markdown
  ### 1. Validate Research Type

  Verify RESEARCH_TYPE is one of: `codebase`, `external`, `market`, `competitor`, `technology`.
  If RESEARCH_TYPE does not match any of these, report an error to the orchestrator and halt.
  Do not attempt to load a skill for an unrecognized type.
  ```

**Web research skills list WebSearch/WebFetch in allowed-tools but no rate limiting or fetch cap enforcement in skill body** - `shared/skills/research-external/SKILL.md:5`, `shared/skills/research-market/SKILL.md:5`, `shared/skills/research-competitor/SKILL.md:5`
**Confidence**: 80%
- Problem: The external, market, and competitor research skills declare `allowed-tools: WebSearch, WebFetch` in frontmatter. While each skill's methodology does cap fetches (e.g., "Maximum 5 fetches total" in research-external line 65, "Run 2-3 WebSearch queries" in research-market line 53), these are purely instructional. There is no enforcement mechanism. A hallucinating or misbehaving agent could exceed these caps, issuing unbounded web fetches. This is a denial-of-cost risk (excessive API calls to web search/fetch), not a code execution risk.
- Fix: Add an explicit anti-pattern row to each web research skill:
  ```markdown
  | Exceeding 5 total fetches | Hard stop at 5 WebFetch calls — report what you have |
  ```
  This makes the cap an explicit anti-pattern rather than just a methodology suggestion. (True enforcement requires tool-call counting at the harness level, which is beyond the scope of this skill change.)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**release command's Phase 2 detection reads `.github/workflows/*.yml` which could contain sensitive env var references** - `shared/skills/release:orch/SKILL.md:67`
**Confidence**: 80%
- Problem: Phase 2 instructs the agent to read `.github/workflows/*.yml` looking for release/publish/deploy jobs. CI workflow files routinely contain `${{ secrets.NPM_TOKEN }}`, `${{ secrets.GITHUB_TOKEN }}`, and similar references. While these are template references (not actual secrets), reading and potentially reproducing them in RELEASE-FLOW.md or research outputs could leak internal secret naming conventions. The skill does exclude `.env*` and `*secret*` files (line 79) but does not instruct the agent to redact or ignore `${{ secrets.* }}` patterns found in workflow files.
- Fix: Add a redaction instruction to Phase 2:
  ```markdown
  When reading workflow files, ignore `${{ secrets.* }}` and `${{ vars.* }}` template references.
  Do not reproduce secret names in RELEASE-FLOW.md or any output.
  ```

## Suggestions (Lower Confidence)

- **RELEASE-FLOW.md is a writable config that affects release behavior** - `shared/skills/release:orch/SKILL.md:50-51` (Confidence: 70%) -- An attacker with write access to `.release/RELEASE-FLOW.md` could manipulate version strategy, tag format, or publish targets. The Iron Law prevents raw shell execution, but config-level manipulation (e.g., changing `tag_format` to create misleading tags, or changing `publish.target` to redirect artifacts) is still possible. Consider documenting that RELEASE-FLOW.md should be committed to version control and reviewed in PRs.

- **research-technology skill mixes trusted (Read) and untrusted (WebSearch/WebFetch) tools without explicit boundary enforcement** - `shared/skills/research-technology/SKILL.md:6` (Confidence: 65%) -- The `allowed-tools: WebSearch, WebFetch, Read` declaration and "mixed" trust tier are correctly labeled, but the methodology does not enforce which tools are used for which trust-tier claims. A finding sourced from Read (local code) should be labeled trusted; a finding from WebFetch should be labeled untrusted. The methodology says "keep trust boundaries explicit" but does not mandate per-finding tool attribution.

- **Progress checkpoint `.release/.progress.json` has no integrity protection** - `shared/skills/release:orch/SKILL.md:161-164` (Confidence: 62%) -- The progress file is used to resume interrupted releases. A tampered progress file could cause the release pipeline to skip phases (e.g., setting `"phase": 6` to skip pre-release checks). The file is gitignored and transient, limiting exposure, but adding a simple hash or structure validation on read would provide defense-in-depth.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Security Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The PR demonstrates strong security awareness overall. The release:orch Iron Law explicitly addresses the most dangerous attack vector (arbitrary shell execution from config). The Researcher agent has a dedicated Security Rules section with prompt injection detection. All web research skills correctly implement untrusted-data discipline with security protocols.

The single blocking HIGH issue is about ambiguous config schema language in release:orch that could lead implementors to store raw shell commands despite the Iron Law prohibition. The should-fix issues are defense-in-depth improvements (input validation, rate-limit enforcement). Pre-existing and suggestion items are informational improvements for the release config trust model.

Note on decisions: The `LEGACY_SKILL_NAMES` additions for the new research and release skills (lines 436-443 of `src/cli/plugins.ts`) and the removal of `['search-first', 'research']` from `SHADOW_RENAMES` follow the project's clean-break philosophy (applies ADR-001, avoids PF-001) -- these are new skills being registered for cleanup of pre-namespace bare names, not backward-compat shims for a rename.
