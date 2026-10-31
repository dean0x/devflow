# Lean Prompt Targets

The targets of the [lean prompts guide](lean-prompts.md), ranked by token spend.
The numbers are a snapshot of commit `3bdc4d50`, after version 3.11.0. Measure again before you start a target.

## How the numbers were measured

- **Bytes**: `wc -c` of the file that an install takes for each build variant key. The keys are `on` (both switches on), `co` (curation off), `cmo` (compliance off) and `both` (both off). The file for a key follows the lookup order in `src/core/assets.ts`. A compiled host is measured in `dist/`. A hand-authored agent or skill is measured in `src/assets/`.
- **Load per spawn**: the agent body plus the `SKILL.md` of each skill in its `skills:` preload list. The spawn prompt and, for an agent that keeps CLAUDE.md, the CLAUDE.md of the project come on top. Neither is in the number.
- **Spawns and turns**: the Claude Code session transcripts of one maintainer over 31 days. This data is not public. To collect it again, count the spawns of each agent type and the model calls of each spawn in your own transcripts. Turns are medians per spawn. The sample is older than some agent renames. The tables use the current names, and the changelog lists the renames. The sample has too few turn counts for Fix and Refactor: two spawns each.
- **Re-read**: load per spawn, times spawns, times median turns, in MB over the sample. It is an index of the spend, not a price.
- **Always-loaded text**: the rows that list skills and agents in a default install, built from the shipped frontmatter. A default install has the twelve core plugins, compliance off, and no language plugin. A skill row is `- devflow:<name>: <description>`, and an agent row is `- <Name>: <description> (Tools: <tools>)`. The rows that Claude Code prints can differ by a few bytes.

## Always-loaded text

| Part | Rows | Bytes | Re-read by |
|---|---|---|---|
| Skill descriptions (`agent-references` is not listed, because it disables model invocation) | 32 | 3,887 | Every main turn |
| Command descriptions | 10 | 1,140 | Every main turn |
| Agent descriptions and tool lists | 20 | 5,619 | Every main turn |
| Core rules: `security`, `engineering`, `quality`, `reliability`, `context-economy` | 5 | 3,207 | Every main turn, and every turn of each agent that keeps CLAUDE.md |
| **Total of the fixed text** | | **13,853** | |
| Ambient session charter, the charter file of the session-start hook. The install renders it for the installed plugins, so the installed copy can be smaller. | 1 | at most 3,382 | Every turn after the session start, when ambient mode is on |
| Per-prompt reminder of the `preamble` hook | 1 | about 280 | Added to each prompt that is not a slash command, when ambient mode is on. It adds up in a long session. |

With compliance on, the `compliance` rule (1,006 bytes) and the `compliance` skill row join the fixed text.
The fixed text is about 3,500 tokens. A main turn of `/implement` reads about 190,000 cached tokens, so the fixed text is about 2% of a main turn.

Notes for a cut:

- The tool text of the agent rows is 2,033 bytes. Code, Fix, Refactor, Harden, Polish and Research each list the tools that they deny, and these six lists are 1,554 bytes of it. A change to an allow list changes the tool policy, so it needs a plan.
- The longest agent rows are Polish (509 bytes), Explore (457), Harden (420), Refactor (413) and Research (403). The longest skill rows are `patterns` (219), `software-design` (200), `dependency-research` (198), `boundary-validation` (184) and `testing` (176).
- A description is what makes a skill or an agent load. Keep the cases where it applies, and cut what repeats the body.

## Agents

| Agent | Model, effort | Body bytes: on / co / cmo / both | Preloads, bytes | Load per spawn | Spawns | Median turns | Re-read MB | Keeps CLAUDE.md |
|---|---|---|---|---|---|---|---|---|
| Code | sonnet, high | 10,718 / 10,287 / 10,718 / 10,287 | git, testing, test-driven-development, worktree-support, apply-feature-knowledge, apply-decisions: 25,487 | 36,205 | 566 | 80 | 1,639 | Yes |
| Harden | opus, medium | 5,491 / 4,867 / 5,491 / 4,867 | quality-gates, software-design, worktree-support, apply-decisions, apply-feature-knowledge: 14,724 | 20,215 | 84 | 96 | 163 | Yes |
| Review | opus, high | 12,422 / 11,623 / 12,422 / 11,623 | review-methodology, worktree-support, apply-decisions, apply-feature-knowledge: 9,804, plus one focus skill of about 4,800 | about 27,000 | 128 | 44 | about 152 | Yes |
| Knowledge | sonnet, medium | 8,357 / 7,891 / 8,357 / 7,891 | feature-knowledge, apply-decisions, worktree-support: 21,099 | 29,456 | 84 | 48 | 119 | No |
| Git | haiku, medium | 10,773 / 10,773 / 9,128 / 9,128 | git, worktree-support: 7,893 | 18,666 | 387 | 11 | 79 | No |
| Test | sonnet, medium | 11,211 in every key | qa, worktree-support: 7,591 | 18,802 | 88 | 46 | 76 | No |
| Curate | opus, inherit | 16,655 in every key | none | 16,655 | 108 | 30 | 54 | No |
| Design | opus, high | 5,529 / 4,776 / 5,529 / 4,776 | worktree-support, apply-decisions, gap-analysis, design-review, apply-feature-knowledge: 17,926 | 23,455 | 50 | 39 | 46 | Yes |
| Validate | haiku, medium | 6,023 in every key | worktree-support: 1,510 | 7,533 | 205 | 26 | 40 | No |
| Polish | sonnet, medium | 5,691 in every key | software-design, worktree-support: 6,361 | 12,052 | 70 | 39 | 33 | Yes |
| Research | opus, medium | 6,300 / 5,794 / 6,300 / 5,794 | worktree-support, apply-decisions, apply-feature-knowledge: 5,401 | 11,701 | 35 | 43 | 18 | No |
| Evaluate | sonnet, medium | 4,672 in every key | worktree-support, apply-feature-knowledge: 3,094 | 7,766 | 56 | 40 | 17 | No |
| Explore | sonnet, high | 3,477 in every key | none | 3,477 | 188 | 22 | 14 | No |
| Debug | opus, medium | 11,206 / 10,686 / 11,206 / 10,686 | worktree-support, apply-decisions, apply-feature-knowledge: 5,401 | 16,607 | 13 | 42 | 9 | Yes |
| Triage | opus, high | 11,813 / 11,029 / 11,752 / 10,968 | worktree-support, apply-decisions, apply-feature-knowledge: 5,401 | 17,214 | 10 | 36 | 6 | No |
| Synthesize | haiku, medium | 4,036 in every key | worktree-support: 1,510 | 5,546 | 45 | 13 | 3 | No |
| Skim | haiku, medium | 7,708 / 6,586 / 7,708 / 6,586 | worktree-support: 1,510 | 9,218 | 6 | 24 | 1 | No |
| Fix | sonnet, high | 8,384 / 7,953 / 8,384 / 7,953 | git, testing, worktree-support, apply-decisions: 14,848 | 23,232 | about 80 | not measured | not measured | Yes |
| Refactor | sonnet, high | 6,393 / 5,962 / 6,393 / 5,962 | git, worktree-support, apply-decisions: 10,200 | 16,593 | about 15 | not measured | not measured | Yes |
| Tracker | sonnet, inherit | 27,110 in every key | git: 6,383 | 33,493 | rare, once for each tracker setup | not measured | low | No |

The Code agent carries more re-read volume than all other agents together. Its preloads are 70% of its load.

## Commands

The main session re-reads a command on each of its turns. Main turns are known for `/implement` only. A static count of its typical path gives 27 main turns. The main cache reads of the sample suggest about 40 to 46. Thus its re-read is 61 to 104 MB.

| Command | on | co | cmo | both | Runs in the sample | Re-read MB |
|---|---|---|---|---|---|---|
| dynamic-build | 105,421 | 102,034 | 102,429 | 99,042 | not counted | not measured |
| resolve | 50,283 | 47,253 | 43,936 | 40,890 | 10 | not measured |
| implement | 43,478 | 40,794 | 44,856 | 42,172 | 52 | 61 to 104 |
| dynamic-tickets | 41,146 | 36,999 | 41,294 | 37,147 | not counted | not measured |
| plan | 36,222 | 33,424 | 36,055 | 33,257 | 5 | not measured |
| dynamic-plan | 35,740 | 31,450 | 35,740 | 31,450 | not counted | not measured |
| code-review | 34,062 | 31,487 | 31,269 | 28,694 | 10 full reviews; 14 more runs with 1 to 3 Review agents | not measured |
| bug-analysis | 23,724 | 20,130 | 23,193 | 19,599 | not counted | not measured |
| release | 22,297 | 19,141 | 17,199 | 14,043 | not counted | not measured |
| debug | 18,340 | 15,591 | 18,340 | 15,591 | not counted | not measured |
| dynamic-profile | 16,329 | 12,673 | 16,329 | 12,673 | not counted | not measured |
| self-review | 14,255 | 11,353 | 14,255 | 11,353 | not counted | not measured |
| research | 14,177 | 10,351 | 14,177 | 10,351 | not counted | not measured |
| explore | 12,325 | 9,593 | 12,325 | 9,593 | not counted | not measured |

Shared partials, with the hosts that import them:

| Partial | Source bytes | Hosts |
|---|---|---|
| `_settings` | 3,005 | all fourteen commands |
| `_knowledge` | 7,413 | bug-analysis, code-review, debug, explore, implement, plan, release, research, resolve, self-review |
| `_decisions` | 4,936 | the same ten hosts as `_knowledge` |
| `_evidence_policy` | 1,264 | bug-analysis, code-review, dynamic-build, dynamic-tickets, implement, plan, release, resolve |
| `_docs_root` | 2,123 | bug-analysis, dynamic-build, dynamic-plan, dynamic-tickets, implement, plan, research |
| `_compliance` | 3,154 | code-review, debug, dynamic-build, implement, plan, resolve |
| `_tracker` | 2,622 | debug, dynamic-build, dynamic-plan, implement, plan |
| `_plan_contract` | 4,493 | dynamic-build, dynamic-plan, implement, plan |
| `_publication` | 1,547 | code-review, dynamic-build, implement, resolve |
| `_engine`, `_wave` | 19,233, 12,321 | dynamic-build |
| `_factory`, `_ticket_template` | 9,189, 2,631 | dynamic-tickets |
| `_preamble` | 7,877 | the four dynamic commands |
| `_roster` | 2,332 | dynamic-build, dynamic-plan, dynamic-tickets |
| agents `_code` | 5,898 | Code, Fix, Refactor |

## Skills

A preloaded skill loads in every spawn of each agent that lists it. Another skill loads only when a run invokes it. Reference files load only on their branch.

| Skill | SKILL.md bytes | Reference bytes | Preloaded by | Re-read MB as a preload |
|---|---|---|---|---|
| test-driven-development | 9,055 | 3,248 | Code | 410 |
| git | 6,383 | 38,435, plus the compiled operation files | Code, Fix, Refactor, Git, Tracker | at least 316 |
| testing | 4,648 | 31,260 | Code, Fix | at least 210 |
| apply-decisions | 2,307 | 0 | Code, Debug, Design, Fix, Harden, Knowledge, Refactor, Research, Review, Triage | at least 155 |
| worktree-support | 1,510 | 4,031 | every agent except Curate, Explore and Tracker | at least 131 |
| apply-feature-knowledge | 1,584 | 0 | Code, Debug, Design, Evaluate, Harden, Research, Review, Triage | 104 |
| feature-knowledge | 17,282 | 0 | Knowledge | 70 |
| software-design | 4,851 | 44,222 | Harden, Polish | 52 |
| quality-gates | 4,472 | 27,424 | Harden | 36 |
| review-methodology | 4,403 | 9,139 | Review | 25 |
| qa | 6,081 | 17,402 | Test | 25 |
| gap-analysis | 6,519 | 7,561 | Design | 13 |
| design-review | 6,006 | 7,166 | Design | 12 |
| Review focus skills: architecture, complexity, consistency, database, dependencies, documentation, performance, regression, reliability, security | 3,714 to 5,360 each | 11,002 to 38,009 each | none; Review loads one for each spawn | about 27 together |
| docs-framework | 12,642 | 14,211 | none | on demand |
| Other skills | 1,584 to 5,526 | up to 67,417 | none | on demand |

## Ranked targets

Rank by re-read volume. A target with a blank turn count ranks by its load and its spawns.

| Rank | Target | Re-read MB | Reason |
|---|---|---|---|
| 1 | Code agent body (`_code` partial and the Code host) | 485 | The largest volume: 10,718 bytes, re-read over 566 spawns of 80 turns. |
| 2 | `test-driven-development` skill | 410 | A 9,055-byte preload of Code, the largest `SKILL.md` that a busy agent preloads. |
| 3 | `git` skill | at least 316 | Preloaded by Code, Fix, Refactor, Git and Tracker. |
| 4 | `testing` skill | at least 210 | Preloaded by Code and Fix. |
| 5 | Core rules | at least 206 | In every turn of Code, Fix, Refactor, Harden, Polish, Design, Debug and Review, and in every main turn on top. |
| 6 | `apply-decisions` skill | at least 155 | Preloaded by ten agents. |
| 7 | Harden agent, `quality-gates` and `software-design` | about 133 | The most turns per spawn (96), on opus. `software-design` is shared with Polish. |
| 8 | `worktree-support` skill | at least 131 | Preloaded by seventeen agents. |
| 9 | Review agent, its methodology and focus skills | about 122 | Eleven spawns for each full review run, on opus at high effort. |
| 10 | `/implement` command | 61 to 104 | The main session holds it for 27 to 46 turns of each run. |
| 11 | `apply-feature-knowledge` skill | 104 | Preloaded by eight agents. |
| 12 | Knowledge agent and `feature-knowledge` skill | 103 | A 17,282-byte preload, the largest `SKILL.md`. |
| 13 | Test agent and `qa` skill | 70 | 88 spawns of 46 turns. |
| 14 | Curate agent | 54 | Runs on opus once for each session that has a curation queue. |
| 15 | Git agent body | 46 | Many short spawns, on Haiku: keep its "finish and verify" text. |

The table ranks a range by its top value. After these: Design with its skills (46), Validate (40), Polish (33), the always-loaded descriptions, the command partials, and the large commands. The Fix agent has no turn count. Its load per spawn is 23,232 bytes, and it shares the `_code` partial and most of the Code preloads. The large commands rank low only because the sample has no turn counts for them. Count their main turns before you rank them.

## Target groups

Each group is one pull request. No two groups cut the same file. A group that changes a `description` also owns that row of the always-loaded text.

| Group | Files | Cuts that fit |
|---|---|---|
| Implement | the `implement` host text and its reference files in the `agent-references` skill | Rare branches to references only with run counts. Scripts that print the next action. Turn audit. |
| Code family | agents `_partials/_code.mds`, `code.mds`, `fix.mds`, `refactor.mds` | Subtract repeats and text that judgment covers. Cut spawn text that the body repeats. Turn audit. |
| Code-path skills | skills `test-driven-development`, `testing`, `git` (the `SKILL.md` only) | Subtract. Move rare detail to the reference files that exist. Check that each preload is one that the agent reads. The Git agent runs on Haiku and preloads `git`, so keep its "finish and verify" text. |
| Spawn-wide skills | skills `worktree-support`, `apply-decisions`, `apply-feature-knowledge` | Say it once. Small files with the largest spread: every byte loads in nearly every spawn. |
| Core rules | rules `security`, `engineering`, `quality`, `reliability`, `context-economy` | Subtract. Some agents quote a rule line in their core-rules digest. Keep those lines, or change the digest in the same pull request. |
| Review | agent `review.mds`, skill `review-methodology`, the ten focus skills, the `code-review` host text | Subtract. No severity filter in the review report: filter in a second pass. Capital emphasis: 7 hits in the agent. |
| Harden and Polish | agents `harden.mds`, `polish.md`, skills `quality-gates`, `software-design` | Subtract. Turn audit: Harden runs the most turns per spawn. |
| Knowledge | agent `knowledge.mds`, skill `feature-knowledge` | Subtract. Move rare detail of the skill to reference files. |
| Test | agent `test.md`, skill `qa` | Subtract. Keep "finish and verify" text. |
| Git agent | agent `git.mds` | Subtract. Keep "finish and verify" text on Haiku. |
| Curate | agent `curate.md` | Subtract. Rare branches to references only if their read rate is low. |
| Plan path | agents `design.mds`, `explore.md`, skills `gap-analysis`, `design-review`, the `plan` host text | Subtract. Turn audit. |
| Command partials | the command partials shared by more than one family: `_settings`, `_knowledge`, `_decisions`, `_evidence_policy`, `_docs_root`, `_compliance`, `_tracker`, `_plan_contract`, `_publication` | Cut each partial once, in this group only. Scripts that print the next action or their own fail-closed line. |
| Resolve | the `resolve` host text, agent `triage.mds` | Subtract. Rare escalation arms to references. Scripts that print the next action. |
| Dynamic family | the four dynamic commands and `_engine`, `_wave`, `_factory`, `_preamble`, `_roster`, `_ticket_template` | Subtract. Capital emphasis: 19 hits in `dynamic-build`. Count main turns first. |
| Other targets | agents Validate, Evaluate, Synthesize, Skim, Research, Debug, Tracker; the other command hosts; the skills that no agent preloads; the hook text | One target at a time, by measured spend. Debug has 11 capital-emphasis hits. |

The Code family and the Code-path skills can share one pull request when the review stays in one round. One number, the Code load per spawn, measures both.
