# Implement: evidence asks

Read by `/implement` Phase 1 (D-CMD-REF-HAND). "Above" means the Phase 1 text before the step that sent you here.

## Ticket link ask

**Ticket link, only when `ISSUE_REQUIRED` is `true`:** when the capture above holds no `ISSUE_PR_LINK` (absent, or `(none)`), ask with AskUserQuestion before any Code spawn — "No tracker issue is linked to this task. Record a self-attested exception, or stop?" — offering exactly these two options:
- **Record an exception** — the user gives the reason as free text. Render it with the grammar below, as kind `ticket-link`; when the rendered reason is empty, ask for it once more, and stop as below if it is empty again.
- **Stop** — report `BLOCKED (no ticket link)`, name the branch setup-task created (`TASK_ID`) and `BASE_BRANCH` so it can be reused or removed, and give the remedy: create or link the tracker issue and re-run `/implement` with its reference, or — for a team that does not want ticket links — commit `.devflow/project.json` as `{"version":1,"evidence":"standard"}` on the default branch; a machine with compliance enabled still resolves `required` whatever that file says. Spawn nothing further.

## Exception grammar

**Render each evidence exception** as one line under a `## Evidence Exceptions` heading, in exactly this shape:

```markdown
## Evidence Exceptions
- `<kind>` self-attested by @<login> at <utc>: <reason>
```

- `<kind>` is one of `ticket-link` or `test-plan` — a closed set; no other kind is ever rendered, and the section holds each kind at most once.
- `@<login>` is `@` followed by the output of `gh api user --jq .login` when that output matches `^[A-Za-z0-9][A-Za-z0-9-]{0,38}$`. On any other output, or a failed call, it is `(login unavailable)` instead, with no `@`.
- `<utc>` is the output of `date -u +%Y-%m-%dT%H:%M:%SZ`.
- `<reason>` is the user's own words, made inert: replace every character outside printable ASCII (newlines and tabs included) with a space, remove every `<`, `>`, `` ` ``, `[`, `]`, `\`, `/`, `#`, `@`, `&` and `$`, collapse runs of spaces, trim, keep the first 200 characters, and trim again. A reason that is empty after this is no reason.

Note: the section reaches a public PR body. The Code agent re-checks every line against this shape before it pastes, and the body's D11 scrub is the reason's secret scrub — rendering filters no secrets. A rendered reason carries no HTML or comment markers, link or image syntax, @-mentions, `#N` or full-URL references (no `/` survives), entities or shell-expansion characters; plain emphasis and `www.` or `GH-N` autolinks can remain — the requester authors the reason.

## Record the exception

**Record the exception at once**, before any Code spawn: write the rendered section as the `## Evidence Exceptions` section of `{worktree}/.devflow/docs/handoff-{branch_slug}.md`, creating the file if absent, and set `PR_EXCEPTIONS` to that section. The file is its one home until the PR exists: every later write to the file keeps the section byte-identical, the Phase 9 Git spawn passes it verbatim as `PR_EXCEPTIONS`, and the file is deleted only once the PR exists — after Phase 9, under every strategy. With no exception recorded, `PR_EXCEPTIONS` is `(none)`.

## Missing test plan ask

**Missing test plan, only when `EVIDENCE_POLICY` is `required`:** when the check above leaves the test plan missing, ask with AskUserQuestion before any Code spawn — "No test plan could be written for this task. Record a self-attested exception, or stop?" — offering exactly these two options:
- **Record an exception** — the user gives the reason as free text. Render it with the exception grammar above, as kind `test-plan`; when the rendered reason is empty, ask for it once more, and stop as below if it is empty again. Add the rendered line to the `## Evidence Exceptions` section of `{worktree}/.devflow/docs/handoff-{branch_slug}.md` — after any `ticket-link` line, creating the section and the file when absent — and set `PR_EXCEPTIONS` to that section, under the same rules as the record above.
- **Stop** — report `BLOCKED (no test plan)`, name `TASK_ID` and `BASE_BRANCH` so the branch can be reused or removed, and give the remedy: state the acceptance criteria in the task, the issue or a `/plan` document (its `## Test Plan` section is copied) and re-run `/implement`, or — for a team that does not want test plans enforced — commit `.devflow/project.json` as `{"version":1,"evidence":"standard"}` on the default branch; a machine with compliance enabled still resolves `required` whatever that file says. Spawn nothing further.
