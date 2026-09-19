/**
 * The byte budget's MEASUREMENT MODEL — how each term is measured, resolved and
 * maximised. The ceilings those terms are gated against, and every assertion,
 * live in tests/tracker/byte-budget.test.ts; this file holds no threshold and no
 * `it()`.
 *
 * The split is along the line that matters for review. A ceiling is a number
 * somebody chose and justified, and it belongs beside the assertion it gates;
 * the measurement is machinery every arm shares and reads once. Read this file
 * to learn what a term MEANS, and the test file to learn what it must stay under.
 *
 * UNIT: characters, not bytes, throughout — `wc -m` semantics. JS `.length`
 * counts UTF-16 code units, which equals `wc -m` for this corpus (every
 * non-ASCII character in it is BMP: em-dashes, arrows, ≤, §). Byte counts ride
 * alongside on `Measurement` so the two are never confused.
 *
 * Every dist read is fail-loud: an absent artifact throws with a build hint
 * rather than making the budget pass by measuring nothing — and those reads
 * happen at MODULE SCOPE, so an unbuilt tree fails the importing test file at
 * load rather than yielding a green suite over zeroes (PF-018).
 */

import { readFileSync, existsSync } from 'fs';
import * as path from 'path';

import { skillsDir, compiledSkillRefsDir } from '../../src/core/assets.js';
import {
  MCP_BACKED_PROVIDER_SUBDIRS,
  TRACKER_GITHUB_OPS,
  TRACKER_OPS,
  VARIANT_MODULES,
} from '../../src/core/mds-variants.js';
import { resolveAgentSource } from '../helpers.js';

// ---------------------------------------------------------------------------
// Fail-loud measurement
// ---------------------------------------------------------------------------

export interface Measurement {
  label: string;
  chars: number;
  bytes: number;
  present: boolean;
}

/** Measure a file that MUST exist; throws with a build hint when it does not. */
function measureRequired(label: string, filePath: string): Measurement {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    throw new Error(
      `${label}: ${filePath} is absent — run \`npm run build\` first\n` +
      '  (the byte budget reads built artifacts and cannot be skipped)',
    );
  }
  return { label, chars: content.length, bytes: Buffer.byteLength(content, 'utf-8'), present: true };
}

/**
 * Measure a file that may not exist yet, as a recorded 0 row.
 *
 * Used only for the four-shape table's NAMED rows — learn-conventions.md,
 * publication-gate.md and decision-markers.md: each is recorded so its cost is
 * visible rather than merely deducted from git.md, and a table that threw on
 * their absence could not record a cost that is about to arrive. Tolerating
 * absence here is not tolerating it in the budget — nothing that gates on a
 * number reads a row through this function.
 */
export function measureOptional(label: string, filePath: string): Measurement {
  if (!existsSync(filePath)) return { label, chars: 0, bytes: 0, present: false };
  return measureRequired(label, filePath);
}

export const GIT_AGENT = resolveAgentSource('git');
const GIT_SKILL_REFS_SRC = path.join(skillsDir(), 'git', 'references');
export const REFS_DIR = compiledSkillRefsDir();

export const gitMd = measureRequired('dist/agents/git.md', GIT_AGENT.path);
export const skillGit = measureRequired(
  'skills/git/SKILL.md',
  path.join(skillsDir(), 'git', 'SKILL.md'),
);
export const skillWorktree = measureRequired(
  'skills/worktree-support/SKILL.md',
  path.join(skillsDir(), 'worktree-support', 'SKILL.md'),
);
/**
 * The gate's one written exclusion, measured at its SOURCE path rather than through
 * resolveReference(): the pin below is on the bytes a commit edits, and a file that
 * were ever shadowed by a generated copy would otherwise move the pin without anyone
 * touching the hand-authored file. Recorded in the table, asserted only for equality.
 */
export const githubApiMd = measureRequired(
  'references/github-api.md  (excluded from the gate — pinned, not budgeted)',
  path.join(skillsDir(), 'git', 'references', 'github-api.md'),
);

/** The always-preloaded set: what every Git spawn pays before it does anything. */
export const PRELOADED = gitMd.chars + skillGit.chars + skillWorktree.chars;

// ---------------------------------------------------------------------------
// Reference resolution — a skill-relative `references/…` name to a real file
// ---------------------------------------------------------------------------
//
// A reference is addressed skill-relatively, and the installed skill directory
// merges two sources: hand-authored files under src/assets/skills/git/references/
// and generated ones under dist/skills/git/references/. Both are loadable in one
// spawn, so both count.

/** Resolve a `references/…`-relative name to the file that would be loaded. */
export function resolveReference(rel: string): string | null {
  for (const base of [REFS_DIR, GIT_SKILL_REFS_SRC]) {
    const candidate = path.join(base, ...rel.split('/'));
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function referenceChars(rel: string): number {
  const resolved = resolveReference(rel);
  return resolved === null ? 0 : readFileSync(resolved, 'utf-8').length;
}

/** The generated per-op mechanics file for the GitHub path. */
export function trackerRefRel(op: string): string {
  return `tracker/github/${op}.md`;
}

/**
 * The tracker providers whose mechanics reach the tracker through a TOOL CALL, and
 * therefore load `references/tracker/_mcp.md` on every spawn.
 *
 * Read from the registry rather than listed: a provider registered later is priced
 * by construction, and the non-vacuity arm reports one whose directory is missing.
 */
export const MCP_BACKED_PROVIDERS: readonly string[] = VARIANT_MODULES
  .filter(mod => (MCP_BACKED_PROVIDER_SUBDIRS as readonly string[]).includes(mod.subdir))
  .map(mod => mod.subdir.slice('tracker/'.length));

/** The generated per-op mechanics file for a named provider. */
function providerRefRel(provider: string, op: string): string {
  return `tracker/${provider}/${op}.md`;
}

/** The tool-call contract — a per-spawn cost for every MCP-backed provider, 0 elsewhere. */
export const MCP_CONTRACT_REL = 'tracker/_mcp.md';

// ---------------------------------------------------------------------------
// The compiled agent, sectioned by operation
// ---------------------------------------------------------------------------

const OP_HEADING_RE = /^## Operation: (\S+)/gm;

/** Every `## Operation:` section in the compiled agent, keyed by op name. */
function opSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const starts: Array<{ op: string; index: number }> = [];
  for (const match of content.matchAll(OP_HEADING_RE)) {
    starts.push({ op: match[1], index: match.index! });
  }
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].index : content.length;
    sections.set(starts[i].op, content.slice(starts[i].index, end));
  }
  return sections;
}

export const SECTIONS = opSections(GIT_AGENT.content);

/** Skill-relative `references/…` names literally mentioned in a slice of text. */
const REFERENCE_MENTION_RE = /references\/([A-Za-z0-9._/{}-]+\.md)/g;

function referenceMentions(text: string): string[] {
  return [...text.matchAll(REFERENCE_MENTION_RE)].map(m => m[1]);
}

/**
 * The reference files an operation's load instructions can name in ONE spawn —
 * derived by SCANNING the compiled agent, independently of the model below.
 *
 * Two sources:
 *   - the preamble's single templated load instruction, instantiated for this op
 *     (registered tracker ops only);
 *   - any literal `references/<name>.md` named inside the op's own section.
 * A templated mention inside a section is skipped: it is a restatement of the
 * preamble's instruction, not a second file.
 */
export function nameableFrom(op: string): Set<string> {
  const nameable = new Set<string>();
  if ((TRACKER_GITHUB_OPS as readonly string[]).includes(op)) {
    nameable.add(trackerRefRel(op));
  }
  for (const rel of referenceMentions(SECTIONS.get(op) ?? '')) {
    if (rel.includes('{')) continue;
    nameable.add(rel);
  }
  return nameable;
}

// ---------------------------------------------------------------------------
// The CROSS-CUTTING scope — references named outside every op section
// ---------------------------------------------------------------------------
//
// nameableFrom() reads `## Operation:` sections only. A reference named ABOVE the
// first op heading is therefore in neither direction of the bidirectional check
// below: not summed by the model, and not seen by the scan that is supposed to
// catch what the model missed. `references/decision-markers.md` is named exactly
// there (the Decision Marker Legend, above the first op), so until this scope
// existed it was accounted for by nothing at all.
//
// Two scopes, not one widened scan: a name in the always-loaded part is reachable
// from EVERY spawn, and a name inside an op section is reachable from that op.
// Folding them together would attribute a cross-cutting document to whichever op
// happened to sort first.

/** The always-loaded part of the compiled agent: everything before the first `## Operation:`. */
function crossCuttingSlice(content: string): string {
  const first = content.search(/^## Operation: /m);
  if (first === -1) {
    throw new Error(
      'no `## Operation:` heading in the compiled agent — the cross-cutting slice would be the ' +
      'whole file and every op-scoped name would read as cross-cutting',
    );
  }
  return content.slice(0, first);
}

/** Named collector: the literal `references/…` names the always-loaded part spells out. */
export function nameableCrossCutting(content: string): Set<string> {
  const nameable = new Set<string>();
  for (const rel of referenceMentions(crossCuttingSlice(content))) {
    if (rel.includes('{')) continue;
    nameable.add(rel);
  }
  return nameable;
}

/**
 * The cross-cutting references the BUDGET MODEL knows the always-loaded part can
 * name — declared, so the scan above has something independent to disagree with.
 *
 * D-CROSS-CUTTING-ON-DEMAND. These are RECORDED, not added to the asserted
 * loaded-set term, and the distinction is the legend's own wording. git.md says
 * D4 and D11 "are defined here because their controls must be loaded before the
 * agent acts. Every other `D{N}` label IS DEFINED IN … references/decision-markers.md."
 * That is a glossary pointer — where to look up a label — not an instruction to
 * load the file, and the module registry says the same thing in
 * GIT_CROSS_CUTTING_DOCS' own comment: "glossary entries a reader consults, not
 * rules a spawn must have". A term added to the asserted worst case would claim
 * every Git spawn pays 1_681 ch it does not pay.
 *
 * What the assertions below DO owe: that the declared set and the scanned set
 * agree in both directions, so a document named cross-cuttingly can never again
 * be invisible to the budget, and that the cost of treating it as mandatory is
 * printed rather than assumed.
 */
export const MODEL_CROSS_CUTTING_ON_DEMAND: readonly string[] = ['decision-markers.md'];

/**
 * The cross-cutting references the BUDGET MODEL attributes to each operation,
 * beyond its own generated mechanics file [DR-12].
 *
 * Declared, not scanned — that is the whole point. The bidirectional check below
 * compares this model against what the compiled agent actually lets an op name;
 * deriving both from one source would make the check a tautology.
 *
 * `learn-conventions.md` is attributed to BOTH `setup-task` and the
 * `learn-conventions` op itself, because both can load it inside one spawn:
 * setup-task step 1b invokes `learn-conventions` when `.devflow/conventions.md`
 * is absent. setup-task is the row that gates — it is a tracker op, so its
 * one-spawn load (own mechanics + learn-conventions.md) is the [DR-12] worst case
 * §5 anticipated.
 */
const MODEL_CROSS_CUTTING_REFS: Readonly<Record<string, readonly string[]>> = {
  'fetch-review-threads': ['github-api.md'],
  'setup-task': ['learn-conventions.md'],
  'learn-conventions': ['learn-conventions.md'],
  'post-review-summary': ['publication-gate.md'],
  'post-resolution-summary': ['publication-gate.md'],
};

/** The file set the budget formula sums for an operation. */
export function summedFor(op: string): Set<string> {
  const summed = new Set<string>(MODEL_CROSS_CUTTING_REFS[op] ?? []);
  if ((TRACKER_GITHUB_OPS as readonly string[]).includes(op)) {
    summed.add(trackerRefRel(op));
  }
  return summed;
}

/**
 * The file set a PROVIDER spawn sums for an operation.
 *
 * The same shape as `summedFor` above, with that provider's own mechanics
 * substituted for GitHub's. The contract document is deliberately NOT included
 * here: §14.10's formula carries it as its own term, once per SPAWN rather than
 * once per operation, and adding it in both places would double-count it.
 */
function summedForProvider(provider: string, op: string): Set<string> {
  const summed = new Set<string>(MODEL_CROSS_CUTTING_REFS[op] ?? []);
  summed.add(providerRefRel(provider, op));
  return summed;
}

export const ALL_OPS = [...SECTIONS.keys()];

/** The sum of every reference file an op's load instructions can name in one spawn. */
function oneSpawnLoad(op: string): number {
  return [...summedFor(op)].reduce((n, rel) => n + referenceChars(rel), 0);
}

/** The winning op of a `max over ops` term, and the quantity it measured. */
export interface OpMax {
  readonly op: string;
  readonly value: number;
}

/**
 * `max over ops of measure(op)`, as the winning op and its value — the one reducer
 * every `max over ops` term in this file goes through.
 *
 * `value` is deliberately unit-neutral: the three budget terms below measure
 * characters, the recorded round-trip term measures Reads. An empty range, or one
 * where nothing measures above zero, answers `(none)` / 0 — the same vacuous answer
 * the three hand-written loops gave, so the non-vacuity floors that exist to catch
 * it still catch it.
 */
export function maxOver(ops: Iterable<string>, measure: (op: string) => number): OpMax {
  let best: OpMax = { op: '(none)', value: 0 };
  for (const op of ops) {
    const value = measure(op);
    if (value > best.value) best = { op, value };
  }
  return best;
}

/**
 * D-LOADED-SET-SCOPE — the `max over ops` term is taken over TRACKER_GITHUB_OPS,
 * not over every operation in the agent.
 *
 * AC-2.5 bounds "the worst-case TRACKER spawn": the question the budget answers is
 * whether the contract/mechanics split makes a tracker operation cost more than the
 * pre-split monolith did. A non-tracker op such as `fetch-review-threads` loads
 * references/github-api.md and always did; it is not a cost the split introduces,
 * and including it would make the budget a measure of a file this phase does not
 * own. Non-tracker ops are RECORDED in the four-shape table below (so the number
 * stays visible and is never quietly dropped) but do not gate.
 */
export function worstCaseReferenceLoad(): OpMax {
  return maxOver(TRACKER_GITHUB_OPS, oneSpawnLoad);
}

/** The same maximum over the ops the budget does NOT gate on — recorded, never asserted. */
export function worstCaseNonTrackerLoad(): OpMax {
  const nonTracker = ALL_OPS.filter(op => !(TRACKER_GITHUB_OPS as readonly string[]).includes(op));
  return maxOver(nonTracker, oneSpawnLoad);
}

/** max_op chars(references/tracker/github/{op}.md) — the largest single mechanics file. */
export function largestTrackerReference(): OpMax {
  return maxOver(TRACKER_GITHUB_OPS, op => referenceChars(trackerRefRel(op)));
}

/**
 * The same two `max over ops` terms, scoped to one PROVIDER.
 *
 * D-LOADED-SET-PER-PROVIDER. Each MCP-backed provider is priced on its own row
 * rather than folded into the GitHub one, because the terms genuinely differ: its
 * mechanics files are different bytes, and it loads the tool-call contract that
 * the GitHub path is billed 0 for. A single row over the union would charge every
 * GitHub user for the most expensive provider's mechanics — GAP-02's defect, moved
 * from a file to an arithmetic.
 *
 * Scoped to TRACKER_OPS for the same reason the GitHub row is scoped to it
 * (D-LOADED-SET-SCOPE): the question is what a TRACKER spawn costs.
 */
export function largestProviderReference(provider: string): OpMax {
  return maxOver(TRACKER_OPS, op => referenceChars(providerRefRel(provider, op)));
}

export function worstCaseProviderLoad(provider: string): OpMax {
  return maxOver(TRACKER_OPS, op =>
    [...summedForProvider(provider, op)].reduce((n, rel) => n + referenceChars(rel), 0));
}

/** The whole loaded-set formula for one MCP-backed provider, as §14.10 states it. */
export function providerLoadedSet(provider: string): number {
  return PRELOADED
    + referenceChars(MCP_CONTRACT_REL)
    + largestProviderReference(provider).value
    + worstCaseProviderLoad(provider).value;
}

// ---------------------------------------------------------------------------
// The preamble block
// ---------------------------------------------------------------------------

const PREAMBLE_START = '## Tracker provider resolution';
// P2-S5 cut 2 moved `## Publication gate (D10)` into references/publication-gate.md,
// so the heading that now follows the preamble is the D11 section — the one
// cross-cutting block §14.4 forbids ever moving, which makes it a stabler end
// anchor than the one it replaces.
const PREAMBLE_END = '## Comment-sink scrub (D11)';
const D4_ANCHOR = '**Degradation contract (D4):**';

/**
 * The provider-resolution preamble as it appears in the compiled agent.
 * Throws — never returns a sentinel — when the block is absent or misplaced: a
 * budget that silently measured an empty preamble would report 0 lines and pass.
 */
export function preambleBlock(content: string): string {
  const start = content.indexOf(PREAMBLE_START);
  const end = content.indexOf(PREAMBLE_END);
  const d4 = content.indexOf(D4_ANCHOR);
  if (start === -1) {
    throw new Error(
      `preamble heading '${PREAMBLE_START}' not found in ${GIT_AGENT.path} — ` +
      'the provider-resolution preamble is missing or was renamed (AC-2.5, P2-S3)',
    );
  }
  if (end === -1) throw new Error(`'${PREAMBLE_END}' not found in ${GIT_AGENT.path}`);
  if (d4 === -1) throw new Error(`'${D4_ANCHOR}' not found in ${GIT_AGENT.path}`);
  if (!(d4 < start && start < end)) {
    throw new Error(
      'the preamble must sit between the Degradation contract (D4) block and ' +
      `'${PREAMBLE_END}' — found D4@${d4}, preamble@${start}, gate@${end}`,
    );
  }
  return content.slice(start, end).replace(/\n+$/, '');
}
