# Complexity Review Report

**Branch**: fix/v2-knowledge-ship-blockers -> main
**PR**: #182
**Diff**: `git diff bd1c92f...HEAD`
**Date**: 2026-04-15 10:22

---

## Issues in Your Changes (BLOCKING)

### HIGH

**Duplicated path-resolution + file-read scaffolding between `loadKnowledgeIndex` and `loadKnowledgeContext`** — `scripts/hooks/lib/knowledge-context.cjs:156-186` and `scripts/hooks/lib/knowledge-context.cjs:242-263`
**Confidence**: 92%
- Problem: Both functions open with the same 8-line block resolving `decisionsFile` / `pitfallsFile` from `opts` against `worktreePath`. They then both read the two files inside `try { } catch {}` blocks with the same "skip silently if absent" comment. The two functions diverge only in what they do with the parsed content (extract entries vs. filter+concatenate). When a third caller appears (or the file location changes), three call sites must be updated in lockstep.
- Impact: Future drift risk — e.g., adding a third knowledge file, or relocating `.memory/knowledge/` would require synchronized edits in two places. Also doubles the surface for bugs in path resolution.
- Fix: Extract a `resolveKnowledgePaths(worktreePath, opts)` helper returning `{ decisionsFile, pitfallsFile }`, plus a `readFileOrNull(filePath)` returning `string | null`. Both loaders then become ~10 lines each:
  ```js
  function resolveKnowledgePaths(worktreePath, opts = {}) {
    const resolve = (override, ...defaults) => override
      ? path.resolve(worktreePath, override)
      : path.join(worktreePath, ...defaults);
    return {
      decisionsFile: resolve(opts.decisionsFile, '.memory', 'knowledge', 'decisions.md'),
      pitfallsFile:  resolve(opts.pitfallsFile,  '.memory', 'knowledge', 'pitfalls.md'),
    };
  }

  function readFileOrNull(filePath) {
    try { return fs.readFileSync(filePath, 'utf8'); } catch { return null; }
  }
  ```

**Triplicated Deprecated/Superseded status check** — `scripts/hooks/lib/knowledge-context.cjs:55-56`, `scripts/hooks/lib/knowledge-context.cjs:81-82`, plus the implicit pair in `formatAdrLine`/`formatPfLine`
**Confidence**: 95%
- Problem: The exact same predicate
  ```js
  /- \*\*Status\*\*: Deprecated/.test(section) || /- \*\*Status\*\*: Superseded/.test(section)
  ```
  appears verbatim in both `filterKnowledgeContext` (lines 55-56) and `extractIndexEntries` (lines 81-82). The semantically related `knownStatuses = ['Active', 'Deprecated', 'Superseded']` array literal then appears in both `formatAdrLine` (line 124) and `formatPfLine` (line 137). This is the file's central piece of business logic — the "D-A filter" that the module's docstring (line 17) names as its single source of truth — and it's expressed in four different places using two different idioms.
- Impact: Adding a fourth status (e.g., "Draft", "Pending") requires touching four locations with two different code shapes. The risk is that someone updates the regex pair but forgets the `knownStatuses` array (or vice versa) and ships a partial migration.
- Fix: Define module-level constants and a predicate once:
  ```js
  const KNOWN_STATUSES = ['Active', 'Deprecated', 'Superseded'];
  const FILTERED_STATUSES = new Set(['Deprecated', 'Superseded']);

  function extractStatus(section) {
    const m = section.match(/- \*\*Status\*\*: (.+)/);
    return m ? m[1].trim() : null;
  }

  function isFilteredOut(section) {
    return FILTERED_STATUSES.has(extractStatus(section));
  }
  ```
  Then `filterKnowledgeContext`, `extractIndexEntries`, `formatAdrLine`, and `formatPfLine` all call into the same primitives. This eliminates the dual-idiom problem and makes the "D-A filter is the single source of truth" claim true.

**`formatAdrLine` and `formatPfLine` duplicate ~80% of their bodies** — `scripts/hooks/lib/knowledge-context.cjs:122-141`
**Confidence**: 90%
- Problem: The two formatters share five lines of identical logic (truncate title, build status tag from `knownStatuses`) and diverge only in the trailing `areaSuffix`. The `knownStatuses` array literal is allocated on every call inside both functions — minor wart, but indicative of the duplication.
- Impact: Any change to the line format (column widths, separator, status tag style) must be applied to both functions identically. The `[unknown]` fallback logic is doubled.
- Fix: One formatter that takes an optional `area`:
  ```js
  function formatIndexLine(entry) {
    const title  = truncate(entry.title, 60);
    const tag    = KNOWN_STATUSES.includes(entry.status) ? `[${entry.status}]` : '[unknown]';
    const suffix = entry.area ? `  —  ${truncate(entry.area, 80)}` : '';
    return `  ${entry.id}  ${title}  ${tag}${suffix}`;
  }
  ```
  Drop the ADR vs PF distinction at the formatter level — area is `null` for ADRs anyway, so the suffix branch is already a no-op for them.

**CLI dispatch in `knowledge-context.cjs:294-365` is a switch-tower with leaky path heuristic, not a table** — `scripts/hooks/lib/knowledge-context.cjs:294-365`
**Confidence**: 88%
- Problem: The 72-line dispatch block has multiple complexity smells:
  1. **The path-detection heuristic on line 314** is a 4-clause boolean used to disambiguate "bare invocation" from "unknown subcommand":
     ```js
     firstArg.startsWith('/') || firstArg.startsWith('.') ||
     firstArg.startsWith('~') || firstArg.includes('/')
     ```
     This is fragile (a worktree path that happens to be a single non-slashed token like `myproj` would be classified as an unknown subcommand and exit 1) and the rationale is buried in a 3-line code comment rather than a named predicate.
  2. **Three near-identical dispatch arms** (`mode === 'bare'`, `'index'`, `'full'`) each do: emit stderr log, write stdout result, `process.exit(0)`. The `bare` arm uses a different stderr message; the `index` arm has extra entry-counting logic; the `full` arm is the simplest. Same shape, three copies.
  3. **`mode` and `worktreeArg` are set via implicit fall-through**: the third `else if` branch on line 318 calls `usageExit()` and *relies on* `process.exit()` to prevent control from reaching the `if (!worktreeArg)` check below. If `usageExit` ever stopped exiting (e.g., made testable by injecting a fake exit), the next branch would dereference an undefined `worktreeArg` and the path resolver would crash.
  4. **Repeated `KNOWN_SUBCOMMANDS.has(firstArg)` checks** appear on lines 314 and 318 — line 314 already established `firstArg !== 'index' && firstArg !== 'full'` via the prior `if`, so the `!KNOWN_SUBCOMMANDS.has(firstArg)` guard on those lines is redundant.
- Impact: Cyclomatic complexity for the dispatch block is ~7 (one for each branch + the boolean clauses), and the implicit-exit reliance is a quiet correctness bug in waiting. A reader needs to mentally execute three nested `if/else if` chains plus a 4-clause boolean to understand which path runs.
- Fix: Restructure as a table-driven dispatcher with explicit arms:
  ```js
  const HANDLERS = {
    index: (worktree) => {
      const result = loadKnowledgeIndex(worktree);
      if (result !== '(none)') {
        const entries = countIndexEntries(result);
        process.stderr.write(`[knowledge-context] mode=index worktree=${worktree} entries=${entries}\n`);
      }
      return result;
    },
    full:  (worktree) => {
      const result = loadKnowledgeContext(worktree);
      if (result !== '(none)') {
        process.stderr.write(`[knowledge-context] mode=full worktree=${worktree}\n`);
      }
      return result;
    },
  };

  function looksLikePath(arg) {
    return arg.startsWith('/') || arg.startsWith('.') ||
           arg.startsWith('~') || arg.includes('/');
  }

  if (require.main === module) {
    const [first, second] = process.argv.slice(2);
    if (!first) usageExit();

    let mode, worktreeArg;
    if (HANDLERS[first]) {
      mode = first;
      worktreeArg = second;
    } else if (looksLikePath(first)) {
      mode = 'bare';
      worktreeArg = first;
    } else {
      usageExit(); // unknown subcommand
    }
    if (!worktreeArg) usageExit();

    const worktreePath = path.resolve(worktreeArg);
    if (mode === 'bare') {
      process.stderr.write('[knowledge-context] DEPRECATED: ...\n');
      process.stdout.write(loadKnowledgeContext(worktreePath) + '\n');
    } else {
      process.stdout.write(HANDLERS[mode](worktreePath) + '\n');
    }
    process.exit(0);
  }
  ```
  This: (a) names the path heuristic, (b) collapses three exit paths to one, (c) makes the handler set extensible, (d) removes redundant `KNOWN_SUBCOMMANDS.has` checks.

**Prose duplication of the knowledge-loading phase across 8 markdown surfaces** — `plugins/devflow-plan/commands/plan.md:75-81`, `plugins/devflow-plan/commands/plan-teams.md`, `plugins/devflow-resolve/commands/resolve.md`, `plugins/devflow-resolve/commands/resolve-teams.md:65-71`, `plugins/devflow-self-review/commands/self-review.md`, `plugins/devflow-code-review/commands/code-review.md:92-100`, `plugins/devflow-code-review/commands/code-review-teams.md:85-93`, plus `shared/skills/{plan,resolve,review,debug}:orch/SKILL.md`
**Confidence**: 90%
- Problem: All 8 orchestrator surfaces contain a near-verbatim 4-6 line phase that says "run `node scripts/hooks/lib/knowledge-context.cjs index '.'` → produces a compact index (~250 tokens) of active ADR/PF entries → pass `KNOWLEDGE_CONTEXT` to {agents} → agents use `devflow:apply-knowledge` to Read full entry bodies on demand". The minor variations are: (a) cwd vs worktree path argument, (b) which agents receive it, (c) trailing sentence about Deprecated/Superseded already being stripped. The substance is identical.
- Impact: Two failure modes:
  1. **Drift** — when the CLI command name or the apply-knowledge instruction text changes (e.g., adding a `--max-tokens` flag, renaming the skill), 8 files must be updated in lockstep. The `tests/knowledge/command-adoption.test.ts` at lines 19-25 catches the *invocation* drift but not phrasing/explanation drift.
  2. **Skim cost** — every orchestrator file grew a 6-10 line block that says the same thing. Readers learning the system see the same paragraph 8 times.
- Fix: Either:
  - **(Preferred)** Promote the 4-line incantation to a sentence in `devflow:apply-knowledge`'s SKILL.md and have each surface reference it: *"Phase X: Load Knowledge Index — see `~/.claude/skills/devflow:apply-knowledge/SKILL.md` § Loader Invocation."* The skill already exists (added in this PR) and is the natural home for the invocation pattern.
  - **(Lighter touch)** Inline the bash command (which is one line and worth showing) but replace the 3-line "what this does + agents follow apply-knowledge" prose with a single sentence: *"See devflow:apply-knowledge for the consumer contract."*
- The current state takes the worst path: every surface gets the bash + the prose explanation + the apply-knowledge pointer. The code-review-teams.md case is especially bad — the same `KNOWLEDGE_CONTEXT: {knowledge_context or '(none)'}` + `Follow devflow:apply-knowledge to scan the index...` two-line block is repeated 4 times in lines 129/132, 145/148, 161/164, 177/184 across the security/architecture/performance/quality teammate prompts.

### MEDIUM

**`code-review-teams.md` teammate-prompt boilerplate is repeated 4× per file with one-line variation** — `plugins/devflow-code-review/commands/code-review-teams.md:127-191`
**Confidence**: 88%
- Problem: The four core reviewer teammate prompts (security, architecture, performance, quality) share ~10 lines of identical boilerplate per teammate (steps 1, 2, 3, 4, 5, 7, 8, 10), differing only in: skill path on step 1, focus area on step 6, and report filename on step 9. With 4 reviewers, that's ~40 lines of duplication. The PR adds the `KNOWLEDGE_CONTEXT:` line and the new step 3 to all four — exactly the kind of edit the duplication penalises (one logical change × 4 files).
- Impact: Same drift risk as the orchestrator-surface duplication, localised to one file. The pattern will repeat across `plan-teams.md`, `resolve-teams.md`, etc.
- Fix: Extract a "Reviewer Teammate Prompt Template" section (the resolve-teams.md file already does exactly this at lines 123-145, where it factors out a shared template and the per-batch prompts just say "Use Resolver Teammate Prompt Template with BATCH_ISSUES = ..."). Apply the same factoring to code-review-teams.md: define the template once with `{focus}`, `{skill_path}`, `{focus_description}`, `{report_filename}` placeholders, then list the four reviewers as four 4-line entries.

**Test fixtures `ACTIVE_ADR`, `ACTIVE_PF`, `DEPRECATED_ADR`, `SUPERSEDED_PF` should live in `tests/knowledge/helpers.ts`, not be re-declared per test file** — `tests/knowledge/index-generator.test.ts:34-59`
**Confidence**: 85%
- Problem: `tests/knowledge/helpers.ts` exists (added in this PR) but only exports `ROOT`, `loadFile`, and `extractSection` — the things `command-adoption.test.ts` and `apply-knowledge-skill.test.ts` use. Meanwhile `index-generator.test.ts` declares its own `makeTmpWorktree()` helper (lines 21-32) and four large fixture constants (`ACTIVE_ADR`, `ACTIVE_PF`, `DEPRECATED_ADR`, `SUPERSEDED_PF`) that any future knowledge-related test will want to reuse. The mixed canonical fixture pattern (`## ADR-001: ... \n\n- **Status**: Active\n- **Decision**: ...`) is exactly the kind of detail that should live once.
- Impact: When the `decisions.md`/`pitfalls.md` schema evolves (e.g., a required `Date` field), each test file's local fixtures drift independently. Future test files that want a "valid active ADR" will copy-paste the literal from `index-generator.test.ts`.
- Fix: Move `makeTmpWorktree`, `ACTIVE_ADR`, `ACTIVE_PF`, `DEPRECATED_ADR`, `SUPERSEDED_PF` into `tests/knowledge/helpers.ts`. The `command-adoption.test.ts` doesn't need them today, but the `apply-knowledge-skill.test.ts` could plausibly use them when verifying a worked-example fixture renders correctly. This also signals the canonical schema for new contributors.

**Repeated `loadFile + match assertion` pattern in `command-adoption.test.ts`** — `tests/knowledge/command-adoption.test.ts:19-44`
**Confidence**: 80%
- Problem: The two near-identical loops at lines 19-25 (commands) and 39-44 (orch skills) run essentially the same assertion (`expect(content).toContain('knowledge-context.cjs index')`) over a list of file paths. Then lines 71-89 (consumer agents — frontmatter contains `devflow:apply-knowledge`) is a third near-identical loop with one extra line of frontmatter extraction. Three table-driven loops, three copies of the same scaffolding.
- Impact: Adding a new "must-reference X" check requires copying a fourth loop block. Less actionable than the BLOCKING items but a lurking maintenance smell.
- Fix: A helper in `helpers.ts`:
  ```ts
  export function expectAllFilesContain(label: string, files: Array<[string, string]>, needle: string) {
    describe(label, () => {
      for (const [name, relPath] of files) {
        it(`${name} contains "${needle}"`, () => {
          expect(loadFile(relPath)).toContain(needle);
        });
      }
    });
  }
  ```
  The three describe blocks collapse to three one-line calls.

### LOW

**`extractIndexEntries` re-runs the same regex split that `filterKnowledgeContext` does** — `scripts/hooks/lib/knowledge-context.cjs:49` and `scripts/hooks/lib/knowledge-context.cjs:71`
**Confidence**: 78%
- Problem: Two functions independently call `raw.split(/(?=^## (?:ADR|PF)-\d+:)/m)` and then walk the resulting sections. The split cost is trivial; the duplication is the regex literal itself, which would now appear three times in the file (counting the section-boundary regex inside the split lookahead). If the heading format changes (e.g., adding `## ADR-NNN-rev2:`) all three regex literals must update together.
- Fix: A module-level constant `const SECTION_SPLIT_RE = /(?=^## (?:ADR|PF)-\d+:)/m;` and a `const SECTION_HEADING_RE = /^## ((?:ADR|PF)-\d+): (.+)/m;`. Then the two functions can share the same split.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`json-helper.cjs:findUnmanagedAnchors` short-circuit logic is correct but allocates an unnecessary intermediate array** — `scripts/hooks/json-helper.cjs:275`
**Confidence**: 82%
- Problem: `Array.from(logMap.values()).some(o => o.status === 'ready')` materialises the full values array just to call `.some()`. Map iterators support `.some()`-style traversal directly via a `for...of` early-return:
  ```js
  let hasReady = false;
  for (const o of logMap.values()) {
    if (o.status === 'ready') { hasReady = true; break; }
  }
  if (!hasReady) return [];
  ```
  Or, more idiomatically:
  ```js
  function hasReady(map) {
    for (const v of map.values()) if (v.status === 'ready') return true;
    return false;
  }
  if (!hasReady(logMap)) return [];
  ```
- Impact: Negligible perf difference for small logs; the readability cost of "why are we converting a Map to an Array to check existence?" is the real issue. Notable because the surrounding comment (P2) says "short-circuit when no ready observations exist" — the implementation defeats the short-circuit by walking the entire collection first.
- Fix: Use the for-loop variant or extract a `hasObservationWithStatus(logMap, 'ready')` helper.

## Pre-existing Issues (Not Blocking)

None significant in scope. The pre-PR `json-helper.cjs` was already a 1500+ line god-script; the PR's refactors (`sliceKnowledgeSection`, `emptyReconcileResult`, `findUnmanagedAnchors` extraction) move it slightly in the right direction. No new pre-existing complexity issues uncovered by this review.

---

## Suggestions (Lower Confidence)

- **`extractIndexEntries` calls `.match()` twice on every section to extract status and area** — `scripts/hooks/lib/knowledge-context.cjs:91-96` (Confidence: 70%) — Could parse all `- **Field**: value` lines in one pass. Marginal cleanup; current code is readable.
- **`filterKnowledgeContext` and `extractIndexEntries` both treat the empty-string fast-path slightly differently** — line 46 returns `''`, line 70 returns `[]` (Confidence: 65%) — Consider standardising on a `parseSections(raw): Section[]` primitive that both functions consume; the empty-string handling becomes "no sections returned" uniformly.
- **`apply-knowledge-skill.test.ts` mostly asserts the SKILL.md *contains* certain regex patterns** — (Confidence: 70%) — These tests verify documentation hasn't drifted, which is useful, but they're brittle to wording tweaks. Consider snapshotting the relevant frontmatter + section headings instead of fishing for individual phrases.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 5 | 3 | 1 |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Complexity Score**: 6/10

The new `knowledge-context.cjs` module is well-documented and individually-readable, but suffers from systematic intra-file duplication: the central D-A filter predicate is expressed in 4 places using 2 idioms; two loaders share 8 lines of identical setup; two formatters share 80% of their bodies; and the CLI dispatch is a switch-tower whose path-detection heuristic relies on `process.exit()` semantics for correctness. The new tests adopt a clean structure but the index-generator file's local fixtures and helper would be more useful in the shared `tests/knowledge/helpers.ts`. The most consequential complexity issue is project-wide: the 4-line "Phase: Load Knowledge Index" block is now duplicated in 8 markdown surfaces, with `code-review-teams.md` repeating a 2-line apply-knowledge instruction 4 times within itself — exactly the prose-duplication pattern that `devflow:apply-knowledge` was created to eliminate. None of these are bugs; they're maintainability issues that compound as the knowledge feature evolves.

**Recommendation**: CHANGES_REQUESTED — the duplication issues are mechanical refactors (~150 lines of consolidation) that should land before merge while the change is fresh. The module's docstring even names the D-A filter as the "single source of truth" — that claim should be true in code, not just in the comment.
