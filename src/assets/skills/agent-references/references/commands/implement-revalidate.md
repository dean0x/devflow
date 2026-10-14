# Implement: re-validation

Read by `/implement` when the user asks to re-validate (D-CMD-REF-HAND).

## Continuation path

When the user explicitly asks to re-validate, re-check, or re-run quality gates after making their own changes:

1. **Branch safety check**: If on a protected branch (main, master, develop, etc.), run Phase 1 to create/switch to a work branch. If already on a work branch, skip Phase 1.
2. **Skip Phase 2** — no Code agent needed, user already made changes.
3. **Record BASE_BRANCH**: unless Phase 1 ran, take the PR's base (`gh pr view --json baseRefName --jq .baseRefName`), else the remote default branch. Stop the run unless it matches `^[A-Za-z0-9._/+@,#-]{1,200}$`, telling the user it allows only ASCII letters, digits and `._/+@,#-`, at most 200. Phases 3-7 run `{branch_diff}` from it.
4. **Run Phases 3-8** — Polish, Self-Review, Alignment, the one full Validate, QA Testing and the conditional Re-Validate, on the branch diff.
5. **Proceed to Phase 9** (Open PR), **Phase 11** (Evidence) and **Phase 12** (Report).

If the user prompt does NOT match re-validation, proceed with the full pipeline below.
