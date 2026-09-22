# Changelog

All notable changes to Devflow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Pick your issue tracker: GitHub, Jira, or Linear** — before: every traceability path in devflow assumed GitHub. An issue reference was a bare `#123`, the only mechanics that existed spoke `gh`, and a team whose issues live in Jira or Linear had no way to say so; the provider-shaped hole the Phase-2 refactor opened had exactly one occupant. After: the provider is a selection — `manifest.features.tracker = { provider }` over `github | jira | linear`, defaulting to `github`, machine-wide rather than per-project (like `proxy` and `compliance`). Choose it at `devflow init`, non-interactively with `devflow init --tracker <id>`, or afterwards with `devflow tracker --set <id>`; inspect it with `devflow tracker --status`, which also reports whether conventions have been learned yet and where the file lives. The wizard asks only where the question can be answered: Advanced always, Recommended only when you actually reached the Setup-mode prompt interactively, and never on `--recommended` or a non-TTY run — so both promptless contracts are preserved, and passing `--tracker` suppresses the question on either path. There is no `--no-tracker`: `--tracker github` is the off switch, because a flag whose only meaning is "⇒ github" is a second spelling of a value that already exists. The ID is matched byte-exactly against the registry — `JIRA`, `jira ` and `jira-cloud` are **rejected with an error, never repaired** — so a typo cannot quietly select a tracker you did not name, and the validated token selects a hardcoded path prefix from a static map instead of ever being concatenated into a path. A malformed value already sitting in the manifest self-heals to `github` silently and is deliberately kept out of the manifest's hard-null set, so every pre-tracker install still reads as a prior install rather than as no install at all. Changing the provider moves any conventions file inferred for the old one aside as `tracker.md.{previous}.bak` and re-arms inference; `--reset` collapses the selection to `github` and still fires that rename, because the prior provider is a real transition even when the reset makes the new one the default. **Existing installs and every GitHub user see nothing change** — no prompt, no new file, no altered byte, and under provider `github` the new session-start gate performs **zero** subprocess invocations.

- **A background agent learns your tracker's conventions once, silently** — before: nothing in devflow knew a project key, an issue-type vocabulary, a required-field set or a workflow's transition names, and there was no place to put them. After: on a non-GitHub provider, Section 3 of the `session-start-context` hook emits a silent `--- TRACKER SETUP ---` directive that spawns the new **Tracker agent** (the 17th agent, `sonnet`) in the background. It is never narrated, never a question, and never spawned from a command — it has no workflow roster row at all. The agent claims `~/.devflow/.tracker.processing`, probes what the connected tracker can actually do **by capability description rather than by tool name** (published tool rosters disagree across vendors and versions, so a name-matched probe reports "missing" for a capability that is present under another spelling), infers repository conventions from the bounded history scan it loads out of the `devflow:git` skill rather than restating it, and writes `~/.devflow/tracker.md` **exactly once or not at all** — create-exclusive, mode `0600`, gated on the secret scrubber through a single `&&` chain so a scrub failure writes nothing, with a `# UNRESOLVED:` sentinel on every line it could not establish and a `## Dedup Strategy` section recording what the probe observed. A partial or defaults-only file would be worse than no file, because the file's existence is the signal that setup is done. The gate in front of it is cheapest-first and bounded in four independent ways: a zero-byte `.tracker.enabled` sentinel plus the absence of `tracker.md` (two shell builtins — the reason GitHub costs nothing), an attempt cap of five counted in `.tracker.attempts` and incremented when the directive is *emitted* rather than when the agent finishes (a crashed agent still burns an attempt), a `source` restricted to `startup` and `clear` so no agent is spawned into a session already mid-flight, a 600-second claim-file freshness check, and a **positive** `jira|linear` allowlist that runs before any interpolation. `devflow init` and `devflow tracker --set` reset the attempt counter; `devflow tracker --status` is read-only and resets nothing.

- **The Git agent resolves the tracker provider once per spawn, and refuses a stale configuration** — before: no single place resolved a provider, so a provider token would have had to be threaded through roughly thirty filename-composition sinks. After: the agent's preamble resolves it once, and **not** by taking the first rung that answers — rung 1 narrows rung 2 and cannot be evaluated without it, so both are read before anything is decided. (1) the `tracker` key in the project's `.devflow/config.json`, which **narrows only**: it admits `github` or the manifest's own provider and nothing else, and any other value is `TRACEABILITY: DEGRADED (tracker configuration mismatch (repository override))` with no tracker call. (2) `manifest.features.tracker.provider`. (3) `github`. The repository's own **issue-reference grammar** is not a rung: it narrows what is already resolved and never selects. The remote, the hosting platform and the PR host are *not* signals either — devflow itself keeps PR hosting on GitHub while a team's tracker is Jira, so a rule reading the remote would disable the feature for exactly the users it exists for. The deciding signal is named on the status line. And the reader half refuses rather than guesses: `tracker.md` whose frontmatter `provider:` disagrees with the resolved provider produces `TRACEABILITY: DEGRADED (tracker configuration mismatch)` and **no tracker call**, which covers every path init cannot see — an uninstall then reinstall, a hand edit, a dotfile-repo sync. On a non-GitHub provider a `- **Tracker**: {provider} ({winning source})` line joins `- **Conventions**:` in the Traceability block; **the GitHub path emits no tracker status line at all**, which the `tests/fixtures/golden/github-status-lines.txt` corpus is what asserts.

- **`redact-secrets.cjs --emit` — the D11 scrub gate for sinks with no shell boundary** — before: the scrub was expressed as a `&&` chain, which works for a file sink and cannot exist inside a tool call. At a tool-call sink the rule degraded to an instruction, and an instruction is not a gate. After: `--emit` scrubs its input **twice** and prints a framed result on stdout — `D11-OK <nonce> <sha256> <bytes> <n> [type:count,…]` on line 1, the scrubbed body from line 2 — where the second pass returning zero findings **is** the gate, and the nonce is 32 hex characters generated per invocation and required, because composed bodies carry untrusted issue text and an unframed `D11-OK` literal is forgeable by anyone who can write an issue comment. Every non-zero path prints `D11-FAIL <reason>` with an **empty body** — no path, no secret, no partial content — and the no-body property belongs to the result type rather than to a caller remembering to suppress it. A new exit code `5` distinguishes "the gate refused" from a usage error, an unreadable input or an internal fault. The consumer's obligation is mechanical too: compare the received body's byte length against `<bytes>` before posting, and on mismatch **do not post**. That check exists because a Bash result is clipped at a per-machine character limit with its middle elided, so the framing line and the body's tail both survive a truncation — and a bare "is the framing line there?" gate would pass over a body with a hole in it.

- **A provider-independent tool-call contract for tracker I/O** — `src/assets/mds/tracker/_mcp.mds` states, once, the rules every MCP-backed provider's mechanics must follow: a fifteen-row capability table mapping each capability to what happens when it is unreachable (only *identify current user* posts anyway, reporting that dedup was unavailable); no HTTP fallback of any kind — no `curl`, no `wget`, no credential read from the environment, no substituted CLI; scrub-before-render, where the only permitted wrapper is a pure structural one whose concatenated text equals the scrubbed bytes, so no re-encoding, chunking, summarising or reflowing can reintroduce what the scrub removed; structured reads whose **shape** is trusted and whose **values** are not; and a one-directional load chain in which this contract wins on any conflict. It names neither provider and not the transport acronym, stating its rules in terms of capabilities instead — which is the same capability-first doctrine it imposes on its readers, applied to its own prose. It is generated to `references/tracker/_mcp.md` only once a provider module that needs it is registered.

- **Jira tracker mechanics — the first provider to reach its tracker through tool calls** — before: the provider slot existed and had one occupant. A team on Jira could select `jira`, and every tracker operation then degraded with `tracker mechanics unavailable`, because no mechanics existed for it. After: ten generated references under `references/tracker/jira/` — one per tracker operation, the same operation set GitHub has, read from one shared roster so a provider cannot silently acquire or lose an operation. Every call goes through a tool the session already exposes, selected **by capability description rather than by tool name**; there is no `curl`, no `wget`, no credential read and no substituted CLI anywhere in the tree, and a capability that is absent degrades with that capability named rather than being improvised around. Jira's own facts are stated and GitHub's are conspicuously absent: the body cap is `32767`, backpressure is `Retry-After` honoured verbatim with a STOP on 429 and **no pre-emptive rung at all** — Jira publishes no remaining-request count, so a threshold keyed on one would never fire and would read as coverage while providing none. A batch fetch is **one** filtered query (`key in (…)` with a result bound), never fifty sequential ones, and a guard forbids both the tool-name and the capability-name spellings of a per-item fetch inside that reference, because the second is what this project's own capability-first doctrine steers an author towards writing. Dedup climbs a four-rung ladder — an invisible entity property, then editing the existing comment in place, then a first-line marker filtered to comments this account authored, then posting with a warning that a duplicate is possible — and the marker is **the comment's first line and nothing else**: Jira comments have no HTML-comment node, so a marker at line 5 is somebody quoting you, and a substring search over the whole comment is precisely how a quoter would acquire the power to silence a release note. Markers are namespaced per comment kind (`devflow:shipped`, `devflow:wave`, `devflow:traceability`), each owned by exactly one operation, because one global marker would make the three kinds suppress each other. Where an operation checks markers inside a bounded loop the cost is stated as a **product** rather than a per-call bound — fifty issues by two pages is a hundred calls, reported as truncated past that — alongside the cheaper shape that avoids the loop entirely. A design artifact that GitHub posts as a collapsed `<details>` block becomes a **pointer sentence**, since Atlassian's document format has no collapsed-block analogue and no official converter; on truncation the marker and the status lines are what survive and the untrusted middle is what gets cut. Jira absent or denied still cuts the branch and opens the PR, records `Tracked (pending)` with the reason, and **never falls back to creating a GitHub issue** — a different tracker is not a degraded version of the one you chose. **GitHub users see nothing change:** the GitHub path's own per-spawn cost is unmoved, the tool-call contract is billed at zero there because no GitHub mechanics file loads it, and the frozen status-line fixture is still byte-identical to its original capture.

- **Linear tracker mechanics — shipped at rank 4, and honest about it** — before: `linear` was a selectable provider with no mechanics behind it, so every tracker operation degraded with `tracker mechanics unavailable`. After: ten generated references under `references/tracker/linear/`, the same operation set the other two providers have, from the same shared roster. An issue reference is a team key (`TEAM-123`) **or** an internal id, each matched against its own separately anchored pattern after upper-casing — separately, because one pattern wrapping an alternation anchors the left half at the start and the right half at the end, and `1; id` walks through the middle of that. A batch fetch is **one** filtered query with a page bound, never fifty sequential ones. Backpressure is an HTTP **400 carrying `RATELIMITED`**, not a 429, and it arrives as error text rather than a status line — so the mechanics name the code, the token and the text form, because the generic rule for a 4xx is "degrade this item and continue", which would keep the fan-out running straight into the window the rule exists to stop. **Where Linear differs from its sibling is what devflow cannot do, and it says so instead of pretending otherwise.** On a stock Linear workspace devflow cannot ask the tracker which account it is, and the attachment upload takes bytes rather than a URL, so three of the four dedup rungs are unreachable and devflow lands on the fourth: it **posts a back-link with a warning** rather than suppressing one it cannot verify. Every run emits `TRACEABILITY: DEGRADED (dedup unavailable — duplicate possible)`, and each comment's first line carries the marker plus the devflow project URL — the line binding defeats somebody quoting your comment, the URL defeats a coincidence, and together they are the only evidence available when there is no author to filter on. A missing release back-link is worse than a second one you were told about. The one place the opposite rule wins is a wave report, where a scan that ran out of pages says the evidence exists and was not read, and a duplicate wave report leaves the next run unable to tell which is authoritative — so that one fails closed and posts nothing. A design artifact becomes a **pointer sentence**, as on Jira; Linear absent or denied still cuts the branch, opens the PR and records `Tracked (pending)` with the reason, and **never falls back to creating a GitHub issue**.

- **Linear's borrowed limits are written down rather than presented as measurements** — the comment-body cap devflow uses for Linear is `32767`, which is **Jira's documented cap adopted as the conservative choice**; Linear publishes no cap that any of this work measured. That, and the rank-4 dedup reality above, are recorded as `## Known Unknowns` in the Linear mechanics module and surfaced for users in `docs/cli-reference.md`, with [issue #343](https://github.com/dean0x/devflow/issues/343) as the owner and the artifact — it names the two files the borrowed values live in, so a measurement lands in one change instead of being hunted for. Borrowed too generously, a long post is rejected at the tracker and degrades with a reason; borrowed too strictly, a body that would have fit is truncated with a pointer to the local artifact. Nothing is lost silently either way.

- **The tracker operations no longer describe themselves as GitHub operations** — before: the Git agent's always-loaded operation table read "Fetch GitHub issue", "Fetch multiple GitHub issues" and "Create or enrich a GitHub issue", and its shipped-issue back-link required every issue reference to be **digits only**. The first was wrong for two of three providers; the second was a live defect — under Jira or Linear every `PROJ-1` was dropped by a gate that ran before any provider mechanics were consulted, which made the operation unreachable. After: the table and the two operation descriptions that duplicate it say "tracker issue", and the entry gate defers to the resolved provider's own anchored reference grammar, with GitHub's `#123` form moved into the GitHub mechanics beside the same drop rule. **The gate is relocated, not relaxed** — the operation always loads its provider's mechanics, and a missing mechanics file already means no tracker call at all. GitHub literals that are not tracker facts stayed put: releases and pull-request review threads name GitHub because both stay there whichever tracker you choose. The always-loaded prompt came out **25 characters shorter and one line shorter**, so every per-spawn budget gained headroom while gaining a provider.
- **Devflow installs only what your selection uses** (#350) — before: every skill from every plugin was installed regardless of which plugins you picked, and every tracker provider's mechanics shipped to every machine: a GitHub-only user carried Jira's and Linear's reference files, the tool-call contract and the Tracker agent, and a Go project carried the React skill. After: each plugin hand-declares in a `requires:` field the skills it uses but does not own, and the install set is the closure of `skills ∪ requires` over the plugins you selected — the default (non-optional) plugin set installs **32 of the 40** plugin-owned skills, the eight left out being exactly the language skills of the optional language plugins. A bidirectional closure guard holds every `requires` entry against what that plugin's commands, agents and skill bodies actually name, in both directions, so an entry cannot be added speculatively and a skill cannot be used without being declared; the single reference no literal can resolve — the Review agent's focus-templated one — is a classified exception rather than an unexplained gap. The tracker bundle is scoped the same way: the installer overlays `{github} ∪ {selected provider}` generated references — **13 files for `github`, 24 for `jira`/`linear`** — and `references/tracker/_mcp.md` and the Tracker agent file land **only** for `jira`/`linear`. The build still compiles every provider, so the tarball is unchanged and switching providers needs no rebuild. Section 3 of `session-start-context` stays installed for everyone and is gated at runtime, because a hook removed from `settings.json` is a hook a re-install has to remember to put back.

### Changed

- **`devflow uninstall` can now ask before clearing `~/.devflow`, where a Jira or Linear user previously got a silent sweep** — this is the one accepted user-visible regression in the tracker work, and it follows from classifying `~/.devflow/tracker.md` as **your content** rather than as an install artifact. Before: a user-scope interactive uninstall for someone with no other user content in `~/.devflow` resolved to an artifacts-only sweep and removed the directory's devflow files without asking. After: a user who has selected Jira or Linear has a `tracker.md`, and a `userContent` entry flips that same interactive uninstall to a confirm prompt — so an inferred conventions file, which is hand-editable and represents real setup effort, is never deleted without a question. `.tracker.enabled`, `.tracker.attempts` and `.tracker.processing` remain install artifacts and are swept normally; the two lists stay disjoint. **GitHub users are unaffected**: no `tracker.md` is ever written for them, so the prompt cannot appear. The classification is deliberately conditional. The precedent it copies is the `agent-models.json` reclassification, where *"silently"* was the load-bearing word: stale per-agent overrides re-applied silently, so they were demoted to an install artifact. A stale `tracker.md` is safe to preserve only because the provider-mismatch guard removes the silence — a file whose frontmatter `provider:` disagrees with the resolved provider produces `TRACEABILITY: DEGRADED (tracker configuration mismatch)` and no tracker call. **Reversal condition, recorded:** if that guard is ever dropped, descoped or softened, `tracker.md` is reclassified back to an install artifact **in the same change**, because otherwise a silently-authoritative stale file survives an uninstall.

- **The Git agent's GitHub mechanics now live in generated skill references** — before: `git.md` was 65,677 characters re-sent on every Git spawn, roughly 9,400 of them GitHub-specific mechanics (`gh` invocations, header names, rate-limit thresholds) interleaved with the provider-independent contract — each operation's `**Input:**`, `**Output:**` template and `**Degradation (D4):**` clause. There was no single place a tracker provider was resolved, so a provider token would have had to be threaded through roughly thirty filename-composition sinks. After: the compiled agent is 55,664 characters (56,075 bytes), against the `BUDGET_GIT_MD` ceiling of 55,750 characters that `tests/tracker/byte-budget.test.ts` asserts on every run — the ceiling is the number that must hold; the measurement is what it holds against today. A ≤40-line provider-resolution preamble resolves the provider **once per spawn** and states the **one** load instruction that composes a mechanics path; thirteen generated references carry what moved — ten per-operation GitHub files under `references/tracker/github/`, plus `learn-conventions.md`, `publication-gate.md` and `decision-markers.md`. Every move is byte-identical unless it is one of 63 named, individually justified exemptions, and a containment oracle compares the pre-split tree against the post-split one line by line to prove it — over the whole branch diff, 150 of the 160 content lines the golden lost are byte-present elsewhere in the loadable set and the remaining 10 fall inside a named exemption range, with none unaccounted. Zero user-visible change: `Tracked = #{n}`, `Depends on: #{n}`, `42-jwt-auth.{ts}.md` and `issue: 42` all render exactly as before. This entry is an internal refactor — it adds no new prompt and no new file to any user's project tree.

- **The D4 and D11 cross-cutting contracts are provider-independent in fact, not only in claim** — before: the always-loaded degradation contract named `gh` as the thing that can be unauthenticated and stated GitHub's own rate-limit signals (a 403/429 body, `X-RateLimit-Remaining < 10`, the `< 50` backpressure rung) in the same sentences as the provider-independent STOP/THROTTLED rules; the comment-sink scrub said it applied to bodies posted "to GitHub". Two authorities on the redaction path. After: the invariants stay inline and unchanged — the scrub is still unconditional, still fail-closed, still `&&` and never a pipeline, and the scrubber invocation itself is never made loadable — while the cross-cutting blocks themselves name no provider. D11's shell recipe now posts through a `<the resolved provider's post command>` placeholder that the operation's own generated reference resolves. D4's GitHub-specific detail — the 403/429 rate-limit body, the `X-RateLimit-Remaining < 10` STOP threshold and the `< 50` backpressure rung — left the cross-cutting block entirely and is *explained* once, in the GitHub reference of `backlink-shipped-issues`, the operation that owns the fan-out. It is not *stated* only there, and deliberately so: `skills/git/SKILL.md` is preloaded on every Git spawn and keeps the `< 10` STOP threshold, which is the mitigation that makes the move safe, and each fan-out operation's own `**Degradation (D4):**` clause still names the signal it acts on inline beside the `THROTTLED` report it triggers — in the agent and in the generated references alike. A threshold an agent must recognise before it acts is worth restating at the point of use; a header name, a status code and a shell command are not.

- **`skills/git/SKILL.md` no longer contradicts the agent it is preloaded with** — before: 9,205 characters preloaded on every Git spawn, carrying two live safety contradictions — `if [ "$REMAINING" -lt 10 ]; then sleep 60; fi`, which tells the agent to wait out exactly the secondary rate limit D4 tells it to STOP for (waiting extends the provider's penalty window), and `gh release create … --notes "$NOTES"`, an inline-body recipe where the release operation mandates `--notes-file` after a scrub whose failure is a hard stop. Both were invisible to every guard. After: 6,581 characters, both contradictions removed, and the inline-body guard widened to see `gh release … --notes` and rescoped to the skill files. Three `sleep 60` sites in all — the third in `references/github-api.md` — are gone.

- **Every shipped recipe that posts a body posts the scrubber's output** — before: sixteen recipes across `references/github-api.md`, `references/patterns.md`, the generated tracker references and the review-methodology skill built a body inline — `--body "$(cat <<'EOF' …)"`, `-f body="$BODY"`, `--notes "$changelog"`, `--notes-file CHANGELOG.md` — so the text reached GitHub without passing `redact-secrets.cjs` at all, in the same files that tell an agent the scrub is unconditional. After: each one composes to `$DEVFLOW_BODY_RAW` (release notes to `$DEVFLOW_NOTES_RAW`, or `CHANGELOG.md` read as raw input), runs the scrubber, and posts the scrubbed file through `--body-file` / `-F body=@` / `--notes-file`, chained with `&&` so a non-zero scrubber exit means the post does not happen. The tech-debt archive closes its predecessor with **no comment body**: before, it closed with a `--comment` placeholder reading `(see linked issue)` and then posted the real number in a second comment; after, it creates the successor first and posts one scrubbed archive comment carrying that number, so the close is a close. Reviews write reports and only the Git agent publishes — the review-methodology skill's own comment-creation recipe is replaced by a pointer to `post-review-summary`, where the repo-visibility gate (D10) and the comment-sink scrub (D11) already live, so there is one publication path instead of two. The inline-body guard that polices this folds shell line-continuations before matching (a `--body` four lines below its `gh` verb is one command, not four lines), names its five posting shapes separately so each is proven live by its own known-bad probe, and scans **every installed agent, command, rule and skill** rather than the Git agent's own neighbourhood; the pre-split baseline tree is kept as a permanent known-bad corpus so the widening is proven against text that really did post unscrubbed bodies. Two `gh … --json number` flags that neither `gh issue create` nor `gh pr create` accepts are replaced by deriving the number from the URL each command prints. Every recipe renders the same text it always did; what changes is what reaches the tracker when a body carries a secret — before, a shipped recipe posted it, and after, the post does not happen (#340, #341).

- **The installer converges the generated references rather than merging into them** — before: nothing installed generated skill references, because none existed. After: `devflow init` overlays them onto the installed `devflow:git` skill directory with a **converge-not-merge** contract — a shadow-supplied file under `references/tracker/**` that the build manifest does not name is removed, and a shadowed `devflow:git` still receives the canonical GitHub references. The swap is **atomic per unit**: each provider directory (and the flat cross-cutting set) is built under a `.tmp` sibling and promoted by rename, so a per-file failure aborts that unit and leaves the previously installed files byte-unchanged instead of promoting a partial tree. Two new install-time failure modes come with it, both reported rather than silent: a unit that could not be refreshed is named in the install summary (`Could not refresh the generated references for "{provider}" …`), and a **declared reference missing from the build** fails loudly with a `npm run build:mds` hint rather than installing an agent instructed to read a file that is not there.

- **The command layer speaks one issue-reference vocabulary** — before: five command hosts each carried their own inline `#N` parsing rule, and the design-artifact naming convention used a `{issue}` placeholder. After: one partial, `_partials/_tracker.mds`, states the grammar and the capture contract once and is imported by `plan`, `implement`, `debug`, `dynamic-build` and `dynamic-plan`; the placeholder vocabulary is `{ISSUE_REF}` (the rendered reference) and `{ISSUE_ID}` (the filesystem-safe form), each site also stating its GitHub rendering so the rendered bytes are pinned. `ISSUE_NUMBER` is kept at all fourteen Code-agent spawn sites. Commands no longer restate a dedup marker literal — the operation owns its marker.

- **Byte budgets for the Git spawn are now constants with derivations, asserted as a four-shape table** — `chars(dist/agents/git.md) ≤ 55,750`, `chars(skills/git/SKILL.md) ≤ 6,600`, and the worst-case tracker spawn's loaded set priced **per provider**, because a provider that loads the tool-call contract must not bill users who never receive it: `≤ 80,200` characters on the GitHub path, `≤ 89,500` under Jira, `≤ 91,700` under Linear. Each of the three was re-baselined once, under explicit authorisation, against the shipped per-operation split; a ceiling may be lowered thereafter and never raised. The formula counts every reference a single operation's load instructions can name, checked bidirectionally against what the compiled agent can actually name, and the four candidate file shapes are recorded as computed rows so the shape decision is not re-litigated from memory.

- **`tests/fixtures/golden/github-status-lines.txt` is frozen from its third capture** — the fixture samples prompt-internal process steps, which is precisely the text this refactor relocates, so a re-capture is what a relocation of that text costs. The first followed the D4 invariant/detector cut, which split two of its sampled sentences, so preserving the fixture and making the split were mutually exclusive. The second followed the review-wave condensing of the `**Mechanics:**` pointer lines it samples, and moved only the two byte-count lines that shift when the agent is regenerated. The third followed the per-operation retarget, which moved nine of the twenty-four git-side samples out of `dist/agents/git.md` into generated references. Each is a single fixture-only commit under its own explicit authorisation, and each authorisation is spent on the capture it covers — a fourth needs its own. The four user-visible byte-identity claims have their own assertions and are untouched.

- **The Git agent is now compiled from an MDS generator host** — before: `src/assets/agents/git.md` was a hand-authored file the installer copied verbatim; the build owned command files only. After: `src/assets/agents/git.mds` declares `output-dir: dist/agents` in a leading steering block and compiles to `dist/agents/git.md`, which was byte-identical to the hand-authored file it replaced at the conversion (66,180 bytes, unchanged SHA-256); the contract/mechanics split is what changes its size. Both agent readers take their directory order from one owner, `agentSourceDirs()` in `src/core/assets.ts` — `dist/agents/`, then `src/assets/agents/`. The installer resolves each declared agent against that list and copies the first hit, throwing with both candidate paths and `npm run build:mds` named when neither directory has it; `loadShippedDefaults()` walks the same list first-wins and warns through its `onWarning` channel when a registry-declared agent has no shipped default in either. The compiled artifact wins for a generated agent and the other 15 agents install exactly as before. The 13 compiled command outputs in `dist/commands/` are byte-unchanged, and the hand-authored `release.md` beside them is untouched — 14 deployed command files in all. Zero user-visible change.

- **`npm run build:cli` alone no longer produces installable agents** — before: `build:cli` (TypeScript) plus the shipped `src/assets/agents/*.md` were enough to install every agent. After: an agent authored as a generator host exists only as a `.mds` source until `npm run build:mds` compiles it, so a publish or install path that runs `build:cli` alone would ship without a Git agent. `npm run build` runs both and is unchanged; the packaging and pack-install guards now fail loudly if the compiled agent is missing from the tarball.

- **`tests/integration/subagent-skill-preload.test.ts` is excluded from `npm run test:integration`** — before: `vitest.integration.config.ts` declared only an `include` glob, so the file was collected by every integration run, including CI, and no-op'd only where the `claude` binary was absent, through its own `describe.skipIf(!isClaudeAvailable())` guard; on a machine with `claude` installed it spawned live sessions. After: the config carries a real `exclude` entry. The test drives live `claude` sessions against the developer's own `~/.claude` with `--dangerously-skip-permissions` and has previously committed to this repo mid-run, so it is opt-in: set `DEVFLOW_INTEGRATION_ALL=1` to include it. A command-line path alone cannot re-add it — `exclude` is applied at glob time.

- **`pin-sonnet-4-6` and `disable-bundled-skills` now default OFF** — before: both flags were in the recommended set with `defaultValue: true`, so a fresh `devflow init` pinned `ANTHROPIC_DEFAULT_SONNET_MODEL` to `claude-sonnet-4-6` and wrote `disableBundledSkills: true` to settings.json, removing Claude Code's built-in skills and commands. After: both are optional flags defaulting to `false`; a fresh install leaves the Sonnet alias and Claude Code's bundled skills untouched. Existing installs keep whatever value their manifest already records (ADR-014 — re-init preserves existing flag values); opt in or out with `devflow flags --enable/--disable pin-sonnet-4-6` and `devflow flags --enable/--disable disable-bundled-skills`.
- **`devflow tracker --set` converges the whole bundle, in both directions** (#350) — before: `--set` wrote the manifest, the sentinel and the conventions rename; the reference files and the Tracker agent were an install-time concern, so switching providers left the previous provider's mechanics on disk. After: `--set` converges references, stale-conventions rename, manifest, Tracker agent file, attempt counter and sentinel in that fixed order, and it converges in both directions — `--set github` REMOVES what `jira` or `linear` installed. Two branches exit 1 leaving the manifest, sentinel and conventions untouched: `devflow:git` is not installed (the mechanics have nowhere to land), or the reference overlay failed. The overlay is atomic per unit, so a failure names the units that failed instead of claiming nothing moved. `devflow tracker --status` gains a `Mechanics:` line — `installed (N file(s))`, `MISSING — run devflow init`, or `unreadable (<errno>)`, three outcomes rather than two because "no files" and "could not look" have different remedies. `devflow skills list` now says which plugin provides each skill and whether that plugin is selected, and `devflow uninstall --plugin` retains assets on behalf of the plugins the **manifest** records as installed rather than the whole registry — so removing a plugin removes exactly its own skills instead of keeping them alive for a plugin you never installed.

### Fixed

- **Shipped recipes posted bodies the scrubber had never seen** (#340, #341) — before: sixteen recipes across `references/github-api.md`, `references/patterns.md`, the generated tracker references and the review-methodology skill composed a body inline and handed it straight to `gh`, so an agent following the shipped text reached the tracker without `redact-secrets.cjs` running at all — in the same files that tell it the scrub is unconditional. The tech-debt archive was the same defect in a second shape: it closed its predecessor with a `--comment` placeholder and posted the real number in a separately-composed follow-up. After: each one composes to `$DEVFLOW_BODY_RAW` (release notes to `$DEVFLOW_NOTES_RAW`), runs the scrubber, and posts the scrubbed file through `--body-file` / `-F body=@` / `--notes-file`, `&&`-chained so a non-zero scrubber exit means the post does not happen. This sink has no erasure path — a comment lands at the repository's visibility, GitHub keeps edit history, and notifications have already fired — so anything that got through had to be answered by rotating the credential, not by editing the comment. The **Changed** entry above carries the full inventory and the guard that now polices it.

- **`/debug #42` wrong Git-op spawn key** — before: `debug.mds` passed `ISSUE: {issue number}` to the `fetch-issue` Git operation, which declares `ISSUE_INPUT:`; the key mismatch meant no issue was ever fetched. After: `debug.mds` passes `ISSUE_INPUT: {issue reference}` — the key the op declares. (AC-0.1)

- **`/plan` with issue references: issue body never fetched** — before: `/plan #42` parsed the issue reference but never retrieved it; the design was built without the issue content. After: `/plan #42` spawns the Git agent with `OPERATION: fetch-issue`; `/plan #12 #15 #18` uses `OPERATION: fetch-issues-batch` (≤50 issues, `TRUNCATED ({n} not processed)` beyond the cap). (AC-0.3)

- **`fetch-issue`/`fetch-issues-batch`: all remote-sourced fields now contained** — before: issue title, body, labels, acceptance criteria, and dependencies reached Design agents unwrapped, with no `<untrusted-issue-body>` containment tag of any kind. After: all remote-sourced fields per issue are wrapped in a single `<untrusted-issue-body>` block with a data-only note appended after the closing marker; the `### Suggested Branch` slug (derived locally from the title, not attacker-controlled) remains outside the block. (AC-0.10)

- **`resolution-summary.md` `Tracked = (pending)` fields now state the reason** — before: four sites in `resolve.mds` wrote a bare `(pending)` with no explanation of what it was pending on, making the field ambiguous in every resolution summary. After: all four sites qualify the pending state with its reason — backfill after Phase 9 manage-debt, or `TRACEABILITY: DEGRADED ({reason})` on failure — making the field self-explaining and consistent with the degradation path that already named the reason. (AC-0.6)

- **`release.md` promised a `close milestone` step that does not exist** — before: `release.md` listed a post-release "close milestone" step; no such Git operation existed, so the step was silently a no-op and the command description was false. After: the `close milestone` reference is removed. (AC-0.14)

- **`/resolve` D9 thread-resolution gate narrowed** — before: `resolve.mds` authorised the Git agent to auto-resolve review threads on any of three verdicts — `FIXED`, `FALSE_POSITIVE`, or `BY_DESIGN`. After: auto-resolution is authorised only when the verdict is `FIXED` and `commit_sha` is non-empty — matching the narrower D9 contract the Git agent had always enforced, closing a live divergence. (PF-024)

- **Issue-body containment: three gaps closed** — before: (a) `setup-task` (`git.md`) — the operation `/implement` actually uses and the highest-traffic issue path in the product — emitted issue title, description, and acceptance criteria as bare bullets, while Principle 8 claimed all remote-originated bodies were wrapped; (b) the `fetch-issues-batch` output template demonstrated wrapping on the first issue only, with the second issue shown as a bare `...` elision and no instruction that the wrapper repeats — leaving up to 49 of the 50-issue cap plausibly uncontained; (c) no operation addressed the case where remote content itself contains the literal `</untrusted-issue-body>` closing marker, allowing an issue author to close the block early and inject text into devflow-authored context. After: `setup-task` wraps all remote-sourced fields in `<untrusted-issue-body>` (locally-derived fields — issue number and branch name — stay outside, matching `fetch-issue`'s model); the `fetch-issues-batch` output template now shows the full wrapper on both the first and second issue, with an explicit per-issue statement that the wrapper repeats for every entry; Principle 8 mandates neutralising any closing marker found in remote content before wrapping, with pointers from all four affected operations. (AC-0.10)

- **`/plan` issue-fetch contradicted its own spawn ban** — before: `plan.mds` declared "Do not spawn any agents until Gate 0 is confirmed" with no exception, directly contradicting the Step 0 issue fetch that must precede Gate 0; a session honouring the ban could silently skip the fetch, making the AC-0.3 fix a no-op. After: the line names the Step 0 issue fetch as its sole exception. (AC-0.3)

- **`learn-conventions` left `.devflow/conventions.md` untracked** — before: the `learn-conventions` Git operation wrote `.devflow/conventions.md` — a git-tracked carve-out path — but included no commit step, leaving `?? .devflow/conventions.md` in `git status` on every fresh project. After: `setup-task` step 4b commits `.devflow/conventions.md` after `git checkout -b` via a scoped pathspec (`commit --only -- .devflow/conventions.md`; never `git add -A`, never push, never force, never amend), on the feature branch and never on the base branch, reporting `CONVENTIONS_COMMIT: …` non-blockingly; `learn-conventions` no longer commits.

- **`devflow init` left `.claudeignore` untracked** — before: `devflow init` wrote `.claudeignore` into any git repo it ran in but never ignored the file, leaving `?? .claudeignore` in `git status` on every fresh install. After: block presence is detected only by the devflow-unique `!.devflow/conventions.md` line (the marker file is `.devflow/.root-gitignore-configured-v4`); a user-authored `.claudeignore` or `!.claudeignore` line is respected — the block is appended without its own `.claudeignore` line and a user's un-ignore is never overridden; the TypeScript function and the `ensure-root-gitignore` shell hook produce byte-identical, idempotent output.

- **`/plan`, `/debug`, and the dynamic-build wave reader did not handle `TRACEABILITY: DEGRADED`** — before: all three callers treated a `TRACEABILITY: DEGRADED` return from the Git agent the same as a successful fetch. After: `/plan` warns, carries the line verbatim into the report's traceability section, and runs Gate 0 with the bare issue reference as sole context; `/debug` reports the line verbatim and asks for the bug description before generating hypotheses; the wave reader returns empty ready/blocked sets with the DEGRADED rationale and the wave stops. (AC-0.6)

- **`fetch-issue` and `fetch-issues-batch` mishandled `#`-prefixed issue references** — before: `fetch-issue` step 1 read `If numeric, fetch directly; if text, search and select first open match` with no `#` handling, so `#42` took the text-search path and resolved to the first open match for the literal string `#42` — an unrelated issue, or none — never a direct fetch of issue 42; `fetch-issues-batch` step 1 said only `Parse ISSUE_REFS into a list of issue numbers`, leaving a `#`-prefixed token unspecified. After: both strip a leading `#` before parsing (`#42` ≡ `42`). (AC-0.3)

- **`fetch-issues-batch` aborted on one unresolvable reference** — before: a null GraphQL alias (an unresolvable reference) in a batch could abort the entire fetch. After: the null alias is dropped and reported as `NOT_FOUND ({refs})` alongside any `TRUNCATED` note; comments are not fetched in batch mode. (AC-0.3)

- **Jira issue keys were matched case-sensitively** (#350) — before: a reference typed `proj-12` was not the same string as `PROJ-12`, so an issue the user had named went unrecognised and the run degraded. After: the project key is normalised to ASCII upper case at the one place the grammar is stated, and the same alphabet (`^[A-Z][A-Z0-9_]{1,9}$`) is used by the Git agent, the Tracker agent and every provider mechanics module. This is a behaviour change, not only a fix: a lower-case Jira key that previously failed to match now resolves.

**Upgrade**: no action required. The devflow-managed `.gitignore` carve-out block advances from marker `v3` to `v4`, appending one `.claudeignore` line. The next `devflow init` or session-start hook detects the existing block and appends the line in place. Users upgrading from a `v2`-era block receive both the `!.devflow/conventions.md` re-include (added in `v3`) and `.claudeignore` in a single pass. A user who had already committed their own `.claudeignore` is unaffected — gitignore has no effect on tracked files. A repo whose `.gitignore` already carries a `.claudeignore` or `!.claudeignore` line of its own receives every carve-out line except `.claudeignore` — that one line is left to the project, so an `!.claudeignore` un-ignore is never reversed; all other carve-out lines always land. Only `.gitignore` lines are read: whether `.claudeignore` is already tracked is not detected and does not change what is written. A `v2`-era block that a user has extended with their own `.claudeignore` line also receives the missing `!.devflow/conventions.md` re-include in the same pass.

### Removed

- **The transition-era test scaffolding** (#350) — the containment exemption registry, the byte-copied baseline reference tree and the guard census are gone. Each addressed a line range of a frozen fixture that recorded what the tracker refactor was moving away from; with the end state in place they address nothing. The five live controls that lived alongside them — generated-reference structural parity, batch-first release evidence, GitHub-path reachability and the two single-authority registries — were re-homed into `tests/tracker/reference-reachability.test.ts` and `tests/tracker/single-authority.test.ts` **before** the deletion, and every known-bad probe that read the baseline tree was re-pointed at a named sample rather than dropped.

---

## [2.4.0] - 2026-09-01

### Added
- **`suppress-attribution` flag** (optional boolean, default OFF): when enabled, writes `{"commit":"","pr":""}` to the `attribution` key in `settings.json`, suppressing Claude attribution trailers in git commits and PRs. Disabling (or uninstalling) removes the `attribution` key only when its current value exactly matches that managed shape — a custom attribution object is preserved, while enabling always replaces the existing value. Toggle via `devflow flags --enable/--disable suppress-attribution`.
- **Attribution wizard step in Advanced init** (D27): the Advanced-mode `devflow init` wizard asks one attribution question after the compliance step. Recommended init never asks; it silently applies the seeded value (off by default on a fresh install). The non-interactive path is `devflow flags --enable/--disable suppress-attribution` — there is no `--attribution` init flag.

### Changed
- **`templates/settings.json` no longer ships an `attribution` block**: fresh installs now emit Claude attribution in git commits and PRs by default (where every prior install suppressed it). Existing installs are unaffected — see Upgrade note below.
- **`devflow:git` skill**: commit and PR templates no longer carry a hard-coded `Co-Authored-By: Claude` trailer or `Generated with Claude Code` footer. Attribution suppression is now an opt-in flag (`suppress-attribution`) rather than a hard-coded default.
- **Routing runtime pinned to `subswitch@0.4.0`** (from `0.2.0`). Over-window Anthropic-bound request bodies are now streamed upstream instead of being rejected by the relay, so long prompts no longer fail at the proxy; only translated (Codex) routes still return `413 request_too_large`. `buildRoutingConfigJson` no longer injects `anthropic.connectTimeoutMs` — the relay's own default (10 s, connect-only) governs; user-set values are preserved as before. The injection was a 0.2.0-era workaround artifact that outlived its purpose once the key's semantics were narrowed to DNS+TCP connect only.

### Fixed
- **`proxy-routing.json` upgrade safety**: `buildRoutingConfigJson` now strips all seven `limits.*` sub-keys that `subswitch@0.4.0` promotes to hard startup errors: `limits.maxBodyBytes` (renamed `limits.maxBufferedBodyBytes`), `limits.maxUpstreamSockets` (moved to `anthropic.maxUpstreamSockets`), `limits.streamIdleTimeoutMs` (moved to `providers.codex.streamIdleTimeoutMs`), `limits.requestTimeoutMs` (moved to `providers.codex.requestTimeoutMs`), and `limits.maxSseEventBytes` (moved to `providers.codex.maxSseEventBytes`), joining the existing strips for `anthropic.streamIdleTimeoutMs`, `limits.connectTimeoutMs`, and `limits.maxConcurrentRequests`. A hand-edited config carrying any of these keys would have killed the relay on every session start — spawned by the `ensure-proxy` hook, with no route back. The `limits` block is now omitted entirely when all its sub-keys are stripped (matching the `anthropic` block's existing omit-when-empty behaviour).

**Upgrade**: no action required. If you hand-edited `~/.devflow/proxy-routing.json` to set any of the seven stripped `limits.*` keys, move their values to the 0.4.0 target paths (`limits.maxBufferedBodyBytes`, `anthropic.maxUpstreamSockets`, or the appropriate `providers.codex.*` key); the next `devflow proxy --enable` drops the stale keys for you.

**Upgrade (attribution)**: existing installs that carry the devflow-managed `attribution` block — written by prior versions' `templates/settings.json` — keep their suppression. On the next `devflow init` or any `devflow flags` write, the managed block is detected and adopted into the manifest as `suppress-attribution: true` automatically, so no manual action is required. Installs with a custom `attribution` value are also unaffected — the shape guard prevents any modification.

---

## [2.3.0] - 2026-08-31

### Added
- **`refresh-anchor` ledger op**: post-promotion reinforcement now reaches rendered output. When the Learning agent reinforces an already-anchored observation (sharpening its `pattern`/`details`), calling `refresh-anchor <anchor_id>` re-projects the updated log row through the same `toLedgerRow` projector as `assign-anchor` and re-renders all three `.md` files. Previously, post-promotion sharpening was written to the log but never projected forward, so the rendered entry silently froze at its first-promotion snapshot.

### Changed
- **`decisions-ledger.jsonl` is now the anchor registry only (ADR-022)**: `decisions-log.jsonl` is the content authority; the ledger holds anchor numbers and `decisions_status` only. Entry content reaches the ledger exclusively through `assign-anchor` (first promotion) and `refresh-anchor` (post-promotion re-projection) via `toLedgerRow`. The Learning agent's previously sanctioned path of editing ledger rows directly is removed — content changes go to the log, then `refresh-anchor` re-projects. Tooling that reads or writes `decisions-ledger.jsonl` directly is affected.
- **`/resolve` DUPLICATE verdict**: `/resolve` now collapses duplicate cross-reviewer findings via a new `DUPLICATE` triage verdict — resolution-summary counts unique issues, with a `Duplicates Collapsed` statistics row and a `## Duplicates` section for traceability.

### Fixed
- **Semicolon-safe `details` field parsing**: the decisions formatter now splits `details` into fields using a segment-aware parser (`segmentDetails`) instead of delimiter regexes. The parser recognises a segment as a new field only when it starts with a known key name followed by `:` (anchored to segment start); semicolons inside values are preserved. Fixes four related defects: truncation at the first internal semicolon, unanchored-key false match (e.g. `reissue:` matching `issue:`), first-match-wins hijack (a key name mentioned inside an earlier value would capture the wrong segment), and newline breakage. Measured blast radius on this repo's own ledger: 111 truncated field extractions before the fix, 0 after. **Installed projects' rendered decisions/pitfalls `.md` may show one-time `--check` drift under the new parser — self-heals on the next ledger op.**
- **Armed double-assign guard**: `assign-anchor` now writes `anchor_id` back to the log row on promotion, enabling the guard that prevents re-anchoring an already-anchored observation. Previously `anchor_id` was never written back, so the guard was permanently inert and running `assign-anchor` twice on the same observation silently minted two anchors.
- **Pitfall date stamping and render date-purity**: `assign-anchor` now stamps a `date` field on all entry types (decisions and pitfalls). Previously only decision rows received a date stamp, leaving the 7-day protection window permanently inert for all pitfall entries. Render formatters now use `row.date || ''` (D5) instead of reading the clock, making renders deterministic and avoiding phantom date changes on re-render.
- **Amendments rendering**: `formatAmendmentsLine` renders the `amendments` field as a `- **Amendments**: ...` line in the entry body. Previously the projected `amendments` field was never rendered, so amendment notes were lost at the `.md` level. Index extraction regexes are now line-anchored (`/m` flag) to prevent amendment text that mentions `- **Status**:` or `- **Area**:` from hijacking the extracted values.
- **Working memory worker staged-write CAS** (closes #306): the background memory worker now writes to `WORKING-MEMORY.md.new` (staged file, never the real path) and compare-and-swaps into place only if `WORKING-MEMORY.md` is byte-identical to the pre-run snapshot. Previously the success check accepted any mtime bump on a file whose line 1 carried the stamp prefix — including a human's own concurrent edit — and on that false success the worker deleted the unprocessed queue batch and touched `.last-refresh-ok`, producing silent loss of captured turns under a healthy freshness marker.
- **Stamped pre-compact bootstrap**: `pre-compact-memory` now writes a HEAD SHA stamp on line 1 of `WORKING-MEMORY.md` (guarded by a 40-hex validation gate) and lays out the five canonical sections in fixed order. Previously the bootstrap ran without a stamp, producing "synced @ unknown" at the next SessionStart and an incorrect State-A classification that hid any real drift.
- **Reconciliation-aware worker prompt**: the memory worker prompt now includes bounded git evidence since the last stamp, explicit reconciliation and expiry guidance, and a strict DONE definition (per PF-010). Addresses unbounded carry-forward, conversation-coined labels promoted to durable state, and no-expiry instruction.
- **State-C orphaned `.processing` visibility**: `session-start-memory`'s State C queue-depth count now includes lines from any orphaned `.pending-turns.processing` file, not just `.pending-turns.jsonl`. Previously an orphaned `.processing` was invisible to the State C detector, so a CONFLICT-requeued batch did not show in the refresh-failing banner.
- **`/resolve` base branch token**: resolution summaries now render the base branch name instead of a literal `{base}` token. Step 0b was not extracting `base_branch` while the summary template referenced it.
- **render summary byte counts**: `render-decisions.cjs` now reports file sizes via `Buffer.byteLength()` instead of `String.length`. The em dash separator in index Area fields (U+2014, 3 UTF-8 bytes, 1 JS character) caused the logged index.md size to be 2 bytes per em dash in the rendered index under the old code.

---

## [2.2.0] - 2026-08-25

### Changed
- **Orchestrator charter — self-contained delegation**: added an operating rule requiring every subagent delegation to be self-contained (goal, constraints, relevant session facts, exact paths). Deliverables that draw on the conversation (issues, PRs, reports) must carry the substance in the prompt rather than a pointer to it. Charter grows from 2177 → 2452 bytes (~600 tokens), well within the 4096-byte runtime limit.
- **Skim agent**: one-view-per-file discipline (pseudo/Read tiers), branch-scoped heatmap (`--diff`, `--window`, `--top`), PATH-first `skim` invocation with `npx rskim` fallback, prose/config skim note

---

## [2.1.0] - 2026-08-25

### Added
- **Typed flag registry**: the flag surface is now a discriminated-union registry of 28 Claude Code flags — `boolean`, `enum`, `number`, and `string` kinds with per-flag validation, defaults, and display metadata. Eight new upstream-verified flags including `max-concurrent-subagents` (devflow default 40; upstream 20), `subagent-spawn-depth`, `workflow-size-guideline`, `goal-checkin-minutes`, `default-model`, `spellcheck`, and `enable-todo-tools`.
- **Flags editor TUI**: bare `devflow flags` on a TTY opens a full-keyboard settings-page editor rendering inline in the scroll buffer (no alt-screen), with effective-value display and per-flag hint blurbs. The agents view now runs on the same generic TUI shell.
- **Typed flags CLI**: `devflow flags --list/--status/--enable/--disable/--set/--unset` with input validation; `--enable/--disable` are boolean-only — non-boolean flags route through `--set`.

### Changed
- **Init seeding**: both init paths apply seeded flag values non-interactively — fresh installs get registry defaults; re-inits preserve existing values and adopt defaults only for newly added flags. The flags editor step was removed from the Advanced wizard.
- **`viewMode` folded into the registry** as the `view-mode` enum flag (`default|verbose|focus`); the `viewMode` settings key is written only when non-default. Old `flags: string[]` manifests heal in-reader on first read — no migration entry needed.

### Fixed
- **viewMode silently lost on re-init**: `resolveExistingViewMode` now runs before `stripFlags` in the settings apply block; the prior order stripped `viewMode` from settings before reading it (PF-015).
- **Published bin not executable**: `prepublishOnly` now sets the execute bit on `dist/cli.js` — the bin shipped as 0644, breaking npm 6 and constrained environments (Docker non-root users, some CI runners) that do not auto-chmod on install.

### Breaking Changes
- **Bare `devflow flags` on non-TTY** now prints a status table and exits 1 (was: usage line, exit 0). Scripts should call `devflow flags --status`.
- **Seven settings.json/env keys become Devflow-managed**: `ANTHROPIC_DEFAULT_MODEL`, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, `CLAUDE_CODE_GOAL_CHECKIN_MINUTES`, `CLAUDE_CODE_ENABLE_TODO_TOOLS` (env); `workflowSizeGuideline`, `spellcheck` (settings). Hand-set values are preserved — adopted into the manifest on the next `devflow init` or flags mutation; `max-concurrent-subagents` adopts the devflow default of 40 only when the key is absent. All keys are removed on `devflow uninstall`.

---

## [2.0.1] - 2026-08-23

### Changed
- **Release workflow hardening**: the version-bump commit stages `package.json`, `package-lock.json`, and `CHANGELOG.md` explicitly instead of `git add -A` (the 2.0.0 release committed the `release-notes.md` CI artifact this way; the file is now also gitignored), and `actions/checkout`/`actions/setup-node` are bumped v4 → v7 to clear the Node 20 runtime deprecation.
- **npm tarball changelog**: the bundled CHANGELOG.md now carries the corrected 2.0.0 section (the 2.0.0 tarball predated the release-notes fix).

### Fixed
- **`bump-version.ts` stale-header guard**: the script treated any pre-existing `## [{version}]` header as "already bumped" and skipped stamping `[Unreleased]` — which is how the 2.0.0 release initially shipped an aborted April bump's section as its release notes. It now fails loudly when a `## [{version}]` header coexists with a non-empty `[Unreleased]` section, and only skips when `[Unreleased]` is empty.

---

## [2.0.0] - 2026-08-23

### BREAKING CHANGES

#### Agent rename — 13 agents renamed to action-verb form

All 13 non-immutable devflow agents have been renamed from noun form to
action-verb form. The three unchanged agents are `git`, `knowledge`, and
`learning`.

| Old name (Form A slug) | New name (Form A slug) | Old Form B (`name:`) | New Form B (`name:`) |
|------------------------|------------------------|----------------------|----------------------|
| `coder`       | `code`      | `Coder`       | `Code`      |
| `designer`    | `design`    | `Designer`    | `Design`    |
| `evaluator`   | `evaluate`  | `Evaluator`   | `Evaluate`  |
| `researcher`  | `research`  | `Researcher`  | `Research`  |
| `reviewer`    | `review`    | `Reviewer`    | `Review`    |
| `scrutinizer` | `scrutinize`| `Scrutinizer` | `Scrutinize`|
| `simplifier`  | `simplify`  | `Simplifier`  | `Simplify`  |
| `skimmer`     | `skim`      | `Skimmer`     | `Skim`      |
| `synthesizer` | `synthesize`| `Synthesizer` | `Synthesize`|
| `tester`      | `test`      | `Tester`      | `Test`      |
| `triager`     | `triage`    | `Triager`     | `Triage`    |
| `validator`   | `validate`  | `Validator`   | `Validate`  |
| `bug-analyzer`| `diagnose`  | `BugAnalyzer` | `Diagnose`  |

**What devflow migrates automatically:**
- All devflow-owned agent files (`~/.claude/agents/devflow/`), command
  sources (`~/.claude/commands/devflow/`), and skill files are
  updated on `devflow init`. No manual action needed for devflow's own
  files.
- `agent-models.json` key migration: old slug keys in
  `~/.devflow/agent-models.json` (e.g. `coder`, `reviewer`) are
  rewritten to their canonical new form (e.g. `code`, `review`) both on
  read by `readAgentMapping` and by the one-time global migration
  `canonicalise-agent-keys-v1` that runs on the first `devflow init`
  after this upgrade.

**What you must migrate by hand:**
- Any `subagent_type` values in your **own** custom commands or agents
  that reference the old Form B names (`Coder`, `Reviewer`, etc.) must
  be updated by you — devflow cannot migrate files it does not own. For
  example: `agentType: "Coder"` → `agentType: "Code"`.
- Any references to old agent names in your **own** CLAUDE.md or project
  files — devflow never edits your CLAUDE.md.

**Downgrade warning — per-agent model overrides stop silently:**
If you upgrade to this version and then **downgrade** to a prior devflow
version, any per-agent model overrides saved under the new canonical key
names (e.g. `code`, `review`) will silently stop applying — the older
version does not know the new names and will not find the override
entries. Retroactive version-detection is impossible: `readAgentMapping`
never reads the `version` field from `agent-models.json`, and a test
pins that behaviour. There is no mechanism that could warn you. If you
downgrade, verify your overrides with `devflow agents --list`.

**Open-session warning:**
A Claude Code session left **open across the upgrade** holds a stale
orchestrator charter that still names the old agents. Restart any open
session after running `devflow init` so the new charter is injected.

**Claude Code built-in name collision check:**
The new agent names were verified against the Claude Code built-in
`subagent_type` registry (checked 2026-08-18). The Claude Code built-in
agent types are `Explore` and `Plan`. None of the 13 new devflow names
(`code`, `design`, `evaluate`, `research`, `review`, `scrutinize`,
`simplify`, `skim`, `synthesize`, `test`, `triage`, `validate`,
`diagnose`) collide with either. Note: `Plan` is a Claude Code built-in;
devflow has no `plan` agent (only a `/plan` command).
**Re-check on each major Claude Code upgrade** — a new built-in can
silently shadow a devflow agent and no in-repo guard can detect it.

#### `/dynamic-wave` command removed

The thin full-pipeline driver command is removed. Run the three stages directly:

```
/dynamic-tickets <initiative>   # 1. decompose initiative into tickets
/dynamic-plan <ticket-dir>      # 2. plan + challenge each ticket
/dynamic-build <ticket-dir>     # 3. implement, review, and verify
```

The `post-wave-report` Git-agent spawn that `/dynamic-wave` formerly handled is
now owned by `/dynamic-build`, which also owns `.devflow/docs/waves/{slug}/`
output. The stale installed command file is removed automatically by the orphan
sweep on the next `devflow init`.

#### Single-pass review in `/dynamic-build`

The review pass now runs exactly **once** per ticket. The following context
variables and machinery are removed: `maxCycles`, `reviewBaseSha`, `preFixSha`,
`cyclesRun`, `fixedInCycle`, and DELTA REVIEW. Fix commits are covered by the
fixing Code agent's self-verification and the final Gate 1 #2.

**Custom MDS host migration**: the `review_loop` export in `_engine.mds` is
renamed `review_pass`. Any custom MDS host that imports `_engine.mds` and calls
`{review_loop()}` must update the call site to `{review_pass()}`.

### Added
- **External model routing** (`devflow proxy --enable/--disable/--status`): Routes Devflow agents through GPT models (via an OpenAI/Codex subscription) using a local relay that intercepts Claude Code's model requests by injecting `ANTHROPIC_BASE_URL` into `settings.json`. `--enable` runs a four-check preflight in order — ① relay binary resolvable from Devflow's `node_modules`, ② Codex auth present at `~/.codex/auth.json`, ③ target port free or already occupied by a Devflow relay (adopted path skips spawn), ④ `settings.json` parseable with no foreign `ANTHROPIC_BASE_URL` — then spawns the relay with a 50×100ms bounded probe loop, then runs a post-spawn doctor verification gate; on doctor failure the relay is killed (self-spawned only — an adopted relay is never killed) and the enable rolls back. `--disable` strips `ANTHROPIC_BASE_URL` from `settings.json`, reverts installed agent frontmatter to Claude defaults, and emits a `kill <pid>` hint; the relay process is intentionally left running for in-flight sessions. `--status` shows relay identity, port, Codex auth content (expiry and account, not just file existence), external-mapped agent count, and the cached routable model registry. The `ensure-proxy` hook (registered on both `SessionStart` and `UserPromptSubmit`) auto-revives a down relay at session start; the `UserPromptSubmit` path exits before any proxy-state I/O to avoid per-prompt overhead. Feature state is manifest-gated (`manifest.features.proxy`); runtime authority lives in `~/.devflow/proxy.json`. Default OFF; Advanced init only. New dependency: `subswitch@0.2.0` (exact-pinned). **Upgrade**: run `devflow init` (Advanced path) to configure, or `devflow proxy --enable` after install.
- **Per-agent model and effort configuration** (`devflow agents`): Interactive TUI and CLI (`--list`, `--set <agent> --model <model>`, `--set <agent> --effort <level>`, `--reset`) for assigning models and effort levels to individual Devflow agents. Overrides are stored deviations-only in `~/.devflow/agent-models.json`; absent entries resolve to shipped defaults read live from agent source files. The routable model catalog is discovered live from the relay binary and cached at `~/.devflow/cache/models/` (24h TTL, at most 3 versioned entries keyed by runtime version, stale entries serve as fallback on discovery failure) — there is no hardcoded model list. Model aliases (e.g. `sol`, `terra`, `luna`) auto-track current model generations. GPT model assignments are **dormant** while routing is disabled — saved to disk but not materialized into agent frontmatter until `devflow proxy --enable`. Effort overrides (`low`/`medium`/`high`/`xhigh`/`max`) are orthogonal to dormancy and apply regardless of proxy state. `reapplyAgentMapping` re-applies all saved overrides after every `devflow init` so customizations survive reinstalls.
- **Ambient mode — orchestrator charter + plan handoff** (BREAKING): Two-hook orchestrator system replaces both old ambient detection paths (first-word keyword dispatch and 3-marker plan detection). A `SessionStart` hook (`session-start-orchestrator`) injects a static ~200-token charter establishing the main model as a pure orchestrator, grading sub-agents by complexity. A `UserPromptSubmit` hook (`preamble`) handles three cases: prompts beginning `Implement the following plan:` auto-run `devflow:implement`; slash commands are silenced; all other prompts get a 2-line orchestrator reminder. Both hooks are silent outside git repos. A sourced `git-marker` helper provides a pure-bash bounded upward walk (64 levels, no subprocess). **Upgrade**: run `devflow init` to register the new `session-start-orchestrator` hook.
- **`agent-teams` Claude Code flag**: bespoke Agent Teams machinery removed; teammate-mode enablement now via the optional `agent-teams` flag (`devflow flags --enable agent-teams`), which sets `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. The flag defaults to OFF.
- **Triager agent** (opus, blast-radius judgment): dedicated validation-only agent that classifies every review issue using a first-match-wins disposition matrix — SECURITY GATE → FALSE_POSITIVE → BY_DESIGN → FIX_NOW → FIX_SEPARATE → TECH_DEBT / ESCALATED — before any Coder touches code. Reads 30-line context around each reported file:line to verify issues; requires file:line evidence for FALSE_POSITIVE and an ADR or inline comment citation for BY_DESIGN. Never edits code.
- **Coder `issue-fix` mode** for `/resolve`: Coder receives pre-classified FIX_NOW issues from the Triager and applies fixes without re-litigating dispositions (`OPERATION: issue-fix`, `PUSH: false`). A `validation-fix` mode handles Validator gate failures; a `ci-fix` mode handles CI failures.
- **Verification Gate** in `/resolve` Phase 7: Validator (haiku) runs build/typecheck/lint/test against changed files; up to 2 Coder validation-fix retries on FAIL; single `git push` fires at the end of this gate (pass or fail) — never before.
- **New `resolution-summary.md` sections**: `## Decisions Citations`, `## By Design`, `## Fix Separately`, `## Escalations`, `## Verification` — all strictly additive over the existing convergence-parser contract (`## Fixed Issues`, `## False Positives` headings and Statistics table rows unchanged). The Triage agent aggregates cited ADR-NNN/PF-NNN IDs from its reasoning column into `## Decisions Citations`; the section is omitted when no citations were made.
- **Rules shadow CLI** (`rules shadow <name>` / `rules unshadow <name>` / `rules list`): shadow a rule with your own version (seeded from the installed rule or built plugin source as fallback), remove a shadow override, and list all known rules with install status and shadow state.
- **Install-report shadow warnings on `devflow init`**: invalid shadows (missing `SKILL.md`, empty rule file, or a directory at the shadow path) are surfaced in the post-install summary without failing init.
- **PR-comment publication gate (D10) and secret scrubber (D11)** for `/code-review` and `/resolve`: Summary comments posted to GitHub are now visibility-gated and secret-scrubbed unconditionally. D10 — the Git agent probes `gh repo view --json visibility` before posting; `PRIVATE` or `INTERNAL` repos receive the full report, everything else (including `PUBLIC`, command error, or unauthenticated) receives a counts-only stub. Fail-closed: any probe error defaults to STUB, never FULL. Configurable via `reviewPublication: auto|full|off` in `.devflow/config.json` (no CLI subcommand; default `auto`). D11 — every body posted to GitHub passes `redact-secrets.cjs` (installed at `~/.devflow/scripts/`) before being sent; the scrubber runs unconditionally, regardless of visibility mode, compliance config, or `reviewPublication` value. If the scrubber exits non-zero or is missing, the post is suppressed and `TRACEABILITY: DEGRADED (redaction unavailable)` is reported — the post never fires. **Stale-install note**: with a `~/.devflow` directory installed before this version (no `redact-secrets.cjs` present), all posting ops report DEGRADED and post nothing; re-run `devflow init` to install the scrubber and restore posting.

- **Compliance wizard step in both init paths** (`src/cli/commands/compliance-prompts.ts`): The compliance framework selection step now runs in **both** the Advanced and Recommended init paths (previously Advanced-only). `shouldRunComplianceStep` gates the step: Advanced always runs it; Recommended only runs it when the mode-select prompt actually fired (`modePromptShown=true`), so `--recommended` and non-TTY invocations remain promptless. The step shows a "Current setting:" note for re-init legibility, uses `p.select` (Yes/No) instead of a `p.confirm` to eliminate Enter-through ambiguity, and emits an outcome line after each answer. Framework-selection prompt choices and the multiselect message are now shared from `compliance-prompts.ts` between `init.ts` and `compliance.ts` (extracted from both). The `--compliance`/`--no-compliance` CLI flags bypass the wizard entirely when passed. The injectable `CompliancePromptIO` seam (mirrors `ProxyPreflightDeps`) enables unit tests to drive all step branches without a real TTY.

- **Dynamic compliance composition** (`src/core/compliance-compose.ts`): The compliance skill (`devflow:compliance/SKILL.md`) and compliance rule are now composed at install time from per-framework fragment files (`src/assets/skills/compliance/frameworks/{id}/fragment.md`) rather than being installed as static all-six blobs. Each fragment provides `## Mapping` (6-column control row), `## Reference` (reference-table blurb), `## Checklist` (0–2 items), and `## Rule` (one ≤200-char bullet) sections that populate 5 SKILL.md tokens (`SCOPE`, `ACTIVE`, `MAPPING`, `CHECKLIST`, `REFERENCES`) and 1 rule token (`RULE_BULLETS`). The existing `${DEVFLOW_COMPLIANCE_FRAMEWORKS}` rule placeholder is retained as a second token and handled by the existing `stampComplianceRule`. Installed artifact layout is unchanged — `references/{id}.md` basenames are preserved even though source files moved to `frameworks/{id}/reference.md`. Shadow SKILL.md without composition tokens passes through byte-identical (C1 passthrough); `devflow compliance --status` now shows `[shadowed, composition skipped — per-framework sections absent]` for such shadows (and `[shadowed]` for shadows that do contain tokens). The `--status` Skill line shows `[shadowed]` when a shadow with tokens is present.

- **`devflow:explore` skill** — structured codebase exploration with optional knowledge-base creation

### Changed
- **`devflow skills list-shadowed` renamed to `devflow skills list`** (BREAKING): `skills list` now shows all known skills with install and shadow state via `validateSkillShadow`. The `list-shadowed` subcommand is removed.
- **`/resolve` pipeline split** (BREAKING): the monolithic Resolver agent (which both validated and fixed issues) is replaced by a Triage + Code pair. The Triage agent (opus) runs a blast-radius disposition pass; the Code agent (sonnet, `OPERATION: issue-fix`) applies fixes. Plugins that declared the `resolver` agent must update their agent list to `[git, triage, code, simplify, validate]`.
- **`devflow init` (Advanced path)**: A proxy prompt (external model routing, default OFF) is now offered after the Claude Code flags selector. On enable during init, the same four-check preflight runs but no relay is spawned and no doctor runs — the first session's `ensure-proxy` hook starts the relay; preflight failure warns and forces proxy off without aborting init. `reapplyAgentMapping` now runs after every post-install file-copy to re-apply saved agent model overrides to freshly installed agent files.
- **`devflow uninstall`**: Now removes proxy artifacts on uninstall — `ensure-proxy` hook registrations, `ANTHROPIC_BASE_URL` from `settings.json`, and the model discovery cache (`~/.devflow/cache/models/`) — in addition to standard command/agent/skill/rule removal.
- **Knowledge index + on-demand Read pattern across all knowledge-consuming commands**: `/resolve`, `/plan`, `/self-review`, `/code-review`, and `/debug` (plus ambient orch equivalents `resolve:orch`, `plan:orch`, `review:orch`, `debug:orch`) now fan a compact index instead of the full ADR/PF corpus. Downstream agents (`triage`, `design`, `simplify`, `scrutinize`, `review`) Read full entry bodies on demand via `devflow:apply-decisions` and `devflow:apply-feature-knowledge`. For `/debug`, knowledge stays orchestrator-local (hypothesis generation) and is not fanned to Explore investigators. Unified placeholder convention: all 11 invocation sites use `"{worktree}"`. Closes PF-011 and fills pre-existing ambient gaps for plan:orch, review:orch, and debug:orch. Token savings: ~75K/run at 10 resolvers with current corpus; scales as O(1) instead of O(entries × agents) as corpus grows.
- **Multi-cycle review loop in `/dynamic-build`** (BREAKING): the review pass now runs exactly once per ticket. `maxCycles`, `reviewBaseSha`, `preFixSha`, `cyclesRun`, `fixedInCycle`, and DELTA REVIEW machinery are removed; the `review_loop` MDS export is renamed `review_pass` (custom MDS hosts importing `review_loop` must update the call site). Fix commits are covered by the fixing Code agent's self-verification and the final Gate 1 #2. See Breaking Changes for the migration path.
- **Learning**: Moved from Stop → SessionEnd hook with 3-session batching (adaptive: 5 at 15+ observations)
- **Learning**: Raised procedural thresholds from 2 to 3 observations with 24h+ temporal spread for both types
- **Learning**: Reduced default `max_daily_runs` from 10 to 5
- **Learning**: Renamed artifact paths: `commands/learned/` → `commands/self-learning/`, `skills/learned-{name}/` → `skills/{name}/`
- **Learning**: Skill artifacts now include `user-invocable: false`, Iron Law section, and `self-learning:` name prefix

- **State-aware re-init** (`devflow init`): re-running init now reads the prior manifest, feature config, and `settings.json` and pre-seeds every prompt with your existing choices — your installed plugin set, feature toggles, Claude Code flags, and view mode are preserved instead of reset to defaults. The Recommended/Advanced question is skipped entirely on re-init. Use `--reset` for a factory reset that ignores all prior state (mutually exclusive with `--plugin`).
- **`self-review` skill** renamed to `quality-gates`

### Removed
- **`/dynamic-wave` command** (BREAKING): the thin full-pipeline driver is removed. Run the three stages directly: `/dynamic-tickets` → `/dynamic-plan` → `/dynamic-build`. The `post-wave-report` Git-agent spawn moved into `dynamic-build`, which now owns `.devflow/docs/waves/{slug}/` output. The stale installed command file is removed automatically by the orphan sweep on the next `devflow init`. See Breaking Changes for the migration path.
- **`devflow-audit-claude` plugin and `/audit-claude` command** (BREAKING): The CLAUDE.md audit plugin is removed. `--plugin=audit-claude` is now rejected by `devflow init`; stale `devflow-audit-claude` entries in existing manifests are silently pruned by `DELETED_PLUGIN_NAMES` on the next partial reinstall. The `claude-md-auditor` agent and `audit-claude.md` command are deleted; the orphan sweep removes any previously installed copies automatically.
- **Non-selectable optional carry mechanism**: `resolveNonSelectableOptionalCarry` and `applyNonSelectableCarry` deleted from `init-seed.ts`. The carry was guarding a now-impossible state (the only non-selectable optional plugin was `devflow-audit-claude`). A structural invariant test (`EXCLUDED ∩ optional === ∅`) ensures this state stays impossible. No behavior change for users.
- **1.x migration registry and helper modules** (BREAKING): all 20 run-once 1.x upgrade migrations removed from `MIGRATIONS`; helper modules `legacy-decisions-purge.ts`, `decisions-ledger-migration.ts`, `marketplace-cleanup.ts`, and `mkdir-lock.ts` deleted. The migration framework stays for future 2.x entries. No 1.x → 2.0 upgrade path.
- **Native `claude plugin install` path** (BREAKING): the `claude plugin install` code path is removed; `installViaFileCopy` (file copy) is the sole install mechanism for all Devflow assets.
- **`extraKnownMarketplaces` registration from settings template**: the Devflow marketplace entry is no longer written to `~/.claude/settings.json` on install.
- **SHADOW_RENAMES migration machinery**: the `SHADOW_RENAMES` constant and associated migration logic for renaming skill shadow directories are removed; no active renames remain.
- **Agent Teams init flags** (BREAKING): `--teams` / `--no-teams` flags removed from `devflow init`. Projects that were using Devflow-managed `teammateMode: "auto"` will have that setting cleaned up automatically on the next `devflow init` or `devflow uninstall` run.
- **Resolver agent**: retired in favor of the Triage + Code split. The `resolver` agent file is removed from installs on `devflow init` by the orphan sweep.

- **`implementation-patterns` skill** (merged into `patterns`)
- **`search-first` skill** (merged into `research`)

### Fixed
- **`devflow agents` TUI — four defects fixed**:
  - **Fix 1 (alias rendering)**: GPT model aliases (`sol`, `terra`, `luna`) previously rendered with a parenthetical canonical-id annotation (`sol (gpt-5.6-sol)`). The picker cycle is now built from `pickerNames(catalog.models)` — aliases only; canonical id only when a model has no aliases. Aliases render bare. Stored canonical ids (e.g. `gpt-5.6-sol` saved via `--set`) are normalized to their alias on read by `buildPickerNameMap` — no disk write. `catalog.aliasToId` is no longer referenced in `render.ts`.
  - **Fix 2 (inertness at selection time)**: `mergeTuiRowsIntoMapping` extracted from `applyTuiSave` as an exported pure helper — only dirty rows modify the mapping (inertness guarantee). `rowState(row, proxyEnabled)` added to `state.ts` as a single source of truth for TUI row state. Save outro wording aligned with `--set` output (dropped "Saved. " prefix).
  - **Fix 3 (install state + orphan visibility)**: `AgentRow` and `InitRowInput` gain required `installed` and `inRegistry` fields. `buildTuiState` calls `readInstalledAgentNames` (one `readdir`, no per-agent `fs.access`) and appends orphan rows — arbitrary keys from `agent-models.json` not present in the registry — with `inRegistry: false`. A 4th **STATE** column is added to the TUI frame (AGENT 18, MODEL 32, EFFORT 13, STATE 14 = 79 ≤ 80), showing `active` / `saved-inactive` / `not installed` / `unknown`. `stripAnsi(row.name)` is mandatory before name-cell rendering to prevent ANSI injection via hostile JSON keys.
  - **Fix 4 (capitalized names)**: `formatAgentName` added to `render.ts` with exactly ONE call site — title-cases each hyphen-separated segment of the agent name for TUI display only (e.g. `bug-analyzer` → `Bug-Analyzer`). `--list` output remains lowercase because the AGENT column is an identifier users copy into `--set`, which exact-matches.
- **Learning**: reject observations with empty id/type/pattern fields
- **Learning**: Handle string-typed `.message.content` in transcript extraction (was only handling arrays)
- **Learning**: Eliminate empty-array loop noise when Sonnet returns no observations
- **Learning**: Race condition in batch file handoff (atomic `mv` replaces `cp`+`rm`)
- **Learning**: `--enable` now auto-upgrades legacy Stop hook to SessionEnd
- **Learning**: `--status` detects legacy hook and shows upgrade instructions

---

## [1.8.3] - 2026-03-22

### Fixed
- **HUD**: version upgrade notice persists after install — cache now stores only npm `latest`, reads installed version live

---

## [1.8.2] - 2026-03-22

### Fixed
- **Ambient mode**: skills not loading despite correct classification — reordered instructions so Skill tool invocations happen before any text output

---

## [1.8.1] - 2026-03-22

### Changed
- **Init wizard**: individual feature prompts with explanatory notes replace extras multiselect
- **Init wizard**: scope-aware `.claudeignore` batch install across all discovered projects (user scope)
- **Init wizard**: project discovery via `~/.claude/history.jsonl` to find all Claude-used git repos
- **Init wizard**: managed settings sudo confirmation moved to prompt phase (before spinner)
- **Init wizard**: safe-delete prompt moved to prompt phase for uninterrupted install

### Added
- `--hud` flag for `devflow init` to explicitly enable HUD
- `discoverProjectGitRoots()` utility for finding projects from Claude history

### Removed
- Extras multiselect (`buildExtrasOptions`) — replaced by individual feature prompts

---

## [1.8.0] - 2026-03-22

### Added
- **Configurable HUD** replacing bash statusline — 14 components, on/off model (#155)
- **HUD components**: directory, git branch, ahead/behind, diff stats, release info, worktree count, model, context usage, version badge, session duration, session cost, usage quota, todo progress, config counts
- **`--hud-only` flag** for standalone HUD install
- **`--no-hud` flag** to skip HUD during init
- **`devflow hud` command** (--status, --enable, --disable, --detail, --no-detail)
- **Version upgrade notification**: `✦ Devflow vX.Y.Z · update: npx devflow-kit init` (yellow, always visible even when HUD disabled)
- **Skill shadowing docs** and HUD options added to README (#156)
- **Simplifier agent** — 8 structured slop detection categories (#120)
- **Scrutinizer agent** — stub detection patterns with reference file (#121)
- **Shepherd agent** — goal-backward verification, artifact depth checking, stub type, re-verification (#124)

### Changed
- Init flow: HUD preset picker (5 options) → simple yes/no confirm
- `--disable` keeps statusLine registered (version badge still renders)
- Manifest `features.hud` field: `string|false` → `boolean`

### Fixed
- HUD base branch detection matching raw commit hashes from reflog (#156)
- HUD comparing main vs main (0/0 always) — now compares against origin/main

### Removed
- HUD preset system (minimal/classic/standard/full)
- `--configure`, `--preset`, `--hud <preset>` flags
- `speed`, `tool-activity`, `agent-activity` components

---

## [1.7.0] - 2026-03-20

### Added
- **Version update notification** — statusline shows magenta `⬆ X.Y.Z` badge when newer devflow-kit is available (24h cached npm check, fully async)

### Fixed
- **Skimmer agent** — enforce rskim usage via `tools: ["Bash", "Read"]` platform restriction and strict sequential workflow; prevents fallback to Grep/Glob
- **Init multiselect** — remove redundant "(optional)" suffix from plugin hints
- **Init multiselect** — hide `audit-claude` plugin (not production-ready; still installable via `--plugin=audit-claude`)
- **Statusline portability** — replace macOS-only `stat -f %m` with portable `get_mtime()` helper (macOS + Linux)

---

## [1.6.1] - 2026-03-20

### Added
- **`--dry-run` flag** for `devflow uninstall` — preview removal plan without deleting anything

### Fixed
- **Ambient skill loading** — removed `allowed-tools` restriction from ambient-router so skills actually load via the Skill tool
- **Ambient hook preamble** — explicit Skill tool instruction ensures models invoke skills rather than responding directly
- **Init wizard** — hide `devflow-ambient` from plugin multiselect (auto-included via ambient prompt)
- **Working memory** — replaced broken `--resume` with transcript-based background updater

---

## [1.6.0] - 2026-03-19

### Added
- **Ambient agent orchestration**: ORCHESTRATED tier spawns agent pipelines for IMPLEMENT, DEBUG, PLAN intents
- **Orchestration skills**: `implementation-orchestration`, `debug-orchestration`, `plan-orchestration` for ambient agent pipelines
- **`knowledge-persistence` skill** (#145) — extraction procedure, lock protocol, loading instructions for project knowledge
- **Knowledge loading phase** (#145) — `/debug`, `/specify`, `/self-review` now load project knowledge at startup
- **Pitfall recording phase** (#145) — `/code-review`, `/resolve` record pitfalls to `.memory/knowledge/pitfalls.md`
- **Knowledge directory** (#145) — `.memory/knowledge/` with `decisions.md` (ADR-NNN, append-only) and `pitfalls.md` (area-specific gotchas)

### Changed
- **Ambient mode**: Three depth tiers (QUICK/GUIDED/ORCHESTRATED) replacing old QUICK/GUIDED/ELEVATE
- **Ambient mode**: GUIDED tier for small-scope IMPLEMENT (≤2 files), simple DEBUG, focused PLAN, and REVIEW — main session with skills + Simplifier
- **Ambient mode**: BUILD intent renamed to IMPLEMENT for clarity
- **Coder agent**: Added `test-driven-development` and `search-first` to permanent skills
- **Command phase numbering** (#145) — renumbered fractional phases to sequential integers across 12 command files

### Fixed
- **Agent metadata** (#146) — fixed `subagent_type` in debug, added missing YAML frontmatter
- **Plugin count** (#146) — corrected to "8 core + 9 optional"
- **Skills catalog** (#146) — cataloged 3 missing skills in reference
- **Debug command** (#147) — removed non-standard `name=` parameter
- **Plugin descriptions** (#147, #148) — synced across plugin.json, plugins.ts, marketplace.json
- **Simplifier agent** (#148) — added Output/Boundaries sections
- **Plugin metadata** (#148) — added homepage/repository/license/keywords to 3 plugins

### Removed
- **`/ambient` command**: Ambient mode is now hook-only. Use `devflow ambient --enable` to activate.

### Behavioral Changes
- EXPLORE intent now always classifies as QUICK (was split QUICK/GUIDED)
- Simple text edits ("Update the README") classify as QUICK (was BUILD/GUIDED)
- Debug agent budget cap removed — agents scale to investigation needs

---

## [1.5.0] - 2026-03-13

### Added
- **Search-first skill** (#111) — New skill enforcing research before building custom utility code. 4-phase loop: Need Analysis → Search (via Explore subagent) → Evaluate → Decide (Adopt/Extend/Compose/Build)
- **Reviewer confidence thresholds** (#113) — Each review finding now includes a visible confidence score (0-100%). Only ≥80% findings appear in main sections; lower-confidence items go to a capped Suggestions section. Adds consolidation rules to group similar issues and skip stylistic preferences
- **Version manifest** (#91) — Tracks installed version, plugins, and features in `manifest.json`. Enables upgrade detection during `devflow init` and shows install status in `devflow list`

### Fixed
- **Synthesizer review glob** — Fixed `${REVIEW_BASE_DIR}/*-report.*.md` glob that matched zero reviewer files; now uses `${REVIEW_BASE_DIR}/*.md` with self-exclusion

---

## [1.4.0] - 2026-03-09

### Added
- **Smart branch naming** — `/implement #42` auto-derives branch names from issue labels and title (e.g., `feature/42-add-jwt-auth`); free-text tasks infer type from keywords (e.g., `/implement fix login bug` → `fix/login-bug`)

### Fixed
- **Code review file detection** — Corrected file detection and skill check logic in `/code-review`

### Changed
- **Author standardization** — Unified author name to Dean0x across marketplace and plugin manifests

---

## [1.3.3] - 2026-03-09

### Changed
- **Sudo trust prompt** — Managed settings now shows a clear explanation, a copy-pasteable verification prompt, and an explicit fallback option before any password prompt

### Added
- **Managed settings test coverage** — Unit tests for `installManagedSettings` two-stage write logic

---

## [1.3.2] - 2026-03-08

### Changed
- **Init prompt improvements** — Agent Teams marked as experimental with recommendation to disable; ambient mode now defaults to enabled (recommended)
- **Init flags documented** — Added `--ambient`/`--no-ambient` and `--memory`/`--no-memory` to README

---

## [1.3.1] - 2026-03-08

### Fixed
- **Background memory updater silent Write failures** — Added Read permission for memory files (Claude Code enforces Read-before-Write), read-only git commands for fresh context, mtime validation to detect silent failures, and stdout logging for debugging

---

## [1.3.0] - 2026-03-08

### Added
- **Skill shadowing** — `devflow skills shadow <name>` copies a skill for personal overrides
  - `devflow skills unshadow <name>` restores the original
  - `devflow skills list-shadowed` shows active overrides
  - Shadowed skills are preserved during `devflow init` (not overwritten)
  - Uninstall warns about remaining shadow files
- **Cross-platform hook wrapper** — `run-hook` polyglot entry point for Windows compatibility
  - Discovers bash on Windows (Git Bash, WSL, MSYS2) via standard paths
  - All hook scripts renamed to drop `.sh` extension
- **Ambient skill injection at session start** — `session-start-memory` hook injects `ambient-router` SKILL.md directly into context
  - Eliminates the need for a Read tool call to load the ambient router
  - Only activates when ambient mode is enabled
- **Skill activation integration tests** — `vitest.integration.config.ts` + helpers for live classification tests
  - Separate `npm run test:integration` for tests requiring `claude` CLI

### Changed
- **Ambient depth labels renamed** — STANDARD→GUIDED, ESCALATE→ELEVATE for clarity
  - GUIDED: skills guide the response; ELEVATE: elevate to a full workflow
- **Hook commands use `run-hook` dispatch** — Settings template and CLI now register hooks via `run-hook <name>` instead of direct `.sh` paths
- **`devflow init` auto-upgrades hook format** — Removes old `.sh`-style hooks before re-adding, ensuring existing installs migrate seamlessly
- **Skill descriptions audited** — All 12 review-only skills updated to trigger-format (`"This skill should be used when..."`)
- **Skills architecture docs** — Added description rules section with good/bad examples
- **`chmod` skipped on Windows** — `chmodRecursive` no longer runs on `win32` platform

### Fixed
- **Ambient preamble missing skill path** — Hook now tells Claude to `Read` skills from `~/.claude/skills/<name>/SKILL.md`
- **Ambient `--status` hook path parsing** — Handles `run-hook <name>` format instead of assuming direct `.sh` path

---

## [1.2.0] - 2026-03-05

### Added
- **Polyglot language skills** — Go, Java, Python, and Rust skill plugins with comprehensive patterns
  - Go: error handling, interfaces, concurrency (errgroup, worker pools, fan-out/fan-in)
  - Java: records, sealed classes, streams, composition over inheritance
  - Python: type hints, protocols, dataclasses, async patterns
  - Rust: ownership, error handling (`thiserror`/`anyhow`), type system, concurrency
  - Skills: 26 → 30, Plugins: 9 → 17
- **Optional plugin architecture** — Language/ecosystem plugins (`optional: true`) not installed by default
  - Install selectively: `devflow init --plugin=go --plugin=python`
  - Existing skills (typescript, react, accessibility, frontend-design) moved to optional plugins
  - `devflow-core-skills` no longer bundles language-specific skills
- **Conditional language reviews** in `/code-review` command
  - Spawns language-specific Reviewer agents when matching files are in the diff
  - Skill availability check: skips review if optional plugin not installed
- **Dynamic skill loading in Coder agent** — Reads language skills at runtime based on DOMAIN hint instead of static frontmatter dependencies

### Changed
- **`devflow-core-skills`** no longer includes typescript, react, accessibility, or frontend-design skills (moved to optional plugins)
- **Coder agent** frontmatter trimmed from 14 skills to 6 core skills; language skills loaded dynamically

### Fixed
- **Deprecated `grpc.WithInsecure()`** in Go concurrency examples → replaced with `grpc.WithTransportCredentials(insecure.NewCredentials())`
- **Deprecated `datetime.utcnow`** in Python dataclass example → replaced with `datetime.now(timezone.utc)`
- **SQL injection** in Python async streaming example → replaced raw query with parameterized query
- **Deprecated `<Context.Provider>`** in React examples → replaced with `<Context>` (React 19+)
- **Deprecated `useRef<T>()`** without argument in React patterns → replaced with `useRef<T | undefined>(undefined)` (React 19+)
- **Non-portable `NodeJS.Timeout`** in TypeScript debounce/throttle → replaced with `ReturnType<typeof setTimeout>`
- **Unsafe `Function` type** in TypeScript type guard → replaced with `(...args: unknown[]) => unknown`
- **Go test file exclusion** removed from go skill activation (test files are valid Go code)

---

## [1.1.0] - 2026-03-04

### Added
- **Ambient mode** — New `devflow-ambient` plugin with `/ambient` command for proportional quality enforcement
  - Intent classification (BUILD/DEBUG/REVIEW/PLAN/EXPLORE/CHAT) auto-loads relevant skills
  - Three depth tiers: QUICK (zero overhead), GUIDED (2-3 skills), ELEVATE (nudge to workflows)
  - Always-on mode via `devflow ambient --enable` or `devflow init --ambient`
  - New `ambient-router` skill for intent/depth classification
  - New `test-driven-development` skill (auto-activates for BUILD tasks)
  - Skills: 24 → 26, Plugins: 8 → 9
- **Working memory enhancements** — Structured cross-session context preservation
  - Structured sections: Now, Progress, Decisions, Modified Files, Context, Session Log
  - Toggleable via `devflow memory --enable/--disable/--status` or `devflow init --memory/--no-memory`
  - `PROJECT-PATTERNS.md` extraction — background hook accumulates patterns across sessions
  - Directory separation: `.memory/` (session state) vs `.docs/` (reviews/design artifacts)
  - Auto-migration from `.docs/` to `.memory/` with no-clobber semantics
  - Auto-adds `.memory/` and `.docs/` to `.gitignore` on first hook run

### Changed
- **Background agent permissions** — Replaced `--dangerously-skip-permissions` with `--tools "Write"` + `--allowedTools` for restricted file access in memory update hooks
- **Safe-delete auto-upgrade** — `devflow init` now detects outdated safe-delete blocks and silently upgrades them; no manual uninstall/reinstall needed

### Fixed
- **Ambient depth classification** — Intent now drives depth exclusively; removed 20-word threshold that silently downgraded ~32% of BUILD/DEBUG prompts to QUICK (#73)
- **Safe-delete file existence** — Filter non-existent files before calling `trash` in bash/zsh, fish, and PowerShell Unix blocks; prevents noisy `trash: file doesn't exist` errors on `rm -f` of missing files (#74)
- **Safe-delete deny list** — Expanded `rm` deny patterns from 8 to 21, covering `rm -r`, `rm -fr`, and `rm -f` flag variations that could bypass the `rm -rf`-only patterns (#74)

---

## [1.0.0] - 2026-02-25

### Added
- **Agent Teams integration** - Peer-to-peer agent collaboration across workflows
  - `/code-review` uses adversarial review team with debate round and consensus findings
  - `/implement` uses exploration and planning teams with debate, Shepherd↔Coder direct dialogue
  - New `/debug` command for competing hypothesis investigation with agent teams
  - `agent-teams` foundation skill with team spawning, challenge protocol, consensus formation
  - Graceful fallback to parallel subagents when Agent Teams is unavailable
- **`devflow-debug` plugin** - New plugin for bug investigation
  - `/debug` command spawns 3-5 hypothesis investigators
  - Adversarial debate where agents actively disprove each other's theories
  - Root cause analysis report with confidence levels
- **`accessibility` skill** - WCAG 2.1 AA patterns for keyboard navigation, ARIA, contrast
  - Iron Law: EVERY INTERACTION MUST BE POSSIBLE WITHOUT A MOUSE
  - Auto-triggers when creating UI components, forms, or interactive elements
- **`frontend-design` skill** - Intentional visual design patterns (Anthropic's 4 Dimensions)
  - Iron Law: AESTHETICS MUST HAVE INTENT
  - AI slop detection (purple-pink gradients, Inter without rationale, everything centered)
  - Auto-triggers when working with CSS, styling, or visual design
- **Enhanced `react` skill** - Added 5 new categories from Vercel best practices
  - Async Parallelization (Promise.all for independent fetches)
  - Bundle Size (no barrel imports, lazy loading)
  - Re-render Optimization (primitive deps, stable callbacks)
  - Image Optimization (dimensions, lazy loading, aspect-ratio)
  - Data Structure Performance (Set/Map for O(1) lookups)
- **Conditional frontend reviews** in `/code-review` command
  - `react` review (if .tsx/.jsx files changed)
  - `accessibility` review (if .tsx/.jsx files changed)
  - `frontend-design` review (if .tsx/.jsx/.css/.scss files changed)
- **Glob pattern activation schema** for skills
  - Skills can declare `activation.file-patterns` and `activation.exclude` in frontmatter
  - Future-proofs for conditional skill loading
- **`github-patterns` skill** - Foundation skill for GitHub API interactions
  - Rate limiting patterns (1-2s delays, 60s wait if <10 remaining)
  - Comment deduplication algorithms
  - Line-in-diff validation for PR comments
  - Issue data parsing (acceptance criteria, dependencies)
  - Branch name generation from issues
  - Tech debt management patterns (archive on overflow)
  - Iron Law: RESPECT RATE LIMITS OR FAIL GRACEFULLY
- **Unified `Git` agent** - Single parameterized agent for all git/GitHub operations
  - `fetch-issue` operation: Fetches GitHub issue details with acceptance criteria and suggested branch name
  - `comment-pr` operation: Creates PR inline comments with deduplication and rate limiting
  - `manage-debt` operation: Updates tech debt backlog issue with semantic deduplication
  - `create-release` operation: Creates GitHub release with version tag
  - Replaces: GetIssue, Comment, TechDebt agents
- **`git-workflow` skill** - Unified commit and PR patterns (atomic commits, message format, PR quality)
  - Iron Law: ATOMIC COMMITS OR NO COMMITS
  - Auto-triggers when staging files, creating commits, or opening PRs
- **Iron Laws** - Every skill now has a single, non-negotiable core principle
  - 24 Iron Laws across all skills (e.g., "NEVER THROW IN BUSINESS LOGIC", "NO FAKE SOLUTIONS")
  - Automatically enforced when skills activate
  - Consistent format: `## Iron Law` section in each SKILL.md
- **Clarification Gates** for `/specify` command
  - Gate 0: Confirm understanding before exploration
  - Gate 1: Validate scope and priorities after exploration
  - Gate 2: Confirm acceptance criteria before issue creation
  - No gate may be skipped - explicit user approval required
- **Security deny list** via OS-level managed settings (140 blocked operations)
  - System destruction (rm -rf, dd, mkfs, shred)
  - Code execution (curl|bash, eval, exec)
  - Privilege escalation (sudo, su, doas, pkexec)
  - Permission changes (chmod 777, chown root)
  - System control (kill -9, reboot, shutdown)
  - Data exfiltration (netcat, socat, telnet)
  - Sensitive file reads (.env, SSH keys, AWS credentials)
  - Package globals (npm -g, pip --system)
  - Resource abuse (fork bombs, crypto miners)
- **`ENABLE_TOOL_SEARCH`** environment variable in settings
  - Deferred MCP tool loading until needed
  - ~85% token reduction for conversations with many MCP tools
- **Context usage percentage** in statusline
  - Replaces binary "exceeds 200k" warning
  - Color-coded: Green (<50%), Yellow (50-80%), Red (>80%)
  - Calculated from `context_window.current_usage` data
- **Working Memory hooks** — Automatic session continuity via stop/session-start/pre-compact hooks (#59)
  - Background haiku updater writes `.docs/WORKING-MEMORY.md` asynchronously
  - SessionStart hook injects previous memory + git state on startup
  - mkdir-based locking for concurrent session safety
- **Teams/no-teams command variants** — Install-time selection of Agent Teams vs parallel subagents (#61)
  - `--teams`/`--no-teams` CLI flags with TTY confirmation prompt
  - Variant-aware installer copies correct `.md` files
  - `stripTeamsConfig()` removes teams env vars when disabled

### Changed
- **Lean agent and command redesign** - Major refactoring reducing 3,653 lines to 844 (-77%)
  - Commands: `/implement` (479→182), `/specify` (631→179), `/devlog` (408→113), `/code-review` (312→136)
  - Agents: Coder, Synthesizer, Reviewer, Git, Devlog, CatchUp, Skimmer, Simplifier
  - Removed embedded bash scripts, verbose templates, redundant explanations
  - Preserved all workflows, agent invocations, and architecture
- **Agent model assignments** - Simplified to inherit vs haiku
  - `inherit`: Coder, Reviewer, Simplifier, Skimmer (use orchestrator's model)
  - `haiku`: Synthesizer, Git, Devlog, CatchUp (fast, simple operations)
- `/specify` now requires explicit user confirmation at each gate
- Statusline shows actual percentage instead of just large context warning
- Settings template includes permissions.deny and env configuration
- Commit and PR patterns now auto-activate via skills instead of requiring explicit commands
- **Skills consolidation** — 28 skills merged to 24
  - `test-design` + `tests-patterns` → `test-patterns`
  - `commit` + `pull-request` → `git-workflow`
  - `code-smell` absorbed into `core-patterns`
  - `codebase-navigation` removed (redundant with Explore agent)
  - `devflow-` prefix dropped from all skill names
- **Managed settings** replace `--override-settings` flag — OS-level deny list installed to system-managed path, non-overridable by user settings
- **CLAUDE.md creation removed** — opinionated template no longer forced on users during init
- **`--teams` default flipped to off** — Agent Teams now opt-in via `--teams` flag
- **`/review` renamed to `/code-review`** — Plugin directory, command files, CLI registry, and all cross-references updated for clarity
- **Landing page** — Reference badge and repo homepage URL added

### Removed
- **`/commit` command** - Replaced by `git-workflow` skill (use `git commit` directly)
- **`/pull-request` command** - Replaced by `git-workflow` skill (use `gh pr create` directly)
- **`/breakdown` command** - Removed (use natural conversation or TodoWrite directly)
- **`/release` command** - Removed (use manual release process)
- **`/resolve-comments` command** - Removed (address PR comments directly)
- **`/run` command** - Removed (use `/implement` for full lifecycle)
- **`Commit` agent** - Patterns moved to `git-workflow` skill
- **`PullRequest` agent** - Patterns moved to `git-workflow` skill
- **`Release` agent** - Removed (use manual release process)
- **`/catch-up` command** - Superseded by Working Memory hooks (automatic context restoration)
- **`/devlog` command** - Superseded by Working Memory hooks (automatic session logging)
- **`catch-up` agent** - No longer needed with automatic Working Memory
- **`devlog` agent** - No longer needed with automatic Working Memory
- **`GetIssue` agent** - Replaced by Git agent (operation: fetch-issue)
- **`Comment` agent** - Replaced by Git agent (operation: comment-pr)
- **`TechDebt` agent** - Replaced by Git agent (operation: manage-debt)

### Fixed
- **Statusline base branch detection** — Layered 4-tier fallback (branch reflog → HEAD reflog → `gh pr view` cache → main/master) replaces hardcoded main/master check; fixes incorrect diff stats for branches off `develop`, `staging`, etc. (#70)
- **Stale CLAUDE.md in files array** — Removed from `package.json` after CLAUDE.md creation was dropped
- **Skimmer agent** — Use `npx rskim` to eliminate global install requirement (#60)
- **Working Memory throttle race** — Marker file prevents concurrent updater spawns during Agent Teams sessions (#62)
- **Working Memory diagnostics** — stderr captured to log file instead of swallowed (#62)

---

## [0.9.0] - 2025-12-04

### Added
- **`/get-issue` command** - Fetch GitHub issue details and create working branch
  - Fetch issue by number (`/get-issue 42`) or search term (`/get-issue fix login`)
  - Display comprehensive issue details (title, body, labels, assignees, comments)
  - Auto-generate branch names: `{type}/{number}-{slug}`
  - Branch type derived from labels (feature, fix, docs, refactor, chore)
  - Pre-flight checks for gh authentication and repository validation
- **`get-issue` sub-agent** - Specialized agent for GitHub issue workflow

### Changed
- Optimized sub-agent model selection - 5 sub-agents switched to haiku model (get-issue, pull-request, project-state, tech-debt, pr-comments)
- Minimized command files - `/get-issue` (16 lines) and `/pull-request` (20 lines) delegate to sub-agents

---

## [0.8.1] - 2025-12-02

### Added
- **`--verbose` flag for `devflow init`** - Clean, command-focused output by default
  - Default output shows only version, available commands, and docs link
  - Use `--verbose` for detailed installation progress, paths, and skills list
  - Improves first-run experience by reducing noise

### Changed
- Refactored init command output rendering into separate functions
- Extracted command and skill lists into maintainable constants

---

## [0.8.0] - 2025-11-21

### Added
- PR comments and tech debt tracking for code-review command
- Robustness improvements (rate limiting, auto-archive for tech debt)

### Changed
- Split code-review into three specialized sub-agents (code-review, pr-comments, tech-debt)
- Simplified code-review Phase 1 setup

---

## [0.7.0] - 2025-11-16

### Added
- **`/brainstorm` command** - Explore design decisions and architectural approaches
  - Launches brainstorm sub-agent for structured exploration
  - Analyzes trade-offs between different approaches
  - Saves exploration to `.docs/brainstorm/`
- **`/design` command** - Create detailed implementation plans with integration points
  - Launches design sub-agent for concrete planning
  - Studies existing codebase patterns
  - Saves implementation plan to `.docs/design/`
- **`/breakdown` command** - Quick task decomposition without interaction
  - Renamed from `/plan-next-steps` for conciseness
  - Extracts action items from conversation
  - Saves todos immediately without triage

### Changed
- **`/plan` command** - Redesigned for deliberate issue triage
  - Examine each issue individually (what, why, severity)
  - Three-way decision: implement now, defer to GitHub issue, or skip
  - Creates and locks actual GitHub issues via `gh` CLI
  - Applies orchestration principle (minimal tools)
- **`/commit` command** - Execute immediately without user confirmation
  - Trust agent judgment after safety checks pass
  - Only abort for genuine issues (secrets, credentials)
  - Faster workflow without back-and-forth
- **`/run` command** - Streamlined from 507 to ~100 lines (renamed from `/implement`)
  - Removed over-engineered interactive triage
  - Focus on efficient task execution
  - Only stop for genuine design decisions
- **Documentation framework** - Standardized across all agents
  - Timestamps: YYYY-MM-DD_HHMM (sortable, readable)
  - Branch slugs: sanitize `/` to `-` for file paths
  - Consistent `.docs/` directory structure
- **Research skill** - Updated to use brainstorm agent
  - Auto-launches brainstorm for unfamiliar features
  - Suggests `/design` after exploration completes

### Removed
- **`/research` command** - Replaced by `/brainstorm` + `/design` workflow
- **`/plan-next-steps` command** - Renamed to `/breakdown`
- **research sub-agent** - Replaced by brainstorm and design agents

### Breaking Changes
- `/plan-next-steps` renamed to `/breakdown`
- `/research` command removed (use `/brainstorm` + `/design`)
- `/plan` behavior completely changed (triage vs batch selection)

## [0.6.1] - 2025-11-04

### Fixed
- Skills installation structure for auto-discovery - Skills are now installed directly under `~/.claude/skills/` instead of `~/.claude/skills/devflow/`, enabling Claude Code to properly discover and auto-activate them
- Uninstall command now correctly removes individual skill directories
- Migration cleanup for users upgrading from nested to flat skill structure

## [0.6.0] - 2025-11-03

### Added

#### Complete PR Workflow Commands
- **`/plan` command** - Interactive planning with design decisions
  - Extracts actionable tasks from discussion
  - Presents tasks to user for selection via interactive UI
  - Saves only chosen tasks to todo list
  - Enables focused, intentional work sessions
- **`/pull-request` command** - Smart PR creation with auto-generated descriptions
  - Analyzes all commits and changes in branch
  - Generates comprehensive PR description automatically
  - Includes summary, key changes, and test plan
  - Supports `--draft` flag and custom base branch
  - Uses new pull-request sub-agent for deep analysis
- **`/resolve-comments` command** - Systematic PR feedback resolution
  - Fetches PR review comments via GitHub CLI
  - Triages comments with user (implement, respond, defer)
  - Implements changes and updates PR
  - Posts replies to reviewers
  - Tracks completion status

#### Enhanced Audit System
- **Three-category reporting** - All 9 review agents refactored for clearer feedback
  - **🔴 Issues in Your Changes** - NEW vulnerabilities/problems introduced (BLOCKING)
  - **⚠️ Issues in Code You Touched** - Problems near your changes (SHOULD FIX)
  - **ℹ️ Pre-existing Issues** - Legacy problems unrelated to PR (INFORMATIONAL)
  - Prevents scope creep in code reviews by clearly separating what you introduced
- **New pull-request sub-agent** - Comprehensive PR analysis specialist
  - Analyzes commit history and code changes
  - Generates structured PR descriptions
  - Identifies breaking changes and migration paths
  - Creates test plans and verification steps

### Changed

#### Code Review Command Rewrite
- **Completely rewritten `/code-review` command** - Better orchestration and synthesis
  - Orchestrates all review sub-agents in parallel for faster execution
  - Synthesizes findings from three-category reports
  - Generates actionable summary with clear priorities
  - Separates blocking issues from informational findings
  - Provides focused feedback on what actually needs fixing

#### Type Safety Improvements
- **Enhanced error handling in CLI** - Proper TypeScript type guards
  - Added `NodeSystemError` interface with proper typing
  - Created `isNodeSystemError()` type guard function
  - Replaced `error: any` with `error: unknown` in init command
  - Safely checks `error.code` property with type guard
  - Maintains runtime behavior while improving type safety

### Fixed

#### Documentation
- **README CLI examples** - Corrected command invocation format
  - Fixed examples to use `npx devflow-kit` instead of `devflow`
  - Ensures users can successfully run installation commands
- **Statusline metrics** - Fixed container-specific resource monitoring
  - Now reads container-specific CPU and memory metrics correctly
  - Removed redundant CPU and memory metrics from statusline implementation
  - Improved accuracy for Docker container environments

---

[0.6.0]: https://github.com/dean0x/devflow/compare/v0.5.0...v0.6.0

## [0.5.0] - 2025-10-24

### Added

#### Installation Scope Support
- **Two-tier installation strategy** - Choose between user-wide and project-specific installation
  - **User scope** (default): Install to `~/.claude/` for all projects
  - **Local scope**: Install to `<git-root>/.claude/` for current project only
  - Interactive prompt with clear descriptions when `--scope` flag not provided
  - CLI flag: `devflow init --scope <user|local>`
  - Automatic .gitignore updates for local scope (excludes `.claude/` and `.devflow/`)
  - Perfect for team projects where Devflow should be project-specific

#### Smart Uninstall with Scope Detection
- **Auto-detection of installed scopes** - Intelligently finds and removes Devflow installations
  - Automatically detects which scopes have Devflow installed (user and/or local)
  - Default behavior: Remove from all detected scopes
  - Manual override: `--scope <user|local>` to target specific scope
  - Clear feedback showing which scopes are being uninstalled
  - Graceful handling when no installation found

### Changed

#### Code Quality Improvements
- **Extracted shared utilities** - Eliminated code duplication between init and uninstall commands
  - Created `src/cli/utils/paths.ts` for path resolution functions
  - Created `src/cli/utils/git.ts` for git repository operations
  - Reduced duplication by ~65 lines
  - Single source of truth for path and git logic

#### Performance Optimizations
- **Eliminated redundant git detection** - Cache git root result for reuse
  - Previously called `git rev-parse` twice during installation
  - Now cached once and reused throughout installation process
  - Faster installation, especially in large repositories

### Fixed

#### CI/CD Compatibility
- **TTY detection for interactive prompts** - Prevents hanging in non-interactive environments
  - Detects when running in CI/CD pipelines, Docker containers, or automated scripts
  - Falls back to default scope (user) when no TTY available
  - Clear messaging when non-interactive environment detected
  - Explicit instructions for CI/CD usage: `devflow init --scope <user|local>`

#### Security Hardening
- **Environment variable path validation** - Prevents malicious path overrides
  - Validates `CLAUDE_CODE_DIR` and `DEVFLOW_DIR` are absolute paths
  - Warns when paths point outside user's home directory
  - Prevents path traversal attacks via environment variables
  - Security-first approach to custom path configuration

### Documentation
- **Installation Scopes section** in README with clear use cases
- **Updated CLI commands table** with scope options for init and uninstall
- **Migration guide** for existing users (scope defaults to user for compatibility)
- **.gitignore patterns** documented for local scope installations

---

## [0.4.0] - 2025-10-21

### Added

#### Skills Infrastructure
- **Auto-activating skills system** - Intelligent context-aware capabilities that activate when relevant
  - Skills replace standalone commands with intelligent activation patterns
  - 7 new skills: research, debug, devlog, test-generation, api-integration, data-migration, refactoring-assistant
  - Skills displayed on devflow init with clear descriptions
  - Installed to `~/.claude/skills/devflow/` directory
  - Automatic activation based on conversation context

#### Smart Interactive Commands
- **/run command** - Orchestrator for guided feature implementation (originally `/implement`)
  - Interactive workflow for planning, research, and execution
  - Integrates with project-state agent for context gathering
  - Guides through research, design, implementation, and testing phases
  - Prevents blind coding by requiring user approval at each stage

#### Command→Agent→Skill Architecture
- **Dual-mode pattern** - Commands for explicit invocation, skills for auto-activation
  - Commands: `/research`, `/debug` for explicit user requests
  - Skills: Auto-activated versions when conversation context matches
  - Clear separation of concerns and activation modes
  - Documented pattern for extending Devflow functionality

#### Enhanced /devlog Command
- **Orchestrator pattern** - Refactored to use project-state agent
  - Delegates project analysis to specialized agent
  - Cleaner separation of orchestration vs analysis logic
  - More maintainable and extensible architecture
  - Comprehensive session documentation with context gathering

### Changed
- **Skills-first approach** - research and debug migrated to dual-mode (command + skill)
  - Commands remain for explicit invocation
  - Skills provide automatic activation based on context
  - No loss of functionality, enhanced discoverability

### Fixed
- **Security vulnerability** - Added input validation for execSync to prevent command injection
  - Validates all user input before shell execution
  - Proper escaping and sanitization
  - Security hardening in CLI commands

- **Uninstall bug** - Fixed cleanup issue and refactored CLI to namespace pattern
  - Proper cleanup of all installed assets
  - Consistent namespace pattern across CLI
  - Improved error handling and user feedback

### Documentation
- **Comprehensive skills guide** - Added to README and CLAUDE.md
  - Detailed explanation of skills infrastructure
  - How to create new skills
  - When to use skills vs commands
  - Auto-activation patterns and best practices

- **Development guide updates** - Enhanced CLAUDE.md for contributors
  - Skills development patterns
  - Command→Agent→Skill architecture explanation
  - Testing guidelines for dual-mode functionality

- **Documentation gap fixes** - Addressed critical gaps from code review
  - Improved clarity and completeness
  - Fixed missing examples and use cases
  - Better organization and navigation

---

## [0.3.3] - 2025-10-19

### Fixed
- **Statusline path resolution** - Use absolute paths instead of tilde (~) for reliable execution
- **Audit report organization** - Formalized structured storage for all review reports
  - Branch-specific directories: `.docs/reviews/<branch-name>/`
  - Timestamped reports for historical tracking
  - Standardized naming: `<review-type>-report.<timestamp>.md`
  - Standalone directory for direct agent invocations
  - Applied consistently across all 9 review agents

### Added
- **Release notes persistence** - Save comprehensive release notes to `.docs/releases/RELEASE_NOTES_v<version>.md`
- **Documentation verification** - Release agent now verifies documentation alignment
  - Checks version references across ROADMAP, READMEs, CHANGELOG
  - Detects monorepo subpackages
  - Provides search-and-replace commands for fixing mismatches
- **Production build standards** - Global CLAUDE.md guidelines for production optimization
  - Never ship test files, debug symbols, or sourcemaps
  - Separate dev/prod build configurations
- **Test suite safety** - Sequential test execution standards to prevent Claude Code crashes
  - Memory limits and resource cleanup requirements
  - Framework-specific configuration flags

---

## [0.3.2] - 2025-10-17

### Changed
- **Simplified init command output** - Reduced installation output from ~60-80 lines to ~10-15 lines
- **Unified review commands** - Consolidated /pre-commit and /pre-pr into single /code-review command
- **Streamlined statusline** - Removed cost/API metrics, added CPU/memory monitoring (28% code reduction)

### Improved
- Replaced /catch-up suggestion with comprehensive commands reference for better initial UX

---

## [0.3.1] - 2025-10-17

### Fixed
- **catch-up agent crashes** - Prevent Claude Code session crashes from expensive operations
  - Replaced full-project filesystem scans with surgical `git diff --name-only HEAD~1`
  - Removed automatic test suite execution (prevents timeout crashes)
  - Removed automatic build execution (prevents resource exhaustion)
  - Scoped TODO/FIXME search to recently modified files only (git-based)
  - Maintains user-preferred 5 status document limit
  - Cleaner code with reduced safety comment overhead
  - Critical fix for large codebases that caused Claude Code to hang/crash

## [0.3.0] - 2025-10-16

### Added

#### Language-Agnostic Global CLAUDE.md
- **Global engineering principles** - Universal CLAUDE.md works across all programming languages
  - Strips language-specific syntax, focuses on concepts (Result types, DI, immutability, pure functions)
  - Critical anti-patterns enforcement (NO FAKE SOLUTIONS, FAIL HONESTLY, BE TRANSPARENT)
  - Code quality enforcement (root cause analysis over workarounds)
  - Architecture documentation standards (document patterns, boundaries, exceptions)
  - Type safety best practices, security requirements, naming conventions
  - Structured as ~330 lines of precise, non-bloated global instructions

#### Smart CLAUDE.md Installation
- **Intelligent mounting logic** - Preserves user's existing global configuration
  - Fresh install: Directly installs CLAUDE.md (no conflicts)
  - Existing CLAUDE.md: Preserves user file, creates CLAUDE.devflow.md with merge instructions
  - `--force` flag: Prompts for confirmation, backs up to .backup before override
  - `-y` flag: Auto-approves prompts for automation/CI/CD workflows
  - Parallel implementation to settings.json (consistent UX across installations)
  - Never overwrites without explicit permission

#### TypeScript Auditor Sub-Agent
- **review-typescript** - Specialized TypeScript code quality and type safety auditor
  - Conditional execution: Runs only if .ts/.tsx files changed OR tsconfig.json exists
  - Built-in detection logic (gracefully skips non-TypeScript projects)
  - Comprehensive reviews: type safety config, `any` usage, type assertions, branded types
  - Advanced patterns: discriminated unions, immutability, Result types
  - Code quality: naming conventions, dependency injection, pure functions
  - Severity-based reporting (CRITICAL/HIGH/MEDIUM/LOW) with file:line references
  - Integrated into `/pre-commit` and `/pre-pr` workflows

#### Release Automation Workflow
- **`/release` command** - Project-agnostic release automation for professional releases
  - Multi-step interactive workflow with user confirmations
  - Preview changes before committing, pushing, or publishing
  - Clear rollback instructions if any step fails
  - Comprehensive final summary with verification links

- **release sub-agent** - Specialized agent for safe, automated release management
  - Universal project detection (10+ ecosystems supported)
  - Intelligent version bumping based on conventional commit analysis
  - Auto-generated changelogs from git history
  - Built-in safety checks (clean directory, builds, tests)
  - Platform integration (creates GitHub/GitLab releases via gh/glab)

#### Supported Release Ecosystems
- Node.js (package.json + npm)
- Rust (Cargo.toml + cargo)
- Python (pyproject.toml/setup.py + pip/twine)
- Go (go.mod + git tags)
- Ruby (gemspec + gem)
- PHP (composer.json + composer)
- Java/Maven (pom.xml + mvn)
- Java/Gradle (build.gradle + gradle)
- Swift (Package.swift + git tags)
- Generic (VERSION file + git tags)

#### Release Workflow Steps
1. Detect project type and configuration
2. Verify clean working directory
3. Analyze commits since last release
4. Generate changelog entry from commit history
5. Update version files (automatic detection)
6. Build and test project
7. Preview changes and await user confirmation
8. Commit version bump
9. Push to remote repository
10. Publish to package registry (npm, crates.io, PyPI, etc.)
11. Create annotated git tag
12. Create platform release (GitHub/GitLab)
13. Provide verification links and next steps

### Changed
- **Pre-commit workflow** - Integrated review-typescript into 5-agent review
  - Conditionally executes for TypeScript projects
  - No manual configuration needed
- **Pre-PR workflow** - Integrated review-typescript into comprehensive review
  - Automatic TypeScript detection and execution
  - Preserves existing review orchestration patterns

### Documentation
- Added `/release` command to README commands table
- Added `release` sub-agent to README sub-agents table
- Added `review-typescript` sub-agent to README sub-agents table
- Created "Creating a Release" workflow section in README
- Documented smart CLAUDE.md installation behavior
- Included release automation in integration examples


## [0.2.0] - 2025-10-16

### Added
- **review-documentation sub-agent** - Ensures documentation stays aligned with code
  - Validates README accuracy (installation, usage, examples)
  - Checks API documentation matches actual function signatures
  - Detects stale code comments and commented-out code
  - Verifies code examples actually work
  - Language-agnostic documentation pattern detection
  - Severity-based reporting (CRITICAL/HIGH/MEDIUM/LOW)
- **Smart settings.json management** - 3-tier backup strategy prevents data loss
  - First install: Direct installation
  - Existing settings: Backup to managed-settings.json
  - Both exist: Save as settings.devflow.json with clear instructions
  - User maintains control of their configuration
- **Surgical test execution** - Prevents Claude Code session crashes
  - Static analysis by default (80% value, 0% crash risk)
  - Smart test selection based on git changes
  - Individual test file execution with 30s timeouts
  - Max 10 test files per run with resource limits
  - Early termination on repeated error patterns
- **Language-agnostic agents** - Works with any programming language
  - Auto-detection for 9+ package managers
  - Universal ORM and database patterns
  - Smart test command detection from manifests
  - Generic file search patterns for all ecosystems

### Changed
- **Pre-commit strategy** - Lightweight 5-agent review for fast feedback
  - Core reviews: Security, Performance, Architecture, Tests, Complexity
  - Typical execution: 30-60 seconds
  - Additional reviews available on explicit request
- **Pre-pr strategy** - Comprehensive 7-8 agent review
  - All core reviews plus Dependencies and Documentation
  - Conditional Database review (only if DB files changed)
  - Typical execution: 2-3 minutes
  - Thorough branch review before PR creation
- **Path handling** - No longer assumes HOME environment variable
  - Uses Node.js homedir() as fallback
  - Environment variable overrides: CLAUDE_CODE_DIR, DEVFLOW_DIR
  - Cross-platform compatibility improvements

### Fixed
- **Git lock file conflicts** - Wait-based prevention instead of deletion
  - Implemented wait_for_lock_release() with 10s timeout
  - Explicit wait commands after each git operation
  - Command substitution patterns for synchronous execution
  - Prevents zombie process lock file issues
  - No more `.git/index.lock` errors
- **Settings overwrite issue** - User settings preserved with backup strategy
- **Hardcoded path assumptions** - Proper fallbacks and environment overrides

### Documentation
- Added review-documentation to sub-agents table in README
- Clarified review strategies for pre-commit vs pre-pr
- Updated workflow examples with refined command usage

## [0.1.2] - 2025-10-05

### Added
- `/research [topic]` - Comprehensive pre-implementation research and planning command
- `research` sub-agent - Specialized agent for systematic implementation research with 10-step workflow
  - Analyzes multiple implementation approaches with pros/cons/trade-offs
  - Studies official documentation and code examples
  - Reviews existing codebase patterns and conventions
  - Designs integration strategy with specific file paths
  - Identifies risks and creates actionable implementation plans
  - Saves research reports to `.docs/research/`

### Documentation
- Updated README.md with `/research` command in workflow examples
- Added research sub-agent to sub-agents table

## [0.1.1] - 2025-10-03

### Changed
- **Simplified Installation**: Single command installation using `npx devflow-kit init` (no global install needed)
- **Improved Documentation**: Commands and sub-agents now displayed in easy-to-scan tables
- **Better Organization**: Separated user documentation (README.md) from developer guide (CLAUDE.md)
- **Reduced Duplication**: Eliminated redundant information throughout README

### Documentation
- Reorganized README.md with table-based layout for commands and sub-agents
- Moved developer/AI agent instructions to CLAUDE.md
- Updated installation to promote npx usage over global install
- Reduced README from 289 lines to 204 lines while preserving all information

## [0.1.0] - 2024-10-03

### 🎉 Initial Release

Devflow is an Agentic Development Toolkit designed to enhance Claude Code with intelligent commands and workflows for AI-assisted development.

### Added

#### Core Commands
- `/catch-up` - Smart summaries for starting new sessions with status validation
- `/devlog` - Development log for comprehensive session documentation (formerly note-to-future-self)
- `/plan-next-steps` - Extract actionable next steps from current discussion
- `/pre-commit` - Review uncommitted changes using specialized sub-agents
- `/pre-pr` - Comprehensive branch review for PR readiness assessment
- `/commit` - Intelligent atomic commit creation with safety checks
- `/debug [issue]` - Systematic debugging with issue-specific investigation

#### Sub-Agents (Audit Specialists)
- `review-security` - Security vulnerability detection and analysis
- `review-performance` - Performance optimization and bottleneck detection
- `review-architecture` - Software architecture and design pattern analysis
- `review-tests` - Test quality and coverage analysis
- `review-dependencies` - Dependency management and security analysis
- `review-complexity` - Code complexity and maintainability assessment
- `review-database` - Database design and optimization review

#### Workflow Sub-Agents
- `catch-up` - Project status and context restoration with validation
- `commit` - Intelligent commit creation with safety checks

#### Features
- **Smart Statusline** - Real-time project context display with git status and cost tracking
- **Security & Optimization** - Automatic `.claudeignore` file creation for token efficiency
- **Parallel Sub-Agent Execution** - Run multiple reviews simultaneously for better performance
- **Git Safety** - Sequential git operations to prevent lock file conflicts
- **Structured Documentation** - Organized tracking in `.docs/` directory

### Technical Details
- Built with TypeScript and Commander.js
- Supports Claude Code on macOS, Linux, and Windows
- Requires Node.js 18.0.0 or higher
- Modular architecture with isolated sub-agents

### Installation
```bash
npm install -g devflow-kit
devflow init
```

### Documentation
- Comprehensive guide in README.md
- Quick reference in README.md
- Self-documenting commands

---

[Unreleased]: https://github.com/dean0x/devflow/compare/v2.0.0...HEAD
[2.4.0]: https://github.com/dean0x/devflow/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/dean0x/devflow/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/dean0x/devflow/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/dean0x/devflow/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/dean0x/devflow/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/dean0x/devflow/compare/v1.8.3...v2.0.0
[1.8.3]: https://github.com/dean0x/devflow/compare/v1.8.2...v1.8.3
[1.8.2]: https://github.com/dean0x/devflow/compare/v1.8.1...v1.8.2
[1.8.1]: https://github.com/dean0x/devflow/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/dean0x/devflow/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/dean0x/devflow/compare/v1.6.1...v1.7.0
[1.6.1]: https://github.com/dean0x/devflow/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/dean0x/devflow/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/dean0x/devflow/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/dean0x/devflow/compare/v1.3.3...v1.4.0
[1.3.3]: https://github.com/dean0x/devflow/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/dean0x/devflow/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/dean0x/devflow/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/dean0x/devflow/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/dean0x/devflow/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/dean0x/devflow/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/dean0x/devflow/compare/v0.9.0...v1.0.0
[0.9.0]: https://github.com/dean0x/devflow/releases/tag/v0.9.0
[0.8.1]: https://github.com/dean0x/devflow/releases/tag/v0.8.1
[0.8.0]: https://github.com/dean0x/devflow/releases/tag/v0.8.0
[0.7.0]: https://github.com/dean0x/devflow/releases/tag/v0.7.0
[0.6.1]: https://github.com/dean0x/devflow/releases/tag/v0.6.1
[0.6.0]: https://github.com/dean0x/devflow/releases/tag/v0.6.0
[0.5.0]: https://github.com/dean0x/devflow/releases/tag/v0.5.0
[0.4.0]: https://github.com/dean0x/devflow/releases/tag/v0.4.0
[0.3.3]: https://github.com/dean0x/devflow/releases/tag/v0.3.3
[0.3.2]: https://github.com/dean0x/devflow/releases/tag/v0.3.2
[0.3.1]: https://github.com/dean0x/devflow/releases/tag/v0.3.1
[0.3.0]: https://github.com/dean0x/devflow/releases/tag/v0.3.0
[0.2.0]: https://github.com/dean0x/devflow/releases/tag/v0.2.0
[0.1.2]: https://github.com/dean0x/devflow/releases/tag/v0.1.2
[0.1.1]: https://github.com/dean0x/devflow/releases/tag/v0.1.1
[0.1.0]: https://github.com/dean0x/devflow/releases/tag/v0.1.0
