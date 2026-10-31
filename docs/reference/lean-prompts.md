# Lean Prompts

How to cut a prompt without losing what it guarantees.
A prompt is a command, an agent or a skill that devflow ships.
A lean prompt holds the rules that its run needs, in the fewest bytes and the fewest turns.
A person who edits a prompt by hand can follow this guide with the repository build and test commands alone.
The ranked list of targets is in [Lean prompt targets](lean-prompts-targets.md).

## What to cut and where the tokens go

Most of the spend is cache reads. Each turn sends the whole context again, so the cost of a text is its bytes times the turns that hold it, times the number of times that it loads.

| Load | What it holds | Who re-reads it |
|---|---|---|
| Always loaded | The `description` frontmatter of each skill, agent and command that an install lists, the installed rules, and the text of the session-start and per-prompt hooks | Every turn of every session |
| Main prompt | A command after its invocation | Every main turn of the run, to the end of the context |
| Agent prompt | The agent body, each skill in its `skills:` preload list, and the spawn prompt. An agent without `omitClaudeMd: true` also gets CLAUDE.md and the installed rules. | Every turn of every spawn |
| On demand | A skill that a run invokes, or a reference file that a run reads | Every turn after the read |

Choose targets in this order:

1. Rank the targets by token spend: loads per run, times bytes, times the turns that re-read the text.
2. Cut agent prompts that run many turns first. One byte of a Code agent prompt is re-read many more times than one byte of the command that spawns it.
3. Count a preloaded skill in every agent that preloads it. A preload is often larger than the agent body.
4. Cut spawn text that repeats the agent body. Each turn of the agent re-reads it.
5. Cut a shared partial once, so that every host gets the cut. Two pull requests never cut the same file.
6. Cut always-loaded text with care. A `description` is the text that makes a skill or an agent load. A shorter description must still name the cases where it applies.

## Rules for every target

1. No fixed size target. The measure is the bytes that a typical run reads in each build variant key, plus the turns per run. The typical-run read is the prompt plus the files that the run reads on its typical path. Neither may grow in any key.
   - The compiled ceiling of one file may rise only when the typical-run read of that key falls by more. The pull request body gives the numbers for each key and the reason, and the ceiling's manifest row records the exception.
   - All other ceilings only fall.
2. No new structure, such as step maps, state tables, step graphs or step files, unless its measured gain is larger than its bytes and turns.
3. A rule that must always hold moves into a script or a hook, not into stronger words.
4. Keep "finish and verify" text for an agent that runs on a smaller model, such as Haiku, or Sonnet at low or medium effort. Its `model` and `effort` frontmatter say which.
5. A text-only cut uses the cut rules below and one independent audit for each pull request. A change of structure or of a contract needs a plan first.

## Cut rules

A cut removes text from a prompt or moves it to another file. A cut never changes what the prompt guarantees.
Follow these steps for each cut commit.

1. List the never-cut items of the cut text. For `/implement`, use the [never-cut table](#never-cut-table). For another target, list the output contracts, fail-closed rules, scrub and security rules, and the text that a test pins.
2. Edit the text as it stands on the current base. A hunk made on an older base can bring back text that a later change removed.
3. Write one cut-log row for each hunk in the commit body. A row holds the rule number, the kind of cut, the bytes, and the never-cut items that the hunk touches. Write "none" when the hunk touches no item.
4. Build once.
5. Measure the compiled size of every host in every variant key, and the typical-run read of the target. Lower each size limit that fell, in the same commit. If a host grew, revert that hunk, unless the exception of the first rule for every target applies. Never raise a limit in any other case.
6. Run the contract tests of the cut host. Put each failure in one class:
   - A contract that moved: adapt the probe or the collector to the new place.
   - A contract that is lost: restore the text.
   - A change of wording only: move the check to a snapshot, or delete it and record the reason.
   - A failure that does not come from this diff.
   - A size limit.
7. Audit the pull request. One independent reader checks the diff against every lens below. The reader gets the diff, the never-cut items, the cut-log rows and the lenses. The author of the cut is not the reader. The author decides each finding. A high finding restores the text before the merge.

The audit lenses:

1. Never-cut items: each item is byte-equal, or it changed under a named decision.
2. Fail-closed paths: each fallback value, exit check, "treat as missing" rule, stop line and failed-read stop keeps its trigger and its value.
3. Halts and skip-forward arms: each halt, report arm, loop bound, skipped arm, note arm, CI-state arm and chooser else arm stays in the step that causes it. No halt depends on a Read.
4. Conditions: each gated instruction keeps its own condition in its own step.
5. Output contracts: each line grammar, claim shape, settings line, spawn fence key and TRACEABILITY or DEGRADED line is unchanged.
6. Safety checks: the branch-name check, the rule that no name value reaches a command, the notes about untrusted input, the scrub step, and the rule that a Code agent opens no pull request are unchanged.
7. Cited names: each bold lead, heading and step number that a reference file or a test cites is unchanged.
8. Cross-host: a cut in a shared partial lowers the bytes of every importing host, and no sentence changes meaning for any host.
9. Meaning: a rule, a contract, or text that says it once covers each removed line.
10. Turns: the audit finds serial calls that could share one turn, reads made off the branch, read-backs after a confirmed write, and narration turns. A turn count that rises needs a reason in the cut log.

These rules bind every cut:

1. A "say it once" cut applies to facts only, never to conditions. Each gated instruction keeps its own condition in its own step.
2. The Produces and Requires lines stay.
3. Check moved text against the grammar and the load set of its destination. A guard corpus widens only for the literal that moved.
4. The MDS semantics of the pinned version apply to every split file. A check of each split file against its source section catches drift in braces, fences and blank lines.
5. Never cut a Code or Fix spawn to save tokens.
6. Never cut Principles 1 to 4 or the Error Handling rule. Their text stays byte-equal.
7. A pinned sentence stays. A cut never changes a pin to make room.

## Never-cut table

The table lists the never-cut items of the `/implement` command. A never-cut item keeps its text, or its text moves byte-equal. Another command gets its own table when a cut needs one.

- **Location** names the place of the item in the command. A cut that moves an item changes its location in the same commit.
- **Guard probe** names the test that pins the item, and a seeded deletion. A seeded deletion removes the quoted text from a copy of the compiled command. The named probe must then report a defect.
- "No pin yet" means that no test pins the text today. The first cut that touches the item adds the probe before the cut.

| No. | Item | Location | Guard probe |
|---|---|---|---|
| 1 | Principle 1, orchestration only. The main session runs no tests, builds or fixes. "Spawn X" means call the Agent tool. The text names the inline calls. | Principles, item 1. Byte-equal. | Pinned in `tests/evidence/implement-flow.test.ts`. Seed: delete "never does work itself (no tests, builds or fixes)". The collector must report a defect. `tests/guards/implement-resolve-levels.test.ts` also pins the title "1. **Orchestration only**". |
| 2 | Principle 1, inline calls. The text names the fresh-base resolver calls, the Phase 10 and Phase 11 pushes, the Phase 10 ci-wait call and the Phase 11 publish call. | Same item as row 1. | Pinned in `tests/evidence/implement-flow.test.ts`, in the resolver clause and in the push and ci-wait clause. Seed: delete the resolver clause. The collector must report a defect. |
| 3 | Principle 2, honest reporting. Display agent outputs directly. | Principles, item 2. Byte-equal. | Pinned in `tests/guards/implement-placement.test.ts`. Seed: delete "Display agent outputs directly". The probe must fail. |
| 4 | Principle 3, loop limits. Max 2 validation retries, max 2 alignment fix iterations and max 2 QA retries before the run escalates to the user. The CI gate allows at most 3 waits and 2 fixes. | Principles, item 3. Byte-equal. | Pinned in `tests/evidence/implement-flow.test.ts`. Seed: delete "at most 3 waits and 2 fixes". The probe must fail. |
| 5 | Principle 4, CI awareness. Test-plan evidence is recorded under every strategy. | Principles, item 4. Byte-equal. | Pinned in `tests/evidence/implement-flow.test.ts`. Seed: delete "is recorded under every strategy". The probe must fail. |
| 6 | Error Handling rule. Report the phase, the agent type and the error. Offer retry, investigate or escalate. | Error Handling. Byte-equal. | Pinned in `tests/guards/implement-placement.test.ts`. Seed: delete "report the phase, agent type and error". The probe must fail. |
| 7 | Empty-input rule. With empty input, write a one-line description and send it as the setup-task description. The rule stays unchanged. | Phase 1 intake. | Pinned in `tests/guards/implement-placement.test.ts`. Seed: delete "Write the description yourself". The probe must fail. |
| 8 | Base-branch check. The captured branch must pass the setup check before the base resolves. | Phase 1 intake, in the same order. | Pinned in `tests/evidence/implement-flow.test.ts`, in the setup-check clause. Seed: delete "stop unless it passes the setup check". The probe must fail. |
| 9 | Handoff file. Delete it once the PR exists. | The Handoff Protocol paragraph, and the cleanup step that runs after Phase 9. | Pinned in `tests/guards/handoff-sections.test.ts` and `tests/evidence-policy/ticket-gate.test.ts`. Seed: delete "once the PR exists". The probe must fail. |
| 10 | Phase 5 alignment-fix counter, limit and loop-back (numbered steps 2 to 4). | Phase 5. | Pinned in `tests/guards/implement-resolve-full-fences.test.ts`: the counter, the two-attempt test, the loop-back line and the report step, each once. Seed: delete the step "Increment `alignment_fix_count`". The probe must fail. |
| 11 | DECISIONS_CONTEXT on the ci-fix spawn, curation-on arm. | Phase 10, ci-fix spawn. | Pinned in `tests/guards/implement-placement.test.ts`, in the builds that hold a decisions load. Seed: delete the field from the on arm. The probe must fail. |
| 12 | Fresh-base fail-closed rules. Output other than one BASE_REF line with exit=0 counts as `NOTE=stop` with REASON=resolver-unavailable. The stop line stops the run. The run removes the temp file on exit. | Phase 1 fresh base. | Pinned in `tests/guards/implement-placement.test.ts`, in the clause "counts as `NOTE=stop`", the stop line and the temp-file trap. `tests/guards/base-ref-guard.test.ts` pins the resolver-unavailable fix row. `tests/evidence/implement-flow.test.ts` pins the re-validation reading. Seed: delete the clause "counts as `NOTE=stop`". The probe must fail. |
| 13 | Test-plan check. Exit 0 passes. Otherwise rewrite the section once, check again, and drop the section if it still fails. A required policy asks. A standard policy does not ask. | Phase 1 intake. | Pinned in `tests/guards/implement-placement.test.ts`, in the four clauses: rewrite once, drop the section, a required policy asks and a standard policy does not ask. Seed: delete "rewrite the section once". The probe must fail. |
| 14 | Test-plan scenario text. A scenario holds no `#`, `@` or `/` (no issue reference, mention, closing keyword or URL), because the lines reach the PR body. | Phase 1 test plan. | Pinned in `tests/guards/implement-placement.test.ts`. Seed: delete "holds no `#`, `@` or `/`". The probe must fail. |
| 15 | Compliance directive. Pass it to every Code and Fix spawn. | Phase 1, the settings and policy step. | Pinned in `tests/guards/implement-placement.test.ts`, in the pass sentence. `tests/guards/compliance-injection.test.ts` pins the directive clause. Seed: delete the pass sentence. The probe must fail. |
| 16 | Decisions context. Pass it to the Code agent (Phase 2) and to the Harden agent (Phase 4), curation-on arm. | Load DECISIONS_CONTEXT. | Pinned in `tests/guards/implement-placement.test.ts`, in the builds that hold a decisions load. Seed: delete the pass sentence. The probe must fail. |
| 17 | The settings line and its fail-closed text. | Phase 1, from the settings partial. | `tests/commands/settings-partial.test.ts` pins the partial. Seed: delete the fail-closed text from the partial. The probe must fail. |
| 18 | Fail-closed sentences of Phases 9 to 11. Each is one whole sentence. (a) Capture the `- **PR**: #{number}` line of its `### Branch` as `PR_NUMBER`, its `### Uncommitted files` list and its `TRACEABILITY: DEGRADED ({reason})` lines for the Phase 12 report. (b) If it returns `### Status: BLOCKED` or no PR number, report its reason to the user and stop at the report (Phase 12); Phases 10 and 11 do not run. (c) Any other result, a rejected non-fast-forward push included, records `TRACEABILITY: DEGRADED (ci push failed)` for the Phase 12 report, reports "CI status unknown — verify manually before merging" and proceeds to Phase 11 without waiting. (d) Any other result, a rejected non-fast-forward push included, does not block: record `TRACEABILITY: DEGRADED (evidence push failed)` for the Phase 12 report and run the script anyway. | (a) and (b): Phase 9. (c): Phase 10. (d): Phase 11. | Pinned in `tests/guards/implement-placement.test.ts`, as rows 18a to 18d, in every build. A sentence must start a sentence and end one, with its full text. Seed: delete "does not block: " from sentence (d). The probe must fail. |

## Core global rules

The global rules of `/implement` bind the whole run. They are the Principles, the Error Handling rule, and the rule for a failed reference read. Each rule has a mark. A rule marked **Yes** is never cut, and its text moves byte-equal. A new global rule joins this list with its mark, and with its guard probe, in the commit that adds it.

| No. | Rule | Never-cut | Reason |
|---|---|---|---|
| 1 | Principle 1, orchestration only | Yes | The main session only orchestrates. This rule keeps tests, builds and fixes out of it. See row 1 of the never-cut table. |
| 2 | Principle 2, honest reporting | Yes | The user sees agent outputs as the agents wrote them. See row 3 of the never-cut table. |
| 3 | Principle 3, loop limits | Yes | Each loop and each wait has a bound. See row 4 of the never-cut table. |
| 4 | Principle 4, CI awareness | Yes | The test-plan evidence exists under every strategy. See row 5 of the never-cut table. |
| 5 | Error Handling | Yes | An error report names the phase, the agent type and the error, and offers retry, investigate or escalate. See row 6 of the never-cut table. |
| 6 | Failed-read rule: when a read of a reference fails, apply no part of it and stop or fall back as the step says. | Yes | A silent failed read would skip a branch. |

## Architecture

### One core file

A command or an agent is one file. The file holds the whole typical path of a run.

Each serial file read adds one turn, and each turn sends the full cached context again. For this reason, a reference file holds a rare branch only. No file groups phases or steps.

### Rare branches

A rare branch is a path that most runs never take. A branch is rare when fewer than half of real runs enter it. Only a rare branch moves to a reference file. A candidate with no run data stays in the core file, and the cut log records the reason.

A run reads a reference file only when it takes that branch, and reads it once. After the read, it returns to the core step. The halt and the counter check of a fix arm stay in the core step. A relative path resolves against the working directory, not against the skill folder, so a step that enters a reference names its full path line.

### Skill folders

The build can carry a command as a skill folder: a core `SKILL.md` and its reference files. No command uses a folder today. A command converts only under the rule for new structure, with a plan.

- The registry `WORKFLOW_FOLDERS` in `src/core/mds-variants.ts` lists each folder. It is empty until a command converts.
- A folder host declares `output-dir: dist/workflows`. The build treats it as the `workflow-skill` host variant, and writes one complete folder for each variant key.
- The build id is the first 12 hex digits of a SHA-256 hash over the compiled files of the folder. The build writes it as ` [build <id>]` at the end of the first heading of each stamped file. A run that reads a reference with another id stops.
- After a compaction, Claude Code re-attaches an invoked skill and keeps its first 20,000 characters. For this reason, the prefix must be at most 16,660 bytes: 20,000 characters, less 400 for the notice and the header path, times 0.85. The settings text and the argument binding stay in the prefix.

The [live-check results](platform-assumptions.md#skill-folders-and-compaction-re-attach) record the platform facts.

## Cut record

Each file that a cut changes has a record in the commit body, next to the cut-log rows. The record holds:

- The compiled bytes of the file before the cut and after it. Bytes are UTF-8 bytes.
- The hosts that import the file.

A partial changes the compiled text of every host that imports it. The record lets a reader check each of those hosts.

A text cut removes text. A move keeps the text in another file. If a text cut leaves less than half of the before size, stop. Ask for a decision before the commit.

## Turns

A turn is one model call in the main session or in an agent.

1. Batch independent tool calls in one turn.
2. Read a reference only on its branch.
3. Do not read back a file after a confirmed write.
4. Do not send a turn that only narrates.
