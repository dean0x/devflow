# Implement: re-validation

Read by `/implement` when the user asks to re-validate (D-CMD-REF-HAND).

## Continuation path

When the user explicitly asks to re-validate, re-check, or re-run quality gates after making their own changes:

1. **Branch safety check**: If on a protected branch (main, master, develop, etc.), run Phase 1 to create/switch to a work branch. If already on a work branch, skip Phase 1.
2. **Skip Phase 2** — no Code agent needed, user already made changes.
3. **Record BASE_BRANCH**: unless Phase 1 ran, take the PR's base name and fork flag (`gh pr view --json baseRefName,isCrossRepository`), else the remote default branch and `false`. Stop the run unless it matches `^(?![-#]|origin\/|(?:@|(?:FETCH_|ORIG_|MERGE_)?HEAD)$)(?!.*\.\.)[A-Za-z0-9._\/+@,#-]{1,200}$`, telling the user it allows only ASCII letters, digits and `._/+@,#-`, at most 200; no leading `-` or `#`, no `origin/` prefix, no `..`, not `@` or a HEAD name. Phases 3-7 run `{branch_diff}` from `BASE_REF`, the fork point.
   Unless Phase 1 ran (its `BASE_REF` stands), run `cd "{worktree}" && X=<isCrossRepository, else false> && node "$HOME/.devflow/scripts/resolve-base.cjs" pr "{BASE_BRANCH}" --cross "${X}"; echo "exit=$?"` and handle its line as Phase 1's fresh base step does. Output other than one `BASE_REF=` line (40 or 64 hex, or `none`) with `exit=0` counts as `REASON=resolver-unavailable`: stop, with the fix `run devflow init`.
4. **Take GATE_LEVEL**: unless Phase 1 ran, run the **Resolve the settings line** step of Phase 1 once for this worktree, and take `GATE_LEVEL` from the line it accepts, or from its fail-closed line when it accepts none. Phase 6 passes it to Validate.
5. **Run Phases 3-8** — Polish, Self-Review, Alignment, the one full Validate, QA Testing and the conditional Re-Validate, on the branch diff.
6. **Proceed to Phase 9** (Open PR), **Phase 11** (Evidence) and **Phase 12** (Report).

If the user prompt does NOT match re-validation, proceed with the full pipeline below.
