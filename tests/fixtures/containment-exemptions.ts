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
      'resolve-review-threads D4 clause, EXTENDED not cut. `:28` defers the backpressure rung to ' +
      '"the resolved provider\'s reference", but D4 names TWO batch ops and only ' +
      'backlink-shipped-issues has a generated reference — so a resolve-review-threads spawn ' +
      'could never learn the rung and the 1s → 3s escalation was unimplementable for it. The ' +
      'rung is stated here, on the line that already names `X-RateLimit-Remaining` < 10 for the ' +
      'same op, so no new provider surface is introduced. Every pre-split byte is retained.',
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
      'The `check_rate_limit` call site now honours the STOP: `check_rate_limit || exit 1`. ' +
      'Leaving the bare call would have made the rewritten function advisory.',
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
];
