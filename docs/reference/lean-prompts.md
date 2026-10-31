# Lean Prompts

How to cut a workflow prompt without losing what it guarantees.
A workflow prompt is a command or a skill that a run loads into its main session.
A lean prompt holds the rules that the run needs, in the fewest bytes and the fewest turns.
A person who edits a prompt by hand can follow this guide with the repository build and test commands alone.

## Cut rules

A cut removes text from a prompt or moves it to another file. A cut never changes what the prompt guarantees.
Follow these steps for each cut commit.

1. List the never-cut items of the cut text from the [never-cut table](#never-cut-table). Do this before any edit.
2. Edit the text as it stands on the current base. A hunk made on an older base can bring back text that a later change removed.
3. Write one cut-log row for each hunk in the commit body. A row holds the rule number, the kind of cut, the bytes, and the never-cut items that the hunk touches. Write "none" when the hunk touches no item.
4. Build once.
5. Measure the compiled size of every host in every variant key. Lower each size limit that fell, in the same commit. If a host grew, revert that hunk. Never raise a limit.
6. Run the contract tests of the cut host. Put each failure in one class:
   - A contract that moved: adapt the probe or the collector to the new place.
   - A contract that is lost: restore the text.
   - A change of wording only: move the check to a snapshot, or delete it and record the reason.
   - A failure that does not come from this diff.
   - A size limit.
7. Audit the commit. Give each lens below to one independent reader. The reader gets the diff, the never-cut table, the cut-log rows and the lens. The author of the cut is not a reader. The lead decides each finding. A high finding restores the text before the commit.

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
6. Never cut Principles 1 to 4 or the Error Handling rule. They move byte-equal to the core global rules.
7. A pinned sentence stays. A cut never changes a pin to make room.

## Never-cut table

The table lists the never-cut items of the `/implement` command. A never-cut item keeps its text, or its text moves byte-equal. Another command gets its own table when it converts.

- **Location** names the place of the item in the end state: a section of the core file, above or below the marker line. A cut that moves an item changes its location in the same commit.
- **Guard probe** names the test that pins the item, and a seeded deletion. A seeded deletion removes the quoted text from a copy of the compiled command. The named probe must then report a defect.
- "No pin yet" means that no test pins the text today. The first cut that touches the item adds the probe before the cut.

| No. | Item | Location | Guard probe |
|---|---|---|---|
| 1 | Principle 1, orchestration only. The main session runs no tests, builds or fixes. "Spawn X" means call the Agent tool. The text names the inline calls. | Core global rules, item 1, above the marker line. Byte-equal. | Pinned in `tests/evidence/implement-flow.test.ts`. Seed: delete "never does work itself (no tests, builds or fixes)". The collector must report a defect. `tests/guards/implement-resolve-levels.test.ts` also pins the title "1. **Orchestration only**". |
| 2 | Principle 1, inline calls. The text names the fresh-base resolver calls, the Phase 10 and Phase 11 pushes, the Phase 10 ci-wait call and the Phase 11 publish call. | Same item as row 1. | Pinned in `tests/evidence/implement-flow.test.ts`, in the resolver clause and in the push and ci-wait clause. Seed: delete the resolver clause. The collector must report a defect. |
| 3 | Principle 2, honest reporting. Display agent outputs directly. | Core global rules, item 2. Byte-equal. | Pinned in `tests/guards/implement-placement.test.ts`. Seed: delete "Display agent outputs directly". The probe must fail. |
| 4 | Principle 3, loop limits. Max 2 validation retries, max 2 alignment fix iterations and max 2 QA retries before the run escalates to the user. The CI gate allows at most 3 waits and 2 fixes. | Core global rules, item 3. Byte-equal. | Pinned in `tests/evidence/implement-flow.test.ts`. Seed: delete "at most 3 waits and 2 fixes". The probe must fail. |
| 5 | Principle 4, CI awareness. Test-plan evidence is recorded under every strategy. | Core global rules, item 4. Byte-equal. | Pinned in `tests/evidence/implement-flow.test.ts`. Seed: delete "is recorded under every strategy". The probe must fail. |
| 6 | Error Handling rule. Report the phase, the agent type and the error. Offer retry, investigate or escalate. | Core global rules, one rule. Byte-equal. | Pinned in `tests/guards/implement-placement.test.ts`. Seed: delete "report the phase, agent type and error". The probe must fail. |
| 7 | Empty-input rule. With empty input, write a one-line description and send it as the setup-task description. The rule stays unchanged. | Phase 1 intake, below the marker line. | Pinned in `tests/guards/implement-placement.test.ts`. Seed: delete "Write the description yourself". The probe must fail. |
| 8 | Base-branch check. The captured branch must pass the setup check before the base resolves. | Phase 1 intake, in the same order. | Pinned in `tests/evidence/implement-flow.test.ts`, in the setup-check clause. Seed: delete "stop unless it passes the setup check". The probe must fail. |
| 9 | Handoff file. Delete it once the PR exists. | The Handoff Protocol paragraph, and the cleanup step that runs after Phase 9. | Pinned in `tests/guards/handoff-sections.test.ts` and `tests/evidence-policy/ticket-gate.test.ts`. Seed: delete "once the PR exists". The probe must fail. |
| 10 | Phase 5 alignment-fix counter, limit and loop-back (numbered steps 2 to 4). | Phase 5. | Pinned in `tests/guards/implement-resolve-full-fences.test.ts`: the counter, the two-attempt test, the loop-back line and the report step, each once. Seed: delete the step "Increment `alignment_fix_count`". The probe must fail. |
| 11 | DECISIONS_CONTEXT on the ci-fix spawn, curation-on arm. | Phase 10, ci-fix spawn. | Pinned in `tests/guards/implement-placement.test.ts`, in the builds that hold a decisions load. Seed: delete the field from the on arm. The probe must fail. |
| 12 | Fresh-base fail-closed rules. Output other than one BASE_REF line with exit=0 counts as `NOTE=stop` with REASON=resolver-unavailable. The stop line stops the run. The run removes the temp file on exit. | Phase 1 fresh base. | Pinned in `tests/guards/implement-placement.test.ts`, in the clause "counts as `NOTE=stop`", the stop line and the temp-file trap. `tests/guards/base-ref-guard.test.ts` pins the resolver-unavailable fix row. `tests/evidence/implement-flow.test.ts` pins the re-validation reading. Seed: delete the clause "counts as `NOTE=stop`". The probe must fail. |
| 13 | Test-plan check. Exit 0 passes. Otherwise rewrite the section once, check again, and drop the section if it still fails. A required policy asks. A standard policy does not ask. | Phase 1 intake. | Pinned in `tests/guards/implement-placement.test.ts`, in the four clauses: rewrite once, drop the section, a required policy asks and a standard policy does not ask. Seed: delete "rewrite the section once". The probe must fail. |
| 14 | Test-plan scenario text. A scenario holds no `#`, `@` or `/` (no issue reference, mention, closing keyword or URL), because the lines reach the PR body. | Phase 1 test plan. | Pinned in `tests/guards/implement-placement.test.ts`. Seed: delete "holds no `#`, `@` or `/`". The probe must fail. |
| 15 | Compliance directive. Pass it to every Code and Fix spawn. | Core settings and policy section. | Pinned in `tests/guards/implement-placement.test.ts`, in the pass sentence. `tests/guards/compliance-injection.test.ts` pins the directive clause. Seed: delete the pass sentence. The probe must fail. |
| 16 | Decisions context. Pass it to the Code agent (Phase 2) and to the Harden agent (Phase 4), curation-on arm. | Core decisions load. | Pinned in `tests/guards/implement-placement.test.ts`, in the builds that hold a decisions load. Seed: delete the pass sentence. The probe must fail. |
| 17 | Settings recovery text and the fail-closed settings line. | Core file, above the marker line. The settings partial holds the fail-closed text. | `tests/commands/settings-partial.test.ts` pins the partial. The placement above the marker line has no pin yet. Seed: delete the recovery line. The prefix probe must fail. |
| 18 | State table, with the append-only TRACEABILITY row. | Core file, above the marker line. | No pin yet. Seed: delete the TRACEABILITY row. The prefix probe must fail. |
| 19 | Argument binding. It comes after the recovery text and the fail-closed settings line. | Core file, above the marker line. | No pin yet. Seed: move the binding above the recovery text. The prefix probe must fail. |
| 20 | Fail-closed sentences of Phases 9 to 11. Each is one whole sentence. (a) Capture the `- **PR**: #{number}` line of its `### Branch` as `PR_NUMBER`, its `### Uncommitted files` list and its `TRACEABILITY: DEGRADED ({reason})` lines for the Phase 12 report. (b) If it returns `### Status: BLOCKED` or no PR number, report its reason to the user and stop at the report (Phase 12); Phases 10 and 11 do not run. (c) Any other result, a rejected non-fast-forward push included, records `TRACEABILITY: DEGRADED (ci push failed)` for the Phase 12 report, reports "CI status unknown — verify manually before merging" and proceeds to Phase 11 without waiting. (d) Any other result, a rejected non-fast-forward push included, does not block: record `TRACEABILITY: DEGRADED (evidence push failed)` for the Phase 12 report and run the script anyway. | (a) and (b): Phase 9. (c): Phase 10. (d): Phase 11. | Pinned in `tests/guards/implement-placement.test.ts`, as rows 20a to 20d, in every build. A sentence must start a sentence and end one, with its full text. Seed: delete "does not block: " from sentence (d). The probe must fail. |

## Core global rules

The core file opens with global rules that bind the whole run. Each rule has a mark. A rule marked **Yes** is never cut, and its text moves byte-equal. A new global rule joins this list with its mark, and with its guard probe, in the commit that adds it.

| No. | Rule | Never-cut | Reason |
|---|---|---|---|
| 1 | Principle 1, orchestration only | Yes | The main session only orchestrates. This rule keeps tests, builds and fixes out of it. See row 1 of the never-cut table. |
| 2 | Principle 2, honest reporting | Yes | The user sees agent outputs as the agents wrote them. See row 3 of the never-cut table. |
| 3 | Principle 3, loop limits | Yes | Each loop and each wait has a bound. See row 4 of the never-cut table. |
| 4 | Principle 4, CI awareness | Yes | The test-plan evidence exists under every strategy. See row 5 of the never-cut table. |
| 5 | Error Handling | Yes | An error report names the phase, the agent type and the error, and offers retry, investigate or escalate. See row 6 of the never-cut table. |
| 6 | State table: value, source, recover-by, never-recall, RUN_PATH, counters, and the append-only TRACEABILITY row | Yes | The table is the recovery source after a compaction. |
| 7 | Compaction rule: after a compaction or a resume, do not recall REVIEW_PUBLICATION, COMPLIANCE_DIRECTIVE, EVIDENCE_POLICY, ISSUE_REQUIRED or GATE_LEVEL. Run the settings-and-policy section again. List the `SKILL.md` headings by the path line. Read from the current step heading to the end. A counter that cannot be recalled counts as spent. | Yes | A lost value can change a publication result or a compliance result. |
| 8 | Failed-read rule: when a read of a reference fails, stop and name the file. Example: "If the Read fails, stop: implement: reference file `<name>` unreadable; run devflow init." | Yes | A silent failed read would skip a branch. |
| 9 | Build-id rule: when the first heading of a reference file does not carry the build id, stop and say that the file is from another build. | Yes | The rule stops a run that mixes builds. |
| 10 | Step map and Next lines. Each Next line carries a stop clause. | Yes | A graph test checks every Next target. A lost line breaks the flow. |
| 11 | Read-once rule: read a reference once for each run, on its branch. | Yes | A second read adds a turn and repeats the bytes in the context. |

## Architecture

### One core file

The command has one core file, `SKILL.md`. The core holds Phases 1 to 12 for a typical run.

Each serial file read adds one main-session turn, and each turn sends the full cached context again. For this reason, the core holds the whole typical path, and a reference file holds a rare branch only.

A rare branch is a path that most runs never take. A branch is rare when fewer than half of real runs enter it. Only rare branches move to reference files. No file groups phases.

### Candidate reference files

A candidate moves only when a count of real runs shows that fewer than half enter its branch. A candidate with no run data stays in the core. The cut log records the reason for each candidate.

| Candidate | Branch that it holds | The run enters when |
|---|---|---|
| base-note | The detail of the base note | `NOTE` is other than none. |
| ci-fix | The CI-fix spawn detail | CI reads FAILING and fewer than 2 fixes have run. |
| knowledge-writeback | Write-back steps 3 and 4 | KNOWLEDGE is on and write-back step 2 passes. |
| align-fix | The Phase 5 MISALIGNED arm | The Evaluate agent reports MISALIGNED. |
| validate-fix | The Phase 6 FAIL arm | The Validate agent reports FAIL. |
| qa-fix | The Phase 7 FAIL arm | The Test agent reports FAIL. |
| knowledge-match | Knowledge load steps 2 to 4 | Feature knowledge bases exist and step 3 selects one. |

The halt and the counter check of a fix arm stay in the gate step of the core. Each Next line that enters a reference file carries a short stop clause. The clause points to the one stop definition in the core.

### How a run reads a reference file

A run reads a reference file by its path line. It reads the file only when it takes that branch. After the read, it returns to the core step.

A relative path resolves against the working directory, not against the skill folder. For this reason, every Next line that enters a reference carries the path line. The path line uses the skill folder variable. A prompt never asks Bash to resolve the variable. The [live-check results](platform-assumptions.md#skill-folders-and-compaction-re-attach) record these facts.

### The marker line and the prefix

The marker line divides `SKILL.md`. The prefix is the text above the marker line.

After a compaction, Claude Code re-attaches the skill and keeps its first 20,000 characters. The cut falls at the end of the body. The text below the marker line can be lost, and the text above it must still bring the run back.

The prefix must be at most 16,660 bytes. Use this calculation:

1. Start from 20,000 characters.
2. Subtract 100 characters for the truncation notice and 300 characters for the header path. The rest is 19,600.
3. Keep 85 percent of the rest. 0.85 times 19,600 equals 16,660.

The settings recovery text and the fail-closed settings line stay above the marker line. The argument binding comes after them, because the bound input counts inside the cut. A prefix probe checks that these items sit above the marker line, in this order.

### How the build and install layers carry a folder

A converted command is a folder:

| Stage | Path |
|---|---|
| Source | `src/assets/commands/<name>/`: the core host `SKILL.mds`, the sources of the reference files, and a `references/` subfolder of fixed files |
| Build, on key | `dist/workflows/<name>/` |
| Build, other keys | The same folder under each variant tree, for example `dist/curation-off/workflows/<name>/` |
| Install | `skills/devflow:<name>/` in the Claude config directory, from the exact key of the machine only |

The build layer works in this way:

- A host that belongs to a folder declares `output-dir: dist/workflows`. The build treats it as the `workflow-skill` host variant. The host declares no `output-name`.
- The registry `WORKFLOW_FOLDERS` in `src/core/mds-variants.ts` lists each folder: its name, its core host, its reference hosts, and the compiled file name of each. A host that declares the workflow directory and is not in the registry fails the build. A folder exists only when a person registers it.
- The core host compiles to `SKILL.md`. The name rule for this variant accepts the literal `SKILL` and nothing else. The ordinary output-name rule does not change.
- The core host keeps its frontmatter, and `name` and `description` are required. A reference host sheds its frontmatter.
- The build compiles a folder as one unit. Then it writes a complete folder for each variant key. A key that lacks a file of its own list fails the build. A key that turns compliance off leaves out a file that is flagged as omitted in that case.

The install layer takes the set of folder names to install as a parameter. The set is empty until a command converts, so a build with no converted command installs no folder. The install converges when the compliance switch changes.

### The build id

The build id is the first 12 hex digits of a SHA-256 hash. The hash covers every compiled file of the folder, taken before the stamp, in file-name order. Each file enters the hash with its name, its byte length and its body. The id holds no timestamp. The same sources give the same id on every machine.

A change to any file of the folder changes the id, a file in `references/` included.

The build writes the id as ` [build <id>]` at the end of the first heading of each file outside `references/`. The files in `references/` carry no stamp and stay byte-equal to their compiled text. Every stamped file of one folder and one key carries the same id.

A run compares the first heading of each reference file that it reads with the id of the core file. If the ids differ, the run stops and says that the file is from another build.

## Cut record

Each file that a cut changes has a record in the commit body, next to the cut-log rows. The record holds:

- The compiled bytes of the file before the cut and after it. Bytes are UTF-8 bytes.
- The hosts that import the file.

A partial changes the compiled text of every host that imports it. The record lets a reader check each of those hosts.

A text cut removes text. A move keeps the text in another file. If a text cut leaves less than half of the before size, stop. Ask for a decision before the commit.

## Turns

A turn is one model call in the main session.

1. Batch independent tool calls in one turn.
2. Read a reference only on its branch.
3. Do not read back a file after a confirmed write.
4. Do not send a turn that only narrates.
