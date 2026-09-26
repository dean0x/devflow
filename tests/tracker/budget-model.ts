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
  PR_HOST_OPS,
  TRACKER_GITHUB_OPS,
  TRACKER_OPS,
  VARIANT_MODULES,
} from '../../src/core/mds-variants.js';
import { TRACKER_PROVIDERS } from '../../src/core/tracker.js';
import { prHostRel, resolveAgentSource } from '../helpers.js';

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
 * Whether an op's mechanics live (also) in the PR-host tree.
 *
 * Its `pr/` file (`prHostRel(op)`, tests/helpers.ts) is one file, not one per
 * provider: pull requests, PR reviews and PR checks stay on GitHub under every
 * issue tracker, so a `pr/` reference costs the same on every path and enters
 * every provider's sum identically.
 */
export function isPrHostOp(op: string): op is (typeof PR_HOST_OPS)[number] {
  return (PR_HOST_OPS as readonly string[]).includes(op);
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
 *
 * ONE HOP, and exactly one (#326). A `pr/` reference the op's own section names is
 * itself loaded text, and what IT names is loaded in the same spawn — so pricing
 * the reference without pricing what it pulls in would under-count exactly as the
 * pre-[DR-12] formula did. `fetch-review-threads` is the case that forces it: its
 * only `github-api.md` mention left git.md with step 1, so with no hop the model
 * sums a file the scan can no longer see an op name.
 *
 * The hop does not recurse and must not: the term this feeds is a per-spawn cost,
 * a fixed point over an unbounded chain is not a budget anyone could read, and a
 * cycle in the reference graph would not terminate. Depth is therefore a constant
 * here, not a parameter — if a `pr/` file ever needs a reference two hops deep,
 * that is a modelling decision to take deliberately, not a loop bound to raise.
 */
export function nameableFrom(
  op: string,
  readReference: (rel: string) => string | null = readReferenceFromDisk,
): Set<string> {
  const nameable = new Set<string>();
  if ((TRACKER_GITHUB_OPS as readonly string[]).includes(op)) {
    nameable.add(trackerRefRel(op));
  }
  const literalMentions = (text: string): string[] =>
    referenceMentions(text).filter(rel => !rel.includes('{'));

  for (const rel of literalMentions(SECTIONS.get(op) ?? '')) {
    nameable.add(rel);
  }
  if (isPrHostOp(op)) {
    const prRef = prHostRel(op);
    const body = nameable.has(prRef) ? readReference(prRef) : null;
    if (body !== null) {
      for (const rel of literalMentions(body)) nameable.add(rel);
    }
  }
  return nameable;
}

/**
 * The hop's default reader — and the seam its known-bad probe drives.
 *
 * Injected rather than read inline so the probe can seed a `pr/` body that names
 * a file nothing models, WITHOUT writing into `dist/` mid-suite: vitest runs
 * other files in parallel workers against those exact paths (PF-055). An absence
 * check over a corpus nobody can perturb is green whether or not the hop runs
 * (PF-064), which is precisely what the probe has to rule out. Exported so the
 * closure scan's seeded-reader probes can wrap it and perturb one body in memory.
 */
export function readReferenceFromDisk(rel: string): string | null {
  const resolved = resolveReference(rel);
  return resolved === null ? null : readFileSync(resolved, 'utf-8');
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
 * The cross-cutting references the always-loaded part names that ARE asserted —
 * the other half of the same declaration, kept beside it rather than folded in.
 *
 * `tracker/_mcp.md` is named from the preamble because it is read once per SPAWN
 * under every non-github provider, and its cost is already a summed term of the
 * per-provider rows (`providerLoadedSet`), billed 0 on the GitHub path by
 * construction. So it is exactly the case ON_DEMAND is not: not a glossary a
 * reader may consult, but a contract the spawn must have.
 *
 * Two lists rather than one, because the scope check and the printed table want
 * different answers. The scope check asks "does the model know the agent can name
 * this?" and must see both. The `2b` table row asks "what would it cost to treat
 * the on-demand ones as mandatory?" and must see only the first — a contract
 * already inside the asserted gate would be counted twice there.
 */
export const MODEL_CROSS_CUTTING_ASSERTED: readonly string[] = [MCP_CONTRACT_REL];

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
  // trust-rule.md (#363) is named from this op's PR-host body — step 2 applies the
  // one trust rule — so it reaches the op through the same one hop github-api.md does.
  'fetch-review-threads': ['github-api.md', 'trust-rule.md'],
  // resolve-review-threads fans out over the same threads, so it reads the same
  // rate-limit rungs. The row is what keeps the two directions honest about a
  // reference the op now names; the worst-case term is unchanged, because the
  // non-tracker maximum was already github-api.md.
  'resolve-review-threads': ['github-api.md'],
  'setup-task': ['learn-conventions.md'],
  'learn-conventions': ['learn-conventions.md'],
  'post-review-summary': ['publication-gate.md'],
  'post-resolution-summary': ['publication-gate.md'],
  // check-merge-readiness step 3 reuses check-ci-status's classification, and those
  // steps live only in the sibling's PR-host file, so its reference names that file
  // for loading. One spawn therefore pays for both `pr/` files.
  'check-merge-readiness': [prHostRel('check-ci-status')],
};

/**
 * Every tracker provider the CLI can select, read from the registry rather than
 * listed, so a fourth provider is ranged over by every per-provider arm by
 * construction and the coverage arm names one that nothing prices.
 */
export const TRACKER_PROVIDER_IDS: readonly string[] = TRACKER_PROVIDERS.map(p => p.id);

function isTrackerOp(op: string): boolean {
  return (TRACKER_OPS as readonly string[]).includes(op);
}

/**
 * An operation's OWN load under one provider — the files its own pointers name,
 * before any sibling-op hop a loaded body adds: its provider mechanics (a tracker
 * op), its `pr/` file (a PR-host op) and the cross-cutting references
 * MODEL_CROSS_CUTTING_REFS attributes to it.
 *
 * The contract document is deliberately NOT included: §14.10's formula carries it
 * as its own term, once per SPAWN rather than once per operation, and adding it
 * here as well would double-count it.
 */
export function ownLoadForProvider(provider: string, op: string): Set<string> {
  const own = new Set<string>(MODEL_CROSS_CUTTING_REFS[op] ?? []);
  if (isTrackerOp(op)) own.add(providerRefRel(provider, op));
  // The PR-host tree is provider-independent and installed under every provider,
  // so it is the same addend on every path — not a GitHub-only cost.
  if (isPrHostOp(op)) own.add(prHostRel(op));
  return own;
}

/**
 * The reference-literal half of the model on the GitHub path: what an op's own
 * pointers name. Directions 1 and 2 of the bidirectional check hold THIS against
 * nameableFrom()'s scan of the agent; the op-mention half — the sibling-op hops a
 * loaded body adds — is D-BODY-HOP-CLOSURE's, below.
 */
export function summedFor(op: string): Set<string> {
  return ownLoadForProvider('github', op);
}

/** A per-provider table of sibling-op hops: provider → op → the ops its bodies hop to. */
export type TransitiveRefs = Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;

/**
 * D-BODY-HOP-CLOSURE — the sibling-op hops a LOADED BODY makes, priced per provider.
 *
 * A mechanics body that tells the spawn to run another operation, or to follow a
 * section of another operation's reference, makes that operation's own load part of
 * this spawn: the Git agent executes it in the same context window. No reference
 * literal names it, so nameableFrom()'s scan could not see it and the formula never
 * summed it. setup-task step 1c is the case that forced this: under ISSUE_REQUIRED
 * it invokes ensure-traceable-issue, whose mechanics are the largest term of the
 * worst tracker spawn on every provider — and until this table existed the budget
 * covered it only because the largest-file term happened to be about that size
 * (D-LOADED-SET-ONE-SPAWN).
 *
 * FLAT and per provider. Each row names every op the closure reaches from that op
 * under that provider, never a chain to follow: a two-hop target is listed directly,
 * and the closure scan (nameableFromProvider) is what proves the list complete. Per
 * provider because the hops genuinely differ — Linear's post-wave-report states its
 * marker's second discriminator only in backlink-shipped-issues' reference, and no
 * other provider's does.
 *
 * Only hops whose load no reference literal already prices live here: setup-task's
 * `learn-conventions` and check-merge-readiness's `check-ci-status` are hops too, and
 * both are priced by MODEL_CROSS_CUTTING_REFS because a `references/…` literal — in
 * the agent's setup-task section, in check-merge-readiness's pr/ body — also names
 * the file. A mention is PRICED when the files it would load are inside
 * summedForProvider(provider, op), whichever table put them there.
 *
 * Checked both ways against the scan in tests/tracker/byte-budget.test.ts: every op a
 * loaded body names is priced or listed in INFORMATIONAL_OP_MENTIONS, and every row
 * here is still a mention the scan takes as a hop.
 */
export const MODEL_TRANSITIVE_REFS: TransitiveRefs = {
  github: {
    'setup-task': ['ensure-traceable-issue'],
    'gather-release-evidence': ['backlink-shipped-issues'],
    'associate-release': ['backlink-shipped-issues'],
  },
  jira: {
    'setup-task': ['ensure-traceable-issue'],
    'gather-release-evidence': ['backlink-shipped-issues'],
    'associate-release': ['backlink-shipped-issues'],
  },
  linear: {
    'setup-task': ['ensure-traceable-issue'],
    'gather-release-evidence': ['backlink-shipped-issues'],
    'associate-release': ['backlink-shipped-issues'],
    'post-wave-report': ['backlink-shipped-issues'],
  },
};

/**
 * The file set ONE spawn of `op` sums under `provider` — its own load plus the own
 * load of every op MODEL_TRANSITIVE_REFS says its bodies hop to. One function for
 * every provider, the GitHub path included, so the rows cannot price a hop on one
 * path and miss it on another.
 *
 * `transitive` is a parameter so the non-vacuity arm can ask what the live corpus
 * reports with the table emptied — one measurement read two ways.
 */
export function summedForProvider(
  provider: string,
  op: string,
  transitive: TransitiveRefs = MODEL_TRANSITIVE_REFS,
): Set<string> {
  const summed = ownLoadForProvider(provider, op);
  for (const target of transitive[provider]?.[op] ?? []) {
    for (const rel of ownLoadForProvider(provider, target)) summed.add(rel);
  }
  return summed;
}

export const ALL_OPS = [...SECTIONS.keys()];

/** The characters of a file set, less any written exclusion. */
function loadChars(rels: Iterable<string>, exclusions: readonly string[] = []): number {
  return [...rels]
    .filter(rel => !exclusions.includes(rel))
    .reduce((n, rel) => n + referenceChars(rel), 0);
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
 *
 * The GitHub path of worstCaseProviderLoad(), named for the rows that read it.
 */
export function worstCaseReferenceLoad(): OpMax {
  return worstCaseProviderLoad('github');
}

/** The same maximum over the ops the budget does NOT gate on — recorded, never asserted. */
export function worstCaseNonTrackerLoad(): OpMax {
  const nonTracker = ALL_OPS.filter(op => !isTrackerOp(op));
  return maxOver(nonTracker, op => loadChars(summedForProvider('github', op)));
}

/**
 * D-LOADED-SET-SCOPE, the written half — the references a loaded-set row does not
 * charge, DECLARED as a list rather than filtered inline, so the exclusion is
 * something a reviewer can read and disagree with.
 *
 * `references/github-api.md` is the only member. It is GitHub CLI, GraphQL and
 * rate-limit recipe prose that `fetch-review-threads` and `resolve-review-threads`
 * loaded long before any split existed. #326 moved the step that NAMES it out of
 * the agent and into `references/pr/{op}.md`, which changed which file spells the
 * name and nothing at all about what a spawn pays. Charging it to the PR-host row
 * would make that row a measure of a file this work neither wrote nor edited, and
 * would bury what the row does measure — the `pr/` bodies, none of which reaches
 * 4_500 ch — under a term four times their size.
 *
 * What the exclusion owes in return (ADR-025): the excluded term is RECORDED, not
 * dropped. Shape `2c-ex` of the four-shape table prints the same maximum with
 * this file charged, and the file's own size is pinned by equality as
 * GITHUB_API_MD_CHARS in tests/tracker/byte-budget.test.ts — so an exclusion can
 * never become a place a reference grows unwatched.
 */
export const LOADED_SET_WRITTEN_EXCLUSIONS: readonly string[] = ['github-api.md'];

/**
 * `max over PR_HOST_OPS of ( sum of every reference that op can name in one spawn )`
 * — the PR-host path's own term.
 *
 * ITS OWN ROW, for the reason each provider has one (D-LOADED-SET-PER-PROVIDER).
 * `references/pr/` is installed under EVERY tracker because pull requests, PR
 * reviews and PR checks stay on GitHub whatever issues the project files
 * elsewhere. So a PR operation costs the same bytes on all three paths, and
 * folding it into the per-provider rows would price one cost three times while
 * leaving the shape a reader actually asks about — what does a PR spawn load? —
 * printed nowhere.
 *
 * `exclusions` is a parameter rather than a closed-over constant so the recorded
 * `2c-ex` row can ask THIS function for the unexcluded figure. One measurement
 * read two ways, instead of a second near-copy free to drift from it.
 */
export function worstCasePrHostLoad(
  exclusions: readonly string[] = LOADED_SET_WRITTEN_EXCLUSIONS,
): OpMax {
  return maxOver(PR_HOST_OPS, op => prHostOpLoad(op, exclusions));
}

/**
 * One PR-host op's one-spawn load: its `pr/{op}.md` plus every reference its load
 * instructions can name, less `exclusions`. The ONE measure both the row's maximum
 * above and the per-op cap in byte-budget.test.ts read, so the cap and the row can
 * never price the same op two ways.
 */
export function prHostOpLoad(
  op: string,
  exclusions: readonly string[] = LOADED_SET_WRITTEN_EXCLUSIONS,
): number {
  return loadChars(summedForProvider('github', op), exclusions);
}

/**
 * max_op chars(references/tracker/github/{op}.md) — the largest single mechanics file.
 *
 * RECORDED ONLY, never a term of a gate (D-LOADED-SET-ONE-SPAWN): the file it names
 * is already inside some op's one-spawn load.
 */
export function largestTrackerReference(): OpMax {
  return maxOver(TRACKER_GITHUB_OPS, op => referenceChars(trackerRefRel(op)));
}

/**
 * The `max over ops` terms, scoped to one PROVIDER.
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
 *
 * largestProviderReference is RECORDED ONLY (D-LOADED-SET-ONE-SPAWN).
 */
export function largestProviderReference(provider: string): OpMax {
  return maxOver(TRACKER_OPS, op => referenceChars(providerRefRel(provider, op)));
}

export function worstCaseProviderLoad(provider: string): OpMax {
  return maxOver(TRACKER_OPS, op => loadChars(summedForProvider(provider, op)));
}

/** The per-spawn tool-call contract: its size under an MCP-backed provider, 0 on every other path. */
export function contractTerm(provider: string): number {
  return MCP_BACKED_PROVIDERS.includes(provider) ? referenceChars(MCP_CONTRACT_REL) : 0;
}

/**
 * The whole loaded-set formula for one tracker provider, the GitHub path included.
 *
 * D-LOADED-SET-ONE-SPAWN — a spawn runs ONE operation, plus whatever its loaded
 * bodies hop to, so its reference cost is that operation's one-spawn load and
 * nothing besides:
 *
 *   the always-preloaded set
 *   + the per-spawn contract term (0 on the GitHub path)
 *   + max over TRACKER ops of chars(summedForProvider(provider, op))
 *
 * The rows used to add a fourth term, `max_op chars(tracker/{provider}/{op}.md)`, and
 * it double-counted: the largest mechanics file is itself inside some op's one-spawn
 * load, so the formula charged one file twice. It survived because it did real work
 * by coincidence — the unpriced setup-task step 1c → ensure-traceable-issue hop was
 * about the size of the largest file, so the phantom term stood in for a real one.
 * With every in-spawn hop priced (D-BODY-HOP-CLOSURE) the stand-in is no longer
 * needed, and keeping it would bill every row for a file no spawn loads twice.
 *
 * The term is RECORDED, not dropped (ADR-025): largestTrackerReference() and
 * largestProviderReference() still print as rows of the shape table, so the size of
 * the biggest single file stays on the record for whoever next edits it.
 */
export function providerLoadedSet(provider: string): number {
  return PRELOADED + contractTerm(provider) + worstCaseProviderLoad(provider).value;
}

// ---------------------------------------------------------------------------
// The body-hop closure — sibling ops a LOADED BODY names [D-BODY-HOP-CLOSURE]
// ---------------------------------------------------------------------------
//
// nameableFrom() prices what the AGENT names as a `references/…` path. A mechanics
// body can also make the spawn load more by naming another OPERATION — "invoke
// `ensure-traceable-issue`", "follow … in this operation's `backlink-shipped-issues`
// reference" — and no path literal marks that. The scan below reads every body a
// spawn loads, finds every op name in it, and takes each one as a load hop unless a
// row of INFORMATIONAL_OP_MENTIONS explains why it is not: DEFAULT-DENY. A mention
// nobody classified is priced or it fails, the only direction an absence-based check
// can be trusted in (PF-064).
//
// WRITTEN NON-GOALS, so a green run is not read as covering them (PF-064):
//   - git.md's own `## Operation:` sections are not scanned. The agent is preloaded
//     whole on every spawn, so an op named there resolves against text the spawn
//     already holds (associate-release's "`backlink-shipped-issues`' step 0" is
//     git.md's own step 0), and a load the agent makes is spelled as a `references/…`
//     literal or a mechanics pointer, which nameableFrom() scans in both directions.
//   - references/decision-markers.md is in no spawn's load set
//     (D-CROSS-CUTTING-ON-DEMAND), so an op it names is a glossary entry, not a hop.
//   - Always-loaded text — the agent above its first op, the preloaded skills, the
//     per-spawn tool-call contract — is not a per-op body. It is held to the stricter
//     rule alwaysLoadedBodies() documents: no hop at all.

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One operation name, bare or backticked, as a whole token — built from ALL_OPS,
 * longest first, so `fetch-issue` never matches inside `fetch-issues-batch`.
 *
 * BARE as well as backticked because the prose is not consistent about it: the
 * frozen status-lines fixture samples `(same slug logic as setup-task)` from the
 * GitHub ensure-traceable-issue reference, and a backtick-only matcher would read that
 * line as naming nothing. The token boundary is `[A-Za-z0-9_-]` on both sides and
 * nothing wider, so a path segment (`references/pr/check-ci-status.md`) or a bare file
 * name still counts as naming its op: maximal recall, because a shape this matcher
 * cannot express is a hop nothing prices.
 *
 * Read it through collectOpMentions(), never with `.test()`/`.exec()`: it is global,
 * and a shared global regex carries `lastIndex` from one caller into the next.
 */
export const OP_MENTION_RE = new RegExp(
  '(?<![A-Za-z0-9_-])`?(' +
    [...ALL_OPS].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|') +
    ')`?(?![A-Za-z0-9_-])',
  'g',
);

/** One operation named inside a body. */
export interface OpMention {
  /** The body's skill-relative reference path, or an always-loaded body's label. */
  readonly file: string;
  /** The operation named. */
  readonly target: string;
  /** The whole line carrying the mention — what an INFORMATIONAL row's anchor is matched against. */
  readonly line: string;
  /** Where the matched token (backticks included) starts in `line`. */
  readonly column: number;
}

/** Named collector: every operation named in `body`, one entry per occurrence. */
export function collectOpMentions(file: string, body: string): OpMention[] {
  const matcher = new RegExp(OP_MENTION_RE.source, OP_MENTION_RE.flags);
  const mentions: OpMention[] = [];
  for (const line of body.split('\n')) {
    for (const match of line.matchAll(matcher)) {
      mentions.push({ file, target: match[1], line, column: match.index });
    }
  }
  return mentions;
}

/**
 * A body naming its OWN operation — `tracker/jira/setup-task.md` saying `setup-task`,
 * learn-conventions.md saying `learn-conventions`. Never a hop: the file it would load
 * is the file being read. Keyed on the file's basename, so a SHARED document
 * (publication-gate.md, github-api.md) owns no operation and every op it names is
 * classified like any other mention.
 */
function namesItsOwnOp(mention: OpMention): boolean {
  return path.posix.basename(mention.file, '.md') === mention.target;
}

/** One op mention that is NOT a load hop, and why. */
export interface InformationalOpMention {
  /** The body, spelled as OpMention.file spells it. */
  readonly file: string;
  /** The operation the line names. */
  readonly target: string;
  /** A verbatim substring of the ONE line carrying the mention; it must itself name `target`. */
  readonly anchor: string;
  /** Why the mention costs the spawn nothing. */
  readonly why: string;
}

/**
 * D-BODY-HOP-CLOSURE, the exemption half — every op a loaded or always-loaded body
 * names WITHOUT making the spawn load it, each with its reason.
 *
 * CLOSED. A row is the only way a mention escapes being priced; it is keyed to one
 * line by a verbatim anchor, never to a whole file, so a second mention of the same
 * op in the same file is still a hop until someone classifies it. The test file holds
 * the table to five things: every row is consulted by a live scan; its anchor still
 * sits on one line of its file and names its target; the clause around the mention
 * carries no load verb; its reason clears a length floor; and what it would cost if it
 * WERE a hop is printed. A prohibition and its exemption table are one authority
 * (PF-067): the scan that reports an unpriced hop reads this table, and the table is
 * checked against the scan, so neither can drift without the other going red.
 *
 * Per provider where the prose differs, so a row exempts one file's line and never a
 * sibling provider's.
 */
export const INFORMATIONAL_OP_MENTIONS: readonly InformationalOpMention[] = [
  // create-release cites the bound it shares with backlink-shipped-issues.
  ...TRACKER_PROVIDERS.map(({ id }) => ({
    file: `tracker/${id}/create-release.md`,
    target: 'backlink-shipped-issues',
    anchor: 'the same bound `backlink-shipped-issues` applies',
    why: 'Cites where the ≤50 bound comes from; the bound itself is written on the same line, so ' +
      'nothing in backlink-shipped-issues\' mechanics is needed to apply it.',
  })),
  // ensure-pr-ready step 4b prefers a reference an EARLIER op returned.
  ...TRACKER_PROVIDERS.flatMap(({ id }) => ['setup-task', 'ensure-traceable-issue'].map(target => ({
    file: `tracker/${id}/ensure-pr-ready.md`,
    target,
    anchor: 'returned by `setup-task` / `ensure-traceable-issue` for this branch',
    why: 'Names which earlier operation produced the issue reference the caller already holds; ' +
      'it reads that Output value and runs none of the producing operation\'s steps.',
  }))),
  ...['jira', 'linear'].map(id => ({
    file: `tracker/${id}/ensure-pr-ready.md`,
    target: 'gather-release-evidence',
    anchor: '`gather-release-evidence` reports the absence',
    why: 'Says what a DIFFERENT operation reports later, in its own spawn, so this one can decline ' +
      'to claim an effect; ensure-pr-ready never runs the release-evidence steps.',
  })),
  // ensure-traceable-issue's title rule names where it came from.
  {
    file: 'tracker/github/ensure-traceable-issue.md',
    target: 'setup-task',
    anchor: '(same slug logic as setup-task)',
    why: 'Provenance of the title rule, not a load: the title is taken from TASK_DESCRIPTION, and ' +
      'the spawn that needs setup-task\'s branch-slug steps (its step 1c) already holds them. ' +
      'This line is sampled by the frozen status-lines fixture and cannot be reworded.',
  },
  ...['jira', 'linear'].map(id => ({
    file: `tracker/${id}/ensure-traceable-issue.md`,
    target: 'setup-task',
    anchor: '(same slug logic as `setup-task`)',
    why: 'Provenance of the summary/title rule, not a load: the text is taken from ' +
      'TASK_DESCRIPTION, and the spawn that needs setup-task\'s branch-slug steps (its step 1c) ' +
      'already holds them.',
  })),
  {
    file: 'tracker/github/fetch-issue.md',
    target: 'backlink-shipped-issues',
    anchor: 'in this operation\'s sibling `backlink-shipped-issues` reference',
    why: 'Cites where the RATIONALE for stripping one leading # is written; the anchored grammar ' +
      'and the strip it drives are both stated inline, so the pre-flight runs without that file.',
  },
  {
    file: 'tracker/linear/setup-task.md',
    target: 'ensure-pr-ready',
    anchor: '`ensure-pr-ready` renders the PR link line explicitly',
    why: 'Explains why the server\'s branch auto-link is not relied on: a later operation writes ' +
      'the PR link line in its own spawn, and setup-task runs none of its steps.',
  },
  // PR-host bodies name their neighbours in the review loop.
  {
    file: 'pr/resolve-review-threads.md',
    target: 'fetch-review-threads',
    anchor: '1s between operations). `fetch-review-threads`',
    why: 'Names the producer of THREAD_MAP to explain why the ≤50 bound can bite; this op consumes ' +
      'that map as an input and never runs the fetch.',
  },
  {
    file: 'pr/resolve-review-threads.md',
    target: 'check-merge-readiness',
    anchor: 'since `check-merge-readiness` will otherwise show them as',
    why: 'States the downstream consequence of an untouched thread — a later report counts it — ' +
      'to justify the TRUNCATED status; no merge-readiness step runs here.',
  },
  ...['post-review-summary', 'post-resolution-summary'].map(target => ({
    file: 'publication-gate.md',
    target,
    anchor: 'Applies to **`post-review-summary` and `post-resolution-summary` only.**',
    why: 'Scope statement naming the two operations the gate applies to. Both load this file; ' +
      'neither needs the other\'s PR-host mechanics to apply it.',
  })),
  // github-api.md is loaded by both review-thread operations (LOADED_SET_WRITTEN_EXCLUSIONS
  // excludes its CHARACTERS from a gate, never its mentions from this scan).
  {
    file: 'github-api.md',
    target: 'create-release',
    anchor: 'because `create-release` composes notes',
    why: 'Explains why the release-notes file pair is named apart from the body pair; the spawns ' +
      'that load this file run the review-thread recipes and never the release steps.',
  },
  ...['fetch-review-threads', 'resolve-review-threads'].map(target => ({
    file: 'github-api.md',
    target,
    anchor: 'Used by the `fetch-review-threads` and `resolve-review-threads` Git agent operations.',
    why: 'Section header naming the two operations that use the Review Threads recipes; both ' +
      'already load this file, and neither loads the other\'s pr/ steps.',
  })),
  {
    file: 'github-api.md',
    target: 'fetch-review-threads',
    anchor: 'as `fetch-review-threads` step 2 defines',
    why: 'A citation inside the Enumerate recipe, which only fetch-review-threads runs, with the ' +
      'trust rule loaded; resolve-review-threads consumes THREAD_MAP and never enumerates.',
  },
  {
    file: 'github-api.md',
    target: 'resolve-review-threads',
    anchor: 'Maximum threads to process in `resolve-review-threads`: ≤50',
    why: 'States the resolve bound among the pagination limits; the fetch spawn that also loads ' +
      'this file reads it as a number, never as steps to run.',
  },
  // Always-loaded text: held to "no hop at all", so its informational mentions are listed too.
  ...['resolve-review-threads', 'backlink-shipped-issues'].map(target => ({
    file: 'agents/git.md',
    target,
    anchor: '**Rate backpressure for batch ops** (`resolve-review-threads` and `backlink-shipped-issues`)',
    why: 'Scope of the always-loaded D4 backpressure rule — the two batch operations it governs; ' +
      'the rule itself is written on the same line, so no mechanics load follows.',
  })),
  {
    file: 'skills/git/SKILL.md',
    target: 'learn-conventions',
    anchor: 'Naming conventions: `learn-conventions` writes `.devflow/conventions.md`',
    why: 'Doctrine naming the one authority for naming conventions; the operation loads its own ' +
      'reference, and only when .devflow/conventions.md is absent.',
  },
];

function matchInformationalRow(
  mention: OpMention,
  table: readonly InformationalOpMention[],
): InformationalOpMention | undefined {
  return table.find(row =>
    row.file === mention.file && row.target === mention.target && mention.line.includes(row.anchor));
}

/**
 * The bound on the closure loop. The scan enqueues each operation at most once, so a
 * live closure takes at most ALL_OPS.length steps; four times that is room for a
 * roster that grows, not for a chain that deepens. Crossing it means the visited set
 * stopped working, and the scan throws rather than spin.
 */
export const CLOSURE_STEP_LIMIT = 4 * ALL_OPS.length;

/** What one spawn's body-hop closure found. */
export interface BodyHopClosure {
  /** Every per-op reference the spawn can be made to load. */
  readonly files: ReadonlySet<string>;
  /** The operations whose own load the closure took, in visit order (the spawn's own op first). */
  readonly visited: readonly string[];
  /** Mentions taken as load hops — every one no row explains. */
  readonly hops: readonly OpMention[];
  /** Mentions an INFORMATIONAL_OP_MENTIONS row explained, with that row. */
  readonly informational: readonly { readonly mention: OpMention; readonly row: InformationalOpMention }[];
  /** Bodies actually read, in visit order — the provenance the non-vacuity arm checks. */
  readonly scanned: readonly string[];
  /** Files the scan could name but not read. */
  readonly unreadable: readonly string[];
  /** Loop iterations taken. */
  readonly steps: number;
}

export interface ClosureOptions {
  /** The body reader — injected so a probe can seed one body in memory (PF-055). */
  readonly readReference?: (rel: string) => string | null;
  readonly informational?: readonly InformationalOpMention[];
  readonly stepLimit?: number;
}

/** An op's own load as the SCAN sees it: nameableFrom()'s file set, instantiated for `provider`. */
function scannedOwnLoad(
  provider: string,
  op: string,
  readReference: (rel: string) => string | null,
): string[] {
  return [...nameableFrom(op, readReference)]
    .map(rel => (rel === trackerRefRel(op) ? providerRefRel(provider, op) : rel));
}

/**
 * D-BODY-HOP-CLOSURE, the scan half — every reference ONE spawn of `op` under
 * `provider` can be made to load, found by reading the bodies rather than trusting
 * the model.
 *
 * Starts from the op's own load as nameableFrom() scans it, reads every body in it,
 * and follows each op a body names into THAT op's own load — to a fixed point, not
 * one hop: a mention inside a hop target is loaded in the same spawn as the hop
 * itself. A VISITED set makes each operation's load taken once, so a cycle ends, and
 * CLOSURE_STEP_LIMIT bounds the loop outright.
 *
 * Classification, in order: a body naming its own op is not a hop; a mention an
 * INFORMATIONAL_OP_MENTIONS row explains is not a hop; EVERY OTHER mention is a hop.
 * Default-deny is the point: a new pointer lands in `hops` whether or not anyone
 * thought to model it.
 */
export function nameableFromProvider(
  provider: string,
  op: string,
  options: ClosureOptions = {},
): BodyHopClosure {
  const readReference = options.readReference ?? readReferenceFromDisk;
  const table = options.informational ?? INFORMATIONAL_OP_MENTIONS;
  const stepLimit = options.stepLimit ?? CLOSURE_STEP_LIMIT;

  const files = new Set<string>();
  const visited: string[] = [];
  const enqueued = new Set<string>([op]);
  const queue: string[] = [op];
  const hops: OpMention[] = [];
  const informational: { mention: OpMention; row: InformationalOpMention }[] = [];
  const scanned: string[] = [];
  const unreadable: string[] = [];
  let steps = 0;

  while (queue.length > 0) {
    steps += 1;
    if (steps > stepLimit) {
      throw new Error(
        `the body-hop closure for ${provider}/${op} took more than ${stepLimit} steps — each ` +
        'operation is enqueued once, so this is a defect in the scan, not a deep chain',
      );
    }
    const current = queue.shift()!;
    visited.push(current);
    for (const rel of scannedOwnLoad(provider, current, readReference)) {
      if (files.has(rel)) continue;
      files.add(rel);
      const body = readReference(rel);
      if (body === null) {
        unreadable.push(rel);
        continue;
      }
      scanned.push(rel);
      for (const mention of collectOpMentions(rel, body)) {
        if (namesItsOwnOp(mention)) continue;
        const row = matchInformationalRow(mention, table);
        if (row !== undefined) {
          informational.push({ mention, row });
          continue;
        }
        hops.push(mention);
        if (!enqueued.has(mention.target)) {
          enqueued.add(mention.target);
          queue.push(mention.target);
        }
      }
    }
  }
  return { files, visited, hops, informational, scanned, unreadable, steps };
}

/** One always-loaded body, labelled as INFORMATIONAL_OP_MENTIONS spells it. */
export interface AlwaysLoadedBody {
  readonly file: string;
  readonly text: string;
}

/** The label the agent's always-loaded part carries in mentions and table rows. */
export const AGENT_ALWAYS_LOADED = 'agents/git.md';

/**
 * Every body a Git spawn holds before it runs any operation: the agent above its
 * first `## Operation:` heading, the two preloaded skills, and the tool-call contract
 * an MCP-backed provider reads once per spawn.
 *
 * Held to a STRICTER rule than a per-op body — no hop at all. An op named here as a
 * load would be paid by every spawn, which no per-op row can express, so the only
 * mentions allowed are the `## Operations` dispatch table (the agent's index of
 * itself) and INFORMATIONAL_OP_MENTIONS rows. The project-key preamble line used to
 * send every spawn to the `learn-conventions` operation's UNTRUSTED-strings block, a
 * reference loaded only when .devflow/conventions.md is absent; it now states the rule
 * itself, and this is what keeps the pointer from coming back.
 *
 * `content` is a parameter so the probe can seed the agent in memory.
 */
export function alwaysLoadedBodies(
  content: string = GIT_AGENT.content,
  readReference: (rel: string) => string | null = readReferenceFromDisk,
): AlwaysLoadedBody[] {
  const bodies: AlwaysLoadedBody[] = [
    { file: AGENT_ALWAYS_LOADED, text: crossCuttingSlice(content) },
    { file: 'skills/git/SKILL.md', text: readFileSync(path.join(skillsDir(), 'git', 'SKILL.md'), 'utf-8') },
    {
      file: 'skills/worktree-support/SKILL.md',
      text: readFileSync(path.join(skillsDir(), 'worktree-support', 'SKILL.md'), 'utf-8'),
    },
  ];
  const contract = readReference(MCP_CONTRACT_REL);
  if (contract !== null) bodies.push({ file: MCP_CONTRACT_REL, text: contract });
  return bodies;
}

/** The op a line of the agent's `## Operations` dispatch table names in its first cell, if any. */
export function dispatchRowOp(line: string): string | null {
  return /^\| `([a-z0-9-]+)` \|/.exec(line)?.[1] ?? null;
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
