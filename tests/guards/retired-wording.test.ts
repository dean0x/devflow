/**
 * Retired-wording guard (GAP-32).
 *
 * ONE shared grep over ONE denylist. A literal deliberately removed from the
 * shipping assets, the compiled output or the repo's own prose is registered in
 * RETIRED_LITERALS with the file it left and the reason it went, and the guard
 * refuses to let it back in. Retiring a literal means adding a row here — never a
 * new describe block, and never a second list somewhere else: two lists is how one
 * goes stale, and the narrower one is always the one that stays green.
 *
 * A widened corpus only raises detection when the VOCABULARY widens with it. Two
 * documentation literals once survived a sweep purely by being spelled differently
 * in files the corpus already scanned, so the response to residue found
 * outside the shipping assets is to widen the corpus and register the spelling —
 * never to loosen the denylist to fit what is there (R2).
 *
 * Non-vacuity: denylist size and corpus size are both asserted, and a seeded
 * retired literal in a synthetic file fails the guard — proven inline, without
 * touching committed source.
 *
 * Entry format: `{ literal, removedFrom, justification, pattern?, scope? }`.
 * `removedFrom` records where the literal used to live — traceability, not a
 * dynamic constraint. `scope` narrows an entry to the trees it is retired FROM;
 * `pattern` replaces the substring test for residue whose spellings cannot be
 * enumerated in advance.
 *
 * The last describe blocks are a different kind of guard, and they do not use the
 * denylist: the FEATURE-WORD guard (AC-1 of the curation rename) reads every tracked
 * file outside tests/ for the old feature word and lets a hit through only when an
 * entry of tests/fixtures/feature-word-allowlist.ts covers its exact text. The
 * TEST-TITLE guard reads the title of every test under tests/ the same way, against
 * its own allowlist in that fixture. The DERIVED-STEM guard reads the shipped scripts
 * for identifiers built on the old stem. Each is an allowlist over one word, where
 * the denylist above is a list of many literals, so they keep their own fixture.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync, lstatSync } from 'fs';
import { execFileSync } from 'child_process';
import * as path from 'path';
import {
  FEATURE_WORD,
  FEATURE_WORD_ALLOWLIST,
  SECTION_EXEMPTIONS,
  TEST_TITLE_ALLOWLIST,
  type AllowlistEntry,
  type SectionExemption,
} from '../fixtures/feature-word-allowlist.js';
import { LEGACY_NAMES } from '../../src/core/project-paths.js';
import { MCP_CONTRACT_MODULE, VARIANT_MODULES } from '../../src/core/mds-variants.js';
import { VARIANT_MANIFEST_REL_PATH } from '../../src/core/curation-variants.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

// ---------------------------------------------------------------------------
// The denylist — grows as literals are retired; never a new grep; never emptied
// ---------------------------------------------------------------------------
interface RetiredEntry {
  literal: string;
  removedFrom: string;
  justification: string;
  /**
   * Matches a CLASS of retired wording rather than one spelling. When present it
   * replaces the `literal` substring test and `literal` becomes the entry's
   * human-readable name in the failure message.
   *
   * Reserved for residue whose members are not enumerable in advance — a wave
   * coordinate is minted by whoever writes the next wave, so a fixed list would go
   * stale the moment it mattered. Everything with a knowable spelling stays a
   * literal, individually classified.
   */
  pattern?: RegExp;
  /**
   * Corpus path prefixes this literal is retired FROM, spelled as the corpus spells
   * them (`dist/commands/`, `src/assets/skills/git/`, …). Absent means the whole
   * corpus.
   *
   * `gh issue` is the case that needs it: RETIRED from the command layer and
   * LEGITIMATE in `git.md` and its generated references — those files are the
   * mechanics. A denylist without scopes could only express the weaker of the two
   * rules, and the weaker one is the one that forbids nothing where it matters.
   */
  scope?: readonly string[];
}

const RETIRED_LITERALS: ReadonlyArray<RetiredEntry> = [
  {
    literal: 'ISSUE_NUMBERS',
    removedFrom: 'src/assets/agents/git.md, src/assets/commands/plan.mds',
    justification: 'Renamed to ISSUE_REFS in A1 (AC-0.11)',
  },
  {
    literal: 'ISSUE: {issue',
    removedFrom: 'src/assets/commands/debug.mds',
    justification: 'Renamed to ISSUE_INPUT: {issue reference} in A1 (debug.mds spawn key fix)',
  },
  {
    literal: 'close milestone',
    // Everything the corpus reaches EXCEPT CHANGELOG.md, enumerated rather than
    // implied. The changelog's own end-state sentence for this fix is "the
    // `close milestone` reference is removed" — a true statement about the tree
    // that has to name the thing it removed. Suppressing the entry there is the
    // narrow reading; deleting the changelog's sentence to green a guard would be
    // damaging a correct record to satisfy a check (R2 runs the other way: widen
    // the corpus, then say exactly where each entry applies).
    scope: [
      'src/assets/', 'src/core/', 'src/cli/', 'src/targets/', 'src/hud/',
      'dist/', 'docs/', 'CLAUDE.md', 'README.md', 'CONTRIBUTING.md',
    ],
    removedFrom: 'src/assets/commands/release.mds',
    justification: 'Untruthful claim deleted from release.mds in A1 (AC-0.14)',
  },
  {
    literal: 'may pre-fetch',
    removedFrom: 'src/assets/commands/_partials/_wave.mds',
    justification: 'Weakened "may" replaced with mandatory pre-fetch in A1',
  },
  {
    literal: 'issue-first gate',
    removedFrom: 'src/assets/commands/implement.mds',
    justification:
      '"issue-first gate in step 1c" was the stale cross-reference in implement.mds pointing to ' +
      'git.md\'s internal step — replaced in A1 with "Git agent\'s issue-first step in setup-task". ' +
      '"step 1c" itself is still a valid self-reference in git.md (git create-branch step); ' +
      '"issue-first gate" is the unique retired phrase.',
  },
  {
    literal: 'no generated copies anywhere',
    removedFrom: 'CLAUDE.md',
    justification:
      'The Build System section claimed src/assets/{skills,agents,rules}/ were the single source ' +
      'of truth with "no generated copies anywhere in the repo". Phase 1 falsified it: ' +
      'dist/agents/git.md is a generated copy of an agent. Restated as "generated files never ' +
      'live in src/" — the rule that is actually true and actually load-bearing (GAP-53).',
  },
  {
    literal: 'The only intermediate build step',
    removedFrom: 'docs/reference/file-organization.md',
    justification:
      'The Asset Distribution section named compiling .mds command sources to dist/commands/ as the ' +
      'sole intermediate build step. Phase 1 falsified it: an .mds agent generator host compiles to ' +
      'dist/agents/ in the same build. Restated as the two host kinds the build serves. Registered ' +
      'because the claim outlived the CLAUDE.md sweep purely by being spelled differently, in a file ' +
      'the corpus already scanned.',
  },
  {
    literal: 'No build step distributes agents',
    removedFrom: 'docs/reference/agent-design.md',
    justification:
      'agent-design.md asserted src/assets/agents/ was the single source of truth for every agent and ' +
      'that no build step distributes them. Phase 1 falsified both: src/assets/agents/git.mds compiles ' +
      'to dist/agents/git.md, which the installer prefers over the src tree. Restated as the ' +
      'hand-authored vs generator-host split.',
  },

  // -------------------------------------------------------------------------
  // SCOPED literals — retired from one tree, legitimate in another. Each names
  // the trees it is forbidden in, because a repo-wide entry for any of these
  // would be a grep rather than a rule.
  // -------------------------------------------------------------------------
  {
    literal: 'gh issue',
    removedFrom: 'src/assets/commands/**.mds (the command layer)',
    scope: ['dist/commands/'],
    justification:
      'A command that names a provider CLI has re-composed provider mechanics at the caller — the ' +
      '~30-sink shape GAP-10 names. The literal stays LEGITIMATE in git.md and in the generated ' +
      'references, which is why this entry is scoped to the compiled command layer. Strictly ' +
      'stronger than build-mds.test.ts\'s prose-only rule, which permits it inside a Git spawn fence.',
  },
  {
    literal: 'sleep 60',
    removedFrom: 'src/assets/skills/git/SKILL.md:196, references/github-api.md:20 and :467',
    scope: ['src/assets/skills/git/', 'dist/agents/git.md', 'dist/skills/git/references/'],
    justification:
      'GAP-25. Sleeping out an active secondary rate limit extends the provider\'s penalty window, ' +
      'which is why D4 says STOP. Three sites held it and all three were rewritten; ' +
      'scoped to the files a Git spawn preloads or can load, because an unrelated example elsewhere ' +
      'is not a second rate-limit policy in the agent\'s context.',
  },
  {
    literal: '<!-- devflow:',
    removedFrom: 'src/assets/commands/dynamic-build.mds and code-review.mds',
    scope: ['dist/commands/'],
    justification:
      'GAP-20: the operation owns the marker; a caller restating the literal already diverged once ' +
      'and produced duplicate comments. Scoped to the compiled commands because the marker must ' +
      'keep living in git.md and in the generated post-wave-report reference — the rule is ' +
      'relocated, not deleted.',
  },
  {
    literal: '{issue}',
    removedFrom: 'src/assets/skills/docs-framework/SKILL.md:45, :106, :144',
    scope: ['src/assets/skills/docs-framework/SKILL.md'],
    justification:
      'The GitHub-bound placeholder was replaced by the provider-neutral {ISSUE_ID}. Scoped to ' +
      'the one file: `{issue}` is an ordinary template token elsewhere and a repo-wide entry would ' +
      'be a grep rather than a rule.',
  },

  // Retired DEGRADED synonyms. Unscoped — a DEGRADED reason is user-visible
  // wherever it is written, and the canonical table admits exactly one spelling per
  // condition (GAP-13: thirteen reasons with three synonyms for one condition is how
  // a caller ends up matching on a string no op emits).
  ...([
    ['provider mechanics unavailable', 'superseded by `tracker mechanics unavailable`'],
    ['provider {x} not installed', 'names an installation state the agent cannot observe'],
    ['no MCP tool for', '"MCP" is transport and stays out of user-facing text'],
    ['no tool available for', 'superseded by `no tracker tool for {capability}`'],
    ['no jira tools in session', 'session-scoped phrasing of a capability fact'],
    ['jira tools unavailable', 'same condition, third spelling'],
    ['tracker not reachable', 'conflates an unconfigured tracker with an unreachable one'],
    ['interactive setup required', 'no question step exists — the phrasing promises a prompt that never comes'],
    ['delete .devflow/tracker.md and re-learn', 'superseded; the file is never the remedy'],
    // #393 (PR6): every install carries every provider's mechanics, so no legitimate
    // configuration leaves a named mechanics file absent, and a prompt rule for a
    // damaged install guards nothing. Retired with its rule, not renamed.
    ['tracker mechanics unavailable', 'no legitimate configuration can produce it once every provider is installed'],
    // #393 (PR6): conventions moved to one file per provider, so the remedy names that file.
    ['edit ~/.devflow/tracker.md', 'the conventions file is per provider now, under `~/.devflow/tracker/`'],
  ] as const).map(([literal, why]): RetiredEntry => ({
    literal,
    removedFrom: 'the canonical DEGRADED reason table (retired synonym)',
    justification: `Retired DEGRADED synonym — ${why}. The canonical table admits one reason per condition.`,
  })),

  // -------------------------------------------------------------------------
  // Retired status headings — three sections no operation emits any more.
  //
  // They belong here rather than in a list of their own. A second list inside
  // tests/tracker/schema-scope.test.ts would be a new grep, and a weaker one:
  // that corpus is `dist/agents/git.md` ∪ `dist/skills/git/references/**` ∪ the
  // two command trees. This corpus is a strict superset of all four AND reaches
  // `src/assets/agents/`, `src/assets/skills/`, `src/assets/mds/`, `docs/` and
  // the root prose — which is exactly where a retired heading survives a sweep by
  // being restated in documentation rather than in an op body. One list,
  // because two lists is how one goes stale.
  //
  // `.devflow/features/*/KNOWLEDGE.md` stays out of the corpus (see the note
  // above buildCorpus), so the knowledge bases may keep recording what these
  // headings were and why they went.
  // -------------------------------------------------------------------------
  ...([
    ['## Tracker Discovery', 'the discovery report of a question step that no longer exists'],
    ['## Tracker Learned', 'the confirmation half of the same step'],
    ['## Tracker Learning Required', 'the prompt half — it promised an interactive setup that never comes'],
  ] as const).map(([literal, why]): RetiredEntry => ({
    literal,
    removedFrom: 'the canonical status-heading set — no op emits them',
    justification:
      `Retired status heading — ${why}. A heading with no emitter is residue; a heading an op ` +
      `still emits is a user-visible section describing a flow that no longer exists.`,
  })),

  // -------------------------------------------------------------------------
  // Transition narration in the TypeScript sources.
  //
  // Comments that date a line to the wave that wrote it ("P3a-S15: move a
  // now-stale conventions file aside") describe the transition, not the end
  // state, and a reader six months on cannot resolve the label to anything. The
  // rationale itself is worth keeping — only the coordinate goes.
  //
  // A pattern rather than seven literals because the members are not enumerable:
  // the next wave mints its own labels, and a fixed list would pass over exactly
  // the narration it was added to stop.
  // -------------------------------------------------------------------------
  {
    literal: 'P{n}-S{n} phase labels',
    pattern: /P[0-9][a-z]?-S[0-9]+/,
    removedFrom:
      'src/core/{tracker,mds-variants,feature-config}.ts, src/cli/commands/{init,tracker}.ts, ' +
      'src/targets/claude-code/installer.ts, src/assets/scripts/redact-secrets.cjs',
    scope: ['src/'],
    justification:
      'Wave coordinates in source comments are transition narration: they name a phase of a ' +
      'delivery that has shipped, and resolve to nothing for the next reader. Seven sites carried ' +
      'them; each was rewritten to state the rule instead of the phase that introduced it. Scoped ' +
      'to src/ because the plan artifacts, handoffs and knowledge bases under .devflow/ and docs/ ' +
      'are where that provenance legitimately lives.',
  },

  // -------------------------------------------------------------------------
  // Internal identifiers and delivery coordinates cut from the Git agent's prompt.
  //
  // The agent's text is read by a model, not by a maintainer: a decision-record
  // anchor or a phase coordinate resolves to nothing there, so it is cost with no
  // reader. The RULE each one annotated is kept and stated plainly in place —
  // only the pointer goes.
  //
  // A scoped entry names the prompt files that carry it rather than registering
  // the spelling repo-wide, because the same anchor is legitimate where a
  // maintainer can follow it; each case is classified individually, not swept.
  // Curation-ledger IDs need no row here: they resolve only on the machine that
  // wrote them, and tests/guards/no-ledger-citations.test.ts holds them out of the
  // sources, the docs and test commentary.
  // -------------------------------------------------------------------------
  {
    literal: '[DR-02]',
    removedFrom: 'src/assets/agents/tracker.md (`## Finishing` step 1)',
    scope: ['src/assets/agents/tracker.md'],
    justification:
      'The prompt told the model that the session-start gate spends the attempt, and then cited ' +
      'the decision record that says so. The claim is what the agent acts on and it is stated in ' +
      'the same sentence; the anchor is a lookup a prompt\'s reader cannot perform. Scoped to the ' +
      'prompt: session-start-context\'s shell comment and CLAUDE.md both cite [DR-02] for the ' +
      'maintainer who can follow it.',
  },
  {
    literal: 'Phase 5/9',
    removedFrom: 'src/assets/agents/git.mds (post-resolution-summary step 4)',
    justification:
      'A delivery coordinate naming which phase of the resolve workflow writes resolution-summary.md. ' +
      'The agent reads the path it is given; the producer\'s phase number is not a fact it can use, ' +
      'and the numbering it refers to no longer exists. Unscoped: the spelling appears nowhere else ' +
      'in the corpus, so a scope would narrow a rule that has nothing to narrow.',
  },
  {
    literal: 'Key Parameters',
    removedFrom: 'src/assets/agents/git.mds (the Operations table\'s third column)',
    justification:
      'The Operations index carried a third column repeating each operation\'s inputs, every one of ' +
      'which the operation\'s own `**Input:**` line already states — an always-loaded second copy ' +
      'of eighteen parameter lists, free to drift against the authority below it. The column is ' +
      'gone; the index keeps operation and purpose. Unscoped for the same reason as above.',
  },

  // -------------------------------------------------------------------------
  // Design-document section coordinates in the shell hooks.
  //
  // A `§14.9 constraint 6` in a hook's comment points into a planning artifact
  // that is not in this repo. The hooks' comments are read by whoever has the
  // shell open and a session misbehaving in front of them, which is the one
  // audience that cannot follow the pointer — and the rule each coordinate
  // annotated is stated in the same sentence, so only the pointer goes.
  //
  // A pattern rather than two literals: the members are not enumerable — the
  // section numbering belongs to whichever document is current — and a fixed list
  // would pass over exactly the coordinate it was added to stop.
  //
  // SCOPED to the hooks, deliberately and not as a convenience. `src/core/*.ts`
  // and `redact-secrets.cjs` carry the same coordinates in JSDoc, where the
  // audience is a maintainer reading the source with the repo checked out; that
  // is a different argument with a different answer, and sweeping both under one
  // entry would settle it by omission.
  // -------------------------------------------------------------------------
  {
    literal: '§14.x design-document coordinates',
    pattern: /§14\.[0-9]/,
    removedFrom: 'src/assets/scripts/hooks/session-start-context (Section 3, gates 5 and the model allowlist)',
    scope: ['src/assets/scripts/hooks/'],
    justification:
      'Two Section-3 comments annotated their rule with a section number from a design document ' +
      'that does not ship. A hook comment is read during a live debugging session by someone who ' +
      'has the script and not the artifact, so the coordinate is cost with no reader while the ' +
      'rule it pointed at — reject never repair, and the closed model domain — is stated in the ' +
      'same sentence. Scoped to the hook tree; the TypeScript JSDoc sites are a separate case.',
  },

  // -------------------------------------------------------------------------
  // The UNGATED github link line.
  //
  // This entry is a CLASSIFIER, not a spelling: the rule is about the
  // qualification in front of the literal, which no substring test can see. Its
  // last site — the github-gated fallback in /implement's PR step — is gone: no
  // command renders a link line now. A gated occurrence is still admitted by the pattern
  // rather than excluded by a hand-written filter, so the guard needs no second
  // list to keep in sync with this one.
  // -------------------------------------------------------------------------
  {
    literal: 'an ungated `Closes #{ISSUE_NUMBER}`',
    // Both spellings of the corpus: the `.mds` source escapes the braces, the
    // compiled `.md` does not. `[^.\n]{0,80}` is the qualification window — a
    // sentence, not a paragraph, so a `github` mentioned in the line above does
    // not license a rendering three sentences later.
    pattern: /(?<!github[^.\n]{0,80})Closes #\\?\{ISSUE_NUMBER\\?\}/,
    removedFrom: 'src/assets/commands/implement.mds (Phase 10) and dist/commands/implement.md',
    justification:
      'The PR step rendered `Closes #{ISSUE_NUMBER}` whenever an issue number was known, with no ' +
      'provider in the condition. Under jira or linear that number is the tail of a key like ' +
      'PROJ-12, so the line closed whichever GitHub issue happens to carry the same digits — a ' +
      'wrong, silent, GitHub-visible write. The rendering is correct only under github; what is ' +
      'retired is stating it without the gate.',
  },

  // ── The `[Unreleased]` changelog's claims about the shipped tree (M-3) ──────
  //
  // Scoped to CHANGELOG.md because each of these is a sentence ABOUT the
  // mechanism rather than the mechanism itself, and the corpus entry for that
  // file is already reduced to the `[Unreleased]` section's After-halves (see
  // unreleasedClaims). A released section keeps whatever it said; what may not
  // stand is a claim that the tree behaves a way it no longer does.
  {
    literal: 'first hit wins',
    scope: ['CHANGELOG.md'],
    removedFrom: 'CHANGELOG.md [Unreleased] — the Git-agent provider-resolution bullet',
    justification:
      'The resolution order is explicitly NOT first-hit-wins: rung 1 (the per-repo `tracker` key) ' +
      'NARROWS rung 2 and cannot be evaluated without it, so both are read before anything is ' +
      'decided. dist/agents/git.md states the prohibition in those words.',
  },
  {
    literal: 'corroborat',
    scope: ['CHANGELOG.md'],
    removedFrom: 'CHANGELOG.md [Unreleased] — the Git-agent provider-resolution bullet',
    justification:
      'The shipped agent runs no corroboration scan and no share threshold. The repository\'s ' +
      'issue grammar is not a rung and never selects a provider — it narrows one already ' +
      'resolved. A stated 60% share is a mechanism a reader would look for and not find.',
  },
  {
    literal: '77,824',
    scope: ['CHANGELOG.md'],
    removedFrom: 'CHANGELOG.md [Unreleased] — the byte-budget bullet',
    justification:
      'The pre-split preloaded set, described as a live ceiling. The loaded set is now priced ' +
      'per path — BUDGET_LOADED_SET on the GitHub path, BUDGET_LOADED_SET_JIRA and ' +
      'BUDGET_LOADED_SET_LINEAR under those providers, BUDGET_LOADED_SET_PR_HOST for a PR-host ' +
      'spawn (tests/tracker/byte-budget.test.ts holds the values) — and quoting a number no ' +
      'constant holds sends a reader to find it. Every one of those rows is BELOW the retired ' +
      'figure, and ceilings are only ever lowered, so it cannot come back as a ceiling either.',
  },
  {
    literal: '58,870',
    scope: ['CHANGELOG.md'],
    removedFrom: 'CHANGELOG.md [Unreleased] — the GitHub-mechanics and byte-budget bullets',
    justification:
      '`BUDGET_GIT_MD_P3` (58,870) was the live git.md ceiling before #326 collapsed the two-sided ' +
      'gate to a single `BUDGET_GIT_MD` (45,150). Both changelog bullets that named it are rewritten ' +
      'to state the current single-ceiling gate instead of restating a constant that no longer exists.',
  },
  {
    literal: '55,750',
    scope: ['CHANGELOG.md'],
    removedFrom: 'CHANGELOG.md [Unreleased] — the GitHub-mechanics and byte-budget bullets',
    justification:
      '`BUDGET_GIT_MD` (55,750) was the Phase-2 non-preamble base paired with `BUDGET_GIT_MD_P3` ' +
      '(see the companion entry above). #326 re-derived the same constant to 45,150 and deleted the ' +
      'non-preamble companion arm along with `PREAMBLE_CHARS_P2` (the preamble-chars constant it ' +
      'subtracted), so neither the number nor the assertion it described survives; the changelog ' +
      'prose that quoted it is rewritten to match.',
  },
  {
    literal: 're-captured twice',
    scope: ['CHANGELOG.md'],
    removedFrom: 'CHANGELOG.md [Unreleased] — the github-status-lines fixture bullet',
    justification:
      'A count that the next re-capture falsifies, in a section that is meant to read as end ' +
      'state. This branch spent the third authorisation, so the sentence was already wrong when ' +
      'it was read.',
  },
  {
    literal: 'docs-helpers.sh',
    // The skill's own tree. CHANGELOG.md names the file it stopped sourcing, a
    // true record of the fix that must keep naming it.
    scope: ['src/assets/skills/docs-framework/'],
    removedFrom: 'src/assets/skills/docs-framework/SKILL.md, src/assets/skills/docs-framework/references/patterns.md',
    justification:
      'The skill told agents to `source .devflow/scripts/docs-helpers.sh`, a repo-local install ' +
      'path that no install provides since the local scope was retired (#406). The helpers are ' +
      'defined inline, and ensure_docs_dir roots .devflow/docs at the checkout toplevel (D-DOCS-ROOT).',
  },
  {
    literal: 'Append-only. Status changes allowed',
    removedFrom: 'src/assets/scripts/hooks/lib/decisions-format.cjs',
    justification:
      'The decisions.md header called the file append-only, with status changes allowed and ' +
      'deletions prohibited. The file is generated from the learning ledger and rewritten on every ' +
      'render, and an entry is rewritten in place, so the header says the file is generated and ' +
      'not to be edited, and that retired entries are listed under Inactive.',
  },
  {
    literal: 'decisions-usage-scan',
    // Every tree that shipped or described the scanner. src/cli/ is left out on
    // purpose: init's LEGACY_HOOK_FILES names the script so that an upgrade deletes
    // the copy an older install left in ~/.devflow/scripts/hooks.
    scope: ['src/assets/', 'src/core/', 'src/hud/', 'src/targets/', 'docs/', 'CLAUDE.md', 'README.md'],
    removedFrom:
      'src/assets/scripts/hooks/decisions-usage-scan.cjs, src/assets/scripts/hooks/capture-turn, ' +
      'src/assets/scripts/hooks/lib/decisions-format.cjs, src/core/fs-atomic.ts, ' +
      'docs/reference/file-organization.md',
    justification:
      'The usage scanner counted the anchors each assistant turn cited into .decisions-usage.json, ' +
      'and assign-anchor registered every new anchor there. Curation v2 maintains entries by their ' +
      'verification age at the default branch, not by citation counts, and committed text no ' +
      'longer cites ledger IDs, so the counts measured nothing. The scanner, its capture-turn call, ' +
      'its project-paths helpers and the registration are gone, and rotate-observations deletes the ' +
      'usage file and lock an older install left behind.',
  },
  {
    literal: '7-day protection window',
    removedFrom: 'src/assets/agents/curate.md',
    justification:
      'The Curate agent left any entry dated within the past week untouched, keyed on the ledger ' +
      'date with a last_seen fallback for rows that had none. Curation v2 hands out entries for ' +
      'maintenance through claim-due, oldest verification first with a one-day lease, so a new ' +
      'entry is not due until its verification ages, and the window has nothing left to protect.',
  },
  {
    literal: '≤5 curation changes',
    removedFrom: 'src/assets/agents/curate.md',
    justification:
      'The Curate agent stopped curating after five changes per run. claim-due now bounds each ' +
      'run by handing out a small leased batch within a byte budget, and the agent takes exactly ' +
      'one final action per entry it was handed, so a prose cap on top of the plumbing bound ' +
      'would only leave handed-out entries unfinished.',
  },
  // -------------------------------------------------------------------------
  // The background-and-poll doctrine (D-FOREGROUND-RUN).
  //
  // The Code, Validate and Test agents once ran any build that might exceed two
  // minutes in the background and polled it with Monitor, and the dynamic-build
  // engine and prompts repeated the procedure. A 250-second silent foreground run
  // survived inside a Workflow sub-agent on Claude Code 2.1.294, and the stalls
  // the old procedure guarded against fire on model-stream silence after a tool
  // result returns, never while a command runs. Every agent now runs builds and
  // tests in the foreground under an explicit Bash timeout, and the three bodies
  // share one `## Running commands` block that a parity guard holds identical.
  //
  // Scoped to the trees that carried the procedure: the agent bodies and the
  // command layer, source and compiled. The spellings are legitimate elsewhere
  // (the session-start hook spawns the Curate agent in the background, and
  // docs/reference/platform-assumptions.md describes what was measured), so a
  // repo-wide entry would be a grep rather than a rule.
  // -------------------------------------------------------------------------
  {
    literal: 'Long-running commands',
    removedFrom: 'src/assets/agents/{code,validate,test}.md, src/assets/commands/_partials/_engine.mds, src/assets/commands/dynamic-build.mds',
    scope: ['src/assets/agents/', 'src/assets/commands/', 'dist/commands/'],
    justification:
      'The section name the three agent bodies and nine dynamic-build prompt sites used for the ' +
      'background-and-poll procedure. The section is now `## Running commands` and the prompt ' +
      'sites name that block, so a surviving reference points at a section that no longer exists.',
  },
  ...([
    ['/tmp/df-val-', 'the Validate agent\'s background log path'],
    ['/tmp/df-test-', 'the Test agent\'s background log path'],
    ['/tmp/df-build-', 'the Code agent\'s and the engine\'s background log path'],
    ['sleep 25', 'the Monitor heartbeat loop'],
    ['25s heartbeat', 'the Monitor heartbeat that kept an agent alive past a watchdog that does not fire during a tool run'],
    ['select:Monitor', 'the ToolSearch call that pre-loaded Monitor for the poll'],
    ['run_in_background: true', 'the Bash parameter that launched the background run'],
    ['<BASE>.done', 'the sentinel file the poll waited on'],
  ] as const).map(([literal, what]): RetiredEntry => ({
    literal,
    removedFrom: 'src/assets/agents/{code,validate,test}.md and src/assets/commands/_partials/_engine.mds (the background-and-poll procedure)',
    scope: ['src/assets/agents/', 'src/assets/commands/', 'dist/commands/'],
    justification:
      `Retired background-and-poll wording — ${what}. Builds and tests run in the foreground under ` +
      'an explicit Bash timeout, and the new block\'s prohibition is worded without any of the ' +
      'registered spellings.',
  })),
  {
    literal: 'Cap: 50 entries per file',
    removedFrom: 'docs/reference/file-organization.md',
    justification:
      'The Project Knowledge section said decisions.md and pitfalls.md each hold at most 50 entries. ' +
      'Nothing ever enforced such a cap, and the live pitfalls file held well over 50 active entries. ' +
      'The section now says what the files hold: the active entries in full, then an Inactive table, ' +
      'and claim-due, not a file cap, bounds what one maintenance run reads.',
  },
  {
    literal: 'coreutils',
    // Every tree the corpus reaches EXCEPT CHANGELOG.md, enumerated rather than implied,
    // for the reason the `close milestone` entry gives: a release note that records the
    // removal has to name the thing it removed.
    scope: [
      'src/assets/', 'src/core/', 'src/cli/', 'src/targets/', 'src/hud/',
      'dist/', 'docs/', 'CLAUDE.md', 'README.md', 'CONTRIBUTING.md',
    ],
    removedFrom: 'src/assets/commands/bug-analysis.mds',
    justification:
      'devflow puts no time limit on scanner calls, so no text tells the user to install a ' +
      'time-limit tool.',
  },
];

// ---------------------------------------------------------------------------
// Corpus: src/assets/ + dist/commands/ + the repo's own prose (root .md, docs/)
//
// The corpus widens when a retired literal lives outside the shipping assets —
// a Phase-1 entry was retired from CLAUDE.md, which nothing scanned. Widening is
// the correct response; loosening the denylist is not (R2).
//
// .devflow/features/*/KNOWLEDGE.md is deliberately NOT in the corpus. Those files
// record what each literal WAS and why it was retired; a residue grep must not
// demand that provenance be deleted.
// ---------------------------------------------------------------------------

function buildCorpus(): Array<{ relPath: string; content: string }> {
  const corpus: Array<{ relPath: string; content: string }> = [];

  function addDir(dir: string, relPrefix: string, exts: string[]): void {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        addDir(path.join(dir, entry.name), `${relPrefix}/${entry.name}`, exts);
      } else if (exts.some(ext => ext === '' ? !entry.name.includes('.') : entry.name.endsWith(ext))) {
        // ext === '' matches extensionless files (hook scripts in src/assets/scripts/hooks/)
        const absPath = path.join(dir, entry.name);
        try {
          corpus.push({ relPath: `${relPrefix}/${entry.name}`, content: readFileSync(absPath, 'utf-8') });
        } catch {
          // Ignore read errors
        }
      }
    }
  }

  // '' in exts picks up extensionless hook scripts in src/assets/scripts/hooks/ so
  // retired-wording checks are not silently skipped for that corpus (e.g. capture-prompt, ensure-proxy).
  addDir(path.join(ROOT, 'src', 'assets'), 'src/assets', ['.md', '.mds', '.sh', '']);
  // The TypeScript sources and the shipped CJS scripts. Without them the phase-label
  // entry would be retired from a tree nothing scanned — every site it names lives
  // in a .ts or .cjs file, and the four extensions above reach none of them.
  for (const sub of ['core', 'cli', 'targets', 'hud']) {
    addDir(path.join(ROOT, 'src', sub), `src/${sub}`, ['.ts', '.cjs']);
  }
  addDir(path.join(ROOT, 'src', 'assets', 'scripts'), 'src/assets/scripts', ['.cjs']);
  addDir(path.join(ROOT, 'dist', 'commands'), 'dist/commands', ['.md']);
  addDir(path.join(ROOT, 'dist', 'agents'), 'dist/agents', ['.md']);
  // Phase 2 generates a third build output. Without it the scoped `sleep 60` entry
  // would be retired from a tree nothing scanned — the GAP-25 contradiction could
  // move into a generated reference and stay green.
  addDir(path.join(ROOT, 'dist', 'skills'), 'dist/skills', ['.md']);
  addDir(path.join(ROOT, 'docs'), 'docs', ['.md']);

  // Root-level prose. Read individually rather than by walking ROOT, which would
  // pull in node_modules/ and every dot-directory.
  for (const name of ['CLAUDE.md', 'README.md', 'CONTRIBUTING.md']) {
    try {
      corpus.push({ relPath: name, content: readFileSync(path.join(ROOT, name), 'utf-8') });
    } catch {
      // Absent root doc — the corpus-size assertion below is what catches a corpus
      // that has collapsed; a single missing file is not a guard failure.
    }
  }

  let changelogRaw: string | undefined;
  try {
    changelogRaw = readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf-8');
  } catch {
    changelogRaw = undefined;
  }
  const changelog = changelogCorpusEntry(changelogRaw);
  if (changelog !== undefined) corpus.push(changelog);

  return corpus;
}

/**
 * CHANGELOG.md as the corpus holds it, or undefined only when the file is absent.
 *
 * A present file is ALWAYS a corpus entry, even when it carries no current claims.
 * scripts/bump-version.ts renames `## [Unreleased]` to the release header, and the
 * release workflow runs this suite on that tree: the file is still scanned there,
 * it just has nothing unreleased in it. Dropping it would report every
 * CHANGELOG.md-scoped entry as retired from a tree nothing scans — a failure on
 * every release — when the scope is live and the next [Unreleased] is guarded.
 */
function changelogCorpusEntry(
  raw: string | undefined,
): { relPath: string; content: string } | undefined {
  if (raw === undefined) return undefined;
  return { relPath: 'CHANGELOG.md', content: unreleasedClaims(raw) };
}

/**
 * The `[Unreleased]` section of CHANGELOG.md, reduced to what it CLAIMS about the
 * tree as it stands.
 *
 * Two reductions, each for a reason the guard would otherwise get wrong:
 *
 *   - **Released sections are dropped.** `## [2.4.0]` says what 2.4.0 did. A
 *     mechanism retired since is not residue there, it is the record — and the
 *     record is not editable after the fact.
 *   - **Only the `After:` half of a before/after bullet is kept.** Every bullet
 *     here is written `- **{the defect}** — before: {what the tree did} After:
 *     {what it does}`, and two of its three parts exist to NAME the retired
 *     mechanism: the title states the defect, the `before:` half states the
 *     behaviour that was removed. Scanning either would report the bullets that
 *     exist precisely to record `ISSUE: {issue number}` and `close milestone`
 *     being removed, and the only way to green that is to damage a correct entry.
 *     A bullet with no `before:` asserts current behaviour throughout and is kept
 *     whole.
 *
 * What survives is the set of sentences that assert current behaviour — which is
 * the same thing the guard reads CLAUDE.md and README.md for. Returns '' when
 * the section is absent — the post-bump state, where every section is released.
 */
function unreleasedClaims(raw: string): string {
  const start = raw.indexOf('## [Unreleased]');
  if (start === -1) return '';
  const nextRelease = raw.indexOf('\n## [', start + 1);
  const section = nextRelease === -1 ? raw.slice(start) : raw.slice(start, nextRelease);

  return section
    .split('\n')
    .map(line => {
      const before = line.indexOf('before:');
      if (before === -1) return line;
      const after = line.indexOf('After:', before);
      return after === -1 ? '' : line.slice(after);
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Named collector — used by both the main guard and the non-vacuity probe (M12a).
// Calling this from both sites proves the probe exercises the real guard logic (pattern:
// collectGhIssueProseViolations in tests/build-mds.test.ts ~:1549 / ~:1571 / ~:1602).
// ---------------------------------------------------------------------------

function collectRetiredLiteralViolations(
  corpus: Array<{ relPath: string; content: string }>,
): string[] {
  const violations: string[] = [];
  for (const { relPath, content } of corpus) {
    for (const entry of RETIRED_LITERALS) {
      if (entry.scope && !entry.scope.some(prefix => relPath.startsWith(prefix))) continue;
      const hit = entry.pattern !== undefined
        ? entry.pattern.test(content)
        : content.includes(entry.literal);
      if (hit) {
        violations.push(
          `${relPath}: contains retired literal "${entry.literal}" (removed from ${entry.removedFrom})`,
        );
      }
    }
  }
  return violations;
}

/** Every scope prefix that matches no corpus path, as `"{literal}" → {prefix}`. */
function deadScopePrefixes(paths: readonly string[]): string[] {
  const dead: string[] = [];
  for (const entry of RETIRED_LITERALS) {
    if (!entry.scope) continue;
    for (const prefix of entry.scope) {
      if (!paths.some(p => p.startsWith(prefix))) dead.push(`"${entry.literal}" → ${prefix}`);
    }
  }
  return dead;
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

describe('retired-wording guard — denylist of retired literals (GAP-32)', () => {
  it('denylist is non-empty and each entry carries a justification (non-vacuity)', () => {
    expect(
      RETIRED_LITERALS.length,
      'RETIRED_LITERALS denylist must be non-empty',
    ).toBeGreaterThan(0);
    for (const entry of RETIRED_LITERALS) {
      expect(entry.literal.length, `entry literal must be non-empty`).toBeGreaterThan(0);
      expect(entry.justification.length, `entry "${entry.literal}" must carry a justification`).toBeGreaterThan(0);
      expect(entry.removedFrom.length, `entry "${entry.literal}" must record removedFrom`).toBeGreaterThan(0);
      if (entry.scope) {
        expect(entry.scope.length, `entry "${entry.literal}" has an empty scope — omit the field instead`)
          .toBeGreaterThan(0);
      }
    }
  });

  it('every scoped entry names a scope the corpus actually reaches (no silently dead scope)', () => {
    // A scope that matches no corpus path silences its entry completely and leaves
    // a denylist row that forbids nothing — the same failure as an exemption nobody
    // notices going stale. Checked against the real corpus, not the literal strings.
    const paths = buildCorpus().map(e => e.relPath);
    expect(paths.length, 'empty corpus').toBeGreaterThan(0);
    const dead = deadScopePrefixes(paths);
    expect(
      dead,
      `scope prefix(es) matching no corpus file — the entry is retired from a tree nothing scans:\n  ` +
      dead.join('\n  '),
    ).toEqual([]);
  });

  it('known-bad probe: a seeded phase label in a src/ source is caught (mechanic 2)', () => {
    // The pattern entry has no fixed spelling to seed, so the probe mints one the
    // denylist has never seen — which is the property a literal list cannot have.
    const seeded = collectRetiredLiteralViolations([{
      relPath: 'src/core/probe.ts',
      content: '// P7c-S42: a coordinate nobody can resolve\nexport const probe = 1;\n',
    }]);
    expect(
      seeded.filter(v => v.includes('P{n}-S{n} phase labels')),
      'a freshly-minted phase label in src/ must be caught by the class rule',
    ).not.toEqual([]);

    // …and the same label in the plan artifacts it legitimately belongs to is not.
    const provenance = collectRetiredLiteralViolations([
      { relPath: 'docs/reference/probe.md', content: 'The P7c-S42 step landed the overlay.\n' },
    ]);
    expect(provenance.filter(v => v.includes('P{n}-S{n} phase labels'))).toEqual([]);
  });

  it('known-bad probe: a scope confines its entry to the named tree (mechanic 2)', () => {
    // EVERY scoped entry, not the first one found. Picking one made the probe
    // depend on which entry happened to sort first and on that entry's scope not
    // naming whatever tree the probe used for "outside" — both of which a later
    // entry can change, turning a real guard red for a reason that is about the
    // probe. The outside path is synthetic for the same reason: no scope
    // prefix in the denylist can match it, whoever writes the next entry.
    const scopedEntries = RETIRED_LITERALS.filter(e => e.scope !== undefined);
    expect(
      scopedEntries.length,
      'at least one entry must be scoped, or the scope arm is untested',
    ).toBeGreaterThan(0);

    for (const scoped of scopedEntries) {
      const seeded = `seeded ${scoped.literal} here\n`;
      // The inside half seeds the entry's own `literal`, so it can only be run for
      // entries the collector matches BY that literal. A `pattern` entry's
      // `literal` is its human-readable name (`P{n}-S{n} phase labels`), which the
      // pattern is not required to match and generally does not; seeding a shape
      // for it would mean this probe carrying a second copy of the pattern's
      // intent. The outside half below runs for every scoped entry either way,
      // and that is the half the scope exists for.
      for (const prefix of scoped.pattern === undefined ? scoped.scope! : []) {
        const relPath = prefix.endsWith('/') ? `${prefix}probe.md` : prefix;
        expect(
          collectRetiredLiteralViolations([{ relPath, content: seeded }])
            .filter(v => v.includes(scoped.literal)),
          `the collector must flag "${scoped.literal}" at ${relPath} — a scope prefix that ` +
          'cannot be shown to admit its own entry is decoration',
        ).not.toEqual([]);
      }
      expect(
        collectRetiredLiteralViolations([
          { relPath: '__outside_every_scope__/probe.md', content: seeded },
        ]).filter(v => v.includes(scoped.literal)),
        `the collector must NOT flag "${scoped.literal}" outside its scope — that is what the scope is for`,
      ).toEqual([]);
    }
  });

  it('no retired literal appears in the shipping assets, the compiled output, or the repo docs', () => {
    const corpus = buildCorpus();

    // Non-vacuity: corpus size must be > 0 so the guard is not trivially green.
    expect(
      corpus.length,
      `corpus is empty — check src/assets/, dist/, and docs/; guard is vacuous`,
    ).toBeGreaterThan(0);
    // …and the doc half specifically, since a Phase-1 entry was retired from CLAUDE.md
    // and would have gone unchecked while the src/assets half kept the corpus non-empty.
    expect(
      corpus.map(e => e.relPath),
      'root prose must be in the corpus — a retired literal lives there',
    ).toContain('CLAUDE.md');

    // Use the named collector so the probe exercises the same logic (M12a).
    const violations = collectRetiredLiteralViolations(corpus);

    expect(
      violations,
      `Retired literals found in corpus:\n${violations.join('\n')}`,
    ).toHaveLength(0);
  });

  it('non-vacuity: a seeded retired literal in a synthetic corpus entry fails the guard (mechanic 2, M12a)', () => {
    // M12a: prior probe re-implemented the violation loop inline — this calls the same
    // named collector as the main guard so the proof tracks the guard rather than shadowing it.
    const retired = RETIRED_LITERALS[0];
    const syntheticCorpus = [
      { relPath: 'synthetic/test.md', content: `# Synthetic\nContains: ${retired.literal}\n` },
    ];
    // Call the same collectRetiredLiteralViolations function used by the main guard.
    const syntheticViolations = collectRetiredLiteralViolations(syntheticCorpus);
    expect(
      syntheticViolations.length,
      `non-vacuity: the guard logic must flag a corpus entry seeded with "${retired.literal}"`,
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The changelog across a release bump
//
// scripts/bump-version.ts renames `## [Unreleased]` to `## [X.Y.Z] - date` and
// the release workflow runs the suite on that tree, so the guard sees a changelog
// with no [Unreleased] section on every release. CHANGELOG.md is still scanned
// then — it simply has no current claims — and its scoped entries must stay live.
// ---------------------------------------------------------------------------

describe('retired-wording guard — CHANGELOG.md across the release bump', () => {
  const changelogScoped = RETIRED_LITERALS.filter(e => e.scope?.includes('CHANGELOG.md'));
  const header = '# Changelog\n\nAll notable changes to Devflow will be documented in this file.\n\n';
  const released = (literals: readonly string[]): string =>
    '## [9.9.9] - 2099-01-01\n\n### Fixed\n\n' +
    literals.map(l => `- **A defect** — before: it said ${l}. After: it says ${l}.\n`).join('') +
    '\n## [9.9.8] - 2098-01-01\n\n- An older entry.\n';
  const literals = changelogScoped.map(e => e.literal);
  const postBump = header + released(literals);
  const emptyUnreleased = header + '## [Unreleased]\n\n' + released(literals);

  function pathsWith(changelogRaw: string): string[] {
    const entry = changelogCorpusEntry(changelogRaw);
    return [
      ...buildCorpus().map(e => e.relPath).filter(p => p !== 'CHANGELOG.md'),
      ...(entry === undefined ? [] : [entry.relPath]),
    ];
  }

  it('has CHANGELOG.md-scoped entries to protect (non-vacuity)', () => {
    expect(changelogScoped.length).toBeGreaterThan(0);
  });

  it('a post-bump changelog with no [Unreleased] section leaves no CHANGELOG.md scope dead', () => {
    expect(postBump).not.toContain('## [Unreleased]');
    expect(deadScopePrefixes(pathsWith(postBump))).toEqual([]);
  });

  it('an empty [Unreleased] section leaves no CHANGELOG.md scope dead', () => {
    expect(deadScopePrefixes(pathsWith(emptyUnreleased))).toEqual([]);
  });

  it('a released section is the record, not residue — its retired literals are not flagged', () => {
    for (const raw of [postBump, emptyUnreleased]) {
      const entry = changelogCorpusEntry(raw);
      expect(entry?.relPath).toBe('CHANGELOG.md');
      expect(collectRetiredLiteralViolations(entry === undefined ? [] : [entry])).toEqual([]);
    }
  });

  it('a retired literal re-entering the next [Unreleased] After-half is still flagged', () => {
    for (const literal of literals) {
      const reopened =
        header +
        `## [Unreleased]\n\n### Fixed\n\n- **A defect** — before: old. After: it says ${literal}.\n\n` +
        released([]);
      const entry = changelogCorpusEntry(reopened);
      expect(
        collectRetiredLiteralViolations(entry === undefined ? [] : [entry])
          .filter(v => v.startsWith('CHANGELOG.md:') && v.includes(`"${literal}"`)),
        `"${literal}" in a fresh [Unreleased] After-half must still be caught`,
      ).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// The FEATURE-WORD guard (AC-1 of the curation rename)
//
// The feature was called "learning" before 3.8 and is called "curation" now. The
// word may not come back: every tracked file outside tests/ is read, and every
// occurrence of the word (any case, inside any word, so `learningCounts` and
// `LEARNING_OPS` count) must sit inside text that an entry of the allowlist
// covers, or inside a section the allowlist exempts by its heading.
//
// The bodies of the tests are out of scope on purpose. They name the old word to pin
// the migration and the legacy readers, and a guard that read them would only force
// each such test to carry a second copy of its own reason. Their titles are read by
// the test-title guard below.
//
// The scan is a named collector so the main guard and the non-vacuity probes run
// the SAME logic: a probe that re-implemented the loop would prove the probe.
// ---------------------------------------------------------------------------

interface ScannedFile {
  readonly relPath: string;
  readonly content: string;
}

interface FeatureWordReport {
  /** `path:line: text` for each line with an uncovered hit, and each path that carries the word. */
  readonly violations: string[];
  /** Entries that covered no hit. */
  readonly unusedEntries: string[];
  /** Section exemptions that exempted no hit. */
  readonly unusedSections: string[];
}

const FEATURE_WORD_ALL = new RegExp(FEATURE_WORD.source, 'gi');
const MAX_REPORTED_LINE = 200;
/** Words an entry must never cover alone: an entry that does covers every use of the word. */
const BARE_SAMPLES: readonly string[] = [
  'learning', 'Learning', 'LEARNING', 'learningCounts', 'LEARNING_OPS', ' learning ', 'the learning curve',
];

function entryApplies(scope: string | RegExp, relPath: string): boolean {
  if (typeof scope !== 'string') return scope.test(relPath);
  return scope.endsWith('/') ? relPath.startsWith(scope) : relPath === scope;
}

/** `[start, end)` of every non-empty match of `re` on `line`. */
function spansOf(re: RegExp, line: string): Array<readonly [number, number]> {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const spans: Array<readonly [number, number]> = [];
  for (const m of line.matchAll(new RegExp(re.source, flags))) {
    if (m[0].length > 0) spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  return spans;
}

function describeEntry(entry: AllowlistEntry): string {
  return `${String(entry.path)}  ${String(entry.pattern)}`;
}

function describeSection(section: SectionExemption): string {
  return `${section.path}  ${String(section.start)} .. ${String(section.end)}`;
}

/**
 * True when some use of the old word in `text` sits outside every span that an entry of
 * `entries` covers. Each entry that covers a use of the word is added to `used`.
 */
function hasUncoveredWord(
  text: string,
  entries: ReadonlyArray<AllowlistEntry>,
  used: Set<AllowlistEntry>,
): boolean {
  const covering: Array<readonly [number, number]> = [];
  for (const entry of entries) {
    for (const span of spansOf(entry.pattern, text)) {
      if (!FEATURE_WORD.test(text.slice(span[0], span[1]))) continue;
      used.add(entry);
      covering.push(span);
    }
  }
  return [...text.matchAll(FEATURE_WORD_ALL)].some(hit => {
    const at = hit.index ?? 0;
    return !covering.some(([from, to]) => from <= at && at + hit[0].length <= to);
  });
}

function scanForFeatureWord(
  files: ReadonlyArray<ScannedFile>,
  allowlist: ReadonlyArray<AllowlistEntry>,
  sections: ReadonlyArray<SectionExemption>,
): FeatureWordReport {
  const violations: string[] = [];
  const usedEntries = new Set<AllowlistEntry>();
  const usedSections = new Set<SectionExemption>();

  for (const { relPath, content } of files) {
    if (relPath.startsWith('tests/')) continue;
    if (FEATURE_WORD.test(relPath)) violations.push(`${relPath}: the file path carries the feature word`);

    const fileEntries = allowlist.filter(entry => entryApplies(entry.path, relPath));
    const fileSections = sections.filter(section => section.path === relPath);
    const open = new Set<SectionExemption>();

    content.split('\n').forEach((line, index) => {
      for (const section of fileSections) {
        if (open.has(section) && section.end.test(line)) open.delete(section);
        if (!open.has(section) && section.start.test(line)) open.add(section);
      }
      if (!FEATURE_WORD.test(line)) return;
      if (open.size > 0) {
        for (const section of open) usedSections.add(section);
        return;
      }

      if (hasUncoveredWord(line, fileEntries, usedEntries)) {
        violations.push(`${relPath}:${index + 1}: ${line.trim().slice(0, MAX_REPORTED_LINE)}`);
      }
    });
  }

  return {
    violations,
    unusedEntries: allowlist.filter(entry => !usedEntries.has(entry)).map(describeEntry),
    unusedSections: sections.filter(section => !usedSections.has(section)).map(describeSection),
  };
}

/** Entries whose pattern covers the word with no context around it. */
function looseEntries(allowlist: ReadonlyArray<AllowlistEntry>): string[] {
  return allowlist
    .filter(entry => BARE_SAMPLES.some(sample => spansOf(entry.pattern, sample).length > 0))
    .map(describeEntry);
}

/** Every tracked text file that `keep` accepts, as the working tree holds it. */
function trackedFiles(keep: (relPath: string) => boolean): ScannedFile[] {
  const listed = execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const files: ScannedFile[] = [];
  for (const relPath of listed.split('\0')) {
    if (relPath === '' || !keep(relPath)) continue;
    const abs = path.join(ROOT, relPath);
    let stat;
    try {
      stat = lstatSync(abs);
    } catch {
      continue; // listed and deleted in this working tree
    }
    if (!stat.isFile()) continue; // a symbolic link or a submodule
    const bytes = readFileSync(abs);
    if (bytes.includes(0)) continue; // binary
    files.push({ relPath, content: bytes.toString('utf-8') });
  }
  return files;
}

/** Every tracked text file outside tests/. */
const trackedFilesOutsideTests = (): ScannedFile[] => trackedFiles(relPath => !relPath.startsWith('tests/'));

/** Every tracked TypeScript file under tests/. */
const trackedTestSources = (): ScannedFile[] =>
  trackedFiles(relPath => relPath.startsWith('tests/') && relPath.endsWith('.ts'));

// ---------------------------------------------------------------------------
// The DIST scan. dist/ is git-ignored, so the tracked-file scan above never sees the
// built output. When dist/ exists, every built text file is read as a copy of the
// source file it is built from, and a hit passes only when an entry that covers THAT
// source file matches the line. A built copy of an allowed line passes; any other use
// of the word in the build is a leftover in the source. A built file with no source
// file is itself a violation.
//
// The build maps source to output in three ways:
//   tsc            src/<x>.ts                        -> dist/<x>.js, <x>.d.ts and their .map files
//   command/agent  src/assets/{commands,agents}/<n>.mds -> dist/{,<variant>/}{commands,agents}/<n>.md
//                  (variant: curation-off, compliance-off or curation-compliance-off)
//   manifest       scripts/build-mds.ts                -> dist/variant-axes.json
//   references     the module of VARIANT_MODULES / MCP_CONTRACT_MODULE -> dist/skills/git/references/**
// ---------------------------------------------------------------------------

const DIST_DIR = 'dist';
const REFERENCES_PREFIX = 'dist/skills/git/references/';
const MAX_DIST_DEPTH = 12;
const MAX_DIST_FILES = 5000;

const COMPILED_TS = /^dist\/(.+?)(?:\.d\.ts\.map|\.d\.ts|\.js\.map|\.js)$/;
const BUILT_HOST = /^dist\/(?:(?:curation-|compliance-|curation-compliance-)off\/)?(commands|agents)\/([^/]+)\.md$/;
const VARIANT_MANIFEST_SOURCE = 'scripts/build-mds.ts';

/** The source file that the build makes `distRel` from, or null when none is known. */
function distSourceOf(distRel: string): string | null {
  const compiled = COMPILED_TS.exec(distRel);
  if (compiled !== null) {
    const source = `src/${compiled[1]}.ts`;
    return existsSync(path.join(ROOT, source)) ? source : null;
  }

  if (distRel === VARIANT_MANIFEST_REL_PATH) return VARIANT_MANIFEST_SOURCE;

  const host = BUILT_HOST.exec(distRel);
  if (host !== null) {
    const source = `src/assets/${host[1]}/${host[2]}.mds`;
    return existsSync(path.join(ROOT, source)) ? source : null;
  }

  if (distRel.startsWith(REFERENCES_PREFIX) && distRel.endsWith('.md')) {
    const rel = distRel.slice(REFERENCES_PREFIX.length);
    for (const module of [...VARIANT_MODULES, MCP_CONTRACT_MODULE]) {
      const dir = module.subdir === '' ? '' : `${module.subdir}/`;
      const covers = module.kind === 'fanout'
        ? rel.startsWith(dir) && !rel.slice(dir.length).includes('/')
        : (module.ops as readonly string[]).some(op => rel === `${dir}${op}.md`);
      if (covers) return module.source;
    }
  }
  return null;
}

/**
 * The same collector as the tracked scan, run over built files. Each file is scanned as
 * its source file, and a violation names the built file. Entries and sections that
 * cover nothing here are not reported: the tracked scan owns that check.
 */
function scanDistForFeatureWord(
  files: ReadonlyArray<ScannedFile>,
  allowlist: ReadonlyArray<AllowlistEntry>,
): string[] {
  const violations: string[] = [];
  for (const { relPath, content } of files) {
    if (FEATURE_WORD.test(relPath)) violations.push(`${relPath}: the file path carries the feature word`);
    const source = distSourceOf(relPath);
    if (source === null) {
      if (FEATURE_WORD.test(content)) violations.push(`${relPath}: no source file is known for this built file`);
      continue;
    }
    const report = scanForFeatureWord([{ relPath: source, content }], allowlist, []);
    for (const violation of report.violations) {
      if (violation.startsWith(`${source}: `)) continue; // the source path, not the built one
      violations.push(`${relPath} (built from ${source}) line ${violation.slice(source.length + 1).trim()}`);
    }
  }
  return violations;
}

/** Every built text file under dist/, or null when dist/ is absent. Bounded in depth and count. */
function distFiles(): ScannedFile[] | null {
  const root = path.join(ROOT, DIST_DIR);
  if (!existsSync(root)) return null;
  const files: ScannedFile[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > MAX_DIST_DEPTH) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= MAX_DIST_FILES) return;
      const entryRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), entryRel, depth + 1);
      } else if (entry.isFile()) {
        const bytes = readFileSync(path.join(dir, entry.name));
        if (!bytes.includes(0)) files.push({ relPath: entryRel, content: bytes.toString('utf-8') });
      }
    }
  };
  walk(root, DIST_DIR, 0);
  return files;
}

const wordsIn = (text: string): number => text.trim().split(/\s+/).length;

describe('feature-word guard — the old feature word stays out of the tree (AC-1)', () => {
  const files = trackedFilesOutsideTests();
  const report = scanForFeatureWord(files, FEATURE_WORD_ALLOWLIST, SECTION_EXEMPTIONS);

  it('reads the whole tracked tree outside tests/ (non-vacuity)', () => {
    expect(files.length, 'the scan reached almost no files').toBeGreaterThan(100);
    const reached = new Set(files.map(file => file.relPath.split('/')[0]));
    for (const top of ['src', 'docs', 'scripts', 'CHANGELOG.md', 'README.md', 'CLAUDE.md', 'package.json']) {
      expect(reached.has(top), `${top} is not in the scan`).toBe(true);
    }
    expect(files.some(file => file.relPath.startsWith('tests/'))).toBe(false);
  });

  it('every entry and every section exemption carries a reason in words', () => {
    expect(FEATURE_WORD_ALLOWLIST.length).toBeGreaterThan(0);
    expect(SECTION_EXEMPTIONS.length).toBeGreaterThan(0);
    for (const entry of FEATURE_WORD_ALLOWLIST) {
      expect(wordsIn(entry.reason), `${describeEntry(entry)} has no reason`).toBeGreaterThanOrEqual(6);
    }
    for (const section of SECTION_EXEMPTIONS) {
      expect(wordsIn(section.reason), `${describeSection(section)} has no reason`).toBeGreaterThanOrEqual(6);
    }
  });

  it('no entry covers the bare word: each pins the words around its hit', () => {
    expect(looseEntries(FEATURE_WORD_ALLOWLIST)).toEqual([]);
  });

  it('no use of the old feature word sits outside the allowlist', () => {
    expect(
      report.violations,
      `the old feature word is back. Rename it, or add an allowlist entry with a reason:\n  ${report.violations.join('\n  ')}`,
    ).toEqual([]);
  });

  it('no entry and no section exemption is stale (each covers a real hit)', () => {
    expect(report.unusedEntries, `entries that cover no hit:\n  ${report.unusedEntries.join('\n  ')}`).toEqual([]);
    expect(report.unusedSections, `sections that exempt no hit:\n  ${report.unusedSections.join('\n  ')}`).toEqual([]);
  });
});

describe('feature-word guard — non-vacuity probes (the same collector as the guard)', () => {
  const scan = (
    synthetic: ReadonlyArray<ScannedFile>,
    allowlist: ReadonlyArray<AllowlistEntry> = FEATURE_WORD_ALLOWLIST,
    sections: ReadonlyArray<SectionExemption> = SECTION_EXEMPTIONS,
  ): FeatureWordReport => scanForFeatureWord(synthetic, allowlist, sections);

  it('a seeded use in a source file fails, in camelCase, UPPER_CASE and plain text', () => {
    const { violations } = scan([{
      relPath: 'src/core/probe.ts',
      content: 'export const learningCounts = 1;\nconst LEARNING_OPS = 2;\n// the Learning note\n',
    }]);
    expect(violations).toHaveLength(3);
  });

  it('a seeded use in a doc, a script or a knowledge base fails', () => {
    for (const relPath of ['docs/probe.md', 'scripts/probe.ts', '.devflow/features/probe/KNOWLEDGE.md', 'README.md']) {
      expect(scan([{ relPath, content: 'The learning feature.\n' }]).violations, relPath).toHaveLength(1);
    }
  });

  it('a file path that carries the word fails, and a file under tests/ is not read', () => {
    expect(scan([{ relPath: 'src/core/learning-probe.ts', content: 'export {};\n' }]).violations).toHaveLength(1);
    expect(scan([{ relPath: 'tests/probe.test.ts', content: 'const learningCounts = 1;\n' }]).violations).toEqual([]);
  });

  it('an entry covers only its own text: the same file with a second use still fails', () => {
    const entry: AllowlistEntry = {
      path: 'src/core/probe.ts',
      pattern: /pre-rename key `learning`/,
      reason: 'The comment names the pre-rename key the reader still accepts.',
    };
    const file = (content: string): ScannedFile => ({ relPath: 'src/core/probe.ts', content });
    expect(scan([file('// the pre-rename key `learning`\n')], [entry]).violations).toEqual([]);
    expect(scan([file('// the pre-rename key `learning` and the learning feature\n')], [entry]).violations).toHaveLength(1);
    expect(scan([{ relPath: 'src/core/other.ts', content: '// the pre-rename key `learning`\n' }], [entry]).violations)
      .toHaveLength(1);
  });

  it('a stale entry fails: an entry that covers no hit is reported', () => {
    const stale: AllowlistEntry = {
      path: 'src/nowhere.ts',
      pattern: /learning-nothing/,
      reason: 'This entry matches nothing in the tree on purpose.',
    };
    expect(scan([{ relPath: 'src/core/probe.ts', content: 'export {};\n' }], [stale]).unusedEntries).toHaveLength(1);
    expect(scan([{ relPath: 'src/nowhere.ts', content: '// learning-nothing\n' }], [stale]).unusedEntries).toEqual([]);
    const staleSection: SectionExemption = {
      path: 'CHANGELOG.md',
      start: /^## \[0\.0\.0\]/,
      end: /^## /,
      reason: 'This section matches nothing in the tree on purpose.',
    };
    expect(scan([{ relPath: 'CHANGELOG.md', content: '## [Unreleased]\n' }], [], [staleSection]).unusedSections)
      .toHaveLength(1);
  });

  it('an entry that covers the bare word is reported as loose', () => {
    const loose: AllowlistEntry = {
      path: 'src/',
      pattern: /learning/,
      reason: 'This entry would cover every use of the word in the tree.',
    };
    expect(looseEntries([loose])).toHaveLength(1);
  });

  describe('CHANGELOG sections (matched by heading, so they survive the release bump)', () => {
    const changelog = (content: string): FeatureWordReport => scan([{ relPath: 'CHANGELOG.md', content }]);
    const upgrade = '### Upgrade notes — Curation rename\n\nthe learning folder moves\n\n';

    it('the upgrade section under [Unreleased] is exempt, and the section after it is not', () => {
      const { violations } = changelog(
        `## [Unreleased]\n\n${upgrade}### Upgrade notes — Lint pack\n\nlearning outside\n\n## [3.7.0] - 2026-10-16\n\nlearning released\n`,
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('learning outside');
    });

    it('the same heading under the released 3.8.0 heading is exempt after the bump', () => {
      const { violations } = changelog(
        `## [Unreleased]\n\nlearning in the next release\n\n## [3.8.0] - 2026-10-20\n\n${upgrade}### Added\n\nlearning released\n`,
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('learning in the next release');
    });

    it('a changelog with no [Unreleased] heading is accepted', () => {
      expect(changelog(`## [3.8.0] - 2026-10-20\n\n${upgrade}## [3.6.0] - 2026-10-14\n\nlearning released\n`).violations)
        .toEqual([]);
    });

    it('a hit in [Unreleased] outside the upgrade section fails', () => {
      expect(changelog('## [Unreleased]\n\n### Added\n\n- a learning note\n').violations).toHaveLength(1);
    });
  });
});

const builtFiles = distFiles();

describe.skipIf(builtFiles === null)('feature-word guard — the built output in dist/ (AC-1)', () => {
  // CI builds before it tests. A machine without dist/ skips this block: run `npm run build`.
  const built = builtFiles ?? [];
  const violations = scanDistForFeatureWord(built, FEATURE_WORD_ALLOWLIST);

  it('reads the compiled code, the built commands and agents, and the built references (non-vacuity)', () => {
    expect(built.length, 'the dist scan reached almost no files').toBeGreaterThan(100);
    for (const prefix of ['dist/core/', 'dist/cli/', 'dist/commands/', 'dist/agents/', 'dist/curation-off/', REFERENCES_PREFIX]) {
      expect(built.some(file => file.relPath.startsWith(prefix)), `${prefix} is not in the dist scan`).toBe(true);
    }
  });

  it('every built file has a known source file', () => {
    const orphans = built
      .filter(file => distSourceOf(file.relPath) === null && !file.relPath.endsWith('.map'))
      .map(file => file.relPath);
    expect(orphans, `built files with no mapped source:\n  ${orphans.join('\n  ')}`).toEqual([]);
  });

  it('every use of the old feature word in the build is a copy of an allowed source line', () => {
    expect(
      violations,
      `the old feature word is in the build. Rename it in the source, or add an allowlist entry:\n  ${violations.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('feature-word guard — dist mapping and probes (the same collector as the dist scan)', () => {
  const scanDist = (relPath: string, content: string): string[] =>
    scanDistForFeatureWord([{ relPath, content }], FEATURE_WORD_ALLOWLIST);

  it('maps built files to their sources', () => {
    expect(distSourceOf('dist/core/project-paths.d.ts')).toBe('src/core/project-paths.ts');
    expect(distSourceOf('dist/core/project-paths.js.map')).toBe('src/core/project-paths.ts');
    expect(distSourceOf('dist/cli/commands/init.js')).toBe('src/cli/commands/init.ts');
    expect(distSourceOf('dist/commands/implement.md')).toBe('src/assets/commands/implement.mds');
    expect(distSourceOf('dist/curation-off/agents/code.md')).toBe('src/assets/agents/code.mds');
    expect(distSourceOf('dist/compliance-off/agents/code.md')).toBe('src/assets/agents/code.mds');
    expect(distSourceOf('dist/curation-compliance-off/commands/implement.md')).toBe('src/assets/commands/implement.mds');
    expect(distSourceOf('dist/variant-axes.json')).toBe('scripts/build-mds.ts');
    expect(distSourceOf('dist/skills/git/references/decision-markers.md')).toBe('src/assets/mds/git/_references.mds');
    expect(distSourceOf('dist/skills/git/references/pr/create.md')).toBe('src/assets/mds/git/_pr.mds');
    expect(distSourceOf('dist/skills/git/references/tracker/_mcp.md')).toBe('src/assets/mds/tracker/_mcp.mds');
    expect(distSourceOf('dist/core/not-a-real-module.js')).toBeNull();
    expect(distSourceOf('dist/stray.txt')).toBeNull();
  });

  it('a built copy of an allowed source line passes, in the form the compiler emits', () => {
    const emitted = Object.entries(LEGACY_NAMES).map(([key, value]) => `    ${key}: ${JSON.stringify(value)};`);
    expect(emitted).toHaveLength(3);
    for (const line of emitted) {
      expect(scanDist('dist/core/project-paths.d.ts', `${line}\n`), line).toEqual([]);
    }
    expect(scanDist('dist/core/curation-variants.d.ts', 'export declare const LEGACY_OFF_OUTPUT_DIR = "dist/learning-off";\n'))
      .toEqual([]);
    expect(scanDist('dist/core/curation-variants.js', "export const LEGACY_OFF_OUTPUT_DIR = 'dist/learning-off';\n"))
      .toEqual([]);
  });

  it('a built line that is not a copy of an allowed source line fails', () => {
    const planted = scanDist('dist/core/project-paths.js', "    folder: 'learning',\n    other: 'the learning feature',\n");
    expect(planted).toHaveLength(1);
    expect(planted[0]).toContain('dist/core/project-paths.js');
    expect(scanDist('dist/core/curation-store.js', 'export const learningCounts = 1;\n')).toHaveLength(1);
    expect(scanDist('dist/commands/implement.md', 'Run the learning step.\n')).toHaveLength(1);
  });

  it('an allowed line covers only its own source file: the same line in another built file fails', () => {
    const line = '    backupPrefix: "learning.backup-";';
    expect(scanDist('dist/core/other.d.ts', `${line}\n`)).toHaveLength(1);
    expect(scanDist('dist/core/project-paths.d.ts', `${line} // the learning feature\n`)).toHaveLength(1);
    expect(scanDist('dist/core/project-paths.d.ts', '    other: "learning";\n')).toHaveLength(1);
  });

  it('a built file with no source file, or a path that carries the word, fails', () => {
    expect(scanDist('dist/core/ghost.js', 'export const learning = 1;\n')).toHaveLength(1);
    expect(scanDist('dist/core/learning-store.js', 'export {};\n')).toHaveLength(1);
    expect(scanDist('dist/core/ghost.js', 'export {};\n')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The TEST-TITLE guard. The feature-word guard above does not read tests/, because a
// test body names the old word to pin the migration and the legacy readers. A title
// is different: it states what the test is about, and a title that says "learning"
// for the current feature is a rename left half done. So the title of every
// `describe`, `it` and `test` call under tests/ is read, and a title that carries the
// word passes only when an entry of TEST_TITLE_ALLOWLIST covers its exact words (a
// legacy key, file, command or hook that the test names on purpose).
//
// A title is read from the source: the first string literal of the call, after the
// table of an `.each(...)` or the condition of a `.skipIf(...)`. A title that is a
// variable is not read here; its words sit in a table or a constant that the sweep
// reviews by hand. The scan is a named collector, so the guard and its planted-title
// probes run the same logic.
// ---------------------------------------------------------------------------

/** A call of `describe`, `it` or `test`, not a method of another object (`regex.test(`). */
const TEST_CALL = /(?<![.\w$])(?:describe|it|test)\b/g;
/** A modifier chained to the call: `.each`, `.skip`, `.skipIf`, `.concurrent`. */
const TEST_MODIFIER = /\.\w+/y;
/** The most modifiers one call chains. */
const MAX_TEST_MODIFIERS = 4;
/** The most parenthesised groups tried after a call: a table, a condition, then the call that holds the title. */
const MAX_TITLE_GROUPS = 3;

/** The title of one test call: the offset of its opening quote and the text between the quotes. */
interface TestTitle {
  readonly index: number;
  readonly text: string;
}

interface TitleReport {
  /** `path:line: title` for each title with an uncovered use of the word. */
  readonly violations: string[];
  /** Entries that covered no title. */
  readonly unusedEntries: string[];
  /** How many titles were read, in all. */
  readonly titlesRead: number;
}

/** The offset of the quote that closes the string literal opened at `start`, or -1 when it never closes. */
function closingQuote(src: string, start: number): number {
  for (let i = start + 1; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === src[start]) return i;
  }
  return -1;
}

/** The offset after the `)` that closes the `(` at `open`, or -1 when it never closes. */
function afterBalancedParens(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      i = closingQuote(src, i);
      if (i < 0) return -1;
    } else if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function skipSpace(src: string, from: number): number {
  let at = from;
  while (at < src.length && /\s/.test(src[at])) at++;
  return at;
}

/** The title of every `describe`, `it` and `test` call in `src`, in source order. */
function extractTestTitles(src: string): TestTitle[] {
  const titles: TestTitle[] = [];
  for (const call of src.matchAll(TEST_CALL)) {
    let pos = (call.index ?? 0) + call[0].length;
    TEST_MODIFIER.lastIndex = pos;
    for (let chained = 0; chained < MAX_TEST_MODIFIERS && TEST_MODIFIER.exec(src) !== null; chained++) {
      pos = TEST_MODIFIER.lastIndex;
    }
    for (let group = 0; group < MAX_TITLE_GROUPS; group++) {
      pos = skipSpace(src, pos);
      if (src[pos] !== '(') break;
      const at = skipSpace(src, pos + 1);
      if (src[at] === "'" || src[at] === '"' || src[at] === '`') {
        const end = closingQuote(src, at);
        if (end > at) titles.push({ index: at, text: src.slice(at + 1, end) });
        break;
      }
      pos = afterBalancedParens(src, pos);
      if (pos < 0) break;
    }
  }
  return titles;
}

/** The 1-based line of the character at `index`. */
const lineAt = (content: string, index: number): number => content.slice(0, index).split('\n').length;

function scanTestTitles(
  files: ReadonlyArray<ScannedFile>,
  allowlist: ReadonlyArray<AllowlistEntry>,
): TitleReport {
  const violations: string[] = [];
  const used = new Set<AllowlistEntry>();
  let titlesRead = 0;

  for (const { relPath, content } of files) {
    if (!relPath.startsWith('tests/')) continue;
    const fileEntries = allowlist.filter(entry => entryApplies(entry.path, relPath));
    for (const { index, text } of extractTestTitles(content)) {
      titlesRead++;
      if (!FEATURE_WORD.test(text)) continue;
      if (hasUncoveredWord(text, fileEntries, used)) {
        violations.push(`${relPath}:${lineAt(content, index)}: ${text.slice(0, MAX_REPORTED_LINE)}`);
      }
    }
  }

  return {
    violations,
    unusedEntries: allowlist.filter(entry => !used.has(entry)).map(describeEntry),
    titlesRead,
  };
}

describe('test-title guard — no test title uses the old feature word for the current feature', () => {
  const files = trackedTestSources();
  const report = scanTestTitles(files, TEST_TITLE_ALLOWLIST);

  it('reads the titles of the whole tests/ tree (non-vacuity)', () => {
    expect(files.length, 'the scan reached almost no test files').toBeGreaterThan(200);
    expect(report.titlesRead, 'the scan read almost no titles').toBeGreaterThan(5000);
    for (const relPath of ['tests/guards/retired-wording.test.ts', 'tests/queue-append.test.ts', 'tests/manifest.test.ts']) {
      expect(files.some(file => file.relPath === relPath), `${relPath} is not in the scan`).toBe(true);
    }
  });

  it('every entry carries a reason in words', () => {
    expect(TEST_TITLE_ALLOWLIST.length).toBeGreaterThan(0);
    for (const entry of TEST_TITLE_ALLOWLIST) {
      expect(wordsIn(entry.reason), `${describeEntry(entry)} has no reason`).toBeGreaterThanOrEqual(6);
    }
  });

  it('no entry covers the bare word: each pins the words around its hit', () => {
    expect(looseEntries(TEST_TITLE_ALLOWLIST)).toEqual([]);
  });

  it('no test title uses the old feature word outside the allowlist', () => {
    expect(
      report.violations,
      `a test title uses the old feature word. Rename it to the current word, or add an allowlist entry with a reason:\n  ${report.violations.join('\n  ')}`,
    ).toEqual([]);
  });

  it('no entry is stale (each covers a real title)', () => {
    expect(report.unusedEntries, `entries that cover no title:\n  ${report.unusedEntries.join('\n  ')}`).toEqual([]);
  });

  describe('planted titles (the same collector as the guard)', () => {
    // Built from two halves, so this file holds no title of its own that uses the word.
    const WORD = 'learn' + 'ing';
    const PLANTED = `a planted ${WORD} title`;

    const scan = (
      content: string,
      relPath = 'tests/probe.test.ts',
      allowlist: ReadonlyArray<AllowlistEntry> = TEST_TITLE_ALLOWLIST,
    ): TitleReport => scanTestTitles([{ relPath, content }], allowlist);

    it('a planted title fails, in every call form', () => {
      for (const form of [
        "it('TITLE', () => {});",
        'describe("TITLE", () => {});',
        'test(`TITLE ${name}`, () => {});',
        "it.each([[1, 2]])('TITLE %s', () => {});",
        "it.each(Object.entries(table))('TITLE', () => {});",
        "describe.skip('TITLE', () => {});",
        "it.skipIf(process.getuid?.() === 0)('TITLE', () => {});",
        "it(\n  'TITLE',\n  () => {},\n);",
        "it('it\\'s a TITLE', () => {});",
      ]) {
        const planted = form.replace('TITLE', PLANTED);
        expect(scan(`${planted}\n`).violations, planted).toHaveLength(1);
      }
    });

    it('the violation names the file and the line', () => {
      expect(scan(`describe('ok', () => {\n  it('${PLANTED}', () => {});\n});\n`).violations)
        .toEqual([`tests/probe.test.ts:2: ${PLANTED}`]);
    });

    it('a title that is not about the old feature, a variable title and a method call are not hits', () => {
      for (const clean of [
        "it('the curation queue holds a turn', () => {});",
        'it(title, () => {});',
        `expect(/${WORD}/.test('the ${WORD} queue')).toBe(true);`,
        `const text = edit('${WORD}');`,
        `const where = { test: '${WORD}' };`,
      ]) {
        expect(scan(`${clean}\n`).violations, clean).toEqual([]);
      }
    });

    it('an entry covers its own words only: a second use in the same title still fails', () => {
      expect(scan(`it('the legacy ${WORD} key beside curation', () => {});\n`).violations).toEqual([]);
      expect(scan(`it('the legacy ${WORD} key and the ${WORD} queue', () => {});\n`).violations).toHaveLength(1);
    });

    it('an entry applies to its own files only', () => {
      const title = `it('devflow ${WORD} exits 1', () => {});\n`;
      expect(scan(title, 'tests/probe.test.ts').violations).toHaveLength(1);
      expect(scan(title, 'tests/cli-unknown-command.test.ts').violations).toEqual([]);
    });

    it('a file outside tests/ is not read', () => {
      expect(scan(`it('${PLANTED}', () => {});\n`, 'src/core/probe.ts').violations).toEqual([]);
    });

    it('a stale entry is reported, and one that covers a title is not', () => {
      const entry: AllowlistEntry = {
        path: /^tests\//,
        pattern: new RegExp(`\\bthe legacy ${WORD} key\\b`),
        reason: 'This entry covers one phrase that a title of the probe uses.',
      };
      expect(scan('it("an unrelated title", () => {});\n', 'tests/probe.test.ts', [entry]).unusedEntries).toHaveLength(1);
      expect(scan(`it('the legacy ${WORD} key', () => {});\n`, 'tests/probe.test.ts', [entry]).unusedEntries).toEqual([]);
    });

    it('an entry that covers the bare word is reported as loose', () => {
      const loose: AllowlistEntry = {
        path: /^tests\//,
        pattern: new RegExp(WORD),
        reason: 'This entry would cover every use of the word in a title.',
      };
      expect(looseEntries([loose])).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// The DERIVED-STEM guard. The feature-word guard above reads the whole old word,
// so an identifier built on the stem alone (`learnOn`, `learn_on`, `isLearnOn`,
// `LEARN_ON`) slips through a rename: a sweep for the word never sees it. The
// shipped scripts hold no such identifier, and one may not come back. Plain
// words that merely start with the stem (`learned`, `re-learn`, `learn-conventions`)
// are not identifiers built on it and are not hits.
//
// Like the feature-word guard, it is a named collector that the guard and its
// planted-hit probes both run.
// ---------------------------------------------------------------------------

/** The folder the stem guard reads: the hook scripts, the resolver and the libraries they load. */
const DERIVED_STEM_SCOPE = 'src/assets/scripts/';

/** An identifier built on the stem: `learnOn`, `learn_on`, `isLearn`, `isLearnOn`, `LEARN_ON`, `IS_LEARN`. */
const DERIVED_STEM = /\blearn[A-Z_]|[a-z0-9]Learn(?:[A-Z_]|\b)|\bLEARN_|_LEARN\b/;

/** `path:line: text` for each line of a file under the scope that holds an identifier built on the stem. */
function collectDerivedStemHits(files: ReadonlyArray<ScannedFile>): string[] {
  const hits: string[] = [];
  for (const { relPath, content } of files) {
    if (!relPath.startsWith(DERIVED_STEM_SCOPE)) continue;
    content.split('\n').forEach((line, index) => {
      if (DERIVED_STEM.test(line)) hits.push(`${relPath}:${index + 1}: ${line.trim().slice(0, MAX_REPORTED_LINE)}`);
    });
  }
  return hits;
}

describe('derived-stem guard — no identifier built on the old feature stem in the shipped scripts', () => {
  const files = trackedFilesOutsideTests().filter(file => file.relPath.startsWith(DERIVED_STEM_SCOPE));

  it('reads the hook scripts, the resolver and the libraries (non-vacuity)', () => {
    for (const relPath of [
      'src/assets/scripts/hooks/queue-append',
      'src/assets/scripts/hooks/session-start-context',
      'src/assets/scripts/resolve-settings.cjs',
    ]) {
      expect(files.some(file => file.relPath === relPath), `${relPath} is not in the scan`).toBe(true);
    }
  });

  it('no identifier built on the stem sits in the scripts', () => {
    const hits = collectDerivedStemHits(files);
    expect(hits, `an identifier built on the old feature stem is back. Rename it to the current word:\n  ${hits.join('\n  ')}`)
      .toEqual([]);
  });

  describe('planted hits (the same collector as the guard)', () => {
    const hitsIn = (content: string, relPath = 'src/assets/scripts/hooks/probe'): string[] =>
      collectDerivedStemHits([{ relPath, content }]);

    it('a planted identifier fails, in camelCase, snake_case and UPPER_SNAKE', () => {
      for (const planted of [
        "const learnOn = cur.length > 0 ? cur.every(on) : on('decisions');",
        'local learn_on="true"',
        'const isLearnOn = true;',
        'const shouldLearn = true;',
        'LEARN_ON=1',
        'IS_LEARN=1',
      ]) {
        expect(hitsIn(`${planted}\n`), planted).toHaveLength(1);
      }
    });

    it('the hit names the file and the line', () => {
      expect(hitsIn('ok\nconst learnOn = 1;\n', 'src/assets/scripts/resolve-settings.cjs'))
        .toEqual(['src/assets/scripts/resolve-settings.cjs:2: const learnOn = 1;']);
    });

    it('plain words and the current name are not hits', () => {
      for (const clean of [
        'const curationOn = true;',
        '# re-learn the conventions from the branch names',
        '# learn-conventions writes the file',
        'the model learned the pattern',
        'learn more in the docs',
      ]) {
        expect(hitsIn(`${clean}\n`), clean).toEqual([]);
      }
    });

    it('a file outside the scope is not read', () => {
      expect(hitsIn('const learnOn = 1;\n', 'src/core/probe.ts')).toEqual([]);
    });
  });
});
