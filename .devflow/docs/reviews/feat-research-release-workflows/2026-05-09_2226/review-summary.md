# Code Review Summary

**Branch**: feat/research-release-workflows -> main
**Date**: 2026-05-09_2226

## Merge Recommendation: CHANGES_REQUESTED

The PR introduces two well-structured new workflows (research and release) with strong architectural patterns, clear orchestration phases, and security-aware design. However, there are **7 blocking issues** across security, architecture, testing, consistency, and documentation that must be resolved before merge. The most critical are: (1) ambiguous release:orch config schema language that could mislead implementors despite a strong Iron Law, (2) architecture violation in RESEARCH routing at GUIDED depth, and (3) missing test coverage for both new intents. Secondary blocking issues include missing documentation updates, version mismatch, and missing legacy skill cleanup entries.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Blocking | 0 | 7 | 2 | 0 | 9 |
| Should Fix | 0 | 0 | 8 | 0 | 8 |
| Pre-existing | 0 | 0 | 3 | 1 | 4 |

---

## Blocking Issues (Must Fix Before Merge)

### CRITICAL
(none)

### HIGH

**1. release:orch Build & Test schema comment is contradictory (ambiguous safety guidance)** 
- **File**: `shared/skills/release:orch/SKILL.md:117`
- **Confidence**: 82%
- **Issue**: The RELEASE-FLOW.md config schema template includes a comment `{Commands: npm run build, npm test, etc. -- expressed as intent fields, not raw shell}`. This phrasing contradicts itself: it shows shell-like command strings (`npm run build, npm test`) then clarifies "intent fields, not raw shell." Despite the Iron Law correctly prohibiting shell execution, the schema example text could mislead implementors into storing raw commands. Phase 4 references ("Build command from RELEASE_CONFIG", "Test command from RELEASE_CONFIG") further blur the distinction.
- **Impact**: If an implementor misinterprets the schema, they could store raw shell strings in RELEASE-FLOW.md, creating a security risk that the Iron Law is supposed to prevent. Defense-in-depth principle violated.
- **Fix**: Rewrite the Build & Test section template with unambiguous intent-field examples:
  ```yaml
  ## Build & Test
  
  build_tool: npm | cargo | go | python
  test_tool: npm | cargo | go | python
  ```
  Remove all shell-like command strings from the template. Update Phase 4 references from "Build command" to "Build intent" and "Test command" to "Test intent."

**2. Research:orch loaded at GUIDED depth breaks router convention**
- **File**: `shared/skills/router/SKILL.md:35`
- **Confidence**: 85%
- **Issue**: The router GUIDED table loads `devflow:research:orch` (an orchestration skill) for RESEARCH intent. Every other GUIDED entry loads domain/knowledge skills (test-driven-development, patterns, git). EXPLORE also has GUIDED behavior but the router shows `--` and defers to EXPLORE's orch skill GUIDED instructions. RESEARCH conflates GUIDED and ORCHESTRATED tiers, making the classification decision less meaningful.
- **Impact**: Inconsistent classification architecture. If the GUIDED tier is supposed to be "quick domain patterns" vs ORCHESTRATED "full agent spawning," then RESEARCH's routing is structurally wrong.
- **Fix**: Either (a) extract the 4-step GUIDED behavior inline into the router like EXPLORE does, then set GUIDED row to `--` or domain skills, or (b) explicitly document in the router that RESEARCH is a special case where the orch skill also serves GUIDED depth.

**3. release:orch missing Phase 1 Decisions loading**
- **File**: `shared/skills/release:orch/SKILL.md`
- **Confidence**: 82%
- **Issue**: All other ORCHESTRATED pipelines (implement:orch, debug:orch, plan:orch, review:orch, resolve:orch, research:orch, explore:orch) have a "Phase 1: Load Decisions" step. release:orch starts with "Phase 1: Load Config" and never loads DECISIONS_CONTEXT or FEATURE_KNOWLEDGE. This means release decisions cannot leverage project-specific ADRs (e.g., "applies ADR-001 clean break philosophy") that could inform version bump strategy or changelog entries.
- **Impact**: Architectural inconsistency. Release workflow is blind to project architectural decisions and pitfall history.
- **Fix**: Add a "Phase 0: Load Decisions" step (or prepend to Phase 1) following the standard pattern, passing DECISIONS_CONTEXT to relevant sub-phases.

**4. Missing RESEARCH and RELEASE intents in ambient test intent count**
- **File**: `tests/ambient.test.ts:659`
- **Confidence**: 95%
- **Issue**: The preamble drift test has a comment "Must contain all 8 intents" but classification-rules.md now defines 10 intents (RESEARCH and RELEASE added). More critically, the test only asserts the original 8 intents without checking for RESEARCH or RELEASE. Accidental removal of either intent would go undetected.
- **Impact**: Test regression barrier missing. Safety net has a hole.
- **Fix**: Update comment to "Must contain all 10 intents" and add assertions:
  ```typescript
  expect(rulesContent).toContain('RESEARCH');
  expect(rulesContent).toContain('RELEASE');
  ```

**5. Integration test alignment regex excludes RESEARCH and RELEASE intents**
- **File**: `tests/ambient.test.ts:605`
- **Confidence**: 95%
- **Issue**: The `classMatch` regex uses `(IMPLEMENT|EXPLORE|DEBUG|PLAN|REVIEW|RESOLVE|PIPELINE)` which silently skips any integration test named with RESEARCH or RELEASE intent. If RESEARCH/RELEASE integration tests are added later, their expected skills won't be cross-checked against the router table.
- **Impact**: Safety net is structurally incomplete for new intents. Integration tests will fail to validate the new intents.
- **Fix**: Update regex to include RESEARCH and RELEASE:
  ```typescript
  const classMatch = name.match(/(IMPLEMENT|EXPLORE|DEBUG|PLAN|REVIEW|RESOLVE|PIPELINE|RESEARCH|RELEASE)\/(GUIDED|ORCHESTRATED)/);
  ```

**6. No integration tests for RESEARCH or RELEASE ambient classification**
- **File**: `tests/integration/ambient-activation.test.ts`
- **Confidence**: 90%
- **Issue**: Ambient-activation test file covers GUIDED and ORCHESTRATED for all existing intents except the new RESEARCH and RELEASE. Zero test coverage for "research how competitor X handles caching" or "cut a release" classification.
- **Impact**: Classification regression for new intents would go undetected.
- **Fix**: Add integration tests for RESEARCH/ORCHESTRATED and RELEASE/ORCHESTRATED as specified in the testing report.

**7. Plugin version mismatch: new plugins use "2.0.0" vs all existing use "1.8.3"**
- **File**: `plugins/devflow-research/.claude-plugin/plugin.json:8`, `plugins/devflow-release/.claude-plugin/plugin.json:8`
- **Confidence**: 95%
- **Issue**: All 18 existing plugins use `"version": "1.8.3"`. The two new plugins use `"version": "2.0.0"`. This breaks the convention that all plugins share a synchronized version.
- **Impact**: Build system inconsistency. Install script and update logic may misinterpret version boundaries.
- **Fix**: Change both new plugins to `"1.8.3"`, or bump all plugins together if a major version is intended.

---

## Should Fix Issues (Recommended Before Merge)

### HIGH
(none)

### MEDIUM

**1. Old devflow:research skill removed without replacement for Coder-level enforcement**
- **Files**: `shared/skills/research/SKILL.md` (deleted), `shared/agents/coder.md:11` (reference removed)
- **Confidence**: 82%
- **Issue**: The old `devflow:research` skill (Tier 2, "research before building" enforcement) was deleted and replaced by 5 specialized research-type skills for Researcher agents — entirely different purpose. The old skill enforced that Coders research packages before writing utility code. No replacement was created. Coder agents now lack this enforcement.
- **Impact**: Functional loss. Coders will no longer be reminded to check for existing packages before implementing date parsing, HTTP wrappers, CLI tooling, etc.
- **Fix**: Either create a lightweight `research-before-building/SKILL.md` skill for Coder-level enforcement, or document this as an intentional removal if the new research workflow subsumes the use case.

**2. Researcher agent dynamic skill name constructed without validation**
- **File**: `shared/agents/researcher.md:52`
- **Confidence**: 85%
- **Issue**: Researcher constructs skill name as `devflow:research-{RESEARCH_TYPE}`. While RESEARCH_TYPE comes from the orchestrator, there is no explicit validation step in the Researcher agent before the Skill tool call that RESEARCH_TYPE is one of the five allowed values (codebase | external | market | competitor | technology). Defense-in-depth principle.
- **Impact**: Low blast radius (Skill tool would fail to find invalid skill, not execute code), but violates defense-in-depth discipline.
- **Fix**: Add explicit validation paragraph before Skill call:
  ```markdown
  ### 1. Validate Research Type
  
  Verify RESEARCH_TYPE is one of: `codebase`, `external`, `market`, `competitor`, `technology`.
  If RESEARCH_TYPE does not match, report error and halt.
  ```

**3. Web research skills declare fetch caps only as methodology, not enforcement**
- **Files**: `shared/skills/research-external/SKILL.md:5`, `shared/skills/research-market/SKILL.md:5`, `shared/skills/research-competitor/SKILL.md:5`
- **Confidence**: 80%
- **Issue**: External, market, and competitor research skills declare `allowed-tools: WebSearch, WebFetch` but caps are only instructional ("Maximum 5 fetches total"). A hallucinating agent could exceed these caps, issuing unbounded web fetches (denial-of-cost risk).
- **Impact**: Cost control exposed to agent behavior. No hard limit enforcement.
- **Fix**: Add explicit anti-pattern row to each skill:
  ```markdown
  | Exceeding 5 total fetches | Hard stop at 5 WebFetch calls — report what you have |
  ```

**4. docs-framework Agent Persistence table missing Researcher and Synthesizer (research mode)**
- **File**: `shared/skills/docs-framework/SKILL.md:114-123`
- **Confidence**: 90%
- **Issue**: Directory structure was updated to include `.docs/research/` but the Agent Persistence Rules table (the canonical reference agents use to know WHERE to write) does not include Researcher or Synthesizer (research mode) entries. Incomplete contract.
- **Impact**: Agents lack clear output destination documentation. Cross-reference confusion.
- **Fix**: Add two rows:
  ```markdown
  | Researcher | `.docs/research/{topic-slug}/{timestamp}/{type}.md` | Creates new in timestamped dir |
  | Synthesizer (research) | `.docs/research/{topic-slug}/{timestamp}/research-summary.md` | Creates new in timestamped dir |
  ```

**5. CLAUDE.md Persisting agents line not updated for research outputs**
- **File**: `CLAUDE.md:165`
- **Confidence**: 90%
- **Issue**: Documents Reviewer, Synthesizer (review), Resolver, Working Memory but not Researcher or Synthesizer (research mode), even though they write to disk.
- **Impact**: Canonical CLAUDE.md is out of sync with actual persisting agents.
- **Fix**: Append research outputs to the persisting agents line.

**6. docs-framework File Naming Patterns table missing research artifact types**
- **File**: `shared/skills/docs-framework/SKILL.md:83-91`
- **Confidence**: 88%
- **Issue**: File Naming Patterns table does not include entries for research output files or research-summary.md. Agents use this table for naming guidance.
- **Impact**: Research agents lack canonical naming reference.
- **Fix**: Add rows for `{type}.md` and `research-summary.md` patterns.

**7. skills-architecture.md: 5 new research-type skills missing from tier catalog**
- **File**: `docs/reference/skills-architecture.md:42-67`
- **Confidence**: 92%
- **Issue**: Tier catalog does not list the 5 new research-type skills or `research:orch` / `release:orch`. Old `research` skill was removed but replacements not categorized.
- **Impact**: Documentation gap. Readers cannot find documentation of new skills in the canonical tier reference.
- **Fix**: Add "Tier 1c: Research Skills" subsection with table of 5 skills and their research types. Add orch skills to existing orchestration listings.

**8. Missing `devflow:research` entry in LEGACY_SKILL_NAMES for cleanup**
- **File**: `src/cli/plugins.ts:436`
- **Confidence**: 85%
- **Issue**: New LEGACY_SKILL_NAMES section adds bare names for new skills but does not add `'devflow:research'` to clean up the deleted skill's namespaced install path (`~/.claude/skills/devflow:research/`). The `init.ts` cleanup uses raw strings without prefixing, so stale `devflow:research/` directory persists after upgrade.
- **Impact**: Cleanup incomplete. Old skill namespace pollution.
- **Fix**: Add `'devflow:research'` to the legacy section.

---

## Suggestions (Lower Confidence)

### HIGH CONFIDENCE (80-85%)

**1. Research orchestration spawns up to 5 Opus-model Researcher agents with unbounded web input**
- **Files**: `shared/skills/research:orch/SKILL.md:93`, `shared/agents/researcher.md:2-4`
- **Confidence**: 85%
- **Issue**: Phase 4 spawns 2-5 Opus-model Researchers in parallel, each with web access (WebSearch/WebFetch) and unbounded input consumption. Token budget guidance only covers output (~4K-8K), not input. Cost/latency concern.
- **Fix**: Consider using `model: sonnet` for Researcher agents (aligning with execution-tier agents), or add explicit input token budget in Researcher contract.

**2. docs-framework integration section not mentioning research agents**
- **File**: `shared/skills/docs-framework/SKILL.md:147-153`
- **Confidence**: 82%
- **Issue**: Integration section lists Review agents and Working Memory but not Research agents, even though Researcher and Synthesizer (research mode) now use docs-framework conventions.
- **Fix**: Add bullet for research agents.

**3. Missing subagent-skill-preload test for Researcher agent**
- **File**: `tests/integration/subagent-skill-preload.test.ts`
- **Confidence**: 82%
- **Issue**: Test file covers Simplifier, Scrutinizer, Reviewer, Coder, Designer, Git agents but not Researcher (which preloads worktree-support, apply-decisions, apply-feature-knowledge). Pattern consistency gap.
- **Fix**: Add test case for Researcher agent skill preloads.

**4. Deleted research skill lost Coder-level research enforcement**
- **Files**: `shared/skills/research/SKILL.md` (deleted), `shared/agents/coder.md:11`
- **Confidence**: 85% (same as MEDIUM #1 above, included twice)

### MEDIUM CONFIDENCE (70-79%)

**1. research-teams.md: 12-phase pipeline borderline unmanageable**
- **File**: `plugins/devflow-research/commands/research-teams.md`
- **Confidence**: 85%
- **Issue**: 12 sequential phases (Load Decisions, Requirements, Orient, Spawn Team, Investigation, Cross-Validation, Convergence, Cleanup, Write Findings, Synthesize, Present, Feature Knowledge Creation) exceed cognitive threshold for LLM tracking across context compaction. Base variant has 7 phases. Teams variant nearly doubles by interleaving team lifecycle phases.
- **Fix**: Consolidate adjacent mechanical phases. Target 7-8 top-level phases matching base variant's cognitive load.

**2. release-teams.md: 10-phase pipeline with inconsistent sub-phase numbering**
- **File**: `plugins/devflow-release/commands/release-teams.md`
- **Confidence**: 82%
- **Issue**: 10 phases with Phase 1 containing sub-phases (1a, 1b) — inconsistent with flat phase numbering used everywhere else. Creates 3+ nesting levels conceptually.
- **Fix**: Promote sub-phases to top-level phases and renumber.

**3. devflow-ambient plugin test missing research:orch, release:orch assertions**
- **File**: `tests/plugins.test.ts:203-220`
- **Confidence**: 85%
- **Issue**: Plugin dependency test explicitly asserts review:orch, resolve:orch, pipeline:orch but not the newly added research:orch, release:orch. Creates asymmetry. Accidental removal wouldn't be caught.
- **Fix**: Add assertions for research:orch, release:orch, and researcher agent.

**4. plugin.json files missing orch skill declarations**
- **File**: `plugins/devflow-research/.claude-plugin/plugin.json`, `plugins/devflow-release/.claude-plugin/plugin.json`
- **Confidence**: 82%
- **Issue**: Both new plugins omit their respective orch skills from the skills array (ambient plugin includes them). While universal skill installation means no runtime failure, manifest completeness is violated.
- **Fix**: Add `"research:orch"` and `"release:orch"` to respective plugin.json skills arrays.

**5. Synthesizer agent now has 5 modes (316 lines total)**
- **File**: `shared/agents/synthesizer.md`
- **Confidence**: 80%
- **Issue**: Agent grew from 4 modes to 5 (added research mode), exceeding the 50-150 line target from CLAUDE.md. Each mode is independent; loading all 5 even when using 1 increases context cost.
- **Fix**: This is an established pattern. Next mode addition should trigger extraction of individual mode specs into referenced files, keeping the agent as a dispatcher.

### LOWER CONFIDENCE (60-70%)

**1. Synthesizer research mode trusts HTML trust comments without validation**
- **File**: `shared/agents/synthesizer.md:177`
- **Confidence**: 70%
- **Issue**: Trust-tier parsing relies on `<!-- trust: {tier} -->` comments. A misbehaving researcher could emit wrong tier.
- **Fix**: Validate trust tier against known RESEARCH_TYPE → tier mapping instead of trusting researcher's self-reported label.

**2. research-competitor and research-market skills have methodology overlap**
- **Files**: `shared/skills/research-competitor/SKILL.md`, `shared/skills/research-market/SKILL.md`
- **Confidence**: 65%
- **Issue**: Both skills cover player identification, positioning, landscape mapping with similar Steps 1-4. If both are spawned for same question, findings may be redundant.
- **Fix**: No action (design choice to spawn multiple researchers for triangulation).

**3. release:orch lacks DECISIONS_CONTEXT passthrough to sub-agents**
- **File**: `shared/skills/release:orch/SKILL.md`
- **Confidence**: 72%
- **Issue**: Even if Load Decisions phase were added, current code spawns Validator and Git agents without passing DECISIONS_CONTEXT (unlike implement:orch, resolve:orch).
- **Fix**: Pass DECISIONS_CONTEXT to worker agents where decisions could inform release behavior.

**4. release:orch Phase 2 detection reads .github/workflows/*.yml with potential secret name leakage**
- **File**: `shared/skills/release:orch/SKILL.md:67`
- **Confidence**: 80% (pre-existing, not blocking)
- **Issue**: Workflow files contain `${{ secrets.* }}` and `${{ vars.* }}` template references. Reading them could leak secret naming conventions in RELEASE-FLOW.md or outputs.
- **Fix**: Add redaction instruction to Phase 2 to ignore template references.

**5. Sequential Phase 2 detection in release:orch reads up to 20 files**
- **File**: `shared/skills/release:orch/SKILL.md:59-80`
- **Confidence**: 70%
- **Issue**: Tiered scan reads up to 20 files sequentially. For first-run only, acceptable, but could be faster with parallel reads within tiers. The 20-file cap is good discipline.
- **Fix**: No action needed. Acceptable performance for first-run only.

**6. Base command and teams variants share substantial duplicated phase definitions**
- **Files**: `plugins/devflow-research/commands/research.md`, `plugins/devflow-research/commands/research-teams.md`
- **Confidence**: 80%
- **Issue**: Phases 1-3 and Feature Knowledge logic duplicated. Same for release. Changes require updates in 4 places total.
- **Fix**: This is established pattern in project. Acknowledge as known tradeoff.

**7. LEGACY_SKILL_NAMES list is 163 entries and growing**
- **File**: `src/cli/plugins.ts:259-444`
- **Confidence**: 80%
- **Issue**: Array grows monotonically, now 186 lines. Will pass 200 within few releases. Maintenance burden increases.
- **Fix**: Consider periodic prune pass to remove v1.x era entries, or extract to separate data file. Neither blocking.

**8. SHADOW_RENAMES removal leaves orphan directories on existing installs**
- **File**: `src/cli/plugins.ts:484`
- **Confidence**: 80%
- **Issue**: Removal of `['search-first', 'research']` means users with shadow overrides at `~/.devflow/skills/research/` will have orphaned custom files. Consistent with ADR-001 clean-break philosophy but silent degradation.
- **Fix**: Document in release notes that old `research` skill overrides will no longer apply.

---

## Summary by Reviewer Focus

| Focus | Score | Key Findings |
|-------|-------|--------------|
| **Security** | 8/10 | Strong overall; one HIGH config schema ambiguity, two MEDIUM defense-in-depth improvements needed (input validation, fetch caps), pre-existing secret name leakage concern |
| **Architecture** | 7/10 | Two HIGH blocking issues (GUIDED routing violation, missing decisions loading); solid orchestration patterns; loss of implementation-time research enforcement |
| **Performance** | 7/10 | One HIGH: Opus agents with unbounded web input; good architectural discipline overall; teams cross-validation has good bounds |
| **Complexity** | 6/10 | Two HIGH: teams variants have 12 and 10 phases (high cognitive load); duplication between command/orch files; LEGACY_SKILL_NAMES growing |
| **Consistency** | 8/10 | One HIGH version mismatch; two MEDIUM documentation gaps; otherwise strong pattern adherence |
| **Regression** | 7/10 | One HIGH: lost implementation-time research enforcement; one MEDIUM: SHADOW_RENAMES orphan issue; missing integration tests |
| **Testing** | 4/10 | Three HIGH: missing intent count assertions, broken regex, zero integration tests for new intents; two MEDIUM: missing plugin assertions, missing agent preload tests |
| **TypeScript** | 8/10 | One HIGH: missing `devflow:research` in LEGACY_SKILL_NAMES; otherwise sound |
| **Documentation** | 6/10 | Four MEDIUM blocking: persistence table, file naming patterns, tier catalog, persisting agents line all incomplete; one MEDIUM should-fix: Synthesizer integration section |

---

## Resolution Priority

### Phase 1 (Must Complete)
1. Fix release:orch schema language ambiguity (security)
2. Add RESEARCH to GUIDED routing (architecture consistency)
3. Add Decisions loading to release:orch (architecture consistency)
4. Add test assertions for 10 intents (testing)
5. Fix classMatch regex (testing)
6. Fix plugin version mismatch (consistency)
7. Add `devflow:research` to LEGACY_SKILL_NAMES (cleanup)

### Phase 2 (Strongly Recommended)
1. Replace or document loss of research-before-building enforcement (regression)
2. Add Researcher validation step (security)
3. Add web skill fetch-cap anti-patterns (security)
4. Create RESEARCH/RELEASE integration tests (testing)
5. Update docs-framework persistence table (documentation)
6. Update CLAUDE.md persisting agents (documentation)
7. Update skills-architecture tier catalog (documentation)

### Phase 3 (Nice to Have)
1. Consolidate teams variant phases (complexity)
2. Add plugin dependency assertions (testing)
3. Model tier reconsideration for Researcher (performance)
4. Synthesizer mode extraction plan (complexity tracking)

---

## Key Insights

**Strengths:**
- Clear orchestration pattern adherence (Phase Protocol, Produces/Requires annotations)
- 5 research-type skills cleanly factored with consistent structure
- Strong security-first design philosophy (Iron Law preventing shell execution)
- Trust-aware synthesis for research outputs
- Learned config pattern for release pipeline (learns once, reuses always)

**Structural Concerns:**
- GUIDED/ORCHESTRATED tier boundary blurred for RESEARCH
- Release workflow lacks architectural decision context
- Implementation-time research enforcement removed without replacement
- Teams variants pushing complexity limits (12 and 10 phases)

**Documentation Gaps:**
- Cross-referencing docs (persistence tables, tier catalog, agent rosters) incomplete
- New persisting agents not documented in canonical references
- Pre-existing inconsistencies (EXPLORE GUIDED routing) now have downstream effects

**Quality Gates:**
- Test coverage incomplete for new intents (0 integration tests)
- New agent (Researcher) missing from skill preload tests
- Plugin dependency assertions incomplete

