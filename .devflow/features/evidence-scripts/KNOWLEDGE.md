---
feature: evidence-scripts
name: Evidence scripts (test-plan claim and verify)
description: "Use when editing verify-evidence.cjs claim or verify, pr-evidence.cjs ladder, claim causes, stdout gates, notes. Keywords: TP line, ARMS, CLAIM_CAUSE_RE, settleShape, local-no-exit, run-failed."
category: domain-knowledge
directories: [src/assets/scripts/verify-evidence.cjs, src/assets/scripts/pr-evidence.cjs, tests/evidence]
created: 2026-11-19
updated: 2026-11-19
---

# Evidence scripts (test-plan claim and verify)

## Rules

- **KB-INV-1** Only `pr-evidence.cjs` and `verify-evidence.cjs verify` assign a TP state. A `claim` line is an input to `verify`, never a state.
- **KB-INV-2** The state ladder is the frozen `ARMS` table in `pr-evidence.cjs`. First match wins. Every arm but the last is a positive match. The last arm is UNVERIFIED. `PRECEDENCE` is derived from `ARMS`.
- **KB-INV-3** A local PASS verifies only with exit 0. A local PASS with no exit, or with an exit that is not a number from 0 to 255, reads UNVERIFIED.
- **KB-INV-4** Any failed run at the claim commit fails a ci TP, so a ci PASS then reads FAILED. No run is matched to one TP.
- **KB-INV-5** Stdout leaves the script only through `settleOutcome` and `settleShape`. A line that is not a closed shape prints nothing and exits 4.
- **KB-INV-6** Every `verify-evidence: claim: <cause>` line goes through `claimCause`. It checks the cause against `CLAIM_CAUSE_RE` at the sink.
- **KB-INV-7** A `claim` writes a line only after the claim parser of `pr-evidence.cjs` accepts it (`claimLine`). A refusal writes nothing.
- **KB-INV-8** Stdout and stderr notes use closed tokens only. No byte of a PR body, comment, run, plan, path, argv, git answer or gh answer reaches them.
- **KB-AP-1** Do not add a state decision to `verify-evidence.cjs`. Add an arm to `ARMS` and let the parity tests catch drift.
- **KB-AP-2** Do not write a `claim: <cause>` line with `io.stderr` directly. The single-writer test fails, and an input byte can reach stderr.
- **KB-AP-3** Do not put an argument, a path, a plan line or a git or gh answer into a cause. Use a template of `CLAIM_CAUSE_TEMPLATES` with digits in its slots.
- **KB-AP-4** Do not let a note change a verdict. `noteVerdict` runs after `classify` and only adds a token.
- **KB-AP-5** Do not add a stdout shape to a subcommand without adding it to `settleShape`. Unlisted output fails closed.
- **KB-AP-6** Do not add a TP-to-job link and do not claim one exists. The TP line has no CI job field (a known limit).
- **KB-AP-7** Do not read a git-tracked evidence or plan file. A tracked path, or a path git cannot answer for, counts as absent.

## Overview

A PR carries a test plan: TP lines in the PR body. A Test or Validate report becomes claim lines in an evidence file. `verify` then turns each claim into one of six states from facts it gathers (SHA ancestry, the diff since the claim, and `gh run view --attempt`). A claim is never trusted on its own.

Two scripts share the work. `pr-evidence.cjs` is pure. It owns every grammar, marker, state rule and rendering. `verify-evidence.cjs` is the I/O half. It runs gh and git through one injected exec, gathers facts, and prints one closed-vocabulary line. The unit tests (`tests/evidence/verify-evidence.test.ts`, `tests/evidence/pr-evidence.test.ts`) call `main()` with a fake exec. `main()` returns `{code, stdout}` and never calls `process.exit`. The one `require.main === module` boundary writes stdout and sets the exit code.

## The TP-line contract

A TP line has this form: `- [ ] TP-<n> (AC-<m>) <scenario> — method:<ci|local|manual>`, with an optional ` [files: <glob>, ...]` tail. The pattern is `TP_LINE_RE` in `pr-evidence.cjs`.

- The scenario reaches the PR body, so the pattern refuses `#`, `@`, `/`, `<`, `>`, a backtick, `[`, `]` and control, bidi and separator characters. Those are the characters an issue reference, a mention, a link, markup or a code span needs.
- TP numbers ascend and are unique. A plan that breaks this gives a parse error code (`order` or `duplicate`).
- `files` globs use `GLOB_RE`. A TP with no files goes STALE as soon as the claim commit is not the head.
- The contract partial (`_plan_contract.mds`) and `TP_LINE_RE` must agree. `tests/evidence/contract-parity.test.ts` compiles the contract shape and runs both over a table. Edit both together.
- A claim line has this form: `- TP-<n> <PASS|FAIL|SKIP> sha:<40 hex> by:test[ exit:<0-255>]`. The gate line is `- gate:validate PASS sha:<head> by:validate`. The pattern is `CLAIM_LINE_RE`. In an evidence file the last valid claim for a TP wins, so a claim file only grows.

## The state ladder

`classify` tries `ARMS` in this order. `tests/evidence/pr-evidence.test.ts` pins the list, and `contract-parity.test.ts` pins the contract prose to `PRECEDENCE`.

| Order | State | It matches when |
|---|---|---|
| 1 | UNVERIFIED | no usable claim, a SKIP, a claim SHA outside the PR, or TP text that no longer matches the trusted record |
| 2 | INDETERMINATE | the head is unresolved, the claim is not in the PR, a needed diff is missing, or (ci) the runs are missing, too many, at a wrong SHA or not settled |
| 3 | STALE | the claim is at an older commit and the TP has no files or the diff overlaps them |
| 4 | FAILED | a FAIL claim, a local claim with an exit other than 0, or (ci) any failed run |
| 5 | VERIFIED-CI | a ci PASS, at least one run, every latest attempt passing at the verifying SHA, each linked under this repository, and at least one `success` |
| 6 | ATTESTED-LOCAL | a local PASS with exit 0, a manual PASS, or a ci PASS whose SHA has no runs (run label `none`) |
| 7 | UNVERIFIED | the conservative default (always matches) |

Order matters. INDETERMINATE comes before STALE, so a stale ci claim still needs its runs resolved first. UNVERIFIED comes first, so a missing claim or a SKIP reads UNVERIFIED even when the head is unresolved. Passing run conclusions are `success`, `skipped` and `neutral`. Failing ones are `failure`, `timed_out` and `startup_failure`. `cancelled`, `action_required` and `stale` are unsettled, so they give INDETERMINATE.

`verify` gathers facts lazily, in ladder order, and stops at the first arm that can decide (`gatherFacts`). A fact that is absent reads as unresolved, never as a pass. When a ci claim has no runs at its own SHA and the diff does not touch the TP, `classifyTp` asks for the head's runs and re-classifies (`verifyingSha`). The head's answer replaces the first only when the head's runs resolved.

In refresh mode, `verify` reads claims from a trusted record in a PR comment. It never carries the recorded state forward. `classify` derives the state again from current facts, so a record written while CI was pending reads VERIFIED-CI later.

## Claim: appending claim lines

Form: `claim --evidence <file> --head <sha> [--plan <file>] gate | TP-<n>=<PASS|FAIL|SKIP>[:<exit>] ...`. Flags come first.

- **Usage errors (exit 1).** `parseClaimArgs` returns a usage result with a `cause`. `main` writes the cause through `claimCause`, then the usage text. Stdout stays empty. The causes are checked in a fixed order. The first one found wins: flags absent, repeated or bad; no claim; more than the TP cap of arguments; `gate` with a plan or another claim; argument k is a flag after the claims, holds two TP claims, or is not one TP claim; a TP given twice. The number k counts from 1 at the first claim argument.
- **Refusals (exit 2).** `claimRefusalReason` checks in this order: `head not one sha`; the evidence path shape or its folder (`evidence file unusable`); the plan path shape; the evidence file tracked (`evidence file tracked`); the plan file tracked (`plan file unusable`). After that, `runClaim` can refuse with `evidence file unusable` or `plan file unusable` for a file that does not read or parse. A refusal writes nothing.
- **Folder.** A missing folder below the working directory is made (`ensureClaimFolder`). `main` removes each folder it made when the run leaves no file in it (`removeMadeFolders`). A link out of the working directory makes nothing.
- **Write.** One append of every line. When `## Claims` is not the last section, `claimInsertText` puts the lines at its end, and one whole-file replace writes the result through a sibling temporary file that keeps the mode. `claimInserted` must confirm that only the Claims section grew. A failed write exits 3, and the file stays as it was.
- **Plan scope.** A TP the plan does not list gets no line and counts in `skipped`. A run that writes no line changes no file.
- **Exit field.** The `exit:` part is kept only when the claim parser accepts a number from 0 to 255. Otherwise the line is written without it.
- **Success.** One line, exit 0: `CLAIM appended:<n> PASS:<n> FAIL:<n> SKIP:<n> skipped:<n>`.

## The stdout gates

`settleShape` is the one place that decides what may print. It runs for every subcommand. The checks run in this order:

1. A non-object, an unknown exit code, or a line with no final newline gives exit 4 and empty stdout. A usage exit or an empty stdout prints nothing.
2. A `## PR Evidence` block prints only on exit 0 and only if `parsePublishBlock` parses it back. The three `TRACEABILITY: DEGRADED` lines print only with exit 2. A `## Merge Readiness` block must parse. Its exit is 2 when the status is DEGRADED, else 0.
3. `SPLICE` and `READBACK` lines match `SPLICE_LINE_RE` and `READBACK_LINE_RE`. Only `ok` and `resplice` pair with exit 0. Other outcomes pair with exit 5.
4. `CLAIM_REFUSAL_RE` accepts only four closed reasons and only with exit 2.
5. `CLAIM_APPENDED_RE` accepts the shape only with exit 0. The settle step then checks that `appended` equals PASS + FAIL + SKIP and that neither `appended` nor `skipped` exceeds the TP cap.
6. Anything else must have exit 0 and be a valid EVIDENCE line, or a test-plan block with no ticked line and no CR.

`publish` never settles to empty stdout. `settleOutcome` replaces it with the evidence unavailable line and exit 2.

The EVIDENCE line has a second gate where it is built. `gateEvidenceLine` formats the fields, parses the line again, and accepts it only when the parsed total equals the TP count. A failed gate is an output-gate refusal (exit 5).

Why so strict: every field pasted into a PR body is an action sink. The script gates it at the place it builds it, with a closed grammar, and never echoes a gh, git or PR byte.

## The stderr cause sink

D-CLAIM-CAUSE: stdout names the closed reason. Stderr names the cause that the reason hides.

- `claimCause(io, text)` writes `verify-evidence: claim: <cause>`. `CLAIM_CAUSE_RE` is built from the closed list `CLAIM_CAUSE_TEMPLATES`. A cause passes only when it is one template exactly, with digits in its slots, and has 1 to 2000 characters. A `<n>` slot holds 1 to 10 digits. A `<tps>` slot holds 2 to 200 TP ids, joined by `, `. Any other cause becomes `CLAIM_CAUSE_FALLBACK`. A new cause needs a new template row. The cause-gate tests call the exported `claimCause` with bad input and expect the fallback line. A test (`one helper writes every claim cause line…`) counts exactly one source line that holds the prefix, and checks that the helper calls `CLAIM_CAUSE_RE.test(`.
- Causes for a plan or evidence file come from `planCause` and `evidenceCause`. They name an unreadable file, a heading the file does not allow or repeats, or the rule that line k breaks. Line k counts from line 1 of the whole file. A plan read from the `## Test Plan` section (`PE.PLAN_HEADING`) adds the heading's row offset. Any other parser error code gives a fixed phrase. A file over the size cap never reaches these helpers, because `readTextFile` refuses it first.
- An insert that `claimInserted` refuses gives `the claim lines do not fit the Claims section`.
- A `claimRefusal` with a null cause writes nothing on stderr. Head, tracked evidence file and evidence path refusals use null, because the stdout reason is enough.
- A run that writes a method:local PASS line with no exit (none given, or one outside 0 to 255) adds a cause that names those TPs (`localNoExitCause`). The exit stays 0. The cause lists TP numbers as digits.

## The closed notes

`main` ends with one stderr line, `verify-evidence: notes: <tokens>`, with the tokens sorted and comma-joined. The tokens come from `io.notes`. Three matter here, and none of them changes a state.

- `evidence-ignored`: `admitPaths` dropped a tracked `--evidence` file, or one git cannot answer for, so the run went on as if the flag was absent. A tracked output path is a write failure (exit 3) and the file stays untouched.
- `local-no-exit`: the final state is UNVERIFIED, the TP is a local PASS with no exit, the claim is in the PR, and the TP text matches. The note follows the final state, so STALE, INDETERMINATE and other UNVERIFIED causes get none.
- `run-failed`: the final state is FAILED, the TP is ci, the claim is PASS, and the verdict carries a run (a failed run at the verifying SHA, from the claim's own runs or the head's). A FAIL claim gets no note.

`tests/evidence/verify-evidence.test.ts`, in the describe block for these notes, holds a quiet-rows table. Each row names a verdict that must give no `local-no-exit` note. Add a row there when you add a state path.

## Fail-closed rules

- A local PASS needs exit 0. See KB-INV-3.
- Any failed run at the claim commit fails a ci TP. There is no TP-to-job link, so one unrelated failed job fails every ci TP at that commit. This is deliberate.
- A ci PASS verifies only when every run is settled, passing, at exactly the verifying SHA, and linked under this repository's own HTML URL.
- An unlisted or malformed fact reads as unresolved. `classify` is total: a bad TP gives `NO_VERDICT` (UNVERIFIED), and a malformed claim becomes no claim.
- A run that cannot read a needed record (rate limit) gives INDETERMINATE with `sha:none` (`forceIndeterminate`).
- A closed vocabulary sends every unlisted input to the conservative verdict. Never add a default that verifies.

## Anti-Patterns

**KB-AP-1.** The ladder lives in one table so the contract prose, the code and the tests share one order. A second place that decides a state can disagree with the table, and nothing then pins them together.

**KB-AP-2 and KB-AP-3.** A cause line is read by the agent that ran `claim`. An argument or file line in it is an injection path. The sink accepts only a listed template with digits in its slots, so no caller can add its own text, a new caller included. The digits can still be wrong, so a caller must build each number from parsed values.

**KB-AP-6.** A ci TP does not name its own CI job, so the script cannot tell which run belongs to which TP. The fail-closed rule (any failed run fails the TP) is the cost of that. A per-TP job link needs a new field in `TP_LINE_RE`, the contract partial, the claim line and `verify`. Do not fake it with a name match on the scenario text.

## Gotchas

**KB-INV-3 and `local-no-exit`.** A user who passes `TP-1=PASS` for a local TP gets exit 0 and `CLAIM appended:1 …`. The TP still reads UNVERIFIED later. The only warning is the stderr cause. Read stderr.

**KB-INV-4.** A CI run that fails for an unrelated reason still fails each ci TP. The `run-failed` note says so. Fix or re-run the job, then run `verify` again.

**KB-AP-7.** Tracked-file checks ask git before any read or write. A repository where git gives no answer gives `evidence file tracked` for `claim`, and `evidence-ignored` for `verify`. The same rule serves both.

**Claims section not last.** The append path is cheap and safe. The insert path replaces the whole file, so it is held to `claimInserted`. If you change the section parser, run both paths in the tests (the claim describe block has CRLF and blank-line rows).

**Header comment is the contract.** The comment at the top of `verify-evidence.cjs` states the stdout shapes, causes, notes and exit codes. A test checks that it documents every exit code and that each design marker appears at its code site. Update the header when you change a shape or a cause.

## Key Files

- `src/assets/scripts/pr-evidence.cjs` — grammars (`TP_LINE_RE`, `CLAIM_LINE_RE`, `EVIDENCE_LINE_RE`), `ARMS`, `PRECEDENCE`, `classify`, `tally`
- `src/assets/scripts/verify-evidence.cjs` — subcommands, fact gathering (`gatherFacts`, `runsAt`), `classifyTp`, `noteVerdict`, `runClaim`, `claimCause`, `settleShape`
- `tests/evidence/verify-evidence.test.ts` — claim, cause, notes and settle tests; source-shape guards
- `tests/evidence/pr-evidence.test.ts` — pins the exports, `PRECEDENCE` and the bounds
- `tests/evidence/contract-parity.test.ts` — the contract prose against the script's grammar and precedence
- `CHANGELOG.md` — the user-facing record of the claim cause and note changes

## Related

- `.devflow/features/test-harness-prompt-install/KNOWLEDGE.md` — the harness that holds `tests/evidence` and its prompt guards
- `.devflow/features/compliance-feature-release-trace/KNOWLEDGE.md` — release evidence that reads the same evidence scripts
- `src/assets/scripts/ci-wait.cjs` — the CI wait helper that `verify-evidence.cjs` requires
