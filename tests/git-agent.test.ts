/**
 * Static content guards for the Git agent.
 *
 * Pin the Git agent's safety-critical literals so silent edits fail loud (PF-018).
 * The agent is read through resolveAgentSource, which is dist-preferred: since
 * Phase 1 that means the compiled dist/agents/git.md, the artifact that ships.
 *
 * Guard 6 in registry-integrity.test.ts performs forward/reverse OPERATION-name
 * checking between compiled commands and git.md (build-gated). These guards cover
 * what Guard 6 does not: the specific traceability operations that must exist,
 * load-bearing numeric bounds, the D9 resolution gate, D4 rate-limit backpressure
 * clauses, and dedup marker formats.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import { skillsDir, rulesDir, commandsDir, compiledSkillRefsDir } from '../src/core/assets.js';
import { getAllAgentNames } from '../src/core/plugins.js';
import {
  TRACKER_GITHUB_OPS,
  GIT_CROSS_CUTTING_DOCS,
  VARIANT_MODULES,
} from '../src/core/mds-variants.js';
import { ROOT, resolveAgentSource, resolveAllAgents, gitAgentSinkCorpus, extractOpSectionFromCorpus, collectUnfencedH2, loadFile, requireDistFile, walkFiles, type CorpusEntry } from './helpers.js';

/**
 * How many corpus files declare a `## Operation:` section for a TRACKER op:
 * git.md itself, plus one generated mechanics file per registered provider.
 *
 * Derived from the registry rather than typed, because the number moves with a
 * provider and not with anything a reader of this file would think to check. A
 * literal here was correct while GitHub was the only provider and became wrong
 * the moment a second one registered — with a message ("expected exactly 2")
 * that reads as a regression in the extractor rather than as a new provider.
 */
const TRACKER_OP_DECLARING_FILES =
  1 + VARIANT_MODULES.filter(mod => mod.subdir.startsWith('tracker/')).length;

// Dist-preferred resolver — Phase 1 needs zero test edits here when git.md → git.mds
const GIT_AGENT_SOURCE = resolveAgentSource('git');
const GIT_AGENT_PATH = GIT_AGENT_SOURCE.path;

/**
 * Extract the content of a named operation section from a corpus.
 * Thin wrapper around extractOpSectionFromCorpus — kept so callers stay readable.
 * Use mode: 'sole' for single-authority lookups (seam test forward direction),
 * mode: 'union' for sink-class guards (D11 forward/reverse).
 */
function extractOpSection(corpus: CorpusEntry[], opName: string, mode: 'union' | 'sole'): string {
  return extractOpSectionFromCorpus(corpus, opName, { mode }).content;
}

// ── Corpus memos ────────────────────────────────────────────────────────────
//
// `gitAgentSinkCorpus()` and `inlineBodyCorpus()` are pure functions of the
// on-disk tree, and no guard in this file writes to that tree — so within a run
// every call re-reads bytes that cannot have changed. Unmemoised they were built
// 18× and 2× respectively, and the second one re-walks `skills/`, `dist/commands/`
// and `rules/` on top of the sink corpus each time: ~700 redundant synchronous
// reads for one file's worth of guards.
//
// The memo is at MODULE scope on purpose, not inside a `describe`: the fence-aware
// collectors read the corpus from several different blocks, and a per-block memo
// would just multiply the builds it was added to remove. The builders themselves
// live in `tests/helpers.ts` and stay unmemoised there — other test files run in
// their own worker and may want a fresh read (and both take an injectable `root`,
// which a shared cache inside the helper would quietly ignore).
//
// Both accessors hand back the cached value itself. Every reader here is read-only
// — `.map`, `.filter`, `for…of`, a spread into a fresh array — and a reader that
// needs to mutate must copy first, as with any shared fixture.

let sinkCorpusMemo: CorpusEntry[] | undefined;

/** `gitAgentSinkCorpus()`, built once per module. */
function cachedSinkCorpus(): CorpusEntry[] {
  return (sinkCorpusMemo ??= gitAgentSinkCorpus());
}

// ── Inline-body (D11 bypass) scan ───────────────────────────────────────────
//
// A single-line, `--(body|notes)`-only regex reads a shell recipe the way a
// human skims it, not the way a shell parses it: a backslash-continued
// `gh issue create \` … `--body "…"` is ONE command spread over five lines, and
// a body attached to `gh issue close --comment` is a posted body like any other.
// Both escaped the old pattern entirely (#341), so an empty exclusion list meant
// "no offender the regex could see", never "no offender".
//
// Two changes make the scan see the corpus as the shell does:
//   (a) joinContinuations() folds every `\`-newline into a space BEFORE matching,
//       so the unit matched is the command, not the source line;
//   (b) INLINE_BODY_SHAPES names each posting form separately, so an offender
//       reports WHICH shape caught it and a probe can prove each arm live on its
//       own (PF-018/PF-064 — an unnamed alternation inside one regex cannot say
//       which branch carried the match).

/**
 * Fold shell line-continuations so one command is one string.
 *
 * `\`-newline-indent → a single space: exactly what the shell does before it
 * parses words, and the only reason a `--body` five lines below its `gh` verb is
 * reachable by a single-line pattern at all.
 */
function joinContinuations(text: string): string {
  return text.replace(/\\\n[ \t]*/g, ' ');
}

/**
 * Bounds a match to ONE command: no backtick (a Markdown code span ends the
 * shell context), no newline, and none of `|`, `;`, `&` (a pipe or a chain
 * starts a new command). Without the last three, `gh pr diff … | grep -n` reads
 * as a `gh` invocation carrying a `-n` flag.
 *
 * The three are excluded unconditionally — this class carries no quoting state, so it
 * cuts inside a quoted argument too. What that costs is the last NOT COVERED bullet on
 * `INLINE_BODY_SHAPES` below.
 */
const IN_COMMAND = '[^`\\n|;&]*';

interface InlineBodyShape {
  /** Reported on every offender, so a failure names the form, not just the text. */
  readonly name: string;
  readonly re: RegExp;
}

/**
 * The posting forms that reach a tracker with a body devflow composed.
 *
 * Every entry is a SINK shape (something is published) or a BYPASS shape (a file
 * ref that is not the scrubber's output). The two `unscrubbed-*` entries are
 * strict: only the quoted scrubber variable passes, because `--body-file $X` with
 * any other value posts a file the scrubber never wrote.
 *
 * NOT COVERED, deliberately (PF-064 — an empty offender list proves the WEAKEST of
 * the claims it stacks, so the matcher's edge has to be written down rather than
 * inferred from a green run). `gh` accepts several spellings this table does not
 * read as sinks, each verified absent from the whole scanned corpus at the time it
 * was written:
 *   - the `=` spellings — `--body=…`, `--body-file=…`, `--notes-file=…` (the shapes
 *     require a space or a quote after the flag);
 *   - a quoted API field — `-f 'body=…'`, `-F "body=@…"` (the shapes expect the
 *     `body=` token unquoted);
 *   - `gh api --input file.json`, which posts a whole JSON payload rather than a
 *     named `body` field;
 *   - provider-composed notes — `--generate-notes`, `--notes-from-tag` — which
 *     publish text GitHub wrote, not a body devflow composed, so the scrub has no
 *     input to run on;
 *   - a body flag sitting behind a QUOTED `&`, `|` or `;`. `IN_COMMAND` above excludes
 *     those three characters with no quoting state, so it cuts inside a quoted argument
 *     as readily as between two commands: `gh issue create --title "A & B" --body "x"`
 *     ends at the `&` and matches no shape at all. The remedy is not another row but a
 *     quote-aware bound — one that tracks open quotes across a folded continuation —
 *     and no title, label or notes string in the corpus needs one. False-NEGATIVE
 *     direction: a body posted that way is NOT reported, and this bullet is all that
 *     stands between that and a silent bypass.
 * Each is a non-goal only while nothing ships it. The moment a recipe adopts one,
 * it is a real bypass: add the shape here WITH its own row in the shape-table probe
 * below, in the same commit as the recipe (ADR-025) — never a silent alternation.
 */
const INLINE_BODY_SHAPES: readonly InlineBodyShape[] = [
  // `gh pr create … --body "…"`, `gh issue close … --comment "…"`,
  // `gh release create … --notes "…"`. `[ "]` after the flag keeps `--body-file`
  // and `--notes-file` (hyphen) out.
  {
    name: 'long-flag',
    re: new RegExp(`gh (?:pr|issue|release) [a-z-]+${IN_COMMAND}--(?:body|notes|comment)[ "]`, 'g'),
  },
  // The short spellings of the same three flags. Verb-restricted to the
  // body-carrying subcommands so `gh pr checkout 123 -b my-branch` — where `-b`
  // names a branch, not a body — is not read as a sink.
  {
    name: 'short-flag',
    re: new RegExp(
      `gh (?:pr|issue|release) (?:create|comment|review|close|reopen|edit)\\b${IN_COMMAND}-[bnc] `,
      'g',
    ),
  },
  // `gh api … -f body=…` — the REST form. `-F body=@…` is the file-ref form and
  // is judged by `unscrubbed-api-file` instead, so `@` is excluded here.
  { name: 'api-field', re: /(?:^|[ \t])(?:-f|-F|--field|--raw-field) body=(?!@)/gm },
  // A file ref that is not the scrubber's output. The trailing `[^\s`]` means a
  // prose mention (`--body-file` inside a code span, followed by a backtick) is
  // never a match — only a flag with a real argument is.
  { name: 'unscrubbed-file', re: /--(?:body-file|notes-file) (?!"\$DEVFLOW_(?:BODY|NOTES)")[^\s`]/g },
  { name: 'unscrubbed-api-file', re: /-F body=@(?!"\$DEVFLOW_BODY")[^\s`]/g },
];

/**
 * Declared inline-body exceptions in the hand-authored `references/github-api.md`,
 * each frozen by the exact text an `INLINE_BODY_SHAPES` entry matches. See
 * D-INLINE-BODY-EXCLUSIONS at the guard's call site.
 *
 * The list is EMPTY: every recipe in that file composes its body to
 * `$DEVFLOW_BODY_RAW`, scrubs it, and posts the scrubbed `$DEVFLOW_BODY` through
 * `--body-file` / `-F body=@`. It stays here because it is the only way to declare
 * an exception, and because both arms below are asserted over it — an offender no
 * entry names is red, and an entry that matches nothing is red. A new exception
 * therefore has to be written down, with the text it excuses, to exist at all.
 */
const KNOWN_GITHUB_API_INLINE_BODIES: readonly string[] = [];

interface InlineBodyOffender {
  readonly file: string;
  /** Which INLINE_BODY_SHAPES entry caught it. */
  readonly shape: string;
  readonly match: string;
}

/** Every shape that fires on a text, after continuations are folded. */
function matchInlineBodyShapes(text: string): { shape: string; match: string }[] {
  const joined = joinContinuations(text);
  const hits: { shape: string; match: string }[] = [];
  for (const shape of INLINE_BODY_SHAPES) {
    for (const match of joined.match(shape.re) ?? []) {
      hits.push({ shape: shape.name, match });
    }
  }
  return hits;
}

/**
 * Named collector (forward arm): offenders that no entry in `known` accounts for.
 *
 * Parameterised on both inputs so the known-bad probe drives the SAME predicate
 * the live assertion does (PF-018).
 */
function collectUndeclaredOffenders(
  offenders: readonly InlineBodyOffender[],
  known: readonly string[],
): string[] {
  return offenders
    .filter(o => !(o.file.endsWith('github-api.md') && known.includes(o.match)))
    .map(o => `${o.file}: ${o.match}`);
}

/** Named collector (reverse arm): entries of `known` that no offender matches. */
function collectStaleExclusions(
  offenders: readonly InlineBodyOffender[],
  known: readonly string[],
): string[] {
  const seen = new Set(offenders.map(o => o.match));
  return known.filter(entry => !seen.has(entry));
}

/**
 * Named collector: every inline-body form in a corpus.
 *
 * Parameterised on the corpus so the live assertion, the shape probe and the
 * baseline known-bad probe all drive the SAME predicate (PF-018) — the baseline
 * probe in particular needs a second, permanently-known-bad corpus to run it over.
 */
function collectInlineBodyOffenders(corpus: readonly CorpusEntry[]): InlineBodyOffender[] {
  const offenders: InlineBodyOffender[] = [];
  for (const entry of corpus) {
    for (const hit of matchInlineBodyShapes(entry.content)) {
      offenders.push({ file: entry.path, shape: hit.shape, match: hit.match });
    }
  }
  return offenders;
}

interface InlineBodyCorpus {
  readonly corpus: CorpusEntry[];
  /** Agents contributed, for provenance. */
  readonly agents: number;
  /** Generated skill references contributed, for provenance. */
  readonly generated: number;
}

/**
 * The whole installed prompt surface — every file a devflow session can put in
 * front of a model that could teach it to post a body.
 *
 * Scope is the fix #341 asks for: the old scope (git.md ∪ the generated
 * references ∪ skills/git/**) made the Git agent's own neighbourhood the only
 * policed one, and a `gh api … -f body=` recipe in the review-methodology skill
 * was a second publication path outside both the D10 gate and the D11 scrub with
 * nothing looking at it. Agents, commands and rules ship the same way skills do,
 * so they are scanned the same way.
 *
 * Deduped by path — skills/git/** arrives twice (once here, once inside
 * gitAgentSinkCorpus) and a doubled file would double every offender.
 */
function inlineBodyCorpus(): InlineBodyCorpus {
  const byPath = new Map<string, CorpusEntry>();
  const add = (filePath: string, content: string): void => {
    if (!byPath.has(filePath)) byPath.set(filePath, { path: filePath, content });
  };

  const agentSources = resolveAllAgents();
  for (const source of agentSources.values()) add(source.path, source.content);

  const refsRoot = compiledSkillRefsDir();
  let generated = 0;
  for (const entry of cachedSinkCorpus()) {
    if (entry.path.startsWith(refsRoot)) generated++;
    add(entry.path, entry.content);
  }

  for (const file of walkFiles(skillsDir(), f => f.endsWith('.md'))) {
    add(file, readFileSync(file, 'utf-8'));
  }
  for (const file of walkFiles(commandsDir(), f => f.endsWith('.md'), 1)) {
    add(file, readFileSync(file, 'utf-8'));
  }
  for (const file of walkFiles(rulesDir(), f => f.endsWith('.md'), 1)) {
    add(file, readFileSync(file, 'utf-8'));
  }

  return { corpus: [...byPath.values()], agents: agentSources.size, generated };
}

let inlineBodyCorpusMemo: InlineBodyCorpus | undefined;

/** `inlineBodyCorpus()`, built once per module — see the corpus-memo note above. */
function cachedInlineBodyCorpus(): InlineBodyCorpus {
  return (inlineBodyCorpusMemo ??= inlineBodyCorpus());
}

/**
 * The hand-authored reference both exception arms are about, spelled through the
 * same source-tree accessor `collectInlineBodyOffenders` reads it with.
 *
 * The probes below seed offenders at this path so a seed carries the path shape the
 * live collector actually produces — a relative stand-in would exercise the
 * `endsWith` check against a string the guard never sees.
 */
const GITHUB_API_MD_PATH = path.join(skillsDir(), 'git', 'references', 'github-api.md');

/**
 * A sibling reference in the same scanned corpus, spelled through the same accessor.
 *
 * The forward collector excuses a declared exception only inside github-api.md. Seeding
 * an identical match here is what drives that file-scoping half of the predicate — a
 * seed at GITHUB_API_MD_PATH alone can never distinguish it from an unscoped list.
 */
const SIBLING_REFERENCE_MD_PATH = path.join(skillsDir(), 'git', 'references', 'patterns.md');

// ── Decision-marker legend (AC-2.13 / E10) ──────────────────────────────────

/** A legend row defines a label: `| D4 | Degradation contract — … |`. */
const LEGEND_ROW_RE = /^\|\s*(D\d{1,2})\s*\|/gm;

/** A label is REFERENCED as `(D4)`, `(D2, D9)` or `per D11` in prose and tables. */
const LABEL_REFERENCE_RE = /\bD\d{1,2}\b/g;

/** Named collector: the D-labels a text DEFINES in a legend table. */
function collectLegendDefinitions(text: string): Set<string> {
  return new Set([...text.matchAll(LEGEND_ROW_RE)].map(m => m[1]));
}

/**
 * Named collector: the D-labels a text USES.
 *
 * Legend rows are stripped first — a definition is not a use, and counting it as
 * one would make every label trivially "referenced" and the set relation circular.
 */
function collectLabelReferences(text: string): Set<string> {
  const withoutLegendRows = text
    .split('\n')
    .filter(line => !/^\|\s*D\d{1,2}\s*\|/.test(line))
    .join('\n');
  return new Set(withoutLegendRows.match(LABEL_REFERENCE_RE) ?? []);
}

// ── D10 publication-gate scope collectors [DR-20] ───────────────────────────

/** Named collector: every `## Operation:` name declared in a text. */
function collectOpNames(text: string): string[] {
  return (text.match(/## Operation: (\S+)/g) ?? []).map(m => m.replace('## Operation: ', ''));
}

/** The slice of `text` belonging to one operation, ending at the next operation. */
function opSlice(text: string, op: string): string {
  const start = text.indexOf(`## Operation: ${op}`);
  if (start === -1) return '';
  const next = text.indexOf('\n## Operation: ', start + 1);
  return next === -1 ? text.slice(start) : text.slice(start, next);
}

/** Named collector: the operations whose own body names `references/<refName>`. */
function collectOpsNamingReference(text: string, refName: string): string[] {
  return collectOpNames(text).filter(op => opSlice(text, op).includes(`references/${refName}`));
}

/**
 * Named collector: every site in the corpus that carries the `gh repo view`
 * visibility probe, labelled `git.md:<op>` / `git.md:(cross-cutting)` for the
 * agent and by basename for a generated reference.
 */
function collectGhRepoViewSites(corpus: CorpusEntry[]): string[] {
  const PROBE = 'gh repo view';
  const sites: string[] = [];
  for (const entry of corpus) {
    if (entry.path === GIT_AGENT_PATH) {
      const firstOp = entry.content.indexOf('## Operation: ');
      const crossCutting = firstOp === -1 ? entry.content : entry.content.slice(0, firstOp);
      if (crossCutting.includes(PROBE)) sites.push('git.md:(cross-cutting)');
      for (const op of collectOpNames(entry.content)) {
        if (opSlice(entry.content, op).includes(PROBE)) sites.push(`git.md:${op}`);
      }
    } else if (entry.content.includes(PROBE)) {
      sites.push(path.basename(entry.path));
    }
  }
  return sites.sort();
}

// ── P2-S4 cross-cutting detector scan (GAP-03) ──────────────────────────────

interface ProviderDetector {
  /** Reported on every hit, so a failure names the shape, not just the line. */
  readonly label: string;
  readonly pattern: RegExp;
  /** Why this shape is a provider detector — a row without one is a grep, not a rule. */
  readonly justification: string;
}

/**
 * Provider-detector shapes that must not survive in always-loaded text.
 *
 * A regex table with a justification per row — the shape `LOOP_MARKERS` /
 * `PROBE_MARKERS` already use in `tests/guards/capability-hoist.test.ts`.
 *
 * Every row is WORD-BOUNDED, and that is the whole point of the table. Its
 * predecessor was three SUBSTRINGS matched with `line.includes(d)`, and `'gh '` is
 * a substring of `through `, `high `, `enough ` and `although `. Nothing in git.md
 * happens to use one of those words today, so the `toEqual([])` below was green by
 * luck rather than by the property it claims — and a generated reference already
 * ships one ("… reaches GitHub through `$DEVFLOW_BODY`"). The first time prose like
 * that lands in a cross-cutting section the guard goes red for a word that is not a
 * provider detector at all, and the next reader narrows the guard instead of reading
 * the hit (PF-064, in the false-positive direction).
 *
 * NOT COVERED, deliberately (PF-064 — the matcher's edge is written down rather than
 * inferred from a green run). Each was checked absent from BOTH the live agent's
 * cross-cutting text and the pre-split baseline at the time this table was written:
 *   - the provider's NAME in prose (`GitHub`, `github.com`). Always-loaded text may
 *     say which provider the tracker abstraction resolved to; what it may not carry
 *     is that provider's command surface or its wire signals.
 *   - the uppercase `GH` spelling, and `gh` with no following argument at end of line
 *     (`… then run gh`) — no site spells either, so a row for them would be a shape
 *     with no evidence behind it.
 * Each is a non-goal only while nothing ships it. The moment a cross-cutting line
 * adopts one, add the row here WITH its own row in the detector probe below, in the
 * same commit (ADR-025).
 */
const PROVIDER_DETECTORS: readonly ProviderDetector[] = [
  {
    label: 'gh-code-span',
    pattern: /`gh`/,
    justification:
      'The CLI named as a bare code span, the way the pre-split D4 degradation clause spelled it ' +
      '("No remote / `gh` unauthenticated / no PR → …"). It carries no argument, so the ' +
      'command-word row cannot see it — the two rows are disjoint by construction and the table ' +
      'needs both.',
  },
  {
    label: 'gh-command-word',
    pattern: /\bgh(?=[ \t])/,
    justification:
      'The CLI invoked, or named, as its own word: `gh repo view --json visibility`, the elided ' +
      '`&& gh …`, and the D1 legend row\'s "a bounded git/gh scan". The leading `\\b` is what ' +
      'separates the command word from the four English words that merely contain `gh `; the ' +
      'lookahead keeps the row to the FLAG-carrying form the substring `\'gh \'` was reaching for, ' +
      'so a code span stays the row above\'s business.',
  },
  {
    label: 'rate-limit-header',
    pattern: /\bX-RateLimit/,
    justification:
      'GitHub\'s rate-limit response headers — the D4 SIGNAL P2-S4 moved into the resolved ' +
      'provider\'s reference while the invariant stayed. Matched as a prefix so ' +
      '`X-RateLimit-Remaining` and any sibling header are both read, `\\b`-bounded so a longer ' +
      'token ending in `X` cannot open the match.',
  },
];

/**
 * Named collector: the CROSS-CUTTING slices of the agent — everything outside a
 * `## Operation:` section. That is the text every spawn loads whatever provider it
 * resolved: the D4 block, the tracker preamble, the D11 section, the operations
 * table, the marker legend, `## Principles` and `## Boundaries`.
 *
 * The section starts come from `collectUnfencedH2` rather than a raw
 * `/^## (.+)$/gm` split. A `## ` line inside an operation's fenced Output template
 * is the literal text that operation PRINTS — not a slice of always-loaded agent
 * text (PF-063). Splitting on the raw shape reported 21 "cross-cutting sections"
 * for a file that has three, because 18 of them were Output-template headings
 * lifted out of operation bodies: the exact opposite of what this docblock claims
 * to scan, and a corpus that would report an operation's own `gh` line as a
 * cross-cutting detector the moment one appeared under a fenced heading.
 */
function collectCrossCuttingSections(text: string): Array<{ label: string; body: string }> {
  const sections: Array<{ label: string; body: string }> = [];
  const starts = collectUnfencedH2(text).map(h => ({ heading: h.text.slice(3), index: h.index }));
  const firstOp = starts.findIndex(s => s.heading.startsWith('Operation: '));
  const head = firstOp === -1 ? text : text.slice(0, starts[firstOp].index);
  sections.push({ label: '(header)', body: head });
  for (let i = 0; i < starts.length; i++) {
    if (starts[i].heading.startsWith('Operation: ')) continue;
    if (starts[i].index < (firstOp === -1 ? text.length : starts[firstOp].index)) continue;
    const end = i + 1 < starts.length ? starts[i + 1].index : text.length;
    sections.push({ label: starts[i].heading, body: text.slice(starts[i].index, end) });
  }
  return sections;
}

/**
 * Named collector: `section [row]: line` sites where a provider detector appears.
 *
 * The matching row is named in the hit, for the same reason `INLINE_BODY_SHAPES`
 * reports which shape caught an offender: a table whose failures cannot say which
 * row fired cannot tell a live row from a dead one (PF-018).
 */
function collectProviderDetectors(
  sections: ReadonlyArray<{ label: string; body: string }>,
): string[] {
  const hits: string[] = [];
  for (const section of sections) {
    section.body.split('\n').forEach(line => {
      const detector = PROVIDER_DETECTORS.find(d => d.pattern.test(line));
      if (detector) {
        hits.push(`${section.label} [${detector.label}]: ${line.trim().slice(0, 90)}`);
      }
    });
  }
  return hits;
}

/**
 * KNOWN-BAD document for the cross-cutting detector probe.
 *
 * An always-loaded header that names the GitHub CLI and GitHub's own rate-limit
 * headers in its degradation clause, its comment-sink section and its boundaries —
 * the shape the contract/mechanics split had to reach zero from, and the one a
 * provider-neutral agent must never take again. The `## Operation:` section in the
 * middle carries a detector too, deliberately: it is MECHANICS, so the collectors
 * must leave it alone, and a probe with no legitimate detector in it could not say
 * so.
 *
 * Seeded rather than read off disk: the property is that the collectors recognise
 * and LOCATE these shapes, and a whole document kept on disk to carry six lines
 * goes stale the moment the real file moves on.
 */
const CROSS_CUTTING_DETECTOR_SAMPLE = [
  '# Git Agent',
  '',
  '## Degradation (D4)',
  '',
  '- No remote / `gh` unauthenticated / no PR → emit `TRACEABILITY: DEGRADED ({reason})`',
  '- Before each iteration, read `X-RateLimit-Remaining` from the last response header',
  '- Secondary limit (403/429 or `X-RateLimit-Remaining` < 10) → STOP and report THROTTLED',
  '',
  '## Comment-sink scrub (D11)',
  '',
  'Scrub the body, then `&& gh issue comment "$ISSUE" --body-file "$DEVFLOW_BODY"`.',
  '',
  '## Principles',
  '',
  '1. Every operation runs a bounded git/gh scan before it writes anything.',
  '',
  '## Operation: setup-task',
  '',
  'Resolve the issue with gh issue view "$REF" --json title,body — mechanics, not doctrine.',
  '',
  '## Boundaries',
  '',
  '- Never run gh pr merge without an explicit request.',
].join('\n');

/** git.md ∪ every generated reference, joined — mode 'union' at file scope [DR-18]. */
function joinedSinkText(): string {
  return cachedSinkCorpus().map(e => e.content).join('\n');
}

/** Read a generated reference; throws with a build hint rather than returning ''. */
function readGeneratedReference(relPath: string): string {
  const file = path.join(ROOT, 'dist', 'skills', 'git', 'references', ...relPath.split('/'));
  try {
    return readFileSync(file, 'utf-8');
  } catch {
    throw new Error(
      `dist/skills/git/references/${relPath} is absent — run \`npm run build:mds\` first\n` +
      '  (this guard reads a generated reference and cannot be skipped)',
    );
  }
}

// ── Single-authority literal scan (GAP-25) ──────────────────────────────────

/**
 * `dist/agents/git.md ∪ src/assets/skills/git/**` — the text a Git spawn preloads
 * plus every reference it can reach, which is the scope GAP-25's two literal rules
 * are stated over.
 */
function gitAuthorityCorpus(): CorpusEntry[] {
  const corpus: CorpusEntry[] = [resolveAgentSource('git')].map(s => ({
    path: s.path,
    content: s.content,
  }));
  for (const file of walkFiles(path.join(skillsDir(), 'git'), f => f.endsWith('.md'))) {
    corpus.push({ path: file, content: readFileSync(file, 'utf-8') });
  }
  return corpus;
}

/** Named collector: every occurrence of a literal in a corpus, with its file. */
function collectLiteralOccurrences(corpus: CorpusEntry[], literal: string): string[] {
  const hits: string[] = [];
  for (const entry of corpus) {
    entry.content.split('\n').forEach((line, index) => {
      if (line.includes(literal)) hits.push(`${entry.path}:${index + 1}`);
    });
  }
  return hits;
}

/**
 * KNOWN-BAD posting recipes — the corpus the D11 inline-body probe runs over.
 *
 * Eighteen command lines, byte-exact, each of which posts a body devflow composed
 * without sending it through the scrubber first. They are quoted rather than
 * synthesised: every one is a recipe devflow itself shipped before the D11 gate
 * landed, so the shapes are the ones a real author really wrote, and the probe
 * proves the collector's RECALL against them without the fix ever being un-landed
 * to show red.
 *
 * This is a probe corpus, never a specimen of anything current: the live arms read
 * `cachedInlineBodyCorpus()`, and nothing here is on disk anywhere else. Kept as
 * lines rather than as whole documents because one line is all each of them
 * contributes — a collector is proven by the shapes it must report, not by the
 * word count around them.
 */
const UNSCRUBBED_POSTING_SAMPLES: readonly string[] = [
  'gh api  -X POST  "repos/${OWNER}/${REPO}/pulls/${PR_NUMBER}/comments"  -f body="$COMMENT_BODY"  -f commit_id="$HEAD_SHA"  -f path="$FILE_PATH"  -F line=$LINE_NUMBER  -f side="RIGHT"',
  'gh issue create  --title "Bug: Login fails for SSO users"  --label "bug,priority-high"  --assignee "username"  --body "$(cat <<\'EOF\'',
  'gh issue comment $TECH_DEBT_ISSUE --body "$new_item"',
  'gh issue close $old_issue --comment "## Archived',
  'TECH_DEBT_ISSUE=$(gh issue create  --title "Tech Debt Backlog"  --label "tech-debt"  --body "Continued from #${old_issue}',
  'gh issue comment $old_issue --body "**Continued in:** #${TECH_DEBT_ISSUE}"',
  'gh release create "v${version}"  --title "v${version}"  --notes "$changelog"',
  'gh release create "v${VERSION}"  --title "v${VERSION} - ${RELEASE_TITLE}"  --notes-file CHANGELOG.md  ./dist/*.tar.gz ./dist/*.zip',
  'gh pr create --title "Add user authentication" --body "$(cat <<\'EOF\'',
  'gh pr create --draft --title "WIP: Feature X" --body "Work in progress, not ready for review"',
  'gh pr review $PR_NUMBER --approve --body "LGTM! Tested locally and all checks pass."',
  'gh pr review $PR_NUMBER --request-changes --body "$(cat <<\'EOF\'',
  'PR_NUMBER=$(gh pr create --title "..." --body "..." --json number -q \'.number\')',
  'gh api -X POST "repos/.../pulls/${PR}/comments" -f body="Comment" -f path="file.ts"',
  'gh api -X POST "repos/.../pulls/${PR}/comments" -f body="Issue" -f path="$file"',
  'gh pr create --title "WIP: Feature" --body "Not ready yet"',
  '\' -f threadId="$THREAD_ID" -f body="$REPLY_BODY"',
  'gh release create "v${VERSION}" --title "v${VERSION}" --notes "$NOTES"',
];

/** The known-bad posting recipes as a corpus the shared collectors accept. */
function unscrubbedPostingCorpus(): CorpusEntry[] {
  return UNSCRUBBED_POSTING_SAMPLES.map((content, index) => ({
    path: `known-bad/unscrubbed-posting-${index + 1}`,
    content,
  }));
}

/**
 * KNOWN-BAD rate-limit recipes — three `sleep 60` sites, byte-exact.
 *
 * Same provenance and the same job as the posting samples above: D4 says STOP the
 * fan-out and report THROTTLED, and these are the three lines that said wait
 * instead. The GAP-25 rule below is an absence assertion, so it is green over a
 * corpus the collector can no longer read; this is what keeps it honest (PF-018).
 */
const RATE_LIMIT_SLEEP_SAMPLES: readonly string[] = [
  'if [ "$REMAINING" -lt 10 ]; then sleep 60; fi',
  '        sleep 60',
  '            sleep 60',
];

/** The known-bad rate-limit recipes as a corpus the shared collectors accept. */
function rateLimitSleepCorpus(): CorpusEntry[] {
  return RATE_LIMIT_SLEEP_SAMPLES.map((content, index) => ({
    path: `known-bad/rate-limit-sleep-${index + 1}`,
    content,
  }));
}

/**
 * Collect conventions-commit placement violations from a corpus.
 *
 * Pins (PF-030, PF-058):
 *   (a) setup-task step 4b commits `.devflow/conventions.md` after branch creation — sole mode;
 *       git.md is the single authority.
 *   (b) learn-conventions contains NO `commit --only` — the commit has moved to setup-task step 4b
 *       (ADR-003: end state only; the old **Commit (non-blocking):** block must not reappear).
 *   (c) fetch-issues-batch reports `NOT_FOUND ({refs})` and strips #-prefixed refs before parsing.
 *   (d) fetch-issue strips #-prefixed refs in step 1 before the numeric/text branch.
 *
 * Two corpora, because the four arms ask two different questions (DR-18):
 *
 *   contractCorpus — git.md ALONE. Arms (a), (c) and (d) read the operation's
 *     CONTRACT (its Input/Process/Output declaration), and git.md is the single
 *     authority for that. Since Phase 2 the generated references under
 *     dist/skills/git/references/tracker/github/ also carry a `## Operation: X`
 *     anchor, so a sink-wide corpus makes every one of these lookups match twice
 *     and 'sole' throws by design — the reference is MECHANICS, not a second
 *     contract. Repointing here is the GAP-21 "guard classes move with the text"
 *     rule applied in the other direction: the text these three arms pin never
 *     moved, so their corpus must not widen.
 *
 *   sinkCorpus — git.md ∪ the generated references. Arm (b) is a NEGATIVE check
 *     ("no commit --only anywhere in learn-conventions"), and a negative check
 *     narrowed to git.md would go blind the moment the learn-conventions body
 *     moves into a reference. It stays wide on purpose.
 *
 * Missing op = violation, never a silent pass (PF-018).
 */
function collectConventionsCommitPlacementViolations(
  contractCorpus: CorpusEntry[],
  sinkCorpus: CorpusEntry[],
): string[] {
  const violations: string[] = [];

  if (contractCorpus.length === 0 || sinkCorpus.length === 0) {
    violations.push('corpus is empty — cannot verify any operation');
    return violations;
  }

  // Helper: extract a section; a missing op is a violation, not an unhandled throw.
  function getSection(
    corpus: CorpusEntry[],
    opName: string,
    mode: 'union' | 'sole',
  ): string | null {
    try {
      return extractOpSectionFromCorpus(corpus, opName, { mode }).content;
    } catch {
      violations.push(`operation '${opName}' not found in corpus — cannot verify placement`);
      return null;
    }
  }

  // ── (a) setup-task ─────────────────────────────────────────────────────────
  // sole mode: git.md is the single authority for setup-task.
  const setupTask = getSection(contractCorpus, 'setup-task', 'sole');
  if (setupTask !== null) {
    if (!setupTask.includes('commit --only -- .devflow/conventions.md')) {
      violations.push(
        'setup-task: missing "commit --only -- .devflow/conventions.md" — ' +
        'conventions commit must happen in setup-task step 4b, not inside learn-conventions (PF-030)',
      );
    }
    if (!setupTask.includes('CONVENTIONS_COMMIT: skipped (no branch)')) {
      violations.push(
        'setup-task: missing "CONVENTIONS_COMMIT: skipped (no branch)" — ' +
        'step 4b must guard against a detached/base HEAD before committing',
      );
    }
    // 4b. step must appear AFTER the git checkout -b line.
    // Scoped to this extracted section: ensure-pr-ready has its own unrelated 4b. at git.md:~113,
    // but that section is never included when extracting setup-task (sole mode).
    const lines = setupTask.split('\n');
    const checkoutIdx = lines.findIndex(l => l.includes('git checkout -b "$DEVFLOW_BRANCH"'));
    const step4bIdx = lines.findIndex(l => /^\s*4b\./.test(l));
    if (step4bIdx === -1) {
      violations.push(
        'setup-task: "4b." step is absent — conventions commit step must be present in setup-task, ' +
        'immediately after the git checkout -b step (PF-030)',
      );
    } else if (checkoutIdx === -1) {
      violations.push(
        'setup-task: "git checkout -b \\"$DEVFLOW_BRANCH\\"" line not found — ' +
        'cannot verify that 4b. appears after branch creation',
      );
    } else if (step4bIdx <= checkoutIdx) {
      violations.push(
        'setup-task: "4b." step appears at or before the git checkout -b line — ' +
        'conventions commit must happen AFTER branch creation so it lands on the feature branch',
      );
    }
  }

  // ── (b) learn-conventions ──────────────────────────────────────────────────
  // Sink-wide on purpose: this arm is a NEGATIVE check, and a negative check
  // narrowed to git.md goes blind the moment the body moves into a reference.
  const learnConventions = getSection(sinkCorpus, 'learn-conventions', 'union');
  if (learnConventions !== null && learnConventions.includes('commit --only')) {
    violations.push(
      'learn-conventions: contains "commit --only" — the conventions commit must not be inside ' +
      'learn-conventions; it belongs in setup-task step 4b so it lands on the feature branch (PF-030)',
    );
  }

  // ── (c) fetch-issues-batch ─────────────────────────────────────────────────
  // sole mode: git.md is the single authority.
  const fetchBatch = getSection(contractCorpus, 'fetch-issues-batch', 'sole');
  if (fetchBatch !== null) {
    if (!fetchBatch.includes('NOT_FOUND ({refs})')) {
      violations.push(
        'fetch-issues-batch: missing "NOT_FOUND ({refs})" — null GraphQL aliases must be reported, ' +
        'never silently dropped; the batch must never abort on a single missing ref (PF-058)',
      );
    }
    if (!fetchBatch.includes('Strip a leading `#`')) {
      violations.push(
        'fetch-issues-batch: missing "Strip a leading `#`" — #-prefixed references must be normalised ' +
        'before parsing so #42 takes the numeric path, not the search path',
      );
    }
  }

  // ── (d) fetch-issue ────────────────────────────────────────────────────────
  // sole mode: git.md is the single authority.
  const fetchIssue = getSection(contractCorpus, 'fetch-issue', 'sole');
  if (fetchIssue !== null) {
    if (!fetchIssue.includes('Strip a leading `#`')) {
      violations.push(
        'fetch-issue: missing "Strip a leading `#`" in step 1 — #-prefixed references must be ' +
        'normalised before the numeric/text branch so #42 fetches directly, not as a search term',
      );
    }
  }

  return violations;
}

describe('git agent — static content guards (PF-018)', () => {
  // Single-file corpus for operations that have exactly one authority file
  let content: string;
  let soleCorpus: CorpusEntry[];

  beforeAll(() => {
    content = GIT_AGENT_SOURCE.content;
    soleCorpus = [{ path: GIT_AGENT_PATH, content }];
  });

  // ── Guard 0: Non-vacuousness ────────────────────────────────────────────────

  it('file is non-empty', () => {
    expect(content.length, `${GIT_AGENT_PATH} is empty`).toBeGreaterThan(0);
  });

  // ── Guard 1: Required traceability operation sections exist ─────────────────
  //
  // Guard 6 in registry-integrity.test.ts cross-checks OPERATION: names in
  // compiled commands against ## Operation: headings in git.md (build-gated).
  // This guard checks the source file directly without requiring a build, and
  // asserts a specific enumerated set of traceability operations.

  const REQUIRED_OPS: readonly string[] = [
    'learn-conventions',
    'fetch-review-threads',
    'resolve-review-threads',
    'ensure-traceable-issue',
    'check-merge-readiness',
    'post-review-summary',
    'post-resolution-summary',
    'backlink-shipped-issues',
    'post-wave-report',
    'gather-release-evidence',
    'setup-task',
    'validate-branch',
    'check-ci-status',
    'manage-debt',
    'create-release',
    // Wired live from plan.mds Gate 0 (single-issue and multi-issue fetch paths) — AC-0.11
    'fetch-issue',
    'fetch-issues-batch',
  ];

  for (const op of REQUIRED_OPS) {
    it(`operation section exists: ## Operation: ${op}`, () => {
      expect(
        content,
        `git.md is missing "## Operation: ${op}" — silent removal breaks the traceability contract`,
      ).toContain(`## Operation: ${op}`);
    });
  }

  // ── Guard 2: Load-bearing numeric bounds ────────────────────────────────────

  it('post-review-summary: 60000-char comment cap is present', () => {
    const sec = extractOpSection(soleCorpus, 'post-review-summary', 'sole');
    expect(
      sec,
      'post-review-summary: missing 60000-char cap — GitHub rejects > 65536 chars; 4xx silent-skip would hide the failure',
    ).toContain('60000');
  });

  it('post-resolution-summary: 60000-char comment cap is present', () => {
    const sec = extractOpSection(soleCorpus, 'post-resolution-summary', 'sole');
    expect(
      sec,
      'post-resolution-summary: missing 60000-char cap',
    ).toContain('60000');
  });

  it('post-wave-report: 60000-char comment cap is present', () => {
    // Mode 'union' [DR-18]: P2-S6 moved this op's compose step into the generated
    // post-wave-report reference, and §14.3 classes `size_cap` as one of the two
    // genuine provider facts — so the cap travels with the mechanics and the pin
    // follows it (GAP-21). The floor literal is unchanged; only the corpus widened.
    const sec = extractOpSection(cachedSinkCorpus(), 'post-wave-report', 'union');
    expect(
      sec,
      'post-wave-report: missing 60000-char cap',
    ).toContain('60000');
  });

  it('manage-debt: 60000-char archive threshold is present (AC-0.12)', () => {
    // Union corpus: the pin follows the text when Phase 2 moves manage-debt
    // mechanics into compiled reference files under dist/skills/git/references/.
    // Floor must stay ≥ 60000 — reducing the threshold silently allows oversized
    // archives that exceed GitHub's comment limit.
    const sec = extractOpSection(cachedSinkCorpus(), 'manage-debt', 'union');
    expect(
      sec,
      'manage-debt: missing 60000-char archive threshold — must be pinned before Phase 2 moves the mechanics',
    ).toContain('60000');
  });

  it('backlink-shipped-issues: ≤50 issues processing bound is present', () => {
    const sec = extractOpSection(soleCorpus, 'backlink-shipped-issues', 'sole');
    expect(
      sec,
      'backlink-shipped-issues: missing ≤50 issues bound — unbounded posting violates D4 rate contract',
    ).toMatch(/≤50/);
  });

  it('resolve-review-threads: ≤50 threads processing bound is present', () => {
    const sec = extractOpSection(soleCorpus, 'resolve-review-threads', 'sole');
    expect(
      sec,
      'resolve-review-threads: missing ≤50 threads bound — unbounded mutation calls violate the GitHub rate contract',
    ).toMatch(/≤50/);
  });

  // AC-0.3 named these three assertions as Guard 2's pinning test for
  // fetch-issues-batch, but they were never written: the only occurrences of
  // ≤50 / TRUNCATED / "## Issues Batch" under tests/ were inside the golden
  // fixtures, which are data. The golden pins them transitively via whole-file
  // byte equality; these give the bound its own named failure instead.

  it('fetch-issues-batch: ≤50 issues processing bound is present (AC-0.3)', () => {
    const sec = extractOpSection(soleCorpus, 'fetch-issues-batch', 'sole');
    expect(
      sec,
      'fetch-issues-batch: missing 50-issue bound — an unbounded batch fetch can exhaust the GraphQL rate budget',
    ).toMatch(/at most 50|≤50|first 50/);
  });

  it('fetch-issues-batch: TRUNCATED ({n} not processed) overflow report is present (AC-0.3)', () => {
    const sec = extractOpSection(soleCorpus, 'fetch-issues-batch', 'sole');
    expect(
      sec,
      'fetch-issues-batch: missing "TRUNCATED ({n} not processed)" — without it a truncated batch ' +
      'is reported as complete and the caller plans against issues that were never fetched',
    ).toContain('TRUNCATED ({n} not processed)');
  });

  it('fetch-issues-batch: "## Issues Batch ({n} issues)" output header is present (AC-0.3)', () => {
    // Op-scoped: the header is a `## ` line inside this op's Output fence, and a
    // fenced heading is payload rather than a section boundary (PF-063), so the
    // assertion pins the header to the operation that renders it rather than to
    // the file as a whole.
    const sec = extractOpSection(soleCorpus, 'fetch-issues-batch', 'sole');
    expect(
      sec,
      'fetch-issues-batch: missing "## Issues Batch ({n} issues)" output header — plan.mds Gate 0 ' +
      'parses the batch response by this heading',
    ).toContain('## Issues Batch ({n} issues)');
  });

  it('fetch-issues-batch: issues are fetched in a single GraphQL query, not N REST calls [DR-07]', () => {
    // Mode 'union' [DR-18]: P2-S6 moved the batch query itself — the one genuinely
    // GitHub-specific step of this op — into the generated fetch-issues-batch
    // reference, so the pin follows the text (GAP-21). The literals are unchanged;
    // only the corpus widened. The op's provider-neutral contract (the `#`-strip, the
    // ≤50 bound, TRUNCATED and NOT_FOUND) stays in git.md and is still pinned in
    // 'sole' mode by the assertions above and by arm (c) of the conventions collector.
    const sec = extractOpSection(cachedSinkCorpus(), 'fetch-issues-batch', 'union');
    expect(
      sec,
      'fetch-issues-batch: missing the single-GraphQL-query mechanic — a per-issue loop reintroduces ' +
      'the N-call rate exposure the A1 rewrite removed',
    ).toContain('gh api graphql');
    expect(
      sec,
      'fetch-issues-batch: the "single" GraphQL query wording is load-bearing [DR-07]',
    ).toMatch(/\*\*single\*\* GraphQL query|single GraphQL query/);
  });

  it('fetch-review-threads: ≤2-page / 100-thread GraphQL bound is present', () => {
    const sec = extractOpSection(soleCorpus, 'fetch-review-threads', 'sole');
    expect(
      sec,
      'fetch-review-threads: missing ≤2-page / 100-thread GraphQL bound — unbounded pagination can exhaust rate limits',
    ).toMatch(/2 pages of 50|100 max|≤2 pages/);
  });

  // Guard 2's four learn-conventions bound pins read the MOVED copy.
  //
  // P2-S5 cut 1 moved this op's `**Process:**` block into the generated
  // references/learn-conventions.md, which carries its own `## Operation:
  // learn-conventions` anchor (arm (b) of the conventions collector needs that
  // anchor to keep seeing the moved body). Mode is therefore 'union' [DR-18] over
  // the sink corpus at all four sites, in the same commit that moved the text
  // (GAP-21) and with every literal unchanged. 'sole' is not available here: the
  // anchor now matches in two corpus files by design, and 'sole' throws on that.
  it('learn-conventions: branch scan bound (head -50) is present', () => {
    const sec = extractOpSection(cachedSinkCorpus(), 'learn-conventions', 'union');
    expect(
      sec,
      'learn-conventions: missing branch scan bound "head -50"',
    ).toContain('head -50');
  });

  it('learn-conventions: tag scan bound (head -20) is present', () => {
    const sec = extractOpSection(cachedSinkCorpus(), 'learn-conventions', 'union');
    expect(
      sec,
      'learn-conventions: missing tag scan bound "head -20"',
    ).toContain('head -20');
  });

  it('learn-conventions: merged-PR scan bound (--limit 30) is present', () => {
    const sec = extractOpSection(cachedSinkCorpus(), 'learn-conventions', 'union');
    expect(
      sec,
      'learn-conventions: missing merged-PR scan bound "--limit 30"',
    ).toContain('--limit 30');
  });

  it('learn-conventions: rev-list --max-count=200 integration-branch bound is present', () => {
    const sec = extractOpSection(cachedSinkCorpus(), 'learn-conventions', 'union');
    expect(
      sec,
      'learn-conventions: missing "--max-count=200" rev-list bound for integration-branch candidate scoring',
    ).toContain('--max-count=200');
  });

  // ── Guard 3: D9 resolution gate ─────────────────────────────────────────────

  it('D9: resolveReviewThread requires VERIFICATION_STATUS == PASS AND verdict FIXED AND commit_sha non-empty', () => {
    const sec = extractOpSection(soleCorpus, 'resolve-review-threads', 'sole');
    expect(
      sec,
      'D9 gate: must state "ONLY when VERIFICATION_STATUS == PASS AND verdict == FIXED AND commit_sha non-empty" — this is the single authority for thread resolution',
    ).toContain('ONLY when VERIFICATION_STATUS == PASS AND verdict == FIXED AND commit_sha non-empty');
  });

  it('D9: FALSE_POSITIVE verdict is reply-only (no resolveReviewThread)', () => {
    const sec = extractOpSection(soleCorpus, 'resolve-review-threads', 'sole');
    expect(
      sec,
      'D9 gate: FALSE_POSITIVE must be reply-only — reviewers retain control over closing their own threads',
    ).toMatch(/FALSE_POSITIVE.*reply.only/s);
  });

  it('D9: BY_DESIGN verdict is reply-only (no resolveReviewThread)', () => {
    const sec = extractOpSection(soleCorpus, 'resolve-review-threads', 'sole');
    expect(
      sec,
      'D9 gate: BY_DESIGN must be reply-only — reviewers retain control over closing their own threads',
    ).toMatch(/BY_DESIGN.*reply.only/s);
  });

  // ── Guard 4: D4 rate-limit backpressure clauses ─────────────────────────────

  it('D4: secondary rate limit triggers STOP', () => {
    expect(
      content,
      'D4: secondary rate limit must trigger STOP — "never continue into an active rate limit" is a safety invariant that protects GitHub\'s penalty window',
    ).toMatch(/[Ss]econdary rate limit.*STOP/s);
  });

  it('D4: secondary rate limit triggers THROTTLED report', () => {
    expect(
      content,
      'D4: secondary rate limit must produce a THROTTLED report — callers need the remaining-items count',
    ).toContain('THROTTLED');
  });

  // The two threshold pins follow the moved text [DR-18]. P2-S4 relocated both
  // rate-limit SIGNALS out of the always-loaded D4 block and into the resolved
  // provider's reference (GAP-03); the thresholds themselves are unchanged, so the
  // literals below are untouched and only the corpus widened — mode 'union' over
  // git.md ∪ the generated references. Scanning git.md alone would pin a number
  // that is not stated there.
  it('D4: X-RateLimit-Remaining < 10 is the full-STOP threshold', () => {
    expect(
      joinedSinkText(),
      'D4: X-RateLimit-Remaining < 10 must be the exact STOP boundary — changing this threshold silently widens the penalty window',
    ).toMatch(/X-RateLimit-Remaining[^<\n]*<\s*10/);
  });

  it('D4: X-RateLimit-Remaining < 50 is the backpressure threshold (1s → 3s delay)', () => {
    expect(
      joinedSinkText(),
      'D4: X-RateLimit-Remaining < 50 backpressure threshold must be present — raises inter-op delay from 1s to 3s; removing it silently disables backpressure',
    ).toMatch(/remaining < 50|X-RateLimit-Remaining[^<\n]*<\s*50/);
  });

  // ── Guard 4b: P2-S4 — invariants stay, detectors leave (GAP-03) ────────────
  //
  // The D4 and D11 blocks, the Decision Marker Legend, `## Principles` and
  // `## Boundaries` are CROSS-CUTTING: every Git spawn loads them whatever provider
  // it resolved. A provider DETECTOR there (`gh`, an `X-RateLimit-…` header name) is
  // a second authority on a provider fact, loaded even when that provider is not the
  // one in play — the two-authorities defect GAP-03 names. The invariants stay; the
  // detectors move into the provider references, where the resolved provider's file
  // is the single place its own signals are spelled.

  it('P2-S4: no provider detector literal survives in a cross-cutting section of git.md', () => {
    const sections = collectCrossCuttingSections(content);
    // A NAMED set, not a bare count. `toBeGreaterThan(1)` was satisfied by 21
    // "sections" of which 18 were fenced Output-template headings from inside
    // operation bodies — a count cannot tell an honest corpus from that one, and the
    // scan was simultaneously too wide (operation payload) and unable to say so. The
    // real cross-cutting text is the header — D4, the tracker preamble, D11, the
    // operations table, the marker legend all sit above the first operation — plus
    // the two shared trailers (ADR-025: the narrower corpus is reclassified here,
    // not accommodated by loosening the assertion).
    expect(
      sections.map(s => s.label),
      'the cross-cutting slices changed shape: a new always-loaded `## ` section was added, or ' +
      'one of the two shared trailers was renamed. Name it here — an unnamed section is text ' +
      'every spawn loads that nothing scans (GAP-03, PF-018)',
    ).toEqual(['(header)', 'Principles', 'Boundaries']);
    expect(
      collectProviderDetectors(sections),
      'provider detector(s) in always-loaded text. The invariant belongs here; the signal that ' +
      'triggers it belongs in the resolved provider\'s reference (GAP-03, P2-S4)',
    ).toEqual([]);
  });

  it('P2-S4 known-bad probe: a fenced `## ` is operation payload, the same heading unfenced is a section', () => {
    // Both arms drive the real collector (PF-018). The fenced arm is the shape git.md
    // actually ships — every operation closes with an Output template whose headings
    // are the text the operation prints — and the unfenced arm is the control that
    // stops "ignore every `## ` after the first operation" from passing as fence-aware.
    const body = (fenced: boolean): string => [
      '# Git Agent',
      '',
      '## Operations',
      '',
      '## Operation: seeded-op',
      '',
      '**Output:**',
      '',
      ...(fenced ? ['```markdown'] : []),
      '## Task Setup: {branch-name}',
      ...(fenced ? ['```'] : []),
      '',
      '## Principles',
      '',
      '1. Rate limit aware',
      '',
    ].join('\n');

    expect(
      collectCrossCuttingSections(body(true)).map(s => s.label),
      'a `## ` inside a fenced Output template is the literal text the operation prints; ' +
      'reading it as a cross-cutting section attributes an operation body to always-loaded text',
    ).toEqual(['(header)', 'Principles']);
    expect(
      collectCrossCuttingSections(body(false)).map(s => s.label),
      'the same heading UNFENCED is structure and must open a section — otherwise the collector ' +
      'is blind to new always-loaded text rather than fence-aware',
    ).toEqual(['(header)', 'Task Setup: {branch-name}', 'Principles']);
  });

  it('known-bad probe: a header carrying provider detectors is reported, section by section', () => {
    // The live rule above asserts an EMPTY hit list, which a collector that read no
    // sections would also satisfy. This drives the SAME pair of collectors over a
    // known-bad document: an always-loaded header, a D11 section and a Boundaries
    // section that each name `gh` or a GitHub rate-limit header — the shape the
    // contract/mechanics split had to reach zero from. The assertion is a FLOOR, not
    // an equality: the claim is that the collectors still recognise and LOCATE
    // detectors, and pinning an exact count would tie a probe about the collectors to
    // a detector table that may legitimately gain a row.
    const hits = collectProviderDetectors(collectCrossCuttingSections(CROSS_CUTTING_DETECTOR_SAMPLE));
    expect(
      hits.length,
      'the collectors must find the seeded cross-cutting detectors — otherwise the rule above ' +
      'is satisfied by a scan that recognises nothing',
    ).toBeGreaterThanOrEqual(6);
    // …located, not merely counted: a collector that returned every line of one
    // section would clear the floor while saying nothing about where a detector sits.
    expect(
      [...new Set(hits.map(hit => hit.slice(0, hit.indexOf(' ['))))].sort(),
      'detectors in more than one cross-cutting section must be reported under their own ' +
      'section labels',
    ).toEqual(['(header)', 'Boundaries']);
    // …and the operation body is NOT cross-cutting: its detector is legitimate
    // mechanics and must stay out of the hit list.
    expect(
      hits.filter(hit => hit.includes('setup-task')),
      'an operation section is mechanics, never cross-cutting text',
    ).toEqual([]);
  });

  it('known-bad probe: every detector row fires on its own shape, and `through ` on none', () => {
    // Both directions, per ROW. The RED half is the usual H10 claim — a table is only
    // as good as the shapes it can be SHOWN to express. The GREEN half is the half this
    // guard was missing: its predecessor matched three substrings, and `'gh '` sits
    // inside `through `, `high `, `enough ` and `although `, so the rule could fail on a
    // line carrying no provider detector at all and the next reader would narrow the
    // guard rather than read the hit (PF-064). Both halves drive the real collector.
    const hits = (line: string): string[] =>
      collectProviderDetectors([{ label: '(probe)', body: line }]);

    const rowProbes: ReadonlyArray<{ label: string; line: string }> = [
      {
        label: 'gh-code-span',
        line: '- No remote / `gh` unauthenticated / no PR → emit `TRACEABILITY: DEGRADED ({reason})`',
      },
      {
        label: 'gh-command-word',
        line: "3. Probe once: run gh pr view 12 --json state --jq '.state'",
      },
      {
        label: 'rate-limit-header',
        line: '- Before each iteration, read `X-RateLimit-Remaining` from the last response header',
      },
    ];
    for (const { label, line } of rowProbes) {
      expect(
        hits(line),
        `PROVIDER_DETECTORS names the row "${label}" but the collector does not fire on the shape ` +
        'it exists for — a row that cannot be shown live is a row that can be deleted unnoticed',
      ).toEqual([`(probe) [${label}]: ${line.trim().slice(0, 90)}`]);
    }

    // The opposite direction: English prose that merely CONTAINS `gh `. The first line
    // is shipped text — `tracker/github/manage-debt.md` states the D11 chain this way —
    // so the substring form was one relocation away from reporting it.
    for (const benign of [
      'Every body below reaches GitHub through `$DEVFLOW_BODY`, the file the D11 scrub wrote.',
      'A high retry rate is enough to extend the window, although the batch bound still holds.',
    ]) {
      expect(
        hits(benign),
        'a word that merely contains `gh ` is not a provider detector; reporting it sends the ' +
        'next reader to narrow the guard instead of to read the hit (PF-064)',
      ).toEqual([]);
    }
  });

  it('P2-S4: each moved detector has exactly one home in the GitHub provider tree', () => {
    const providerFiles = walkFiles(
      path.join(ROOT, 'dist', 'skills', 'git', 'references', 'tracker'),
      f => f.endsWith('.md'),
    );
    expect(providerFiles.length, 'no provider reference was read').toBeGreaterThan(0);
    for (const detector of ['X-RateLimit-Remaining` header < 10', 'X-RateLimit-Remaining` < 50']) {
      const homes = providerFiles.filter(f => readFileSync(f, 'utf-8').includes(detector));
      expect(
        homes.map(f => path.basename(f)),
        `the detector ${JSON.stringify(detector)} must be stated exactly once per provider — ` +
        'a second copy is a second authority on that provider\'s rate-limit signal (PF-023)',
      ).toHaveLength(1);
    }
  });

  it('P2-S4: the D4 and D11 INVARIANTS stay in the always-loaded agent', () => {
    // The other half of the split: nothing that decides whether to stop, or whether a
    // body may be posted, may become a file the spawn might not have (PF-027).
    for (const invariant of [
      'STOP the current fan-out operation immediately',
      'THROTTLED ({n} not processed)',
      'DO NOT POST',
      'TRACEABILITY: DEGRADED (redaction unavailable)',
      'never pipelines',
      '**Always post `$DEVFLOW_BODY` (scrubbed), never `$DEVFLOW_BODY_RAW`.**',
      'DEVFLOW_BODY_RAW="$(mktemp)"',
      'redact-secrets.cjs',
    ]) {
      expect(content, `P2-S4: the invariant ${JSON.stringify(invariant)} must stay in git.md`)
        .toContain(invariant);
    }
  });

  // ── Guard 5: Dedup marker formats ───────────────────────────────────────────

  it('review-summary dedup marker uses cycle:{N} ts: pair form', () => {
    const sec = extractOpSection(soleCorpus, 'post-review-summary', 'sole');
    expect(
      sec,
      'review-summary dedup: missing "devflow:review-summary cycle:{N} ts:" marker pair — changing either token breaks idempotency for existing comments',
    ).toMatch(/devflow:review-summary cycle:[^ ]+ ts:/);
  });

  it('resolution-summary dedup marker uses ts: form', () => {
    const sec = extractOpSection(soleCorpus, 'post-resolution-summary', 'sole');
    expect(
      sec,
      'resolution-summary dedup: missing "devflow:resolution-summary ts:" marker — changing this format breaks idempotency for existing comments',
    ).toContain('devflow:resolution-summary ts:');
  });

  // ── Guard 6: D10 publication visibility gate ─────────────────────────────

  it('D10: ## Publication gate (D10) section exists', () => {
    // Follows the corpus [DR-18]: P2-S5 cut 2 moved the section into
    // references/publication-gate.md, which the two summary ops name. The section
    // must still EXIST somewhere a spawn can reach — that is what this pins; where
    // it may be loaded FROM is [DR-20](i) below.
    const joined = cachedSinkCorpus().map(e => e.content).join('\n');
    expect(
      joined,
      'git.md ∪ the generated references is missing the "## Publication gate (D10)" section — ' +
      'silent removal breaks the visibility-gated posting contract',
    ).toContain('## Publication gate (D10)');
  });

  it('D10: gh repo view --json visibility probe command is present', () => {
    expect(
      content,
      'D10: missing "gh repo view --json visibility" — the visibility probe is the sole mechanism for determining FULL vs STUB mode',
    ).toContain('gh repo view --json visibility');
  });

  it('D10: PRIVATE, INTERNAL, and PUBLIC visibility values are all named in the gate logic', () => {
    // All three canonical GitHub visibility values must appear; removing one silently disables a gate branch
    expect(content, 'D10: PRIVATE not documented').toContain('PRIVATE');
    expect(content, 'D10: INTERNAL not documented').toContain('INTERNAL');
    expect(content, 'D10: PUBLIC not documented').toContain('PUBLIC');
  });

  it('D10: fail-closed rule "treat as PUBLIC" is present', () => {
    expect(
      content,
      'D10: missing "treat as PUBLIC" fail-closed rule — any probe error must default to STUB (not FULL)',
    ).toContain('treat as PUBLIC');
  });

  it('D10: stub-withheld sentence is present', () => {
    expect(
      content,
      'D10: missing "Full summary withheld (public repository)." — changing this line alters the stub template seen by PR reviewers',
    ).toContain('Full summary withheld (public repository).');
  });

  it('D10: review-summary dedup marker appears ≥2× in post-review-summary (full mode + stub template)', () => {
    const sec = extractOpSection(soleCorpus, 'post-review-summary', 'sole');
    const matches = sec.match(/devflow:review-summary cycle:/g);
    expect(
      matches,
      'post-review-summary: "devflow:review-summary cycle:" must appear ≥2 times (full body + stub template)',
    ).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('D10: resolution-summary dedup marker appears ≥2× in post-resolution-summary (full mode + stub template)', () => {
    const sec = extractOpSection(soleCorpus, 'post-resolution-summary', 'sole');
    const matches = sec.match(/devflow:resolution-summary ts:/g);
    expect(
      matches,
      'post-resolution-summary: "devflow:resolution-summary ts:" must appear ≥2 times (full body + stub template)',
    ).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('D10: REVIEW_PUBLICATION is documented with all three values: auto, full, off', () => {
    // RE-POINTED, not weakened (applies ADR-025). The three-value enumeration used to
    // be spelled in BOTH summary op sections AND, byte-identically, in
    // references/publication-gate.md — three copies of one enum, each free to drift.
    // The reference is the authority both ops name (the [DR-20](i) arm below proves
    // exactly those two name it), so the enum is asserted THERE and the op sections
    // are asserted to still route the input into it.
    //
    // What deliberately did NOT move: the fail-closed visibility probe. That is a
    // containment control, so it stays spelled inline in both ops (PF-058) and the
    // [DR-20](ii) arm below is what holds it there.
    const gate = readGeneratedReference('publication-gate.md');
    expect(gate, 'D10: `off` → SKIPPED resolution step not present').toContain('`off` → report');
    expect(gate, 'D10: `full` → mode FULL resolution step not present').toContain('`full` → mode FULL, skip probe');
    expect(gate, 'D10: `auto` → probe resolution step not present').toContain('`auto` or absent/unrecognised → probe');

    for (const op of ['post-review-summary', 'post-resolution-summary']) {
      const sec = extractOpSection(soleCorpus, op, 'sole');
      expect(sec, `D10: REVIEW_PUBLICATION not documented in ${op}`).toContain('REVIEW_PUBLICATION');
      expect(
        sec,
        `D10: ${op} must name references/publication-gate.md — an op that resolves ` +
        'REVIEW_PUBLICATION without naming the gate has no route to the three values',
      ).toContain('references/publication-gate.md');
    }
  });

  it('D10: publication output enum line is present in git.md', () => {
    expect(
      content,
      'D10: missing publication output enum line — removing it breaks the caller\'s ability to parse publication status',
    ).toContain('**Publication**: FULL (private repo) | FULL (config override) | STUB (public repository) | OFF (publication disabled by config)');
  });

  // ── [DR-20] the D10 scope guard's successor pair ───────────────────────────
  //
  // P2-S5 cut 2 moved `## Publication gate (D10)` into references/publication-gate.md.
  // The old negative-scope `it` asked "which git.md op sections contain `gh repo
  // view`" — recomputing that over the joined corpus would only establish that the
  // literal EXISTS somewhere, and the scope property (CONTEXT-PACK B3: the probe is
  // allowed in the two summary ops and nowhere else) would evaporate. The successor
  // is two assertions, both non-vacuous, and they REPLACE one `it` with three, so
  // AC-2.6's guard count rises rather than falls.
  //
  // Deviation recorded: [DR-20](ii) is written as "only in that file AND the two ops
  // it is named from". SG-8 forbids moving post-review-summary / post-resolution-
  // summary mechanics, so their step-3 probe lines stay in git.md by rule; asserting
  // the literal appears in publication-gate.md ALONE would demand a move the phase
  // prohibits. The set below is therefore the original scope property plus the file
  // the section moved to — strictly stronger than "the literal exists".

  it('D10 [DR-20](i): references/publication-gate.md is named from EXACTLY the two summary ops', () => {
    const opNames = collectOpNames(content);
    expect(
      opNames.length,
      `corpus is only ${opNames.length} ops — expected > 2 for a non-vacuous scope check (PF-018)`,
    ).toBeGreaterThan(2);
    expect(
      collectOpsNamingReference(content, 'publication-gate.md').sort(),
      'D10 scope violation: the publication gate must be loaded by the two summary ops and by ' +
      'no other operation — any other op naming it is an op that probes repo visibility',
    ).toEqual(['post-resolution-summary', 'post-review-summary']);
  });

  it('D10 [DR-20](i) known-bad probe: a seeded third op naming the gate is detected', () => {
    const seeded =
      `${content}\n## Operation: post-fake-summary\n\nSee \`references/publication-gate.md\`.\n`;
    expect(
      collectOpsNamingReference(seeded, 'publication-gate.md').sort(),
      'the collector must see a third naming op — otherwise the exact-set assertion is inert',
    ).toEqual(['post-fake-summary', 'post-resolution-summary', 'post-review-summary']);
  });

  it('D10 [DR-20](ii): `gh repo view` appears only in publication-gate.md and the two ops that name it', () => {
    expect(
      collectGhRepoViewSites(cachedSinkCorpus()),
      'D10 scope violation: the visibility probe escaped the publication gate and the two summary ' +
      'operations — every other site is an op deciding publication for itself',
    ).toEqual(['git.md:post-resolution-summary', 'git.md:post-review-summary', 'publication-gate.md']);
  });

  it('D10 [DR-20](ii) known-bad probe: a seeded fourth probe site is reported by the same collector', () => {
    const seeded: CorpusEntry[] = [
      ...cachedSinkCorpus(),
      { path: '/synthetic/tracker/github/setup-task.md', content: "gh repo view --json visibility\n" },
    ];
    expect(
      collectGhRepoViewSites(seeded),
      'the collector must see a probe site outside the allowed set — otherwise (ii) is inert',
    ).toContain('setup-task.md');
  });

  // ── Guard 7: D11 comment-sink scrub ─────────────────────────────────────

  it('D11: ## Comment-sink scrub (D11) section exists', () => {
    expect(
      content,
      'git.md is missing "## Comment-sink scrub (D11)" section — silent removal disables unconditional secret redaction',
    ).toContain('## Comment-sink scrub (D11)');
  });

  it('D11: redact-secrets.cjs script path with DEVFLOW_DIR prefix is present', () => {
    expect(content, 'D11: redact-secrets.cjs not referenced').toContain('redact-secrets.cjs');
    expect(
      content,
      'D11: ${DEVFLOW_DIR:-$HOME/.devflow}/scripts/ prefix not present — changing the install path silently breaks the scrubber invocation',
    ).toContain('${DEVFLOW_DIR:-$HOME/.devflow}/scripts/');
  });

  it('D11: DO NOT POST and TRACEABILITY: DEGRADED (redaction unavailable) are present', () => {
    expect(content, 'D11: "DO NOT POST" directive missing').toContain('DO NOT POST');
    expect(
      content,
      'D11: "TRACEABILITY: DEGRADED (redaction unavailable)" missing — callers need this exact string to detect scrubber failure',
    ).toContain('TRACEABILITY: DEGRADED (redaction unavailable)');
  });

  it('D11: no-pipeline clause is present (&&-chain discipline, never pipelines)', () => {
    // A pipeline swallows scrubber crashes (fail-open); the &&-chain is the fail-closed mechanism
    expect(
      content,
      'D11: "never pipelines" discipline clause missing — without it, pipeline exits mask scrubber failures',
    ).toContain('never pipelines');
  });

  it('D11: every posting op (--body-file or -F body=@) references D11 (forward guard, ≥8 ops)', () => {
    // Non-vacuous: assert ≥ 8 posting ops exist AND each one references D11 (PF-018)
    // Sink corpus = git.md ∪ dist/skills/git/references/*.md (ENOENT-tolerant on dist).
    // Mode 'union' — a posting op's D11 reference may live in a moved mechanics file
    // (Phase 2+); unioning ensures the floor never silently drops below 8 [DR-18, AC-0.8].
    const sinkCorpus = cachedSinkCorpus();
    const opNames = (content.match(/## Operation: (\S+)/g) ?? []).map(m => m.replace('## Operation: ', ''));

    const postingOps: string[] = [];
    const postingOpsWithoutD11: string[] = [];

    for (const op of opNames) {
      const sec = extractOpSection(sinkCorpus, op, 'union');
      if (sec.includes('--body-file') || sec.includes('-F body=@')) {
        postingOps.push(op);
        if (!sec.includes('Comment-sink scrub (D11)')) postingOpsWithoutD11.push(op);
      }
    }

    expect(
      postingOps.length,
      `D11 forward guard: expected ≥ 8 posting ops, found ${postingOps.length}: [${postingOps.join(', ')}]`,
    ).toBeGreaterThanOrEqual(8);
    expect(
      postingOpsWithoutD11,
      `D11 forward guard: posting ops missing Comment-sink scrub (D11) named reference: [${postingOpsWithoutD11.join(', ')}]`,
    ).toHaveLength(0);
  });

  it('D11: every op that references the Comment-sink scrub also has a posting call (reverse guard)', () => {
    // Ensures the named reference is never orphaned — every D11 reference must pair with an actual posting.
    // Sink corpus = git.md ∪ dist/skills/git/references/*.md (ENOENT-tolerant on dist).
    // Mode 'union' — same rationale as forward guard [DR-18].
    const sinkCorpus = cachedSinkCorpus();
    const opNames = (content.match(/## Operation: (\S+)/g) ?? []).map(m => m.replace('## Operation: ', ''));
    expect(
      opNames.length,
      `reverse guard is vacuous: found ${opNames.length} ops (expected > 0)`,
    ).toBeGreaterThan(0);

    const d11OpsWithoutPost: string[] = [];
    for (const op of opNames) {
      const sec = extractOpSection(sinkCorpus, op, 'union');
      if (sec.includes('Comment-sink scrub (D11)')) {
        if (!sec.includes('--body-file') && !sec.includes('-F body=@') && !sec.includes('--notes-file')) {
          d11OpsWithoutPost.push(op);
        }
      }
    }
    expect(
      d11OpsWithoutPost,
      `D11 reverse guard: ops referencing Comment-sink scrub without a posting call: [${d11OpsWithoutPost.join(', ')}]`,
    ).toHaveLength(0);
  });

  it('D11: no gh call passes a body inline — every body reaches GitHub through a scrubbed file (bypass guard)', () => {
    // The forward guard above only inspects ops that ALREADY use --body-file, so it is
    // blind to a bypass: `gh pr create --body "…"` posts an unscrubbed body and would
    // never be visited. This guard is the reverse check — it fails on any inline body
    // form anywhere in the scanned corpus, which is exactly how a new sink escapes D11
    // (PF-023).
    //
    // #341 widened it again on both axes:
    //   pattern — continuations are folded first and the forms are a named table
    //     (INLINE_BODY_SHAPES), so a backslash-continued `gh issue create` and a
    //     `--comment` attached to a close are sinks like any other;
    //   scope  — every installed agent, command, rule and skill, not just the Git
    //     agent's own neighbourhood. A posting recipe in the review-methodology
    //     skill was a publication path outside both the D10 gate and the D11
    //     scrub, and nothing was looking at it.
    const { corpus } = cachedInlineBodyCorpus();
    const offenders = collectInlineBodyOffenders(corpus);
    expect(
      corpus.length,
      'inline-body scan corpus is empty — the guard would pass by scanning nothing',
    ).toBeGreaterThan(1);

    // D-INLINE-BODY-EXCLUSIONS — an inline-body recipe in references/github-api.md is
    // allowed only when KNOWN_GITHUB_API_INLINE_BODIES names it by the exact text an
    // INLINE_BODY_SHAPES entry matched. The list is empty, so the corpus must hold no
    // inline body at all. Declaring an exception rather than narrowing the scope back is
    // what keeps a named exception from being a weakened guard (§14.6's release.md
    // precedent); narrowing the scope would have been.
    expect(
      collectUndeclaredOffenders(offenders, KNOWN_GITHUB_API_INLINE_BODIES),
      'D11 bypass: inline body form(s) found — route the body through the scrubber and ' +
      'post with --body-file / -F body=@ / --notes-file',
    ).toEqual([]);

    // The list must stay live: an entry that matches nothing is a stale exclusion
    // silencing a line that no longer exists.
    expect(
      collectStaleExclusions(offenders, KNOWN_GITHUB_API_INLINE_BODIES),
      'declared github-api.md exclusion(s) no longer match anything — delete them from the list',
    ).toEqual([]);

    // Non-vacuous: the pattern must still match BOTH shapes P2-S7 guarded against —
    // the pre-existing one and the release-notes arm — now reported by name.
    expect(
      matchInlineBodyShapes('gh pr create --title "x" --body "unscrubbed"').map(h => h.shape),
      'bypass guard no longer matches a known-bad inline body form — the guard is inert',
    ).toEqual(['long-flag']);
    expect(
      matchInlineBodyShapes('gh release create v1 --notes "unscrubbed"').map(h => h.shape),
      'bypass guard no longer matches an inline release-notes body — that arm is inert',
    ).toEqual(['long-flag']);
  });

  it('D11: shape table probe — each of the five inline-body shapes fires, and the scrubbed forms do not', () => {
    // One arm per INLINE_BODY_SHAPES entry, each proven live on its own (PF-018):
    // a five-way alternation inside one regex cannot say which branch carried a
    // match, so a dead arm would be invisible behind the four that still work.
    const positives: readonly (readonly [string, string, string])[] = [
      ['long-flag', 'inline PR body', 'gh pr create --title "x" --body "unscrubbed"'],
      [
        'long-flag',
        // The joiner is what makes this reachable: the `--body` sits four lines
        // below its verb, which is how every real offender #341 found was written.
        'backslash-continued issue body',
        'gh issue create \\\n    --title "Bug" \\\n    --label "bug" \\\n    --body "$(cat <<\'EOF\'',
      ],
      ['long-flag', 'body attached to a close', 'gh issue close 12 --comment "## Archived'],
      ['short-flag', 'short PR body flag', 'gh pr create --title "x" -b "unscrubbed"'],
      ['api-field', 'REST body field', "gh api repos/o/r/pulls/1/comments -f body=\"$BODY\""],
      ['unscrubbed-file', 'a file the scrubber never wrote', 'gh release create v1 --notes-file CHANGELOG.md'],
      ['unscrubbed-api-file', 'a file ref the scrubber never wrote', 'gh api graphql -F body=@reply.txt'],
    ];
    const missed = positives
      .filter(([shape, , text]) => !matchInlineBodyShapes(text).some(h => h.shape === shape))
      .map(([shape, label]) => `${shape}: ${label}`);
    expect(
      missed,
      `inline-body shape(s) that no longer fire on their own known-bad sample — the arm is ` +
      `inert and the corpus is unpoliced for that form:\n  ${missed.join('\n  ')}`,
    ).toEqual([]);

    // GREEN controls. A collector that flagged everything would satisfy the arms
    // above and still be useless; these are the forms the recipes are supposed to
    // end up in, plus the two prose shapes that must never read as commands.
    const negatives: readonly (readonly [string, string])[] = [
      ['scrubbed body file', 'gh issue comment 12 --body-file "$DEVFLOW_BODY"'],
      ['scrubbed api body file', 'gh api repos/o/r/pulls/1/comments -F body=@"$DEVFLOW_BODY"'],
      ['scrubbed notes file', 'gh release create v1 --notes-file "$DEVFLOW_NOTES"'],
      [
        'the github-api.md head blockquote',
        '> via `--body-file` / `-F body=@`, `$DEVFLOW_NOTES` via `--notes-file` — chained',
      ],
      ['a pipe ends the command', 'gh pr diff "$PR_NUMBER" --name-only | grep -n "^src/a.ts$"'],
      ['-b names a branch, not a body', 'gh pr checkout 123 -b review/pr-123'],
      [
        // The shipped manage-debt size check, verbatim: a `gh issue` verb, the bare
        // word `body` twice, and no body ever leaves. `--json body` is the closest
        // real text in the corpus to a sink, so it is the control worth keeping.
        'a --json field named body is a read, not a post',
        "current_body=$(gh issue view $TECH_DEBT_ISSUE --json body -q '.body')",
      ],
    ];
    const falsePositives = negatives
      .flatMap(([label, text]) => matchInlineBodyShapes(text).map(h => `${label} → ${h.shape}: ${h.match}`));
    expect(
      falsePositives,
      `scrubbed or prose form(s) reported as inline bodies — a guard that flags the correct ` +
      `recipe teaches the next author to work around it:\n  ${falsePositives.join('\n  ')}`,
    ).toEqual([]);
  });

  it('D11: known-bad probe — every unscrubbed posting recipe is reported by the same collector', () => {
    // The live arms above assert an EMPTY offender list, which a collector that
    // matched nothing would also satisfy. This drives the SAME collector over the
    // known-bad corpus, so a shape that stopped matching is named here (PF-018).
    const offenders = collectInlineBodyOffenders(unscrubbedPostingCorpus());
    const reported = new Set(offenders.map(o => o.file));
    const unreported = unscrubbedPostingCorpus()
      .filter(entry => !reported.has(entry.path))
      .map(entry => entry.content);
    expect(
      unreported,
      `known-bad posting recipe(s) the inline-body shapes no longer see — each one posts a body ` +
      `devflow composed without scrubbing it:\n  ${unreported.join('\n  ')}`,
    ).toEqual([]);

    // Double spaces are the joiner's signature: the space before a `\` survives and
    // the fold adds its own, so a match spelled with single spaces would be a match
    // against text the collector never produces.
    const texts = offenders.map(o => o.match);
    const expected = [
      'gh issue create  --title "Bug: Login fails for SSO users"  --label "bug,priority-high"  --assignee "username"  --body ',
      'gh issue close $old_issue --comment ',
      'gh issue create  --title "Tech Debt Backlog"  --label "tech-debt"  --body ',
      ' -f body=',
      '--notes-file C',
    ];
    const absent = expected.filter(text => !texts.includes(text));
    expect(
      absent,
      `the shapes no longer produce the matched text they used to:\n  ${absent.join('\n  ')}`,
    ).toEqual([]);
  });

  it('D11: the scan reaches the whole installed prompt surface, not just the Git agent neighbourhood', () => {
    const { corpus, agents, generated } = cachedInlineBodyCorpus();
    // Provenance, not a total: a corpus floor met by the skills tree alone would
    // still claim to scan agents, commands and rules (PF-018).
    expect(
      agents,
      'every declared agent must be scanned — a missing one is a prompt nobody policed',
    ).toBe(getAllAgentNames().length);
    expect(
      generated,
      'the generated tracker references must be scanned — they hold the posting mechanics',
    ).toBeGreaterThanOrEqual(TRACKER_GITHUB_OPS.length + GIT_CROSS_CUTTING_DOCS.length);

    // Sentinels rather than per-tree counts: a count would be a floor someone has to
    // register and re-register every time a skill or command lands, and the property
    // is reach, not size.
    const paths = new Set(corpus.map(e => e.path));
    const sentinels = [
      path.join(ROOT, 'src', 'assets', 'agents', 'review.md'),
      path.join(ROOT, 'dist', 'agents', 'git.md'),
      path.join(skillsDir(), 'review-methodology', 'references', 'patterns.md'),
      path.join(commandsDir(), 'release.md'),
      path.join(rulesDir(), 'security.md'),
    ];
    const unreached = sentinels.filter(p => !paths.has(p));
    expect(
      unreached,
      `these files are installed in front of a model and are not in the scan:\n  ${unreached.join('\n  ')}`,
    ).toEqual([]);
    expect(
      corpus.length,
      'the deduped corpus collapsed — the scan is far smaller than the installed surface',
    ).toBeGreaterThan(200);
  });

  it('D11: known-bad probe — an undeclared offender is reported by the same forward collector', () => {
    // The live forward arm runs over a corpus that holds no inline body, so its
    // empty result proves the corpus and not the predicate. Seed one offender and
    // drive the SAME collector: a filter that stopped reporting extras takes this
    // probe red alongside the guard it backs.
    const seeded: InlineBodyOffender[] = [
      { file: GITHUB_API_MD_PATH, shape: 'long-flag', match: 'gh pr create --title "x" --body ' },
      { file: SIBLING_REFERENCE_MD_PATH, shape: 'long-flag', match: 'gh pr create --title "x" --body ' },
    ];
    expect(
      collectUndeclaredOffenders(seeded, KNOWN_GITHUB_API_INLINE_BODIES),
      'an inline body with no declared exception must be reported — otherwise the forward arm ' +
      'is green because it filtered everything away, not because the corpus is clean',
    ).toEqual([
      `${GITHUB_API_MD_PATH}: gh pr create --title "x" --body `,
      `${SIBLING_REFERENCE_MD_PATH}: gh pr create --title "x" --body `,
    ]);
    // …and a declared one is excused, so the exception mechanism itself still works —
    // but only in github-api.md. The identical match text in a sibling reference is still
    // reported, which is the file-scoping half of the predicate.
    expect(
      collectUndeclaredOffenders(seeded, [seeded[0].match]),
      'a declared exception must excuse its match in github-api.md ONLY — the same text in ' +
      'another scanned reference must still be reported, or the exception list silences files ' +
      'it was never scoped to',
    ).toEqual([`${SIBLING_REFERENCE_MD_PATH}: gh pr create --title "x" --body `]);
  });

  it('D11: known-bad probe — a declared exception that matches nothing is reported by the same reverse collector', () => {
    // The reverse arm ranges over KNOWN_GITHUB_API_INLINE_BODIES, which is empty, so
    // it is vacuous on the live inputs (PF-018). Seed the list instead and drive the
    // SAME collector, so the ratchet that forces a stale entry out is proven live.
    const offenders: InlineBodyOffender[] = [
      { file: GITHUB_API_MD_PATH, shape: 'api-field', match: '-f body=' },
    ];
    expect(
      collectStaleExclusions(offenders, ['-f body=', 'gh pr create --title "gone" --body ']),
      'an exception matching no offender must be reported — otherwise the list can be left ' +
      'half-drained and keeps silencing text that no longer exists',
    ).toEqual(['gh pr create --title "gone" --body ']);
  });

  it('D11: ensure-pr-ready scrubs the PR body it creates (gh pr create is a publication sink)', () => {
    const sec = extractOpSection(soleCorpus, 'ensure-pr-ready', 'sole');
    // extractOpSection throws when the anchor is absent — sec.length is always > 0 here (not a guard).
    expect(
      sec,
      'ensure-pr-ready: gh pr create must post --body-file "$DEVFLOW_BODY" — a PR body is published at repo visibility like any comment',
    ).toContain('gh pr create … --body-file "$DEVFLOW_BODY"');
    expect(
      sec,
      'ensure-pr-ready: PR creation must reference the Comment-sink scrub (D11)',
    ).toContain('Comment-sink scrub (D11)');
  });

  it('D11: erasure guidance — rotation (/rotat/i) and edit-history retention are documented', () => {
    expect(content, 'D11: rotation guidance (/rotat/i) missing — a found live secret requires rotation, not just deletion').toMatch(/rotat/i);
    expect(content, 'D11: "edit history" retention note missing — GitHub retains edit history; deletion is not remediation').toContain('edit history');
  });

  // ── Guard 7b: GAP-25 single-authority literals ─────────────────────────────
  //
  // Two rules over `dist/agents/git.md ∪ src/assets/skills/git/**`. Both are absence
  // assertions, so each carries a probe that runs the SAME collector over a
  // known-bad corpus — the fix is never un-landed to show red.

  it('GAP-25: no `sleep 60` survives in git.md ∪ skills/git/** — D4 says STOP, not wait', () => {
    const hits = collectLiteralOccurrences(gitAuthorityCorpus(), 'sleep 60');
    expect(
      hits,
      'a rate-limit `sleep 60` is a second, opposed policy alongside D4\'s "STOP the ' +
      'fan-out and report THROTTLED". Waiting out an active secondary limit extends ' +
      `GitHub's penalty window:\n  ${hits.join('\n  ')}`,
    ).toEqual([]);
  });

  it('GAP-25 probe: the known-bad `sleep 60` recipes are reported by the same collector', () => {
    const hits = collectLiteralOccurrences(rateLimitSleepCorpus(), 'sleep 60');
    expect(
      hits.length,
      'the collector must find every known-bad `sleep 60` site — otherwise the rule above is ' +
      'satisfied by a scan that reads nothing',
    ).toBe(RATE_LIMIT_SLEEP_SAMPLES.length);
    expect(
      collectLiteralOccurrences(rateLimitSleepCorpus(), 'sleep 90'),
      'a literal the corpus does not carry must not be reported — the collector has to discriminate',
    ).toEqual([]);
  });

  it('GAP-25: the learn-conventions branch bound is stated exactly once', () => {
    // NOT COVERED, deliberately (PF-064 — the corpus half of the stack is written down
    // rather than inferred from a green count). `gitAuthorityCorpus()` is the AUTHORED
    // preload surface only, so it cannot see `dist/skills/git/references/`, where the
    // OPERATIVE bound now lives in its command spelling
    // (`learn-conventions.md:22`, `… | head -50`). Widening the corpus is refused under
    // ADR-025: the property here is "one authority within the text a spawn preloads",
    // and a joined corpus would only prove that the literal exists somewhere while
    // losing the scope that makes the count mean anything. The moved spelling is not
    // unpinned by that refusal — `learn-conventions: branch scan bound (head -50) is
    // present` reads it union-mode over the sink corpus. What no guard asserts is that
    // the two spellings agree on the NUMBER; a prose `≤50 branches` beside a `head -80`
    // is the shape that would survive both.
    const hits = collectLiteralOccurrences(gitAuthorityCorpus(), '≤50 branches');
    expect(
      hits,
      'the bounded-scan branch limit must be declared exactly once across git.md ∪ ' +
      'skills/git/**; a second statement is a second authority on the bound:\n  ' +
      hits.join('\n  '),
    ).toHaveLength(1);
  });

  it('GAP-25 probe: a seeded second statement of the bound is detected', () => {
    const corpus = [
      ...gitAuthorityCorpus(),
      { path: '/synthetic/second-authority.md', content: 'scan ≤50 branches for prefixes\n' },
    ];
    expect(
      collectLiteralOccurrences(corpus, '≤50 branches').length,
      'the collector must see a second statement — otherwise the count assertion is inert',
    ).toBe(2);
  });

  // ── Guard 7c: AC-2.13 — no surviving D-label lacks its definition (E10) ────
  //
  // P2-S5 cut 3 keeps a two-row inline legend (D4, D11) and re-homes D1–D3 / D5–D10
  // to the generated references/decision-markers.md. Asserted as a SET RELATION, not
  // row by row: a per-row check passes while a label nobody remembered goes
  // undefined, which is the exact failure the cut can cause.
  //
  // NOTE on the AC's wording. It was drafted as "referenced ⊆ defined in git.md's
  // inline legend", which the cut makes unsatisfiable by construction — moving those
  // definitions out is the cut. The relation below is the AC's stated property ("no
  // surviving label lacks its definition") over the set of places a definition may
  // now live, plus the separate clause that D4 and D11 are defined ONLY inline.

  it('AC-2.13: every D-label used in git.md is defined in the inline legend or decision-markers.md', () => {
    const defined = new Set([
      ...collectLegendDefinitions(content),
      ...collectLegendDefinitions(readGeneratedReference('decision-markers.md')),
    ]);
    const undefinedLabels = [...collectLabelReferences(content)].filter(l => !defined.has(l));
    expect(
      undefinedLabels,
      `D-label(s) used in git.md with no definition in the inline legend or ` +
      `references/decision-markers.md: ${undefinedLabels.join(', ')}`,
    ).toEqual([]);
    expect(defined.size, 'no D-label definitions were parsed at all — the relation is vacuous')
      .toBeGreaterThanOrEqual(11);
  });

  it('AC-2.13: D4 and D11 are defined inline and ONLY inline (E10)', () => {
    const inline = collectLegendDefinitions(content);
    const rehomed = collectLegendDefinitions(readGeneratedReference('decision-markers.md'));
    expect(
      [...inline].sort(),
      'the inline legend must define exactly D4 and D11 — their controls are always-loaded, ' +
      'so making either definition a file the spawn might not have is PF-027\'s failure mode',
    ).toEqual(['D11', 'D4']);
    expect(
      [...inline].filter(label => rehomed.has(label)),
      'a label is defined in both places — two authorities for one definition (PF-023)',
    ).toEqual([]);
    expect(rehomed.size, 'decision-markers.md defines nothing — the cut dropped the rows')
      .toBeGreaterThan(0);
  });

  it('AC-2.13 known-bad probe: a referenced label with no definition is reported', () => {
    const seeded = `${content}\n| \`some-op\` | does a thing (D42) | none |\n`;
    const defined = new Set([
      ...collectLegendDefinitions(content),
      ...collectLegendDefinitions(readGeneratedReference('decision-markers.md')),
    ]);
    expect(
      [...collectLabelReferences(seeded)].filter(l => !defined.has(l)),
      'the collectors must see an undefined label — otherwise the set relation is inert',
    ).toEqual(['D42']);
  });

  // ── Guard 8: D9 caller guard (AC-0.5) ──────────────────────────────────────

  it('D9: resolve.mds and dist/commands/resolve.md carry the D9 rule literal from git.md (AC-0.5)', () => {
    // The seam test deliberately ignores D9: lines (DECISION_ANNOTATION_KEYS), so this
    // guard is the only cross-file pin for the D9 caller-contract.
    // Authoritative source: resolve-review-threads op section ~git.md:681 (NOT the
    // operations-table row near line 96, which has different casing and backtick-quoted terms).
    const sec = extractOpSection(soleCorpus, 'resolve-review-threads', 'sole');
    // Unique fragment: line 681 uses 'ONLY' (uppercase) and 'verdict == FIXED' (with ==),
    // whereas line 96 uses 'only' (lowercase) and 'verdict `FIXED`' (backtick-quoted, no ==).
    const D9_RULE_FRAGMENT = 'ONLY when VERIFICATION_STATUS == PASS AND verdict == FIXED AND commit_sha non-empty';
    expect(
      sec,
      'git.md resolve-review-threads section must contain the authoritative D9 rule fragment',
    ).toContain(D9_RULE_FRAGMENT);
    // RED proof: any string lacking this exact fragment would fail the assertions below.
    const resolveMds = loadFile('src/assets/commands/resolve.mds');
    expect(
      resolveMds,
      'resolve.mds must carry the D9 rule fragment from git.md (seam test ignores D9: lines)',
    ).toContain(D9_RULE_FRAGMENT);
    const resolveDist = requireDistFile('resolve.md');
    expect(
      resolveDist,
      'dist/commands/resolve.md must carry the D9 rule fragment from git.md',
    ).toContain(D9_RULE_FRAGMENT);
  });

  // ── Guard 9: D4 degradation clauses (AC-0.6) ───────────────────────────────

  it('manage-debt: **Degradation (D4):** clause and (pending — TRACEABILITY: DEGRADED site present (AC-0.6a)', () => {
    const sec = extractOpSection(soleCorpus, 'manage-debt', 'sole');
    expect(
      sec,
      'manage-debt: **Degradation (D4):** clause missing — every remote op must degrade gracefully',
    ).toContain('**Degradation (D4):**');
    expect(
      sec,
      'manage-debt: (pending — TRACEABILITY: DEGRADED site missing — caller must see the degraded state',
    ).toContain('(pending — TRACEABILITY: DEGRADED');
  });

  it('every REQUIRED_OP with remote I/O carries **Degradation (D4):** (AC-0.6b)', () => {
    // "Does remote I/O": the op set is derived from REQUIRED_OPS, but the 12 remote-I/O
    // indicators below are an explicit list (not derived from op text).
    // D4 scope: all ops that call gh CLI or a remote tracker (posting, mutation, or read-only fetch).
    // G1 added D4 to fetch-issue (~:268) and fetch-issues-batch (~:314) — both fetch remotely via gh.
    const remoteOps: string[] = [];
    const missingD4: string[] = [];
    for (const op of REQUIRED_OPS) {
      const sec = extractOpSection(soleCorpus, op, 'sole');
      // Remote I/O indicators: body-file posting, git push, explicit gh subcommands
      // that write state, plus read-only API calls (gh api, gh issue view/list, GraphQL,
      // and backtick-quoted `gh` which appears in D4 lines of fetch-issue/fetch-issues-batch).
      const doesRemoteIO =
        sec.includes('--body-file') ||
        sec.includes('-F body=@') ||
        sec.includes('git push') ||
        sec.includes('gh pr merge') ||
        sec.includes('gh pr comment') ||
        sec.includes('gh issue comment') ||
        sec.includes('gh release create') ||
        sec.includes('gh pr review') ||
        sec.includes('gh api') ||
        sec.includes('gh issue view') ||
        sec.includes('gh issue list') ||
        /graphql/i.test(sec) ||
        sec.includes('`gh`');
      if (!doesRemoteIO) continue;
      // D4 evidence: either the formal `**Degradation (D4):**` label or an inline
      // TRACEABILITY: DEGRADED site (ops that carry the degradation concept but use
      // the inline form rather than a separate labelled clause — e.g. setup-task,
      // create-release in git.md@5fc76aa).
      const hasD4Evidence = sec.includes('**Degradation (D4):**') || sec.includes('TRACEABILITY: DEGRADED');
      remoteOps.push(op);
      if (!hasD4Evidence) missingD4.push(op);
    }
    // Non-vacuity: fetch-issue and fetch-issues-batch must be detected as remote-I/O.
    expect(
      remoteOps,
      'non-vacuity: fetch-issue must be detected as remote-I/O (backtick-quoted `gh` in its D4 line)',
    ).toContain('fetch-issue');
    expect(
      remoteOps,
      'non-vacuity: fetch-issues-batch must be detected as remote-I/O (gh api graphql in Process)',
    ).toContain('fetch-issues-batch');
    expect(
      remoteOps.length,
      'no REQUIRED_OPS detected as remote-I/O — guard is vacuous (PF-018)',
    ).toBeGreaterThan(0);
    expect(
      missingD4,
      `REQUIRED_OPS with remote I/O missing **Degradation (D4):** clause: [${missingD4.join(', ')}]`,
    ).toHaveLength(0);
  });

  it('resolve.mds and dist/commands/resolve.md have 4 (pending sites each naming DEGRADED on the same line (AC-0.6c)', () => {
    // The four sites in resolve.mds (lines 244, 354, 501, 541) all mention TRACEABILITY: DEGRADED
    // on the same line — either directly or as the "or" alternative. AC-0.6 pins the count at 4.
    // If A1 reports 5 sites, assert the true number and note the AC says 4.
    function pendingLines(content: string): string[] {
      return content.split('\n').filter(l => l.includes('(pending'));
    }
    function linesWithoutDegraded(lines: string[]): string[] {
      return lines.filter(l => !l.includes('DEGRADED'));
    }
    const resolveMds = loadFile('src/assets/commands/resolve.mds');
    const mdsLines = pendingLines(resolveMds);
    expect(mdsLines.length, 'resolve.mds: expected 4 (pending sites (AC-0.6)').toBe(4);
    expect(
      linesWithoutDegraded(mdsLines),
      'resolve.mds: every (pending line must name DEGRADED on the same line',
    ).toHaveLength(0);
    const resolveDist = requireDistFile('resolve.md');
    const distLines = pendingLines(resolveDist);
    expect(distLines.length, 'dist/commands/resolve.md: expected 4 (pending sites (AC-0.6)').toBe(4);
    expect(
      linesWithoutDegraded(distLines),
      'dist/commands/resolve.md: every (pending line must name DEGRADED on the same line',
    ).toHaveLength(0);
  });

  // ── Guard 10: Containment guard (AC-0.10) ──────────────────────────────────
  // AC-0.10 mechanisation record (P0-S11): "every op Output block rendering a remote-sourced field"
  // is split into two independent assertions — one per containment class (Principle 8):
  //
  //   (a) <untrusted-issue-body>: setup-task, fetch-issue, fetch-issues-batch wrap issue bodies.
  //       Non-vacuity proof: on main, <untrusted-issue-body> appears ZERO times → floor 3 fails.
  //       The prior combined predicate (<untrusted-issue-body> OR <external-thread>) scored 3 on
  //       main from the pre-existing <external-thread> ops, making the issue-body detection vacuous.
  //
  //   (b) <external-thread>: fetch-review-threads, post-resolution-summary, post-wave-report.
  //       Pre-existing on main (stabilisation assertion, named-set ensures no silent op drift).
  //
  // OP-SCOPED: an op's slice is its OWN section, cut at the next unfenced `## ` heading, so the
  // shared `## Principles` / `## Boundaries` trailer can never satisfy the predicate for the last
  // operation in the file. Every listed op carries its containment marker itself:
  // `fetch-review-threads` wraps the bodies it returns, while `post-resolution-summary` and
  // `post-wave-report` each state the non-reproduction half of Principle 8 for the remote-derived
  // artifact they post.

  it('containment (AC-0.10): ops rendering remote-sourced fields wrap them in containment tags (op-scoped)', () => {
    const opNames = collectOpNames(content);
    /** An operation's own section — cut at the next unfenced `## `, never a shared trailer. */
    const opSection = (op: string) => extractOpSection(soleCorpus, op, 'sole');

    // ── (a) Issue-body containment ────────────────────────────────────────────
    // Predicate: <untrusted-issue-body> ONLY.
    // Named set: ensures an unrelated op cannot satisfy the floor by accident.
    // Non-vacuity: on main's git.md, 0 ops have <untrusted-issue-body> → the floor-3 assertion below FAILS.
    const EXPECTED_ISSUE_BODY_OPS = ['setup-task', 'fetch-issue', 'fetch-issues-batch'];
    const opsWithUntrustedIssueBody = opNames.filter(
      op => opSection(op).includes('<untrusted-issue-body>'),
    );
    for (const expectedOp of EXPECTED_ISSUE_BODY_OPS) {
      expect(
        opsWithUntrustedIssueBody,
        `containment (issue-body): expected '${expectedOp}' to wrap issue content in <untrusted-issue-body>`,
      ).toContain(expectedOp);
    }
    expect(
      opsWithUntrustedIssueBody.length,
      `containment (issue-body): expected >= 3 ops with <untrusted-issue-body>; found [${opsWithUntrustedIssueBody.join(', ')}]`,
    ).toBeGreaterThanOrEqual(3); // floor: containment-issue-body-floor (numeric-floors.json)

    // ── (b) External-thread containment ──────────────────────────────────────
    // Predicate: <external-thread> ONLY.
    // Named set: stabilises the set; any silent removal of an expected op is loud.
    // These three ops pre-existed on main; the assertion existed there too — its non-vacuity
    // is proved by the named-set: removing <external-thread> from any listed op fails toContain.
    const EXPECTED_EXTERNAL_THREAD_OPS = ['fetch-review-threads', 'post-resolution-summary', 'post-wave-report'];
    const opsWithExternalThread = opNames.filter(
      op => opSection(op).includes('<external-thread>'),
    );
    for (const expectedOp of EXPECTED_EXTERNAL_THREAD_OPS) {
      expect(
        opsWithExternalThread,
        `containment (external-thread): expected '${expectedOp}' to carry <external-thread> in its section`,
      ).toContain(expectedOp);
    }
    expect(
      opsWithExternalThread.length,
      `containment (external-thread): expected >= 3 ops with <external-thread>; found [${opsWithExternalThread.join(', ')}]`,
    ).toBeGreaterThanOrEqual(3); // floor: containment-external-thread-floor (numeric-floors.json)

    // Negative arm: summary/reply ops must not interpolate remote body placeholders.
    const SUMMARY_OPS = ['post-review-summary', 'post-resolution-summary', 'post-wave-report'];
    for (const op of SUMMARY_OPS) {
      // {body} / {description} / {title} as MDS template placeholders (curly-brace form)
      // would echo remote origin content verbatim. Shell vars ($DEVFLOW_BODY) are safe.
      expect(
        /\{body\}|\{description\}|\{title\}/.test(opSection(op)),
        `${op}: must not interpolate remote body fields ({body}/{description}/{title}) in its Output template`,
      ).toBe(false);
    }
  });

  // ── Guard 11: D11 matchCount + known-bad probe (M9, AC-0.8) ────────────────

  it('D11: extractOpSectionFromCorpus matchCount is surfaced for union calls (non-vacuous, AC-0.8)', () => {
    // The extractOpSection wrapper in this file discards matchCount — this test calls
    // extractOpSectionFromCorpus directly to assert the matchCount contract [DR-18].
    // Exact expectation: count how many sink-corpus files contain the anchor independently,
    // then assert matchCount equals that count (exact count, not an unfalsifiable >= 1).
    const sinkCorpus = cachedSinkCorpus();
    const expectedMatchCount = sinkCorpus.filter(
      e => e.content.includes('## Operation: post-review-summary'),
    ).length;
    expect(
      expectedMatchCount,
      'expected matchCount must be > 0 — otherwise the union guard would be vacuous (PF-018)',
    ).toBeGreaterThan(0);
    const { content: sec, matchCount } = extractOpSectionFromCorpus(
      sinkCorpus, 'post-review-summary', { mode: 'union' },
    );
    expect(
      matchCount,
      `union matchCount for post-review-summary must be exactly ${expectedMatchCount} — computed independently from the corpus`,
    ).toBe(expectedMatchCount);
    expect(sec.length, 'union result content must be non-empty').toBeGreaterThan(0);
  });

  it('the `## Operation:` anchor is line-bounded: `fetch-issue` does not pull in `fetch-issues-batch`', () => {
    // Read over the REAL sink corpus, not a fixture: the collision is a property of the
    // shipped operation roster (`fetch-issue` is a prefix of `fetch-issues-batch`), so a
    // synthetic pair would prove the extractor fixed without proving this corpus clean.
    // An unbounded `indexOf('## Operation: fetch-issue')` matched
    // `fetch-issues-batch.md`'s own line-1 heading at offset 0, so every union lookup
    // for `fetch-issue` returned the sibling operation's entire mechanics file as well.
    const sinkCorpus = cachedSinkCorpus();
    const { content: sec, matchCount } = extractOpSectionFromCorpus(
      sinkCorpus, 'fetch-issue', { mode: 'union' },
    );
    expect(
      sec,
      'the `fetch-issue` section carries `fetch-issues-batch`\'s heading — the anchor matched a ' +
      'longer operation name as a prefix and swept in its whole file',
    ).not.toContain('## Operation: fetch-issues-batch');
    expect(
      matchCount,
      `expected exactly ${TRACKER_OP_DECLARING_FILES} \`fetch-issue\` sections (git.md plus one ` +
      `generated mechanics file per registered provider); one more than that is the prefix match ` +
      `on fetch-issues-batch.md returning`,
    ).toBe(TRACKER_OP_DECLARING_FILES);
    // Control: the longer name still resolves on its own, so the bound did not go too far.
    const batch = extractOpSectionFromCorpus(sinkCorpus, 'fetch-issues-batch', { mode: 'union' });
    expect(
      batch.matchCount,
      'fetch-issues-batch must still resolve in each of its own declaring files',
    ).toBe(TRACKER_OP_DECLARING_FILES);
    expect(batch.content).toContain('## Operation: fetch-issues-batch');
  });

  it('the `## Operation:` anchor is fence-aware at BOTH ends: a fenced heading is a sample, not a match', () => {
    // The terminator has been fence-aware since PF-063; the start anchor was not, so a
    // corpus file quoting an operation heading inside a fence — the shape
    // ensure-traceable-issue's D3 template and manage-debt's successor body already use
    // for their `## ` lines — counted as a second declaring file and made 'sole' mode
    // throw "found in multiple files": a message that reads as a corpus-scope bug.
    const authority: CorpusEntry = {
      path: 'seed/authority.md',
      content: ['## Operation: seeded-op', '', 'the real body', ''].join('\n'),
    };
    const sample = (fenced: boolean): CorpusEntry => ({
      path: 'seed/sample.md',
      content: [
        '# Notes',
        '',
        'The heading this operation prints:',
        '',
        ...(fenced ? ['```markdown'] : []),
        '## Operation: seeded-op',
        ...(fenced ? ['```'] : []),
        '',
      ].join('\n'),
    });

    const fenced = extractOpSectionFromCorpus([authority, sample(true)], 'seeded-op', { mode: 'sole' });
    expect(fenced.matchCount, 'a fenced heading is payload — one declaring file, not two').toBe(1);
    expect(fenced.content, 'the sole match must be the declaring file\'s section').toContain('the real body');
    // Known-bad control: unfenced, the same line IS a second declaration and must throw,
    // naming both paths — otherwise the fence-awareness above is indistinguishable from
    // an anchor that stopped matching that file at all.
    expect(
      () => extractOpSectionFromCorpus([authority, sample(false)], 'seeded-op', { mode: 'sole' }),
      'an UNFENCED duplicate heading must still throw in `sole` mode',
    ).toThrow(/multiple files/);
  });

  it('D11: forward guard rejects a posting op without Comment-sink scrub reference (known-bad, AC-0.8)', () => {
    // Known-bad synthetic corpus: a posting op (--body-file) with no D11 reference.
    // Calls extractOpSectionFromCorpus (the real collection path) — not an inline re-implementation.
    const syntheticOp = 'post-fake-summary';
    const syntheticContent =
      `## Operation: ${syntheticOp}\n` +
      `**Process:**\ngh pr comment 1 --body-file "$DEVFLOW_BODY"\n`;
    const syntheticCorpus = [{ path: '/fake/git.md', content: syntheticContent }];
    const { content: sec } = extractOpSectionFromCorpus(syntheticCorpus, syntheticOp, { mode: 'union' });
    // Verify the detection logic: posting present, D11 absent — the forward guard would flag this.
    expect(sec.includes('--body-file') || sec.includes('-F body=@'), 'posting must be detected').toBe(true);
    expect(sec.includes('Comment-sink scrub (D11)'), 'D11 reference must be absent in the known-bad').toBe(false);
  });

  // ── Guard 12: Conventions-commit placement and batch NOT_FOUND rule (PF-030, PF-058) ──
  //
  // Pins the contracts introduced in commit ae62d0a:
  //   (a) setup-task step 4b commits .devflow/conventions.md on the feature branch,
  //       immediately after git checkout -b — so the commit never lands on BASE_BRANCH.
  //   (b) learn-conventions is a commit boundary only — no commit --only inside it.
  //   (c) fetch-issues-batch drops (not aborts on) null GraphQL aliases → NOT_FOUND ({refs}).
  //   (d) fetch-issue and fetch-issues-batch both strip a leading # from their ref inputs.
  //
  // Named collector + known-bad probe (H10, PF-043): proves detection is live.

  it('conventions-commit placement and batch NOT_FOUND rule: live corpus has no violations', () => {
    // contract corpus: git.md only (mode 'sole'); sink corpus: git.md ∪ references (arm b).
    const violations = collectConventionsCommitPlacementViolations(soleCorpus, cachedSinkCorpus());
    expect(
      violations,
      `conventions-commit placement: live guard found violations:\n${violations.map(v => `  • ${v}`).join('\n')}`,
    ).toEqual([]);
  });

  it('conventions-commit placement: known-bad synthetic corpus triggers violations (H10, PF-043)', () => {
    // PF-043: synthetic corpus built from real git.md content (copy + targeted mutation),
    // never hand-authored. PF-018: calls the same named collector as the live guard.
    //
    // Mutation 1: remove setup-task's 4b step block.
    //   Search from the setup-task marker so ensure-pr-ready's unrelated 4b. (git.md:~113)
    //   is not mistakenly targeted.
    // Mutation 2: replace learn-conventions' **Commit boundary:** one-liner with an old-style
    //   **Commit (non-blocking):** block containing commit --only, reproducing the pre-ae62d0a shape.
    const realContent = resolveAgentSource('git').content;

    // Mutation 1: delete the 4b block from setup-task.
    const setupTaskMarker = '## Operation: setup-task';
    const setupTaskStart = realContent.indexOf(setupTaskMarker);
    if (setupTaskStart === -1) throw new Error('probe: ## Operation: setup-task not found in git.md');
    const step4bStart = realContent.indexOf('\n4b. ', setupTaskStart);
    const step5Start = realContent.indexOf('\n5. Return setup summary', step4bStart);
    if (step4bStart === -1 || step5Start === -1) {
      throw new Error('probe: could not locate 4b./5. boundaries in setup-task for mutation');
    }
    let mutated = realContent.slice(0, step4bStart) + realContent.slice(step5Start);

    // Mutation 2: replace the **Commit boundary:** one-liner with an old-style block.
    const commitBoundaryAnchor = '\n**Commit boundary:**';
    const cbIdx = mutated.indexOf(commitBoundaryAnchor);
    if (cbIdx === -1) throw new Error('probe: "**Commit boundary:**" not found after mutation 1');
    const cbLineEnd = mutated.indexOf('\n', cbIdx + 1);
    const oldStyleBlock =
      '\n**Commit (non-blocking):** Run only if learn-conventions returned `**Status**: WRITTEN`.\n' +
      '```bash\n' +
      'git commit --only -- .devflow/conventions.md -m "docs(devflow): record project conventions"\n' +
      '```\n';
    mutated =
      mutated.slice(0, cbIdx) +
      oldStyleBlock +
      (cbLineEnd === -1 ? '' : mutated.slice(cbLineEnd));

    const syntheticCorpus: CorpusEntry[] = [{ path: '/synthetic/git.md', content: mutated }];
    const violations = collectConventionsCommitPlacementViolations(syntheticCorpus, syntheticCorpus);

    expect(
      violations.length,
      `probe must detect >= 2 violations on the known-bad corpus; got: ${JSON.stringify(violations)}`,
    ).toBeGreaterThan(1);
    expect(
      violations.some(v => v.startsWith('setup-task:')),
      `probe must name 'setup-task' in at least one violation; got: ${JSON.stringify(violations)}`,
    ).toBe(true);
    expect(
      violations.some(v => v.startsWith('learn-conventions:')),
      `probe must name 'learn-conventions' in at least one violation; got: ${JSON.stringify(violations)}`,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The operation roster
// ---------------------------------------------------------------------------

/**
 * Every `## Operation:` name the Git agent declares, in file order.
 *
 * A NAMED set, not a count. Registry Guard 6 (tests/registry-integrity.test.ts)
 * asserts that spawn-fence `OPERATION:` values and `## Operation:` headings agree,
 * which stays true across a coordinated rename — rename the op and its callers
 * together and Guard 6 never moves. The operation name is a public contract: a
 * caller written against a release two versions ago resolves by name, so a rename
 * is a breaking change and has to be a visible edit to this list.
 */
export const GIT_OPERATION_ROSTER: readonly string[] = [
  'ensure-pr-ready',
  'validate-branch',
  'setup-task',
  'fetch-issue',
  'fetch-issues-batch',
  'post-review-summary',
  'manage-debt',
  'check-ci-status',
  'create-release',
  'gather-release-evidence',
  'learn-conventions',
  'fetch-review-threads',
  'resolve-review-threads',
  'post-resolution-summary',
  'check-merge-readiness',
  'backlink-shipped-issues',
  'ensure-traceable-issue',
  'post-wave-report',
];

/** Named collector: the `## Operation:` names an agent source declares, in file order. */
export function collectOperationNames(content: string): string[] {
  return [...content.matchAll(/^## Operation: (\S+)/gm)].map(m => m[1]);
}

describe('git agent: the operation roster is unchanged (registry Guard 6)', () => {
  it('the compiled agent declares exactly the registered operation names, in order', () => {
    const names = collectOperationNames(resolveAgentSource('git').content);
    expect(
      names,
      'the operation roster changed. Registry Guard 6 stays green across a coordinated rename, so ' +
      'it cannot see this: a renamed op silently breaks every caller pinned to the old name.',
    ).toEqual(GIT_OPERATION_ROSTER);
  });

  it('the roster check is non-vacuous, and the collector sees a seeded change', () => {
    expect(GIT_OPERATION_ROSTER.length, 'the named set is empty').toBe(18);
    const seeded = '## Operation: setup-task\nbody\n\n## Operation: renamed-op\nbody\n';
    expect(collectOperationNames(seeded)).toEqual(['setup-task', 'renamed-op']);
  });
});
