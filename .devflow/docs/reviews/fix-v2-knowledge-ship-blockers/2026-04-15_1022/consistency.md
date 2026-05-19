# Consistency Review Report

**Branch**: fix/v2-knowledge-ship-blockers -> main
**PR**: #182
**Diff**: bd1c92f...HEAD
**Date**: 2026-04-15_1022
**Focus**: consistency

This review concentrates on cross-surface uniformity introduced by the v2 knowledge
ship-blockers refactor: the new `knowledge-context.cjs index` invocation, the
`KNOWLEDGE_CONTEXT` plumbing through orchestrators and consumers, the
`devflow:apply-knowledge` skill-reference convention, and PF-008 lockstep between
base and `-teams` command variants.

---

## Issues in Your Changes (BLOCKING)

### HIGH

**Inconsistent worktree placeholder across the 8 orchestration surfaces** — Confidence: 96%
- `plugins/devflow-resolve/commands/resolve.md:75` — `"<worktree>"`
- `plugins/devflow-resolve/commands/resolve-teams.md:68` — `"<worktree>"`
- `plugins/devflow-code-review/commands/code-review.md:97` — `"{worktree}"`
- `plugins/devflow-code-review/commands/code-review-teams.md:90` — `"{worktree}"`
- `plugins/devflow-plan/commands/plan.md:78` — `"."`
- `plugins/devflow-plan/commands/plan-teams.md:78` — `"."`
- `plugins/devflow-self-review/commands/self-review.md:26` — `"."`
- `shared/skills/plan:orch/SKILL.md:42` — `"."`
- `shared/skills/resolve:orch/SKILL.md:38` — `"."`
- `shared/skills/review:orch/SKILL.md:45` — `"."`
- `shared/skills/debug:orch/SKILL.md:32` — `"."`
- Problem: All eight orchestration surfaces invoke the same CLI helper with the same intent ("load the knowledge index for the worktree we're working on") but use **three distinct conventions** for the worktree argument: `"<worktree>"` (literal-angle-bracket placeholder), `"{worktree}"` (curly-brace template variable, the convention the rest of the file uses for substitutions), and `"."` (the literal value with no template at all). Resolve commands ship one form, code-review commands ship another, plan and self-review commands plus all four orch skills ship a third. Worse, `<worktree>` and `{worktree}` are *visually* the same kind of placeholder but the rest of these files only ever use `{...}` for substitutions — `<...>` looks like generic angle-bracket prose. The orchestrator reading these instructions could plausibly substitute the inner text in `{worktree}` while leaving `<worktree>` as a literal string passed to bash.
- Impact: Three failure modes from one inconsistency: (1) a copy-paste/rebase grafts the `"<worktree>"` form into a per-worktree command, the orchestrator passes the literal string `<worktree>` to `path.resolve()`, and the script reads `.memory/knowledge/...` from `cwd/<worktree>/.memory/...`, then exits with `(none)` from the `try/catch` swallowing ENOENT — silent loss of knowledge with no surfaced error. (2) Future maintainer assumes `<worktree>` is intentional and propagates it. (3) The `tests/knowledge/command-adoption.test.ts` only checks `toContain('knowledge-context.cjs index')` (line 22, 42), so all three forms pass the test even though only one set is correct in context.
- Fix: Pick one convention and apply it everywhere. The cleanest choice is the established `{worktree}` template variable in command files (matches the surrounding `{worktree_path}`, `{branch_slug}`, `{timestamp}` substitutions in the same files), and the literal `"."` only in orch skills where there is no per-worktree iteration. Concretely:
  - `plugins/devflow-resolve/commands/resolve.md:75` and `resolve-teams.md:68`: `"<worktree>"` → `"{worktree}"`
  - Document in CLAUDE.md or a comment in `knowledge-context.cjs` that orchestration surfaces use `{worktree}` for per-worktree commands and `"."` for single-cwd skills.
  - Tighten `tests/knowledge/command-adoption.test.ts` to also assert one of `{worktree}`, `{worktree_path}`, or `"."` follows the `index` token, so future drift trips the test.

**`KNOWLEDGE_CONTEXT` substitution placeholder is inconsistent across reviewer-prompt blocks** — Confidence: 92%
- `plugins/devflow-code-review/commands/code-review.md:135` — `{knowledge_context or '(none)'}`
- `plugins/devflow-code-review/commands/code-review-teams.md:129,145,161,177` — `{knowledge_context or '(none)'}` (4 reviewer prompts)
- `plugins/devflow-self-review/commands/self-review.md:39,52` — `{knowledge_context or '(none)'}`
- `plugins/devflow-resolve/commands/resolve.md:129` — `{knowledge index from Step 0d, or (none)}`
- `plugins/devflow-resolve/commands/resolve-teams.md:129` — `{knowledge index from Step 0d, or (none)}`
- `plugins/devflow-plan/commands/plan.md:140` — `{knowledge index from Phase 2, or (none)}`
- `plugins/devflow-plan/commands/plan-teams.md:96,107,118,129` — `{Phase 2 knowledge index, or (none)}`
- `plugins/devflow-plan/commands/plan-teams.md:205` — `KNOWLEDGE_CONTEXT: knowledge index from Phase 2 (or \`(none)\`)`
- `shared/skills/plan:orch/SKILL.md:76,87` — `{knowledge index from Phase 0, or (none)}`
- Problem: The literal placeholder template the orchestrator inlines into spawned-agent prompts is encoded in **at least four different shapes**: `{knowledge_context or '(none)'}` (Python-ish `or`-default with quoted string); `{knowledge index from Step 0d, or (none)}` (descriptive prose, unquoted `(none)`); `{Phase 2 knowledge index, or (none)}`; and a parenthesized `(or \`(none)\`)`. Some quote `(none)` with single quotes, some leave it bare, some put it in backticks. The model substituting these placeholders has to guess whether the literal output should be `(none)` or `'(none)'` — and the receiving agent then has to handle both: `apply-knowledge/SKILL.md:86` says the skip guard fires "When `KNOWLEDGE_CONTEXT` is empty, `(none)`, or not provided" — so `'(none)'` (with quotes) does **not** match.
- Impact: Inconsistent quoting causes `apply-knowledge`'s skip guard to silently fail in the quoted-form surfaces. The reviewer would scan a literal three-character quoted string and try to do real work on it (no Read of any file, no citation possible) instead of skipping. Failure is silent — orchestrator would not see this.
- Fix: Standardize on `{knowledge_context or (none)}` (no quotes around `(none)`) across all 11+ sites. Add a one-line comment in `apply-knowledge/SKILL.md` Step 1 documenting that the literal token is `(none)` (no quotes). Optionally tighten the skip guard to also match `'(none)'` for robustness — but only if the standardization above is also applied so we do not encode bug-tolerance into the spec.

### MEDIUM

**`devflow:apply-knowledge` reference structure differs across the 5 consumer agents** — Confidence: 88%
- `shared/agents/reviewer.md:46-52` — dedicated `## Apply Knowledge` H2 section (3 lines + a `<!-- CITATION-SENTENCE-START -->` block)
- `shared/agents/resolver.md:79-81` — dedicated `## Apply Knowledge` H2 section (1-line directive)
- `shared/agents/scrutinizer.md:21-23` — dedicated `## Apply Knowledge` H2 section (1-line directive, *before* Responsibilities)
- `shared/agents/simplifier.md:21-23` — dedicated `## Apply Knowledge` H2 section (1-line directive, *before* Responsibilities)
- `shared/agents/designer.md:34` — embedded as **Responsibility 3** in the numbered list, no dedicated H2 section
- Problem: All 5 consumer agents declare `devflow:apply-knowledge` in `skills:` frontmatter, but the body conventions diverge: 4 use a dedicated `## Apply Knowledge` H2 section, 1 (Designer) embeds it as a numbered responsibility. Of the 4 with sections, 2 place the section before `## Responsibilities` (Scrutinizer, Simplifier) and 2 after the Input/before-Output area (Reviewer, Resolver). The Reviewer also has a `<!-- CITATION-SENTENCE-START -->` machine-readable marker that the others lack, but a tagged-comment marker is a contract — if anything reads it (a test? a skill-reference validator?), only Reviewer publishes it.
- Impact: A new consumer agent author has no canonical template to copy. The Designer's agent file (which now declares the skill in frontmatter) lost its dedicated section in this refactor — it had `Apply Knowledge` only as a one-line responsibility. If any downstream tooling (e.g. the `tests/skill-references.test.ts` referenced in this PR) validates the presence of an `## Apply Knowledge` section as part of the skill-adoption contract, Designer fails the contract while still claiming the skill.
- Fix: Pick one structural convention. Recommendation: dedicated `## Apply Knowledge` H2 section in every consumer (matches 4/5 already) immediately after `## Input Context`/`## Input` and before `## Responsibilities`. Move Designer's responsibility-3 prose into a dedicated section, leave a brief "see Apply Knowledge section" reference in Responsibilities. Decide whether the `CITATION-SENTENCE-START/END` marker is a contract — if yes, propagate it to all 5 consumers; if no, drop it from Reviewer.

**Step-numbering off-by-one risk in `code-review.md` Reviewer prompt** — Confidence: 84%
- `plugins/devflow-code-review/commands/code-review.md:135-137`
- Problem: In the parallel `code-review.md` Reviewer invocation, the new `KNOWLEDGE_CONTEXT: ...` line and the "Follow devflow:apply-knowledge..." line are inserted after `DIFF_COMMAND` (line 134) but *before* the existing `IMPORTANT: Write report...` line (line 137). This is a flat list of agent prompt fields, not a numbered process, so it is fine here. However, in the **teams** variant `code-review-teams.md` (lines 121-139, 141-155, etc.) the equivalent insertion is into a *numbered* list of steps (lines 130-140 originally numbered 1-10). The diff renumbered: original step 3 was "Read pitfalls.md" → replaced with new step 3 "Follow devflow:apply-knowledge..." (good — same number). But then steps 4-10 do not change number. This is consistent. **However**, no equivalent numbered-step renumbering exists in code-review.md (it has no numbered steps inside the prompt), so the surfaces are structurally divergent in how they teach the reviewer to apply knowledge. The teams variant tells the reviewer "step 3: Follow devflow:apply-knowledge"; the parallel variant tells the reviewer "Follow devflow:apply-knowledge..." as a free-floating instruction. Per PF-008 (base↔teams lockstep), these should match in instructional content.
- Impact: Reviewer agents spawned via `/code-review` (parallel) get a less-prescriptive instruction than reviewers spawned via `/code-review-teams`. The reviewer agent definition (`shared/agents/reviewer.md:46-52`) does have a self-contained Apply Knowledge section, so this is not catastrophic — but it does mean the orchestration surfaces are not in lockstep on knowledge-loading instructions, which is the exact PF-008 concern called out in the review prompt.
- Fix: In `code-review.md:135-137`, restructure as a numbered field list parallel to the teams variant, OR explicitly call out in both files that `KNOWLEDGE_CONTEXT` is a prompt field (not a step) and the reviewer's own `## Apply Knowledge` section is the contract.

**Comment in `knowledge-context.cjs` claims dispatch "mirrors json-helper.cjs:8-36" — but lines 8-36 of json-helper are the operations docblock, not the dispatch idiom** — Confidence: 91%
- `scripts/hooks/lib/knowledge-context.cjs:20` — `// CLI dispatch mirrors json-helper.cjs:8-36 subcommand style:`
- Problem: The dispatch in `json-helper.cjs:43-44 + 641` is `const op = process.argv[2]; const args = process.argv.slice(3); ... switch (op) { case 'get-field': ... }`. Lines 8-36 of `json-helper.cjs` are merely the **operations comment block** (`//   get-field <field> [default]   Read field from stdin JSON`), not the dispatcher. Meanwhile `knowledge-context.cjs:294-365` uses a fundamentally **different** dispatcher: `const argv = process.argv.slice(2); const firstArg = argv[0]; if (firstArg === 'index'...) ... else if (...) ... else if (...)`. It also adds an entirely new "bare-mode" path-detection idiom (line 314) that has no analog in `json-helper.cjs`.
- Impact: The "mirrors X" comment is misleading. A maintainer reading `json-helper.cjs:8-36` to understand the convention finds only documentation comments, not a dispatcher to mirror. The new file actually invents its own dispatch shape (positional path-sniffing for backward compat) which is a fine choice but is **not** the json-helper idiom. This is a documentation/code-comment consistency violation that misrepresents a design relationship.
- Fix: Either (a) update the comment to accurately describe the relationship: `// CLI dispatch is a positional argv parser; differs from json-helper.cjs's switch-on-argv[2] because we need backward-compat for the bare invocation form.` Or (b) refactor to match json-helper's `switch (op)` style and reference the actual dispatch lines (~641). Recommend (a) — refactoring is unjustified given the bare-mode legacy detection requires inspection logic json-helper does not need.

**`KNOWLEDGE_CONTEXT` terminology is bifurcated: "index" everywhere except Resolver agent input doc** — Confidence: 87%
- `shared/agents/resolver.md:18` — "Compact index of active ADR/PF entries... Lists each entry with ID, truncated title, status, and area" (correct: index)
- `shared/agents/reviewer.md:19` — "Compact index of active ADR/PF entries for this worktree" (correct: index)
- `shared/agents/scrutinizer.md:17` — "Compact index of active ADR/PF entries" (correct: index)
- `shared/agents/simplifier.md:17` — "Compact index of active ADR/PF entries" (correct: index)
- `shared/agents/designer.md:21` — "Compact index of active ADR/PF entries" (correct: index)
- `plugins/devflow-resolve/commands/resolve.md:78,131` — "compact index", "no fan-out of the full corpus" (correct: index, contrasted with old 'full corpus' meaning)
- `plugins/devflow-resolve/commands/resolve-teams.md:71,131` — same as resolve.md
- `shared/skills/resolve:orch/SKILL.md:38` — "compact index... no fan-out of the full corpus"
- `scripts/hooks/lib/knowledge-context.cjs:13-14` — "The `full` subcommand returns the full corpus (for backwards compatibility). The bare invocation (no subcommand) is deprecated"
- Problem: Across all the prose *describing* `KNOWLEDGE_CONTEXT` to spawned agents, the terminology is consistently "compact index" and the prior "full corpus" meaning is correctly marked as legacy/deprecated. **However**, the `loadKnowledgeContext` function (the full-corpus loader) is still exported alongside `loadKnowledgeIndex` from line 367, and its JSDoc at line 230 says "Load and filter project knowledge for a given worktree" — the function name and JSDoc do not signal "this is the legacy/deprecated full-corpus path". A new caller importing the module sees two functions with similar names and unclear deprecation semantics.
- Impact: A future consumer importing `loadKnowledgeContext` (full corpus) instead of `loadKnowledgeIndex` (compact) silently re-introduces the fan-out problem the refactor was specifically designed to eliminate. The "fan out" problem was the original PR motivation. Naming is the only signal.
- Fix: Either (a) rename the legacy function `loadKnowledgeContextLegacy` and add `@deprecated` JSDoc tag, with a one-line note pointing callers to `loadKnowledgeIndex`; or (b) add an `@deprecated` tag and a "Use `loadKnowledgeIndex` instead unless you specifically need the full corpus for the deprecated `full` subcommand" note at line 229. The CLI `bare` mode emits a stderr deprecation; module callers do not see that warning.

### LOW

**Footer line uses padded `PF-NNN` to align with `ADR-NNN` but only in one of two index-builder paths** — Confidence: 82%
- `scripts/hooks/lib/knowledge-context.cjs:217` — `'PF-NNN  entries live in '` (two spaces — alignment padding)
- `scripts/hooks/lib/knowledge-context.cjs:212` — `'ADR-NNN entries live in '` (one space)
- Problem: The footer line in `loadKnowledgeIndex` deliberately right-pads `PF-NNN` with an extra space so it aligns visually with the longer `ADR-NNN` — a small, justified consistency choice. But the corresponding consumer-side footer template in `apply-knowledge/SKILL.md:36-38` does NOT carry this padding (`PF-NNN  entries live in {worktree}/...` is shown padded, but it is the literal output of the script, so this matches). Verified — the script does emit two spaces and the SKILL.md doc uses two spaces. This is consistent.
- Impact: None observed; this is consistent. Flagging at LOW only because the two-space padding is fragile to a future "fix" by an editor that re-flows whitespace. A test asserting the exact byte-shape of the footer would lock it.
- Fix: No change required. Optionally add a `tests/knowledge/index-generator.test.ts` assertion that the footer block contains both `'ADR-NNN entries live in '` and `'PF-NNN  entries live in '` (with the exact padding), so a whitespace-collapsing reformatter is caught.

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`json-helper.cjs` dispatch is now a `switch` mixing `case`-block-scoped `let` with non-block early returns — knowledge-context.cjs invented a different idiom for the same problem** — Confidence: 84%
- `scripts/hooks/json-helper.cjs:641-1580` (modified — extracted `sliceKnowledgeSection` and `emptyReconcileResult`)
- `scripts/hooks/lib/knowledge-context.cjs:294-365` (added)
- Problem: Both files implement CLI subcommand dispatch. `json-helper.cjs` uses `switch (op) { case 'reconcile-manifest': { ... break; } }` with explicit `break` and braced case-block scopes. `knowledge-context.cjs` uses an `if/else if` chain plus three separate top-level `if (mode === 'X')` blocks (lines 329, 340, 355) — which means after `mode === 'index'` returns, the parser does a no-op check for `'full'`. The two dispatchers do conceptually-identical work with different shapes. Per the consistency Iron Law: "match existing patterns or justify deviation." The new file's docblock claims to mirror json-helper's style (see HIGH finding above) but does not — and the deviation is not justified inline.
- Impact: Maintainability burden; future contributor must learn two dispatch styles for two CLI helpers in the same `scripts/hooks/` tree.
- Fix: Either (a) refactor `knowledge-context.cjs` dispatch to use `switch (mode)` matching json-helper's style; or (b) add an inline comment justifying the deviation: `// We use if/else (not switch) because we need to detect the deprecated bare-path form before assigning a known subcommand`.

---

## Pre-existing Issues (Not Blocking)

None of the consistency concerns flagged below predate this PR; they are all introduced or solidified by it.

---

## Suggestions (Lower Confidence)

- **`(none)` placeholder also appears as the function return value documented in JSDoc `@returns {string} ... or '(none)'`** — `scripts/hooks/lib/knowledge-context.cjs:154,240` (Confidence: 70%) — JSDoc uses single-quoted `'(none)'` to indicate a string literal in a TypeScript-y comment style, but the actual returned value is the unquoted three-char `(none)`. Consistent within the JSDoc convention; mildly confusing alongside the consumer-side guidance to look for unquoted `(none)`.
- **`tests/knowledge/command-adoption.test.ts` only checks for the substring `knowledge-context.cjs index`, not the worktree placeholder shape** — `tests/knowledge/command-adoption.test.ts:22,42` (Confidence: 76%) — adding an assertion for the placeholder convention (`{worktree}` / `"."`) would have caught the HIGH inconsistency above before merge.
- **`KNOWLEDGE_CONTEXT` field placement in agent input docs is non-uniform** (Confidence: 65%) — Designer puts it as a top-level bullet *after* the Worktree Support paragraph (`plugins/devflow-plan/agents/designer.md:21`), while Reviewer/Resolver/Scrutinizer/Simplifier put it inline with other Input Context bullets. Cosmetic; not load-bearing.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 4 | 1 |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Consistency Score**: 6/10

The refactor is internally well-motivated and the *intent* is consistent (every
consumer surface uses the index pattern, every consumer cites `devflow:apply-knowledge`,
the CLI dispatches predictably). But the **surface details diverge in three load-bearing
ways**: worktree placeholders use three different shapes across the eight invocation
sites; the `(none)` literal is encoded with three different quoting conventions across
11+ prompt-template sites; and the `## Apply Knowledge` body convention differs across
the five consumer agents. The two HIGH findings concern silent failure modes (knowledge
silently dropped, skip-guard silently bypassed), so they should land before merge.
The MEDIUM findings are quality-of-life and contract-of-claims; they should ideally
be fixed in this PR but are not strictly merge-blocking.

**Recommendation**: CHANGES_REQUESTED

The two HIGH findings (worktree placeholder + `(none)` quoting) are blocking because
both encode silent failure modes specific to this refactor's surface area. The MEDIUM
findings should be addressed in this PR but could be deferred to a follow-up if the
HIGH items are fixed.
