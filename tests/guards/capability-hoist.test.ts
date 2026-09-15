/**
 * capability-hoist — no capability probe is invoked inside a loop (P2-S15, [DR-11]).
 *
 * The preamble states the rule once, for every provider:
 *
 *   "Resolve tracker **capabilities** and the current-user identity **exactly once
 *    per spawn, before any loop**; pass the resolved set to nested invocations;
 *    **never invoke a capability probe inside a loop.**"
 *
 * Prose alone does not enforce it. Nothing previously stopped a mechanics file from
 * probing a session-scoped capability inside the ≤50 loops of
 * `backlink-shipped-issues` or `resolve-review-threads`, and [DR-11] widened the rule
 * from identity-only to every capability — so the guard must be widened with it, or
 * the rule reads as covering fifteen capabilities while the check covers one.
 *
 * Shape: within each `**Process:**` / `### Process` block of
 * `dist/agents/git.md` ∪ `dist/skills/git/references/**`, no PROBE line may appear
 * on a LATER line than a LOOP line.
 *
 * `D-CAPABILITY-PROBE-SCOPE` — which of §14.3's capabilities are probes here.
 * ------------------------------------------------------------------------------
 * §14.3 lists fifteen capabilities. Only the SESSION-SCOPED ones are probes: their
 * result does not vary per item, so hoisting them is both possible and required.
 * The per-item capabilities — fetch by key, list the comments OF ONE issue, comment,
 * edit body — are the loop's PAYLOAD. A guard that called those probes would report
 * `backlink-shipped-issues` step 1 (`gh issue view {number} --json comments`, which
 * fetches THIS issue's comments) as a violation, and the only way to satisfy it
 * would be to stop fetching the data the loop exists to fetch. They are therefore
 * named in PER_ITEM_PAYLOAD below rather than omitted silently.
 *
 * Non-vacuity: `processBlocksScanned > 0`, both marker tables asserted non-empty,
 * and TWO seeded bad fixtures — the identity probe in a loop, and a non-identity
 * probe (a per-item issue-type metadata lookup) — driven through the SAME collector
 * the live assertion uses.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { compiledSkillRefsDir } from '../../src/core/assets.js';
import { collectUnfencedLines, resolveAgentSource, walkFiles, type CorpusEntry } from '../helpers.js';

// ---------------------------------------------------------------------------
// Marker tables — NAMED lists, derived from the real corpus, never inline regexes
// ---------------------------------------------------------------------------

interface Marker {
  /** Short label used in the violation message. */
  readonly label: string;
  readonly pattern: RegExp;
  /** Why this shape is a marker — an entry without one is a grep, not a rule. */
  readonly justification: string;
}

/**
 * Lines that OPEN an iteration.
 *
 * Every pattern is anchored to the start of the line (an optional list marker
 * allowed) because the corpus states loops as instructions and states the ABSENCE
 * of loops mid-sentence. `gather-release-evidence` says "batch first, never one
 * call per commit" and then, on the NEXT line, uses `gh api graphql`: an
 * unanchored `per commit` marker would report the batch-first fix — the very thing
 * [DR-17] commit B landed — as an unhoisted probe.
 *
 * The bare word `loop` is deliberately NOT a marker for the same reason: its only
 * occurrences in this corpus are the hoist instructions themselves
 * ("before any loop", "never inside a loop", "Setup (once, before the loop)"), so
 * a marker matching it would make the rule its own first violation.
 */
export const LOOP_MARKERS: readonly Marker[] = [
  {
    label: 'for-each',
    pattern: /^[ \t]*(?:[-*][ \t]+|\d+[a-z]?\.[ \t]+)?(?:\*\*)?For (?:each|every)\b/i,
    justification:
      'The corpus states its three real fan-outs this way: git.md fetch-review-threads step 4, ' +
      'resolve-review-threads\' ≤50 reply loop, and backlink-shipped-issues\' ≤50 issue loop.',
  },
  {
    label: 'then-per-item',
    pattern: /^[ \t]*(?:[-*][ \t]+|\d+[a-z]?\.[ \t]+)?(?:\*\*)?Then,?[ \t]+per[ \t]+\w+/i,
    justification:
      'The generated backlink-shipped-issues reference opens its per-issue body with ' +
      '"Then, per issue, within the operation\'s ≤50 bound:" — the loop line the hoisted ' +
      'viewer-login Setup line sits above.',
  },
  {
    label: 'iterate-over',
    pattern: /^[ \t]*(?:[-*][ \t]+|\d+[a-z]?\.[ \t]+)?(?:\*\*)?(?:Iterate|Repeat)\b[^\n]*\b(?:over|for each)\b/i,
    justification:
      'The other phrasing an author reaches for. Present as a shape the guard must cover even ' +
      'though no current line uses it — a marker table that only covers today\'s wording stops ' +
      'working the first time someone writes the loop differently.',
  },
];

/**
 * SESSION-SCOPED capability probes — §14.3's capability column, narrowed per
 * `D-CAPABILITY-PROBE-SCOPE` above.
 */
export const PROBE_MARKERS: readonly Marker[] = [
  {
    label: 'identify-current-user',
    pattern: /gh api user\b|\bviewer\s*\.\s*login\b|--jq '\.login'/i,
    justification:
      '§14.3 marks this one "hoisted once per spawn, never inside a loop" in the matrix itself. ' +
      'The login is the same for every item, so a per-item call is N wasted calls into a rate limit.',
  },
  {
    label: 'project-and-issue-type-metadata',
    pattern: /issue[- ]type (?:map|metadata|lookup)|label\s*(?:→|->)\s*type|label-to-type/i,
    justification:
      'The label→type map (`bug→fix`, `docs→docs`, …) is a repository fact, not an item fact. ' +
      'This is [DR-11]\'s named non-identity example and the guard\'s second seeded fixture.',
  },
  {
    label: 'search',
    pattern: /gh issue list[^\n]*--search/i,
    justification:
      'A search is a query over the whole tracker; running it per item turns one call into N ' +
      'and returns the same set each time.',
  },
  {
    label: 'list-by-filter',
    pattern: /gh issue list[^\n]*--(?:label|milestone)\b/i,
    justification:
      'GAP-26\'s wave defect exactly: a per-round re-read of the wave\'s issues. The wave states ' +
      'that refresh as one `fetch-issues-batch` call per round, and ADR-005 keeps its page bound ' +
      'an API bound — which only holds while the call is made once per round.',
  },
  {
    label: 'batch-fetch',
    pattern: /gh api graphql/i,
    justification:
      'A batch query inside a per-item loop is a contradiction — the batch exists so the loop ' +
      'does not have to make the call. GAP-26 / [DR-17].',
  },
  {
    label: 'transitions',
    pattern: /\btransitions?\b[^\n]*\b(?:enumerat|available|permitted|list)\w*\b/i,
    justification:
      'Transition enumeration is a workflow fact of the project. GitHub degrades it ' +
      '(`unsupported by github`), but the structural rule is provider-independent and the ' +
      'guard must already hold when Phase 3 adds a provider that supports it.',
  },
];

/**
 * Per-item capabilities from §14.3 that are deliberately NOT probes.
 *
 * Recorded as a named list so the narrowing is visible and reviewable rather than
 * an unexplained gap between the rule's wording and the guard's reach.
 */
export const PER_ITEM_PAYLOAD: readonly string[] = [
  'fetch by key',
  'list comments with authors (for one item)',
  'add comment',
  'edit comment in place',
  'update description',
];

// ---------------------------------------------------------------------------
// Corpus and process-block extraction
// ---------------------------------------------------------------------------

function trackerCorpus(): CorpusEntry[] {
  const git = resolveAgentSource('git');
  const corpus: CorpusEntry[] = [{ path: git.path, content: git.content }];
  const refsDir = compiledSkillRefsDir();
  for (const file of walkFiles(refsDir, f => f.endsWith('.md'))) {
    corpus.push({ path: file, content: readFileSync(file, 'utf-8') });
  }
  return corpus;
}

/** Opens a process block. Both spellings ship: git.md uses one, the references the other. */
const PROCESS_OPEN = /^(?:\*\*Process:\*\*|### Process\b)/;
/** Closes it: the next heading of any level, or the operation's Output template. */
const PROCESS_CLOSE = /^(?:#{2,4} |\*\*Output:\*\*|---\s*$)/;
/**
 * `### Process` satisfies BOTH shapes — it opens its own block and closes the one
 * above it. Classified into both sets rather than by an either/or, which is what the
 * line-at-a-time scan this replaced did implicitly (it tested the opener first, then
 * scanned for a closer from the following line).
 */

export interface ProcessBlock {
  readonly file: string;
  /** 1-based line number of the block's opening line in its file. */
  readonly startLine: number;
  readonly lines: readonly string[];
}

/**
 * Named collector: every `**Process:**` / `### Process` block in a corpus.
 *
 * Both boundaries are resolved through `collectUnfencedLines` — the harness's one
 * fence scanner (PF-063) — rather than by testing each raw line. A column-0
 * `## `/`### `/`---` inside a fenced block is the literal text an operation prints,
 * not the end of its Process block: `tracker/github/manage-debt.md` already ships
 * a `## Items` inside a bash fence as the body of the successor tech-debt issue.
 * Reading it as a terminator truncates the block there, and every line below it —
 * loops and probes alike — leaves this guard's reach while the bytes stay on disk.
 * No shipped block is closed by a fenced line today, so this is armed rather than
 * hypothetical: the block count and every block's length are unchanged by the
 * rerouting (ADR-025 — nothing to reclassify, and the guard is no longer one
 * fenced heading away from going partly blind).
 */
export function collectProcessBlocks(corpus: CorpusEntry[]): ProcessBlock[] {
  const blocks: ProcessBlock[] = [];
  for (const entry of corpus) {
    const lines = entry.content.split('\n');
    const opensAt = new Set<number>();
    const closesAt = new Set<number>();
    for (const site of collectUnfencedLines(
      entry.content,
      line => PROCESS_OPEN.test(line) || PROCESS_CLOSE.test(line),
    )) {
      if (PROCESS_OPEN.test(site.text)) opensAt.add(site.line);
      if (PROCESS_CLOSE.test(site.text)) closesAt.add(site.line);
    }
    for (let i = 0; i < lines.length; i++) {
      if (!opensAt.has(i + 1)) continue;
      let end = i + 1;
      while (end < lines.length && !closesAt.has(end + 1)) end++;
      blocks.push({
        file: entry.path,
        startLine: i + 1,
        lines: lines.slice(i + 1, end),
      });
      i = end - 1;
    }
  }
  return blocks;
}

export interface HoistViolation {
  readonly file: string;
  readonly line: number;
  readonly probe: string;
  readonly afterLoop: string;
  readonly text: string;
}

/**
 * Named collector — driven by the live assertion AND by both seeded fixtures.
 *
 * A probe is a violation when a loop marker opened EARLIER IN THE SAME BLOCK.
 * "Earlier" is strictly a lower line index, so the hoisted
 * `**Setup (once, before the loop):**` line — which names the loop on the same
 * line as the probe it hoists — is correctly not a violation.
 */
export function collectCapabilityHoistViolations(blocks: ProcessBlock[]): HoistViolation[] {
  const violations: HoistViolation[] = [];
  for (const block of blocks) {
    let openedBy: string | null = null;
    for (let i = 0; i < block.lines.length; i++) {
      const line = block.lines[i];
      if (openedBy !== null) {
        for (const probe of PROBE_MARKERS) {
          if (probe.pattern.test(line)) {
            violations.push({
              file: block.file,
              line: block.startLine + 1 + i,
              probe: probe.label,
              afterLoop: openedBy,
              text: line.trim().slice(0, 110),
            });
          }
        }
      }
      if (openedBy === null) {
        const loop = LOOP_MARKERS.find(m => m.pattern.test(line));
        if (loop) openedBy = loop.label;
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

describe('capability-hoist: no capability probe runs inside a loop [DR-11]', () => {
  const blocks = collectProcessBlocks(trackerCorpus());

  it('the scan is non-vacuous: real process blocks, and both marker tables populated', () => {
    expect(
      blocks.length,
      'processBlocksScanned === 0 — the corpus is absent or the `**Process:**` / `### Process` ' +
      'opener changed spelling; the guard would pass without reading anything (PF-018)',
    ).toBeGreaterThan(0);

    // BOTH corpora must contribute, asserted by provenance rather than by a total.
    // A count alone cannot say this: git.md declares 18 operations by itself, so any
    // floor at or below 18 is met with the generated tree entirely absent — the guard
    // would then claim to scan both while scanning one (PF-018).
    const fromReferences = blocks.filter(b => b.file.includes(`${path.sep}references${path.sep}`));
    const fromAgent = blocks.filter(b => !b.file.includes(`${path.sep}references${path.sep}`));
    expect(
      fromAgent.length,
      'no process block came from dist/agents/git.md — the agent half of the corpus is missing',
    ).toBeGreaterThan(0);
    expect(
      fromReferences.length,
      'no process block came from dist/skills/git/references/ — the generated tree is absent or ' +
      'unreadable, and the guard is scanning only the agent. Run `npm run build`.',
    ).toBeGreaterThan(0);

    // 29 = 18 from git.md + 11 from the generated tree, measured on this branch.
    // Registered as `capability-hoist-block-floor`; the literal is spelled here so a
    // decrement is visible at the assertion, not only in the manifest.
    expect(
      blocks.length,
      'too few process blocks to be scanning both git.md and the generated references',
    ).toBeGreaterThanOrEqual(29);

    expect(LOOP_MARKERS.length, 'LOOP_MARKERS must be non-empty').toBeGreaterThan(0);
    expect(PROBE_MARKERS.length, 'PROBE_MARKERS must be non-empty').toBeGreaterThan(0);
    for (const m of [...LOOP_MARKERS, ...PROBE_MARKERS]) {
      expect(m.justification.length, `marker "${m.label}" must carry a justification`).toBeGreaterThan(0);
    }
    expect(
      PER_ITEM_PAYLOAD.length,
      'the deliberate narrowing must be named, not silent (D-CAPABILITY-PROBE-SCOPE)',
    ).toBeGreaterThan(0);
  });

  it('the loop markers actually match the corpus (a table that matches nothing forbids nothing)', () => {
    const matched = new Set<string>();
    for (const block of blocks) {
      for (const line of block.lines) {
        const loop = LOOP_MARKERS.find(m => m.pattern.test(line));
        if (loop) matched.add(loop.label);
      }
    }
    // Two of the three shapes are live in the shipped corpus; `iterate-over` is
    // carried for coverage and is asserted by the seeded fixtures instead.
    expect(
      [...matched].sort(),
      'no loop line was recognised anywhere — the ≤50 fan-outs are stated differently now and ' +
      'the guard has silently stopped covering them',
    ).toEqual(['for-each', 'then-per-item']);
  });

  it('no capability probe appears after a loop line in any process block', () => {
    const violations = collectCapabilityHoistViolations(blocks);
    expect(
      violations.map(v => `${path.basename(v.file)}:${v.line} ${v.probe} after ${v.afterLoop} — ${v.text}`),
      'a session-scoped capability probe runs inside a loop. Hoist it above the loop and pass ' +
      'the resolved value down — the preamble requires exactly that, and a per-item probe is N ' +
      'identical calls into the provider\'s rate limit.',
    ).toEqual([]);
  });

  it('known-bad probe 1: an identity probe inside the loop is reported by the same collector', () => {
    const seeded: CorpusEntry[] = [
      {
        path: 'seed/identity-probe.md',
        content: [
          '## Operation: seeded-backlink',
          '',
          '### Process',
          '',
          'For each issue number in `SHIPPED_ISSUES` (sequentially, ≤50):',
          '',
          "1. Fetch viewer login: `gh api user --jq '.login'` → store as VIEWER_LOGIN",
          '2. Post the shipped marker.',
          '',
        ].join('\n'),
      },
    ];
    const violations = collectCapabilityHoistViolations(collectProcessBlocks(seeded));
    expect(violations.map(v => v.probe)).toEqual(['identify-current-user']);
  });

  it('known-bad probe 2: a per-item issue-type metadata lookup is reported by the same collector', () => {
    // [DR-11]'s point: the old identity-only regex would have passed this one.
    const seeded: CorpusEntry[] = [
      {
        path: 'seed/metadata-probe.md',
        content: [
          '## Operation: seeded-setup-task',
          '',
          '**Process:**',
          'Iterate over every ticket in the wave:',
          '   - Resolve the branch type through the label→type map for this ticket.',
          '',
          '**Output:**',
          '',
        ].join('\n'),
      },
    ];
    const violations = collectCapabilityHoistViolations(collectProcessBlocks(seeded));
    expect(violations.map(v => v.probe)).toEqual(['project-and-issue-type-metadata']);
    expect(violations.map(v => v.afterLoop), 'the third loop shape must be the one that opened it')
      .toEqual(['iterate-over']);
  });

  it('known-bad probe 3: the same probe ABOVE the loop is not a violation', () => {
    // Without this arm the collector could report every probe line and still pass
    // the two fixtures above — the hoisted form is what the rule permits.
    const seeded: CorpusEntry[] = [
      {
        path: 'seed/hoisted.md',
        content: [
          '## Operation: seeded-hoisted',
          '',
          '### Process',
          '',
          "**Setup (once, before the loop):** Fetch viewer login: `gh api user --jq '.login'`",
          '',
          'Then, per issue, within the operation\'s ≤50 bound:',
          '',
          '1. Post the shipped marker.',
          '',
        ].join('\n'),
      },
    ];
    expect(collectCapabilityHoistViolations(collectProcessBlocks(seeded))).toEqual([]);
  });

  it('known-bad probe 4: a fenced `## ` does not close a process block; the same line unfenced does', () => {
    // The block boundary is structural, not textual (PF-063). `manage-debt` composes a
    // successor issue body containing a column-0 `## Items` inside a bash fence; when that
    // line ends the block, every loop and probe BELOW it silently leaves the guard's reach.
    // Both arms drive the same two collectors the live assertion uses.
    const seeded = (fenced: boolean): CorpusEntry[] => [
      {
        path: 'seed/fenced-close.md',
        content: [
          '## Operation: seeded-fenced-close',
          '',
          '### Process',
          '',
          '1. Compose the successor issue body:',
          '',
          ...(fenced ? ['```bash'] : []),
          '## Items',
          ...(fenced ? ['```'] : []),
          '',
          'For each issue number in `SHIPPED_ISSUES` (sequentially, ≤50):',
          '',
          "2. Fetch viewer login: `gh api user --jq '.login'` → store as VIEWER_LOGIN",
          '',
        ].join('\n'),
      },
    ];

    expect(
      collectCapabilityHoistViolations(collectProcessBlocks(seeded(true))).map(v => v.probe),
      'the fenced `## Items` is the successor issue\'s own body — the Process block runs past it, ' +
      'and the unhoisted identity probe below the loop is a violation the guard must still see',
    ).toEqual(['identify-current-user']);
    expect(
      collectCapabilityHoistViolations(collectProcessBlocks(seeded(false))),
      'UNFENCED, the same line is a heading: the block ends there, the loop and the probe belong ' +
      'to a different section, and there is nothing to report. A collector blind to fences ' +
      'cannot tell these two corpora apart',
    ).toEqual([]);
  });
});
