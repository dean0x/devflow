---
name: feature-knowledge
description: Use when building a feature knowledge base.
user-invocable: false
allowed-tools:
  - Read
  - Grep
  - Glob
  - Write
---

# Feature Knowledge Base Creation

## Iron Law

> **Capture the institutional knowledge that lives in developers' heads — the things
> obvious to them but invisible to newcomers.**
>
> A feature knowledge entry exists to save the NEXT agent from rediscovering patterns that span multiple files,
> modules, or layers. If it's obvious from a single file read, don't capture it.

---

## The Four Phases

Follow these four phases in order.

### Phase 1: Scan

Map where the code of this area lives and how it is structured: directories, languages and frameworks, entry points, configuration and existing documentation.

With your first scan calls, Glob the target `KNOWLEDGE.md` and run `d="${CLAUDE_CONFIG_DIR:-}"; case "$d" in /*) ;; *) d="$HOME/.claude" ;; esac; printf '%s\n' "$d"` in Bash.
**New KB only** (the Glob finds no file): Read `<that directory>/skills/devflow:feature-knowledge/references/new-kb.md` once, with your next reads. It holds the category table, the category templates and a worked example. If the Read fails, choose the category from the frontmatter list and main sections that fit it.

### Phase 2: Extract

Read the key files and trace how data moves through the area. Find ALL instances of similar things and see what they share: naming, structure, error handling, and the implicit rules the team follows but never wrote down. For a complex domain, also map the core entities, the decision points, the state transitions and the edge cases.

### Phase 3: Distill

Keep a finding only if it is specific to THIS codebase, true of the code NOW, actionable for a developer, and preferably cross-cutting rather than obvious from one file.

### Phase 4: Forge

Write the knowledge file. Follow the output format exactly.

---

## Output Format

### KNOWLEDGE.md Structure

```markdown
---
feature: {slug}
name: {human-readable name}
description: "Use when [specific scenarios]. Keywords: [relevant terms]."
category: [architecture | conventions | component-patterns | domain-knowledge | lessons-learned]
directories: [{dir prefixes}]
created: {ISO date}
updated: {ISO date}
---

# {Feature Area Name}

## Rules
- **KB-AP-1** [one-line anti-pattern or gotcha: what to avoid, and the consequence]
- **KB-INV-1** [one-line invariant that must hold]

## Overview
[1-2 paragraphs: what this knowledge covers and why it matters for this codebase]

## [Main Sections — vary by category]

## Anti-Patterns
[The longer explanation of each anti-pattern, headed by its ID — never a restatement of the Rules bullet]

## Gotchas
[Non-obvious behaviors, edge cases, things that break silently — headed by the ID of the Rules bullet each explains]

## Key Files
[Most important files with one-line descriptions]

## Related
[Links to other feature knowledge entries and key source files — never an ADR/PF ID]
```

### Rules Section

`## Rules` comes first, after the title: the anti-patterns, gotchas and invariants of the feature area as one-line bullets, in about 3–5K characters. A bullet fits one line and never starts with `## `.

- **IDs**: anti-pattern and gotcha bullets take `KB-AP-n`; invariant bullets take `KB-INV-n`. Numbers are unique within a KB. A bullet keeps its ID across rewrites; a removed bullet's ID is retired and never reused. A citation names the slug and the ID together, as `{slug} KB-AP-n`; a bare ID is never cited.
- **Explanations**: `## Anti-Patterns` and `## Gotchas` stay below Rules as the longer explanations, each headed by the IDs it explains.
- **No volatile numbers**: a volatile number is a count, size, line number, version or threshold that changes when the code changes. Where a value matters, name the test or constant that pins it. Bullet IDs are not volatile numbers.
- **Legacy KBs**: a KB without `## Rules` is valid until curated. Readers take one to three entries from its Anti-Patterns or Gotchas, cited by section name, with the KB path and heading index.

### Size Budget

Per KB: target 30,000 characters, ceiling 40,000. An index line is at most 300 characters and a description at most 220, so slug, areas and description fit one line. **Curate, never truncate**: reword or consolidate, and nothing is cut or dropped to meet the budget. Split into focused sub-knowledge bases (each with its own index entry) only when curation cannot bring a KB under the ceiling.

### Refreshing an Existing KB

When `EXISTING_KB` is provided, change only the sections the new work touches, and add or update Rules bullets for what changed. Never renumber, and never rewrite untouched sections to meet the budget. A KB still above the ceiling after a refresh is written as it stands, and the final message says so.

### Description Field

The `description` field is how this entry gets discovered. It starts with "Use when", names the specific scenarios where the knowledge applies, includes the keywords a developer would search for, and stays within 220 characters. Example: `"Use when adding a new vendor integration, implementing API clients, or connecting to external services. Keywords: integration, vendor, API client, webhook."`

### Cross-References

The **Related** section links the other feature knowledge entries that cover related topics and the key source files the knowledge references. When a new entry relates to an existing one, note the connection in both.

A decision or pitfall from DECISIONS_CONTEXT that shapes this area is stated in words in the section it governs, never by its ADR/PF ID: KNOWLEDGE.md is git-tracked and shared with every clone, and ledger IDs resolve only on the machine that recorded them.

---

## Rules for Code Examples

Include a code example only when it adds significant unique value beyond a sentence, and only for a codebase-specific pattern, never a generic language feature. Every example has a description before it (what it shows and why), inline comments on the important lines, and takeaways after it.

---

## Quality Self-Checks

Run through this before writing. If any check fails, go back and fix it.

**Content:**
- [ ] Knowledge provides codebase-specific insights, not generic advice ("use dependency injection" without how THIS project does it)
- [ ] All content reflects current code; no speculation ("we might add caching later")
- [ ] Business context and domain constraints captured where relevant
- [ ] Every claim is verifiable in actual code
- [ ] One focused topic, not an everything-bagel file; no test patterns unless requested

**Examples:**
- [ ] Every code example has description before, inline comments, and takeaways after
- [ ] Each example adds significant unique value beyond descriptive text alone
- [ ] Anti-patterns documented with explanation of consequences

**Structure:**
- [ ] Category is correct; a new KB follows its category template, and a refresh keeps the existing sections
- [ ] Description field starts with "Use when" and includes keywords
- [ ] `## Rules` comes first: one-line bullets with `KB-AP-n` / `KB-INV-n` IDs, about 3–5K characters, no volatile numbers
- [ ] File within the 40,000-character ceiling (curate, never truncate); description at most 220 characters

**Connections:**
- [ ] Cross-references to related feature knowledge entries in Related section; decisions and pitfalls stated in words, with no ADR/PF ID anywhere in the file
- [ ] Key source files listed in Key Files section

---

## Index Registration

After writing KNOWLEDGE.md, register it in `{worktree}/.devflow/features/index.md` with this line:

```
- **{slug}** — {areas} — {Use-when description}
```

The whole line is at most 300 characters; reword a longer one, never cut it. Where:
- `{slug}` matches the `feature:` frontmatter field
- `{areas}` is a comma-separated summary of the `directories:` frontmatter field
- `{Use-when description}` is the `description:` frontmatter field value (the full "Use when..." sentence, at most 220 characters)

If `index.md` does not exist, create it with just this line. The KNOWLEDGE.md frontmatter is always authoritative; the index line is a cache.

---

## Scope and Limitations

Only document what you can verify in the codebase. Where knowledge lies outside it, or needs context you do not have, say so and focus on what IS extractable. Never fill gaps with generic knowledge or speculation.
