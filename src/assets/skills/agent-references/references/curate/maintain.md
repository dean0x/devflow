## Part 2 — Maintain the due entries

You read this because `claim-due` handed out at least one entry. Its output is in your context.

The first line, `ref <origin/HEAD|HEAD> <sha12>`, names the verify ref: check every claim
at that ref (`git show <ref>:<path>`). Each further line, `<anchor> <reason> <bytes>`, is
one due entry. The reason is one or more integrity flags joined by `,` —
`duplicate-obs-id` (two active entries share one observation), `ledger-without-log` (the
entry's observation is gone from the log), `scope-matches-nothing` (no tracked file
matches its scope) — or `legacy-v1` (a v1 entry) or `verify-age` (not verified for over
30 days). Each entry is leased for a day, so whatever you leave unfinished comes back.
`ref none` means there is no commit to check against: leave every
due entry as it is.

**LLM judgment — the maintenance ladder.** For each due entry, run `show <anchor>`. A
`ledger-without-log` entry first gets its observation back: `put-observation --create`
under the same id, carrying the entry's content in the entry format, which re-projects
the entry. Then take the first rung that matches. Exactly one final action per entry;
when unsure, Keep.

1. **Encoded** — the codebase now enforces or states the rule, by a strict bar: a test or
   guard that fails on a new violation anywhere in the entry's scope, or the rule stated in
   CLAUDE.md, a rules file, or a prompt loaded for all work in that scope. One JSDoc line
   does not count, and neither does a test pinning one instance. Find it with `git grep -P`,
   confirm it at the ref, then retire the entry with the file and a line of it:

   ```bash
   cd "<project root>" && node "$HOME/.devflow/scripts/hooks/json-helper.cjs" retire-anchor <anchor> Encoded <<'EOF'
   {"at": "<path from the repository root>", "quote": "<one line of that file, 12 to 200 characters>"}
   EOF
   ```

   The op checks the quote in the file as committed at the verify ref. A refusal saying
   `the quote is not in …` or `… is not a file at …` means the encoding is not there yet:
   Keep the entry.
2. **No longer true at the ref** — the code the rule governs is gone or changed so the rule
   cannot apply; `scope-matches-nothing` is a prompt to check. A missing file is not proof
   alone: an entry that records removing or replacing something is confirmed by the
   absence. When the lesson still applies elsewhere, rewrite it (`put-observation --update`
   with a corrected scope) and Keep it; otherwise retire it as `Retired`.
3. **Duplicate** — another active entry covers the same concern; `duplicate-obs-id` always
   means one does. Choose the survivor: the more precise entry, or the more accurate type
   when an ADR and a PF cover one incident. Absorb what only the other says into the
   survivor with `put-observation --update`, then retire the other as `Superseded` by the
   survivor.
4. **One-off** — it recorded a single incident with no general lesson: retire it as `Retired`.
5. **Keep** — every other entry. Rewrite it only when it is legacy (`legacy-v1`), wrong or
   vague: `put-observation --update` with its whole content, which also converts a v1 entry
   to v2. Before rewriting a v1 entry, read the `flags` of its `show`: `ledger-only-content`
   names details only its ledger row holds — carry over what is still true; history and the
   pre-v2 backup keep the rest.

After each maintained entry, refresh the claim (Step 0).

**RETIRE BY STATUS — never hand-edit the .md.** `retire-anchor <anchor> <status>` takes one
JSON object on stdin, by status, and refuses a key the status does not take:

- `Retired`, `Deprecated`: `{"reason": "<why, one line, 1 to 120 characters>"}`
- `Superseded`: `{"by": "<anchor>"}` — an active entry other than this one, of either type
- `Encoded`: `at` and `quote`, as in rung 1

**Close with one batch** listing every entry you kept, rewritten or not (skip it when you
kept none):

```bash
cd "<project root>" && node "$HOME/.devflow/scripts/hooks/json-helper.cjs" refresh-anchor <anchor> [<anchor>...] --verified
```

List only active v2 entries — a v1 entry refuses the whole batch, which is why a kept v1
entry is rewritten first. A refused batch names each refused anchor: drop those and run
it once more.
