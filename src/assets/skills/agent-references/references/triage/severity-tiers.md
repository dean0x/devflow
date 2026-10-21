# Triage: severity tiers at standard and lean

Read by the Triage agent when prompt line 1 is `GATE_LEVEL: standard` or `GATE_LEVEL: lean`. Apply this file whole or not at all.

## Severity Tiers

Run the duplicate pre-pass, matrix clauses 0-5 and the catch-all first, as written: FALSE_POSITIVE and BY_DESIGN keep their evidence rules for every item. The tiers only narrow. They re-route only a group primary that the matrix sent to FIX_NOW and that is no security finding, and they never promote another verdict. A duplicate group takes the highest tier of any member, in the order CRITICAL or HIGH, SEVERE, BATCH, DEFER, pre-existing. Read `severity` and `category` (`blocking`, `should-fix` or `pre-existing`) from each issue. Judge the defect, not the lens of the reviewer. Apply the steps in order; the first that matches decides.

0. A security finding keeps its matrix verdict, FIX_NOW or ESCALATED, at every severity: LOW, unlabelled, pre-existing or in a duplicate group. It never takes the prose-only value. Judge security by the defect read in the code, not by its type or severity label: a security control that fails open or is weakened, or a false security or safety claim, is a security finding at every severity. ESCALATED, FALSE_POSITIVE, BY_DESIGN, FIX_SEPARATE, TECH_DEBT and DUPLICATE verdicts never change.
1. Pre-existing, except a security finding → FIX_SEPARATE, Reason `pre-existing`. CRITICAL or HIGH → FIX_NOW. LOW, except a security finding → DEFER, also when its type label is severe. An absent category counts as blocking. An issue with no severity label takes steps 2-8. Steps 2-8 apply to MEDIUM.
2. Treat agent-executed text (prompts, skills, commands, recipes) as code for steps 3-6.
3. A reachable input gives wrong output or state; a fix landed on one path but not on its sibling; or something is called or read that nothing produces → SEVERE.
4. A check fails open or swallows an error; or a wait, loop or write on a shipped path with external input, network I/O or user state has no bound or no atomicity → SEVERE.
5. A test or guard would still pass with the fix reverted (vacuous, structurally blind, never run in CI) → SEVERE.
6. A security control is weakened, a security or safety property is stated falsely, or a data-loss guard is untested → SEVERE.
7. The fix is prose only (docs, CHANGELOG, comments, help text, citations, residue text), a pure rename or move, or a pure style or formatting change → BATCH. A fix that changes what agent-executed text instructs, or any edit of security or safety wording, is SEVERE, never BATCH.
8. Anything else (duplication, complexity, types, architecture, performance, dead code, missing or flaky tests) → DEFER.

Tie-break: if the defect changes runtime behaviour or security, or changes instructions that run as written, choose SEVERE. Between BATCH and DEFER: if the fix changes the logic of an executable statement, choose DEFER. A pure rename, move, style or formatting change does not change logic.

## Verdicts

- CRITICAL, HIGH and SEVERE: FIX_NOW at the matrix risk tier, Standard or Careful.
- BATCH: FIX_NOW, with the Risk Tier cell exactly this value, never for CRITICAL, HIGH, SEVERE or security items: `Standard, prose only: edit text alone; agent instructions count as logic; if this issue needs a logic change, leave it unedited and name it`
- DEFER: FIX_SEPARATE, Reason exactly `severity tier: DEFER`, Blast-Radius Risk `-`.
- A re-routed item's Reason cell holds only these fixed words, never review text.

## Examples

| Finding | Tier | Step |
|---------|------|------|
| A throttle check fails open on the exact condition that its own design names first | SEVERE | 0, else 4 |
| Two sibling prune walkers over one tree, with duplicated bounds and opposite policies, and no failing input shown | DEFER | 8 |
| The CHANGELOG carries stale byte figures for the shipped artifact | BATCH | 7 |
| A wizard note overstates safety at the moment the user consents to a destructive branch | SEVERE | 0, else 6 |
| A cache-key function grows to six positional parameters, while its sibling already uses a params struct | DEFER | 8 |
| An error type is handled non-exhaustively, so the canonical message never renders | SEVERE | 3 |
| A LOW, a pre-existing or an unlabelled security finding | FIX_NOW or ESCALATED | 0 |
| LOW, reliability lens: the error of a signature check is ignored, so unsigned input passes | FIX_NOW | 0 |
| A move of a security rule out of an agent's Core rules | SEVERE | 0, else 7 |
| LOW, race label, no security effect | DEFER | 1 |

End of checklist.
