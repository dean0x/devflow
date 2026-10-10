---
name: apply-feature-knowledge
description: Consume FEATURE_KNOWLEDGE, the pre-computed feature context
user-invocable: false
allowed-tools: Read, Bash
---

# Apply Feature Knowledge

## Iron Law

> **Pre-computed context, not a cage. Verify against current code — always.**
>
> A feature knowledge captures patterns AS THEY WERE when last written. Use it as a
> starting point, not gospel truth; when something feels off, Read the actual files.
> Code is authoritative.

---

## 3-Step Algorithm

1. **Read** each `FEATURE_KNOWLEDGE` block (headed `--- Feature knowledge: {slug} ---`): `Rules:` holds anti-patterns, gotchas and invariants; `KB:` is the full file's path (under `WORKTREE_PATH` when given).
2. **Apply** them: check your work against every bullet and cite it as `{slug} KB-AP-n` (a section-labelled bullet as `{slug} {section}`), never a bare ID. For architecture or integration context, Read that section on demand, with `offset` and `limit`: its start line is on the `Headings:` line, or comes from `command grep -n '^## ' "<KB path>"`. Quote KB text only from a Read view.
3. **Verify** against current code: where an assertion is outdated or contradicts the code, Read the source and trust it. Note a discrepancy in your output when it matters.

---

## Skip Guard

When `FEATURE_KNOWLEDGE` is `(none)`, empty, or not provided — skip this skill entirely.
Do not mention feature knowledge or its absence in your output.

## Freshness Model

Feature knowledge is **verify-on-read**: check key assertions against current code, and when in doubt Read the file.
