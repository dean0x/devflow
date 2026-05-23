# Testing Review Report

**Branch**: feat/bug-analysis -> main
**Date**: 2026-05-23

## Issues in Your Changes (BLOCKING)

### HIGH

**No tests for the new `devflow-bug-analysis` plugin registration** - `src/cli/plugins.ts:127-134`
**Confidence**: 95%
- Problem: A new plugin `devflow-bug-analysis` was added to the `DEVFLOW_PLUGINS` array with agents (`git`, `bug-analyzer`, `synthesizer`), skills (`agent-teams`, `worktree-support`, `apply-feature-knowledge`), and a `/bug-analysis` command. The existing test suite at `tests/plugins.test.ts` validates plugin integrity (duplicate names, required fields, optional flags, agent/skill cross-references) but no test was added to verify the new plugin's registration or its specific contract. The `build.test.ts` suite will passively exercise the new plugin through its generic integrity checks (e.g., "every plugin has a `.claude-plugin/plugin.json`", "every shared agent referenced in plugins exists"), but there are no targeted tests asserting that `devflow-bug-analysis` declares the correct agents, skills, and commands.
- Fix: Add a test block in `tests/plugins.test.ts` (following the pattern of `devflow-implement declares evaluator and tester agents and qa skill` at line 222) that validates:
  ```typescript
  it('devflow-bug-analysis declares bug-analyzer agent and correct skills', () => {
    const bugAnalysis = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-bug-analysis');
    expect(bugAnalysis).toBeDefined();
    expect(bugAnalysis!.agents).toContain('bug-analyzer');
    expect(bugAnalysis!.agents).toContain('synthesizer');
    expect(bugAnalysis!.agents).toContain('git');
    expect(bugAnalysis!.commands).toContain('/bug-analysis');
    expect(bugAnalysis!.skills).toContain('agent-teams');
    expect(bugAnalysis!.skills).toContain('worktree-support');
    expect(bugAnalysis!.skills).toContain('apply-feature-knowledge');
  });
  ```

**No structural tests for `bug-analysis.md` command or `bug-analyzer.md` agent** - `plugins/devflow-bug-analysis/commands/bug-analysis.md`, `shared/agents/bug-analyzer.md`
**Confidence**: 92%
- Problem: The project has an established pattern of structural tests that verify critical markdown contracts remain intact (see `tests/review/convergence-detection.test.ts` which validates section ordering, containment markers, and cross-surface consistency for the review pipeline; and `tests/resolve/decisions-citation.test.ts` which validates DECISIONS_CONTEXT plumbing across resolve surfaces). The new `bug-analysis.md` command (317 lines) and `bug-analyzer.md` agent (192 lines) introduce significant orchestration contracts — 7 phases with Produces/Requires annotations, incremental detection via `.last-analysis-head`, tiered static analysis, and /resolve compatibility — but no structural tests validate these contracts. Key behaviors that should be pinned: (1) phase ordering, (2) the BugAnalyzer agent receiving `DECISIONS_CONTEXT` and `FEATURE_KNOWLEDGE`, (3) the `--full` and `--no-static` flag documentation, (4) the 4 focus area declarations, and (5) self-verification mandate in the agent.
- Fix: Create `tests/bug-analysis/` directory with structural tests following the convergence-detection pattern. Example:
  ```typescript
  // tests/bug-analysis/command-structure.test.ts
  import { describe, it, expect } from 'vitest';
  import { loadFile, extractSection } from '../helpers';

  describe('bug-analysis.md — phase structure', () => {
    const content = loadFile('plugins/devflow-bug-analysis/commands/bug-analysis.md');

    it('has all 7 phases in order', () => {
      const phases = ['Phase 1:', 'Phase 2:', 'Phase 3:', 'Phase 4:', 'Phase 5:', 'Phase 6:', 'Phase 7:'];
      let lastIdx = -1;
      for (const phase of phases) {
        const idx = content.indexOf(phase);
        expect(idx, `${phase} should exist`).not.toBe(-1);
        expect(idx, `${phase} should come after previous phase`).toBeGreaterThan(lastIdx);
        lastIdx = idx;
      }
    });

    it('Phase 5 passes DECISIONS_CONTEXT to BugAnalyzer agents', () => {
      const phase5 = extractSection(content, '### Phase 5:', '### Phase 6:');
      expect(phase5).toContain('DECISIONS_CONTEXT');
    });

    it('documents --full and --no-static flags', () => {
      expect(content).toContain('--full');
      expect(content).toContain('--no-static');
    });
  });

  describe('bug-analyzer.md — agent contract', () => {
    const content = loadFile('shared/agents/bug-analyzer.md');

    it('declares all 4 focus areas', () => {
      for (const focus of ['security', 'functional', 'integration', 'usability']) {
        expect(content).toContain(`\`${focus}\``);
      }
    });

    it('has self-verification step', () => {
      expect(content).toMatch(/[Ss]elf.[Vv]erif/);
    });

    it('references DECISIONS_CONTEXT in input section', () => {
      const input = extractSection(content, '## Input', '## Focus Areas');
      expect(input).toContain('DECISIONS_CONTEXT');
    });
  });
  ```

**No structural tests for /resolve bug-analysis fallback** - `plugins/devflow-resolve/commands/resolve.md:75-81`, `shared/skills/resolve:orch/SKILL.md:33-39`
**Confidence**: 90%
- Problem: The /resolve command and resolve:orch skill were modified to add a bug-analysis fallback path (Step 0c-5b in resolve.md, Phase 1 in resolve:orch). This is a behavioral change to an existing workflow — when no qualifying review directory is found, /resolve now falls back to `.devflow/docs/bug-analysis/{branch-slug}/`. The existing `tests/resolve/decisions-citation.test.ts` validates resolve structural contracts but was not updated to cover the new fallback. If someone accidentally removes the fallback, no test would catch the regression.
- Fix: Add tests to `tests/resolve/decisions-citation.test.ts` (or a new file `tests/resolve/bug-analysis-fallback.test.ts`) that verify:
  ```typescript
  describe('resolve.md — bug-analysis fallback', () => {
    const content = loadFile('plugins/devflow-resolve/commands/resolve.md');

    it('documents bug-analysis fallback in Step 0c', () => {
      expect(content).toContain('bug-analysis fallback');
    });

    it('fallback checks .devflow/docs/bug-analysis/ directory', () => {
      expect(content).toContain('.devflow/docs/bug-analysis/');
    });

    it('suggests /bug-analysis in no-reviews error message', () => {
      expect(content).toContain('/bug-analysis');
    });
  });

  describe('resolve:orch SKILL.md — bug-analysis fallback parity', () => {
    const content = loadFile('shared/skills/resolve:orch/SKILL.md');

    it('fallback checks bug-analysis directory', () => {
      expect(content).toContain('bug-analysis');
    });

    it('error message suggests /bug-analysis', () => {
      expect(content).toContain('/bug-analysis');
    });
  });
  ```

### MEDIUM

**No cross-surface consistency tests for synthesizer bug-analysis mode** - `shared/agents/synthesizer.md:134-206`
**Confidence**: 85%
- Problem: The synthesizer received a new `bug-analysis` mode with specific output format requirements (risk assessment, bug summary table, acceptance criteria status, action plan). The project has established a pattern where new synthesizer modes are covered by cross-cutting tests (see convergence-detection tests for review mode). No test validates that the bug-analysis mode section exists, declares the correct input fields (ANALYSIS_BASE_DIR, BRANCH, TIMESTAMP), or produces the required output format.
- Fix: Add a test that validates the synthesizer bug-analysis mode contract:
  ```typescript
  describe('synthesizer.md — bug-analysis mode', () => {
    const content = loadFile('shared/agents/synthesizer.md');

    it('declares bug-analysis in mode list', () => {
      expect(content).toContain('bug-analysis');
    });

    it('has Mode: Bug Analysis section', () => {
      expect(content).toContain('## Mode: Bug Analysis');
    });

    it('bug-analysis mode requires ANALYSIS_BASE_DIR input', () => {
      const bugMode = extractSection(content, '## Mode: Bug Analysis', '## Mode: Design');
      expect(bugMode).toContain('ANALYSIS_BASE_DIR');
    });
  });
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Existing plugins.test.ts `PluginDefinition` mock is missing `rules` field** - `tests/plugins.test.ts:66-78`
**Confidence**: 82%
- Problem: The test fixture at line 66 creates a `PluginDefinition` without the `rules` field (`{ name: 'test-plugin', description: 'Test', commands: [], agents: ['agent-a'], skills: ['skill-a', 'skill-b'] }`). The `PluginDefinition` interface requires a `rules: string[]` field. TypeScript compilation would catch this if strict checks are enforced, but the test currently works due to the test file importing `type PluginDefinition` and the field having no default. While this is pre-existing, it was not updated alongside the new plugin addition that correctly includes `rules: []`.
- Fix: Add `rules: []` to the test fixture:
  ```typescript
  const single: PluginDefinition[] = [{
    name: 'test-plugin',
    description: 'Test',
    commands: [],
    agents: ['agent-a'],
    skills: ['skill-a', 'skill-b'],
    rules: [],
  }];
  ```

## Pre-existing Issues (Not Blocking)

(No CRITICAL pre-existing issues found.)

## Suggestions (Lower Confidence)

- **Property-based testing for incremental SHA detection** - `plugins/devflow-bug-analysis/commands/bug-analysis.md:49-59` (Confidence: 65%) — The incremental detection logic (SHA validation via `git cat-file -t`, same-HEAD detection, fallback to full diff) has 4 branches that could benefit from boundary testing. However, since this is a markdown orchestration spec (not executable code), structural tests are the appropriate validation level.

- **Missing `bug-analyzer` in devflow-ambient agents list** - `src/cli/plugins.ts:139` (Confidence: 70%) — The `devflow-ambient` plugin declares all shared agents for orchestration but does not include `bug-analyzer`. If ambient mode ever routes to bug-analysis (e.g., via a future intent classification), the agent would not be available. However, ambient currently has no bug-analysis intent path, so this is speculative.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 3/10
**Recommendation**: CHANGES_REQUESTED

The PR introduces a substantial new plugin (`devflow-bug-analysis`) with a new agent, a new synthesizer mode, and modifications to the /resolve fallback path, but ships zero test coverage. The project has an established and thorough structural testing pattern (see `tests/review/convergence-detection.test.ts`, `tests/resolve/decisions-citation.test.ts`, `tests/build.test.ts`, `tests/plugins.test.ts`) that pins markdown contracts and cross-surface consistency. This PR should follow those patterns by adding (1) plugin registration tests for `devflow-bug-analysis`, (2) structural tests for the command and agent contracts, (3) fallback tests for the /resolve modification, and (4) synthesizer mode coverage. The existing generic build tests will catch file-existence issues but not behavioral contracts.
