/**
 * CONTAINMENT_EXEMPTIONS — the [DR-17] rewrite exemption table.
 *
 * Data, not oracle. `tests/tracker/containment.test.ts` holds the scan and the
 * three arms that police this list (zero unaccounted baseline lines, no entry for
 * a range that is in fact still contained, every rationale at or above that file's
 * `MIN_RATIONALE_CHARS` floor); this file holds the list those arms read. The
 * table is this file's whole content, so an edit that adds or retires an exemption
 * is reviewable on its own rather than inside a test file that also carries
 * structural parity, [DR-17]'s batch-first probe, the shared-literal registry and
 * AC-2.7 reachability.
 *
 * Baseline line ranges that are deliberately NOT present byte-identically in any
 * target, each with the reason. 1-based, inclusive on both ends, addressed by the
 * baseline's basename — `git-agent.md`, `SKILL.md`, `github-api.md` under
 * tests/fixtures/tracker/baseline/, the byte copies of the tree at `101bda7`.
 *
 * This is the other half of AC-2.1 [DR-27(b)]: "the diff contains only intended
 * moves" stops being a reviewer's attention span and becomes a list someone had to
 * write a sentence for. A rewrite with no entry here is reported as a lost line.
 *
 * P2-S7 filled it. Three of the SKILL.md entries below go beyond the cut table in
 * the plan and are marked BEYOND-TABLE: the plan's `9,204 − 2,604 = 6,600`
 * derivation did not budget for the pointers P2-S7 itself mandates (the naming
 * pointer, the Extended-References row, the heredoc sentence, the protected-branch
 * pointer, the GitHub-API pointer), which cost roughly 700 characters of add-back.
 * Each BEYOND-TABLE cut removes a section that RESTATES rules already stated once
 * in the same preloaded file — the single-convergence-point rule (PF-023) the phase
 * is built on — rather than removing any rule.
 *
 * ADDING AN ENTRY: one `{ file, startLine, endLine, rationale }` block per
 * rewritten baseline range, under the `── … ──` banner naming the source file and
 * the step or issue that caused the rewrite; a new cause opens a new banner at the
 * foot rather than scattering rows through the existing groups. The rationale says
 * what the baseline line carried and what replaced it — an exemption without a
 * reason is a deletion, which is what the character floor exists to refuse.
 */

export interface ContainmentExemption {
  readonly file: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly rationale: string;
}

export const CONTAINMENT_EXEMPTIONS: readonly ContainmentExemption[] = [
  // ── skills/git/SKILL.md (P2-S7) ────────────────────────────────────────────
  {
    file: 'SKILL.md',
    startLine: 24,
    endLine: 28,
    rationale:
      'BEYOND-TABLE. The five activation bullets restate the frontmatter `description:` ' +
      'field one-for-one, and `description:` is what actually drives activation. ' +
      'Compressed to a single line; the heading survives so the skill keeps the ' +
      'template shape every other skill has.',
  },
  {
    file: 'SKILL.md',
    startLine: 73,
    endLine: 73,
    rationale:
      'The protected-branch list is duplicated from devflow:worktree-support, which is ' +
      'the canonical list (that skill is preloaded on the same spawns). Replaced by a ' +
      'pointer, so the list has one owner.',
  },
  {
    file: 'SKILL.md',
    startLine: 152,
    endLine: 152,
    rationale:
      'Related-Issues row moved to {ISSUE_REF} vocabulary. The GitHub rendering (`#N`) ' +
      'is unchanged; the row no longer hardcodes a provider-specific reference shape.',
  },
  {
    file: 'SKILL.md',
    startLine: 190,
    endLine: 190,
    rationale:
      '"remaining < 10 wait 60s" is the same D4 contradiction as :196 in prose form: D4 ' +
      'says STOP the fan-out and report THROTTLED. Rewritten to state D4\'s rule. ' +
      'Deleting :196 while leaving this line would have fixed the recipe and kept the ' +
      'contradiction.',
  },
  {
    file: 'SKILL.md',
    startLine: 196,
    endLine: 196,
    rationale:
      'DELETED, not moved: `if [ "$REMAINING" -lt 10 ]; then sleep 60; fi` directly ' +
      'contradicts the D4 degradation contract\'s STOP clause (GAP-25). Two opposed ' +
      'rate-limit policies were preloaded in one context; sleeping out an active ' +
      'secondary limit extends GitHub\'s penalty window.',
  },
  {
    file: 'SKILL.md',
    startLine: 200,
    endLine: 200,
    rationale:
      'Heading renamed `### PR Comments` → `### Comment Rules` on the move, because its ' +
      'destination in references/github-api.md already has a `## PR Comments` section ' +
      'and a same-named child would read as a second one. The three rule bullets ' +
      'underneath moved byte-identically.',
  },
  {
    file: 'SKILL.md',
    startLine: 211,
    endLine: 211,
    rationale:
      '`gh release create … --notes "$NOTES"` is an inline-body recipe in a file that is ' +
      'preloaded on every spawn, while create-release mandates --notes-file after a D11 ' +
      'scrub whose failure is a HARD fail. Rewritten as the --notes-file form; this is ' +
      'the known-bad sample the widened inline-body scan was proven red against.',
  },
  {
    file: 'SKILL.md',
    startLine: 214,
    endLine: 214,
    rationale:
      'The "See references/github-api.md" pointer was rewritten to name what actually ' +
      'moved there (throttling, PR-comment rules, releases) instead of the generic ' +
      '"extended API, CLI, and GraphQL patterns".',
  },
  {
    file: 'SKILL.md',
    startLine: 218,
    endLine: 228,
    rationale:
      'BEYOND-TABLE. Every row of the Anti-Patterns table restates a rule already stated ' +
      'in its own section above (Sequential Operations, Atomic Grouping, Sensitive File ' +
      'Detection, Branch Safety, GitHub API, Description Sections) — and ' +
      'references/violations.md, already listed under Extended References, is the named ' +
      'authority for git/PR anti-patterns. A third copy in the preloaded file is what ' +
      'PF-023 forbids.',
  },
  {
    file: 'SKILL.md',
    startLine: 252,
    endLine: 261,
    rationale:
      'The Naming Conventions Authority block is replaced by a one-line pointer to ' +
      'learn-conventions, which owns .devflow/conventions.md. The `≤50 branches` bound ' +
      'survives in that pointer so it is stated exactly once across git.md ∪ ' +
      'skills/git/** (GAP-25).',
  },

  // ── dist/agents/git.md (P2-S4 — the invariant/detector split) ──────────────
  //
  // These seven ranges are the ONLY deliberate rewrites of always-loaded text in
  // the phase. Each one carried BOTH halves of P2-S4's table in a single sentence:
  // an invariant that must stay and a GitHub detector that must not. No relocation
  // of verbatim text can split a sentence, so the invariant half is rewritten in
  // place and the detector half is restated in the GitHub provider reference.
  // These bytes are the reason the github-status-lines re-capture was authorised.
  {
    file: 'git-agent.md',
    startLine: 24,
    endLine: 25,
    rationale:
      'D4 remote-unavailable and secondary-rate-limit conditions. `:24` named `gh` as the ' +
      'authentication that can fail and `:25` carried the GitHub signal (403/429 with a ' +
      'rate-limit body, `X-RateLimit-Remaining` header < 10) inside the same sentence as the ' +
      'STOP/THROTTLED invariant. Rewritten provider-neutrally ("a provider-signalled secondary ' +
      'rate limit"); the STOP clause, the THROTTLED report and the DEGRADED reason are ' +
      'byte-unchanged, and the signal is now stated once in the GitHub reference.',
  },
  {
    file: 'git-agent.md',
    startLine: 28,
    endLine: 28,
    rationale:
      'D4 backpressure rung. The `X-RateLimit-Remaining` < 50 threshold is a GitHub signal; the ' +
      '1s → 3s delay it triggers is a policy bound and §14.3 keeps policy bounds in the contract ' +
      'layer. The sentence is rewritten so the bound stays and the signal moves.',
  },
  {
    file: 'git-agent.md',
    startLine: 45,
    endLine: 45,
    rationale:
      'D11 scope sentence said "posts or edits a body to GitHub". The scrub is unconditional for ' +
      'EVERY provider, so naming one made the rule read as GitHub-only the moment a second ' +
      'provider exists. Rewritten to "to the tracker"; "unconditionally" and the rest are unchanged.',
  },
  {
    file: 'git-agent.md',
    startLine: 50,
    endLine: 50,
    rationale:
      'The `&& gh …` half of the D11 shell-discipline fence. The scrubber invocation on `:49` ' +
      'STAYS — making the containment control loadable is PF-027\'s failure mode — and only the ' +
      'provider\'s post command becomes a placeholder. The concrete GitHub chain is stated once ' +
      'in the GitHub reference, where the `&&` discipline is restated with it.',
  },
  {
    file: 'git-agent.md',
    startLine: 968,
    endLine: 968,
    rationale:
      '`## Principles` item 1 restated both rate-limit thresholds in prose, in a cross-cutting ' +
      'section every spawn loads. Rewritten to keep the 1s/3s policy bounds and the STOP rule ' +
      'and to defer both signals to the provider — otherwise the D4 cut would have been half a fix.',
  },
  {
    file: 'git-agent.md',
    startLine: 990,
    endLine: 990,
    rationale:
      '`## Boundaries` suggested `gh pr create` to the orchestrator. A provider CLI named in ' +
      'always-loaded escalation text is a detector like any other; the advice is kept, the tool ' +
      'name dropped.',
  },

  // ── Scrutinize pass: defects found reviewing the split ─────────────────────
  {
    file: 'git-agent.md',
    startLine: 715,
    endLine: 715,
    rationale:
      'resolve-review-threads D4 clause, CUT to its op-specific arms. Both GitHub rate-limit ' +
      'signals — the `X-RateLimit-Remaining` < 10 STOP and the < 50 backpressure rung — left ' +
      'this line; what stays is the no-PR arm, the 4xx arm and the 5xx retry, which are this ' +
      'op\'s own. `:25` and `:28` already hold the STOP rule and the 1s → 3s bound ' +
      'provider-neutrally, and the thresholds they defer to now live in the `devflow:git` ' +
      'skill\'s `references/github-api.md`, which SKILL.md\'s always-loaded throttling row ' +
      'names — so the batch op that has no generated tracker reference can still reach both. ' +
      'This makes resolve-review-threads state its rate limiting exactly as its sibling ' +
      'backlink-shipped-issues does: one policy in the contract, one threshold in a GitHub ' +
      'reference, and no restatement in always-loaded text.',
  },
  {
    file: 'git-agent.md',
    startLine: 910,
    endLine: 910,
    rationale:
      'ensure-traceable-issue D3 pointer, REPOINTED. The pre-split line sent the reader to the ' +
      '"Traceability Issue Template (D3)" section of the devflow:git skill; P2-S7 deleted that ' +
      'section from SKILL.md and the template now sits in this same generated reference. The ' +
      'pointer named a location that no longer exists (ADR-003). The untrusted-interpolation ' +
      'rule and the D11 clause on the same line are byte-unchanged.',
  },
  {
    file: 'github-api.md',
    startLine: 248,
    endLine: 248,
    rationale:
      'create_release()\'s publish call, RE-INDENTED by two spaces as the second arm of an `&&` ' +
      'chain. The pre-split recipe published `--notes-file "$DEVFLOW_BODY"` while create-release ' +
      'mandates the `$DEVFLOW_NOTES_RAW`/`$DEVFLOW_NOTES` pair (git-agent.md:498), so the recipe ' +
      'published either empty notes or an unrelated body already staged in the same spawn. The ' +
      'call now follows the scrub it depends on, chained with `&&` per D11 — the command itself ' +
      'is otherwise unchanged.',
  },

  // ── dist/agents/git.md (P2-S6) ─────────────────────────────────────────────
  {
    file: 'git-agent.md',
    startLine: 541,
    endLine: 541,
    rationale:
      'DR-17 commit B: gather-release-evidence step 4 REWRITTEN, not relocated. The ' +
      'pre-split line resolves closing references with one `gh api` call PER COMMIT — up ' +
      'to 100 remote calls for a 100-commit range (GAP-26). Commit A moved it verbatim; ' +
      'commit B replaced it in the reference with a batch-first paged GraphQL query, ' +
      'PR-number dedup and a ≤25 bounded sequential fallback. This is the phase\'s ' +
      'ONE deliberate rewrite of moved text, and its RED proof is the collector at the ' +
      'foot of this file, driven over this same baseline.',
  },

  {
    file: 'SKILL.md',
    startLine: 232,
    endLine: 232,
    rationale:
      'The D3 template heading moved into the ensure-traceable-issue reference DEMOTED to ' +
      '`###`. extractOpSectionFromCorpus slices an op section at the next UNFENCED `\\n## `, ' +
      'and this heading sits outside any fence, so at level 2 it would hide the rest of that ' +
      'reference from every union-mode guard (PF-063). The prohibition is now structural and ' +
      'asserted in tests/tracker/reference-structure.test.ts. ' +
      'The template body, its fence and its Rules bullets moved byte-identically.',
  },

  // ── skills/git/references/github-api.md (P2-S7 fallout) ────────────────────
  {
    file: 'github-api.md',
    startLine: 19,
    endLine: 20,
    rationale:
      'check_rate_limit\'s "wait, then continue" is the same D4 contradiction the ' +
      'SKILL.md sleep-60 line was cut for, in a file the Git agent loads. Rewritten to ' +
      'emit TRACEABILITY: DEGRADED (rate limited) and return non-zero so the caller STOPs.',
  },
  {
    file: 'github-api.md',
    startLine: 24,
    endLine: 24,
    rationale:
      'The `check_rate_limit` call site now honours the STOP: the loop runs only on a clean ' +
      'check (`check_rate_limit && for issue in …`). Leaving the bare call would have made ' +
      'the rewritten function advisory; the `|| exit 1` this first carried would have killed ' +
      'the caller\'s shell instead of reporting, which is the overshoot #339-resolve removed.',
  },
  {
    file: 'github-api.md',
    startLine: 250,
    endLine: 250,
    rationale:
      'Complete Release Flow posted release notes inline (`--notes "$changelog"`). It sits ' +
      'in the same file as the --notes-file recipe moved in from SKILL.md, so leaving it ' +
      'would have re-created the two-authorities defect one section apart. The multi-line ' +
      'form was invisible to a single-line scan, which is why it needed fixing by hand.',
  },

  // ── skills/git/references/github-api.md → per-op tracker references (P2-S8) ─
  {
    file: 'github-api.md',
    startLine: 137,
    endLine: 137,
    rationale:
      'The `## Issue Operations` container heading has no single destination: its four ' +
      'subsections went to four different operations (fetch-issue, ensure-traceable-issue, ' +
      'manage-debt). Carrying the heading into one of them would have implied the other ' +
      'three live there too.',
  },
  {
    file: 'github-api.md',
    startLine: 184,
    endLine: 184,
    rationale:
      'Tech-debt add: `gh issue comment … --body "$new_item"` became `--body-file ' +
      '"$DEVFLOW_BODY"` on the move. manage-debt is a D11 posting sink, and moving the ' +
      'inline form verbatim would have created a NEW D11 bypass inside the tracker ' +
      'reference tree — the inline-body exclusion list freezes named github-api.md text ' +
      'only, so a moved copy is a new offender by construction.',
  },
  {
    file: 'github-api.md',
    startLine: 202,
    endLine: 202,
    rationale:
      'Tech-debt archive back-link: same rewrite, same reason as :184.',
  },
  {
    file: 'github-api.md',
    startLine: 283,
    endLine: 283,
    rationale:
      '`## Branch Name from Issue` moved into the setup-task reference DEMOTED to `###`. ' +
      'extractOpSectionFromCorpus slices an op section to the next UNFENCED `\\n## `, and this ' +
      'heading sits outside any fence, so at level 2 it would truncate every union-mode guard ' +
      'at that point (PF-063); the prohibition is asserted in reference-structure.test.ts. ' +
      'The recipe itself moved byte-identically.',
  },
  {
    file: 'github-api.md',
    startLine: 466,
    endLine: 467,
    rationale:
      'batch_api_calls had the third `sleep 60` wait-and-continue. Rewritten to break out ' +
      'of the fan-out after emitting the DEGRADED line, which is what D4 requires and what ' +
      'the caller reports as THROTTLED ({n} not processed).',
  },

  // ── skills/git/references/github-api.md — the D11 inline-body recipes (#340) ─
  //
  // Eleven lines across ten recipes, each REWRITTEN in place into the
  // scrub-then-post chain D11 mandates: compose to `$DEVFLOW_BODY_RAW`, run
  // redact-secrets.cjs, and post the scrubbed `$DEVFLOW_BODY` through
  // `--body-file` / `-F body=@`, chained with `&&` so a non-zero scrubber exit
  // means DO NOT POST. Nothing relocated — a recipe that posts a body inline is
  // loadable instruction text showing an agent how to bypass the comment-sink
  // scrub (PF-027), and the file already carried the corrected form one section
  // away in create_release(), so it contradicted itself.
  {
    file: 'github-api.md',
    startLine: 88,
    endLine: 88,
    rationale:
      '#340. The inline-comment `gh api` call, RE-INDENTED by two spaces as the second arm ' +
      'of the `&&` chain the scrub now leads — same shape, and the same reason, as the ' +
      'create_release publish call exempted at :248.',
  },
  {
    file: 'github-api.md',
    startLine: 91,
    endLine: 91,
    rationale:
      '#340. `-f body="$COMMENT_BODY"` posted an unscrubbed inline body to a PR review ' +
      'comment — a D11 sink. Rewritten to `-F body=@"$DEVFLOW_BODY"`, the file-ref form ' +
      'git.md prescribes, preceded by the scrubber invocation that produces that file.',
  },
  {
    file: 'github-api.md',
    startLine: 313,
    endLine: 313,
    rationale:
      '#340. The HEREDOC PR-body recipe built `--body "$(cat <<EOF …)"`. The heredoc now ' +
      'writes `$DEVFLOW_BODY_RAW` and the scrub chains into ' +
      '`gh pr create … --body-file "$DEVFLOW_BODY"`. A PR body publishes at repo ' +
      'visibility, so it is a D11 sink like any comment (git.md step 4a).',
  },
  {
    file: 'github-api.md',
    startLine: 328,
    endLine: 328,
    rationale:
      '#340. The draft-PR recipe posted its body inline. Rewritten to compose, scrub and ' +
      'post `--body-file "$DEVFLOW_BODY"`; draft status does not exempt a body from the ' +
      'scrub, because a draft PR is as visible as any other.',
  },
  {
    file: 'github-api.md',
    startLine: 334,
    endLine: 334,
    rationale:
      '#340. `gh pr review --approve --body "…"` is a posting sink with no scrub. Rewritten ' +
      'to the composed-scrubbed-`--body-file` chain; the review verdict flag is unchanged.',
  },
  {
    file: 'github-api.md',
    startLine: 336,
    endLine: 336,
    rationale:
      '#340. Same rewrite as :334 for the `--request-changes` review, whose heredoc body ' +
      'now lands in `$DEVFLOW_BODY_RAW` before the scrub rather than in an inline `$(cat)`.',
  },
  {
    file: 'github-api.md',
    startLine: 504,
    endLine: 504,
    rationale:
      '#340. An "assumes success" VIOLATION example that also modelled an inline `--body`. ' +
      'The violation it teaches is unchanged — the exit status is still ignored — but the ' +
      'body now comes from `--body-file "$DEVFLOW_BODY"`, so the sample stops teaching a ' +
      'second defect it never meant to.',
  },
  {
    file: 'github-api.md',
    startLine: 541,
    endLine: 541,
    rationale:
      '#340. The "missing commit_id" VIOLATION example carried `-f body="Comment"`. Now ' +
      '`-F body=@"$DEVFLOW_BODY"`: the missing `commit_id` is still the defect on display, ' +
      'and the body no longer demonstrates a D11 bypass alongside it.',
  },
  {
    file: 'github-api.md',
    startLine: 545,
    endLine: 545,
    rationale:
      '#340. Same rewrite as :541 inside the "no rate limiting between comments" VIOLATION ' +
      'loop; the absent throttle is still what the sample illustrates.',
  },
  {
    file: 'github-api.md',
    startLine: 552,
    endLine: 552,
    rationale:
      '#340. The "non-draft for WIP" VIOLATION example. `--body "Not ready yet"` became ' +
      '`--body-file "$DEVFLOW_BODY"`; the missing `--draft` flag is still the violation.',
  },
  {
    file: 'github-api.md',
    startLine: 638,
    endLine: 638,
    rationale:
      '#340. The review-thread reply mutation passed `-f body="$REPLY_BODY"` inline. ' +
      'Rewritten to `-F body=@"$DEVFLOW_BODY"` after the scrub, which is exactly the ' +
      'file-ref form git.md\'s resolve-review-threads step 2 already mandates — the recipe ' +
      'and the operation that uses it now agree.',
  },

  // ── the sinks a single-line pattern could not see (#341) ───────────────────
  //
  // Three recipes whose bodies are attached to a `\`-continued command, so the
  // flag sits four lines below its `gh` verb and no single-line scan reached it.
  // Each is REWRITTEN in place into the same scrub-then-post chain #340 applied
  // to this file's one-line recipes: compose to the RAW file, run
  // redact-secrets.cjs, post the scrubbed file. The guard now folds continuations
  // before matching, so the shape that hid them is gone as well (ADR-025 — the
  // widening lands in the same commit as the content it catches).
  {
    file: 'github-api.md',
    startLine: 149,
    endLine: 149,
    rationale:
      '#341. `gh issue create \\` is now the second arm of the `&&` chain the scrub leads, ' +
      'so it is indented two spaces — the same re-indentation, for the same reason, as the ' +
      'create_release publish call exempted at :248.',
  },
  {
    file: 'github-api.md',
    startLine: 153,
    endLine: 153,
    rationale:
      '#341. `--body "$(cat <<\'EOF\'` built the issue body inline from a command ' +
      'substitution, which cannot be scrubbed at all. The heredoc now writes ' +
      '`$DEVFLOW_BODY_RAW` and the create posts `--body-file "$DEVFLOW_BODY"`; the heredoc ' +
      'content itself moved byte-identically.',
  },
  {
    file: 'github-api.md',
    startLine: 189,
    endLine: 189,
    rationale:
      '#341. `gh issue close … --comment "## Archived` attached a posted body to a close. ' +
      'The close now carries no body at all and the archive note goes through ' +
      '`post_scrubbed`, the helper this same recipe already defines — a comment on a close ' +
      'is published exactly like a comment on anything else.',
  },
  {
    file: 'github-api.md',
    startLine: 191,
    endLine: 191,
    rationale:
      '#341. `**Continued in:** (see linked issue)` was a placeholder the recipe posted ' +
      'BEFORE the successor existed, then followed with a second comment carrying the real ' +
      'number. Ordering the chain create-then-comment lets one scrubbed archive comment ' +
      'name the real successor, so the placeholder has nothing left to stand in for.',
  },
  {
    file: 'github-api.md',
    startLine: 193,
    endLine: 193,
    rationale:
      '#341. The successor create is captured as `new_url=` rather than assigned straight ' +
      'to `TECH_DEBT_ISSUE`, because the number is now derived from the URL `gh issue ' +
      'create` prints. The `--title`/`--label` lines below it are byte-unchanged.',
  },
  {
    file: 'github-api.md',
    startLine: 196,
    endLine: 200,
    rationale:
      '#341. The successor issue\'s body moved out of an inline `--body "…"` into ' +
      '`$DEVFLOW_BODY_RAW`, so the create posts `--body-file "$DEVFLOW_BODY"` and the ' +
      'closing `" \\` disappears with the inline string. `--json number -q \'.number\'` ' +
      'went with it: `gh issue create` has no `--json` flag, so that arm could only ever ' +
      'have produced an empty issue number. The `## Items` line inside the range is ' +
      'unchanged and still contained.',
  },
  {
    file: 'github-api.md',
    startLine: 257,
    endLine: 257,
    rationale:
      '#341. `gh release create` re-indented two spaces as the second arm of the scrub ' +
      'chain, same shape as :149 and :248.',
  },
  {
    file: 'github-api.md',
    startLine: 259,
    endLine: 259,
    rationale:
      '#341. `--notes-file CHANGELOG.md` published the working file directly, bypassing the ' +
      'scrubber that every other release recipe in this file runs. redact-secrets.cjs takes ' +
      'any input path, so CHANGELOG.md is now its input and `$DEVFLOW_NOTES` is what ships.',
  },

  // ── the unquoted expansions the move carried across verbatim (#339-resolve) ─
  //
  // security-06: a bare `$VAR` was a local habit in a skill reference; inside a
  // generated reference it is shell an agent copies. Each is quoted in place and
  // nothing else in the recipe moves, so the only baseline lines these rewrites
  // cost are the ones that carried the unquoted expansion itself. The compose-step
  // `&&` chaining landed in the same commit but owes nothing here — every line it
  // touched was already exempted by #340/#341.
  //
  // The first four rows are security-06's own; the six after them finish the sweep
  // over the sibling recipes the same file still carried, so the group is the whole
  // set rather than the half one issue happened to name.
  {
    file: 'github-api.md',
    startLine: 84,
    endLine: 86,
    rationale:
      '#339-resolve. `echo $REPO_INFO` twice and `gh pr view $PR_NUMBER` once handed ' +
      'unquoted expansions to word splitting and globbing in the inline-comment recipe. ' +
      'Quoted in place as `"$REPO_INFO"` and `"$PR_NUMBER"`; the `cut` pipelines and the ' +
      '`--json headRefOid` projection are byte-unchanged.',
  },
  {
    file: 'github-api.md',
    startLine: 176,
    endLine: 176,
    rationale:
      '#339-resolve. The tech-debt size probe read `gh issue view $TECH_DEBT_ISSUE` ' +
      'unquoted — the one variable in this recipe derived from `gh issue create` stdout. ' +
      'Quoted to `"$TECH_DEBT_ISSUE"` in the same edit that made the successor number a ' +
      'checked digit run, so the value is parsed at its source and quoted at its sink.',
  },
  {
    file: 'github-api.md',
    startLine: 179,
    endLine: 179,
    rationale:
      '#339-resolve. `[ $body_length -gt $MAX_SIZE ]` splits on an empty or spaced operand ' +
      'and reports a shell error instead of a comparison, so the archive branch it guards ' +
      'would be skipped silently. Both operands quoted; the 60000-char threshold is ' +
      'unchanged, and so is the branch body underneath it.',
  },
  {
    file: 'github-api.md',
    startLine: 209,
    endLine: 209,
    rationale:
      '#339-resolve. `gh issue view $ISSUE` sits downstream of the command layer\'s ' +
      'forward-the-token-verbatim rule, so what reaches it is attacker-influenceable text. ' +
      'Quoted to `"$ISSUE"` where the line now lives, in fetch-issue\'s mechanics; the ' +
      'criteria and dependency extraction below it moved byte-identically.',
  },
  {
    file: 'github-api.md',
    startLine: 70,
    endLine: 70,
    rationale:
      '#339-resolve. `gh issue view $ISSUE` in the Error Handling recipe kept the unquoted ' +
      'expansion its fetch-issue sibling lost, so the same attacker-influenceable text still ' +
      'reached word splitting one section away. Quoted to `"$ISSUE"`; the `--json body` ' +
      'projection and the emptiness check under it are byte-unchanged.',
  },
  {
    file: 'github-api.md',
    startLine: 94,
    endLine: 94,
    rationale:
      '#339-resolve. `-F line=$LINE_NUMBER` handed gh an unquoted operand inside the ' +
      'inline-comment `&&` chain — the one line of that recipe the #340 rewrite left bare. ' +
      'Quoted to `-F line="$LINE_NUMBER"`; the flag, the field name and the trailing ' +
      'continuation backslash are byte-unchanged.',
  },
  {
    file: 'github-api.md',
    startLine: 107,
    endLine: 107,
    rationale:
      '#339-resolve. `gh pr diff $PR_NUMBER --name-only` piped an unquoted expansion into ' +
      'grep inside `is_line_in_diff`, the predicate that decides whether a comment may be ' +
      'posted at all. Quoted to `"$PR_NUMBER"`; the `--name-only` projection and the ' +
      'anchored grep are byte-unchanged.',
  },
  {
    file: 'github-api.md',
    startLine: 111,
    endLine: 111,
    rationale:
      '#339-resolve. The line-level arm of that same predicate carried the identical ' +
      'unquoted `gh pr diff $PR_NUMBER`. Quoted to `"$PR_NUMBER"` in the same edit as the ' +
      'name-only arm above, so the two halves of one predicate cannot drift apart again; ' +
      'the pipeline and both anchored greps are byte-unchanged.',
  },
  {
    file: 'github-api.md',
    startLine: 351,
    endLine: 351,
    rationale:
      '#339-resolve. `gh pr view $PR --json title,body,state,author,reviews,commits` is the ' +
      'batch-field-selection recipe an agent copies verbatim, and it read `$PR` unquoted. ' +
      'Quoted to `"$PR"`; the field list is byte-unchanged, and the `### Query Violations` ' +
      'examples are left as written — those exist in order to be wrong.',
  },
  {
    file: 'github-api.md',
    startLine: 421,
    endLine: 421,
    rationale:
      '#339-resolve. `gh run watch $RUN_ID` took an unquoted expansion straight out of ' +
      '`gh run list`\'s stdout — parsed command output at a sink, which is where PF-023 puts ' +
      'the invariant. Quoted to `"$RUN_ID"`; the `gh workflow run` call and the `sleep 5` ' +
      'above it are byte-unchanged.',
  },

  // ── the batch projection a wave round reads (#339-resolve) ─────────────────
  //
  // performance-03's E1 follow-on: `fetch-issues-batch` is the op a wave round
  // names to refresh its ticket set, but its per-issue selection projected no
  // `state`, so a ticket closed out of band read exactly like an open one. The
  // field is added to the selection where the selection lives — the generated
  // mechanics — and rendered outside the `<untrusted-issue-body>` wrapper,
  // because a tracker-computed enum is not remote prose.
  {
    file: 'git-agent.md',
    startLine: 319,
    endLine: 320,
    rationale:
      '#339-resolve. Both per-issue GraphQL alias lines WIDENED by one field: `state` now ' +
      'sits between `title` and `body` in the selection, so a wave round refreshing the ' +
      'batch can see a ticket closed out of band instead of re-planning a closed one. ' +
      'Every other field on both lines is byte-unchanged, and the lines themselves moved ' +
      'to fetch-issues-batch\'s mechanics in P2-S6 before this widened them.',
  },

  // ── one D4 stop-and-report spelling in github-api.md (#339-resolve) ────────
  //
  // security-05 / reliability-04 / consistency-12: three sites answered one D4 rule
  // three ways — `exit 1`, `return 1`, `break` — while two of the three probes pinned
  // an optimistic `|| echo "100"` on failure and the third pinned nothing at all, which
  // is the fail-open the STOP rule exists to refuse. Every probe is now read through a
  // digit-run `case` before it is compared, and the convention is stated once in the
  // head-of-file D4 note: inside a function, echo TRACEABILITY: DEGRADED and `return 1`;
  // at top level, the echo IS the response and the call sits in the branch a healthy
  // probe reaches. The baseline lines this costs are the two probe reads that carried
  // the old fallback and the two SKILL.md lines whose destination fence was
  // restructured around them.
  {
    file: 'SKILL.md',
    startLine: 195,
    endLine: 195,
    rationale:
      '#339-resolve. `REMAINING=$(gh api rate_limit --jq \'.resources.core.remaining\')` had ' +
      'no fallback at all, so a failed probe left REMAINING empty, `[ "" -lt 10 ]` errored, ' +
      'and the branch that exists to stop the fan-out was skipped. The read now pins the ' +
      'empty string and a digit-run `case` degrades it to a STOP with its own reason.',
  },
  {
    file: 'SKILL.md',
    startLine: 197,
    endLine: 197,
    rationale:
      '#339-resolve. The 1s inter-call throttle survives verbatim but is indented into the ' +
      'branch a healthy probe reaches, beside the call it throttles — that is what makes the ' +
      'top-level STOP structural rather than advisory, because a failed probe can no longer ' +
      'fall through to the call. The instruction and its trailing comment are unchanged.',
  },
  {
    file: 'github-api.md',
    startLine: 14,
    endLine: 14,
    rationale:
      '#339-resolve. `check_rate_limit`\'s `|| echo "100"` answered a failed probe with a ' +
      'fabricated "plenty of quota", so the helper reported healthy in exactly the case where ' +
      'it could not tell. The fallback now pins the empty string and the digit-run `case` ' +
      'above the comparison returns 1 with a DEGRADED line, matching both siblings.',
  },
  {
    file: 'github-api.md',
    startLine: 463,
    endLine: 463,
    rationale:
      '#339-resolve. `batch_api_calls` carried the same optimistic `|| echo "100"`, one loop ' +
      'iteration away from deciding whether to keep fanning out. Same fallback and same ' +
      'digit-run `case`, whose unreadable-probe arm sets the stop reason that the post-loop ' +
      'THROTTLED report names alongside the count of items never attempted.',
  },

  // -------------------------------------------------------------------------
  // #325. Provider-neutralisation of the tracker operations' always-loaded
  // wording. Phase 2 reserved this decision for Phase 3 because it could not be
  // taken with one provider registered: a cell reading "Fetch GitHub issue" was
  // simply true. With three providers it is false for two of them, in a table
  // and in three op descriptions that every Git spawn preloads regardless of
  // which tracker resolved. Each entry below is a REWRITE, not a move — the
  // words changed — which is exactly what CONTAINMENT_EXEMPTIONS is for.
  // -------------------------------------------------------------------------
  {
    file: 'git-agent.md',
    startLine: 68,
    endLine: 69,
    rationale:
      '#325. The `## Operations` table\'s two fetch rows read "Fetch GitHub issue" and "Fetch ' +
      'multiple GitHub issues" in a provider-blind, always-loaded position. Both are tracker ' +
      'operations whose provider is resolved per spawn, so the cells are wrong for jira and ' +
      'linear and right for one of three. Rewritten to "tracker issue(s)" — the vocabulary the ' +
      'phase artifact uses — with nothing else in either row touched.',
  },
  {
    file: 'git-agent.md',
    startLine: 81,
    endLine: 81,
    rationale:
      '#325. The same defect in `ensure-traceable-issue`\'s table cell: "Create or enrich a ' +
      'GitHub issue from the D3 template". The D3 template is provider-independent (each ' +
      'provider\'s mechanics state how it is attached), so only the provider name was wrong. ' +
      'Rewritten to "a tracker issue"; the D5 marker and the whole parameter column are ' +
      'byte-unchanged.',
  },
  {
    file: 'git-agent.md',
    startLine: 310,
    endLine: 310,
    rationale:
      '#325. `fetch-issues-batch`\'s own one-line description, the op-body twin of the table ' +
      'cell above. Left alone it would have contradicted the cell it duplicates — the table ' +
      'saying "tracker issues" and the operation two hundred lines later saying "GitHub ' +
      'issues" — which is a worse end state than either wording alone. Same one-word rewrite.',
  },
  {
    file: 'git-agent.md',
    startLine: 890,
    endLine: 890,
    rationale:
      '#325. `ensure-traceable-issue`\'s own description, the twin of its table cell. Two words ' +
      'changed: "GitHub issue" to "tracker issue", and "the issue number" to "the issue ' +
      'reference" — under a non-github provider what the operation returns is a key, and ' +
      '§14.1 fixes ISSUE_REF as the provider-canonical rendered form. The spawn-key ' +
      '`ISSUE_NUMBER` is untouched everywhere (§14.5 keeps it at all 14 sites); this is prose.',
  },
  {
    file: 'git-agent.md',
    startLine: 850,
    endLine: 853,
    rationale:
      '#325. `backlink-shipped-issues` step 0 required every `SHIPPED_ISSUES` entry to be ' +
      '"digits only" — a GitHub SHAPE in a provider-blind, always-loaded position, which made ' +
      'the operation unreachable under jira and linear (every `PROJ-1` dropped, and the step ' +
      'is the entry gate). The step now defers to the resolved provider\'s anchored reference ' +
      'grammar, stated and enforced by that provider\'s mechanics, and the github grammar ' +
      '`^#?[1-9][0-9]{0,8}$` moved INTO the github reference with the same drop rule and the ' +
      'canonical per-ref DEGRADED reason — so the gate is not weakened, it is relocated to ' +
      'where enforcement lives. The metacharacter rationale went with it: all three provider ' +
      'mechanics now say the anchored form is what keeps a reference out of a query or a ' +
      'command, and git.md\'s input contract already states the shape-gate-at-the-sink rule ' +
      'once, so restating it here was the duplication GAP-37 forbids. Net effect on the ' +
      'always-loaded file is 33 characters SHORTER.',
  },
  {
    file: 'git-agent.md',
    startLine: 555,
    endLine: 555,
    rationale:
      '#325, Scrutinize pass. `gather-release-evidence`\'s `### SHIPPED_ISSUES` output template ' +
      '— the PRODUCER instruction for the list the two entries below consume. It asked for ' +
      '"issue numbers" in a provider-blind, always-loaded position, so under jira or linear it ' +
      'asked the agent to EMIT a shape the resolved provider does not use, while the consuming ' +
      'operation\'s step 0 had already been rewritten to validate entries against that ' +
      'provider\'s own anchored grammar (the 850-853 entry). One word, "numbers" to ' +
      '"references", matching §14.1\'s ISSUE_REF vocabulary and the `ensure-traceable-issue` ' +
      'entry above. The `≤50` bound and the separator wording are byte-unchanged.',
  },
  {
    file: 'git-agent.md',
    startLine: 844,
    endLine: 844,
    rationale:
      '#325, Scrutinize pass. `backlink-shipped-issues`\'s input-contract line, which sat four ' +
      'lines above the step-0 gate the 850-853 entry relocated: the gate now defers to the ' +
      'resolved provider\'s anchored grammar while the contract immediately above it still ' +
      'called the entries "numbers" — the same file contradicting itself within one operation. ' +
      'Same one-word rewrite; both separator spellings and the `SHIPPED_ISSUES` parameter name ' +
      'are byte-unchanged.',
  },
  {
    file: 'git-agent.md',
    startLine: 861,
    endLine: 861,
    rationale:
      '#325, Scrutinize pass. The same operation\'s loop header, "For each issue number in ' +
      '`SHIPPED_ISSUES`". Under jira and linear the iteration is over keys, not numbers. The ' +
      'rest of the line is byte-unchanged, the ≤50 cap and the TRUNCATED clause included — ' +
      'among them "never report the status as `COMPLETE` while issues went unprocessed", which ' +
      'is the release-facing half of the same gate and was deliberately left alone.',
  },

  // ── #325, alignment pass: the last GitHub signal in a tracker op's D4 line ──
  {
    file: 'git-agent.md',
    startLine: 846,
    endLine: 846,
    rationale:
      '#325, alignment pass (M4). The same operation\'s `**Degradation (D4):**` line named ' +
      'GitHub\'s rate-limit SIGNAL — a 403/429 rate-limit response or `X-RateLimit-Remaining` ' +
      '< 10 — in a provider-blind, always-loaded position. Under jira and linear the winning ' +
      'contract therefore keyed the full-STOP rung on a header neither provider ever sends, ' +
      'while those providers\' own mechanics say there is no pre-emptive rung at all: a rung ' +
      'that can never engage reads as coverage and is none. The sentence is DELETED rather ' +
      'than reworded because both of its halves already exist provider-neutrally and deleting ' +
      'it leaves the end state rather than a pointer restating an always-loaded rule. `:28` ' +
      'states the rung itself ("A provider-signalled secondary rate limit … STOP the current ' +
      'fan-out operation immediately; report remaining items as `THROTTLED ({n} not ' +
      'processed)`") and defers the signal to "the resolved provider\'s reference"; `:31` names ' +
      'this operation as one of D4\'s two batch ops; and `### Provider signals (GitHub)` in ' +
      'the github mechanics holds both thresholds, which is where the 850-853 entry above ' +
      'already relocated this operation\'s reference grammar. A third restatement in the op ' +
      'body was the duplication GAP-37 forbids. The unavailability rung and the 4xx/5xx rungs ' +
      'on this line are byte-unchanged; net effect on the always-loaded file is 163 characters ' +
      'SHORTER, which is what funded the `## Tracker input contract` rendering rule (M2).',
  },

  // ── #325, resolve pass: the D11 staging files gain a lifetime ──────────────
  {
    file: 'git-agent.md',
    startLine: 59,
    endLine: 59,
    rationale:
      'security-01/security-08. The D11 temp-file sentence stated CREATION and nothing else, so ' +
      'the four staging files it names were created per invocation and removed on no path — and ' +
      '`$DEVFLOW_BODY_RAW` holds precisely the bytes the scrub exists to delete, which makes the ' +
      'staging area a second sink with no gate over it (PF-066). The line is MERGED with the ' +
      '`DEVFLOW_NOTES_RAW`/`DEVFLOW_NOTES` sentence that followed it, so all four names are ' +
      'stated once, and extended with the removal: a `trap` armed before the first `mktemp`, a ' +
      'plain `rm` because the permission layer these recipes run under refuses the flagged form, ' +
      'and the gate status captured ahead of the removals so a cleanup cannot report the ' +
      'scrubber\'s refusal as success. Every clause of the pre-split line survives in the merged ' +
      'one — both `$(mktemp)` assignments, "never a fixed path", and the parallel-worktrees ' +
      'reason — and `tests/guards/mcp-sink-bypass.test.ts` claim 5 now pins each property of the ' +
      'removal with a known-bad probe per property.',
  },

  // ── #325, resolve pass: the last host-named issue in an op input contract ──
  {
    file: 'git-agent.md',
    startLine: 933,
    endLine: 933,
    rationale:
      'regression-04. `post-wave-report` is a TRACKER operation — both tool-call providers ' +
      'generate mechanics for it — so its `TRACKING_ISSUE` input does not take a GitHub issue ' +
      'NUMBER. Under jira and linear the value is a key such as `PROJ-42`, and a contract that ' +
      'calls it a number in an always-loaded position describes a shape those providers never ' +
      'produce. Reworded to "tracker issue reference for the parent tracking issue", which is ' +
      'the vocabulary `ensure-traceable-issue` and `backlink-shipped-issues` already use for ' +
      'the same value (`:803`, `:839`). Nothing is dropped: the input, its name and its role as ' +
      'the parent tracking issue all survive; only the provider-bound noun is replaced. The ' +
      'user-facing half of the same defect lived in the plan command, which asked "create or ' +
      'enrich a GitHub issue for this plan?" immediately before spawning ensure-traceable-issue ' +
      '— that command is outside this baseline, and `tests/guards/provider-scope.test.ts` now ' +
      'pins it over both the authored and the compiled form.',
  },
];
