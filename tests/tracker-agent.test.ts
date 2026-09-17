/**
 * Static content guards for the Tracker agent (P3a-S9, P3a-S16, P3a-S10).
 *
 * The Tracker agent is spawned only by the session-start setup directive, runs in
 * the background, and its summary is never seen — so the FILE IT WRITES is its
 * only report surface. That makes every rule in its prompt unobservable at
 * runtime: nothing downstream fails loudly when the prompt stops saying
 * "increment the counter before deleting the claim file". These guards are the
 * only place that regression is visible, which is why the prompt's safety
 * literals are pinned here rather than described in prose (PF-060: a prose
 * prohibition is not a guard).
 *
 * Structure mirrors tests/git-agent.test.ts: the agent is read through
 * resolveAgentSource (dist-preferred, src-fallback, fail-loud), never through a
 * literal agent path, and every negative is driven by a NAMED COLLECTOR that a
 * known-bad sample also drives — so a negative can never pass because the
 * extractor silently stopped returning anything (PF-018).
 *
 * Two contracts are asserted here that no other file can assert:
 *   - the agent declares NO `tools:` key (G3.2). provider-scope.test.ts pins the
 *     same property for the Git agent only, deliberately scoping its vendor arm
 *     away from src/assets/agents/ so the QA agent may keep naming Chrome tools.
 *     The Tracker agent's omission has a different reason (unenumerable
 *     user-configured tracker servers) and therefore needs its own site.
 *   - the `~/.devflow/tracker.md` SCHEMA (§14.3) — this agent owns the writer
 *     half of it (conflict C12). The reader half lands in 3a-4, and both halves
 *     bind to TRACKER_SCHEMA_SECTIONS in tests/helpers.ts: a two-sided equality
 *     test cannot catch drift in its own oracle, so the oracle is shared.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { homedir, tmpdir } from 'os';
import * as path from 'path';

import { scriptsDir } from '../src/core/assets.js';
import { DEVFLOW_PLUGINS, getAllAgentNames } from '../src/core/plugins.js';
import { loadShippedDefaults } from '../src/core/agent-models.js';
import {
  ROOT,
  TRACKER_SCHEMA_FRONTMATTER_KEYS,
  TRACKER_SCHEMA_SECTIONS,
  TRACKER_TEMPLATE_FENCE_TAG,
  collectTrackerSchemaRows,
  collectTrackerTemplate,
  collectTrackerTemplateHeadings,
  resolveAgentSource,
  resolveAllAgents,
  splitFrontmatter,
} from './helpers.js';

/** Registry key, filename stem and (capitalised) frontmatter name are one identity (PF-021). */
const TRACKER_SLUG = 'tracker';
const TRACKER_NAME = 'Tracker';

const TRACKER_SOURCE = resolveAgentSource(TRACKER_SLUG);
const TRACKER_TEXT = TRACKER_SOURCE.content;

const ROSTER_SRC = path.join(ROOT, 'src', 'assets', 'commands', '_partials', '_roster.mds');

// ---------------------------------------------------------------------------
// Named collectors — each is driven by a guard AND by a known-bad probe
// ---------------------------------------------------------------------------

/**
 * Column-0 frontmatter keys. Copied in shape from provider-scope.test.ts's
 * extractor: an indented `tools:` is a nested value and a YAML list item never
 * reaches column 0, so neither is a declaration.
 */
export function collectFrontmatterKeys(inner: string): string[] {
  return inner
    .split('\n')
    .map(l => /^([A-Za-z_][\w-]*):/.exec(l)?.[1])
    .filter((k): k is string => k !== undefined);
}

/** Lines naming a delegation primitive. The Tracker agent never spawns anything. */
export function collectDelegationLiterals(content: string): string[] {
  return content
    .split('\n')
    .filter(l => /\bAgent\(|\bsubagent_type\b/.test(l))
    .map(l => l.trim());
}

/**
 * One rule per write-side primitive, each LABELLED.
 *
 * Declared beside the collector rather than inside it because a multi-rule absence
 * guard is only as live as its least-exercised rule: a probe that seeds two lines
 * against six patterns certifies the other four by not contradicting them, which is
 * PF-064's first blindness with the corpus shrunk to the rule list. The labels are
 * what let the probe below drive ONE seeded line per rule and assert the two lists
 * are the same length, so a seventh rule cannot land unprobed.
 */
export const WRITE_SIDE_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ['git commit', /\bgit\s+commit\b/],
  ['git push', /\bgit\s+push\b/],
  ['git add', /\bgit\s+add\b/],
  ['gh create', /\bgh\s+\w+\s+create\b/],
  ['curl', /\bcurl\b/],
  ['wget', /\bwget\b/],
];

/**
 * Lines naming a write-side git or forge command. The agent is read-only
 * (§14.9 constraint 12) and its write path runs no git command at all.
 */
export function collectWriteSideCommands(content: string): string[] {
  return content
    .split('\n')
    .filter(l => WRITE_SIDE_RULES.some(([, pattern]) => pattern.test(l)))
    .map(l => l.trim());
}

/**
 * Lines naming the interactive-question primitive.
 *
 * Plan §3.3 deleted the question step outright: this agent runs from a
 * SessionStart hook's directive, where there is no human turn to answer a
 * prompt, and §14.2 retired `interactive setup required — run /plan in an
 * interactive session` for exactly that reason ("the phrasing promises a prompt
 * that never comes"). A question here would not merely be unreachable — it would
 * hang a background spawn holding the claim file, and the claim-file lifecycle's
 * recovery path treats a held claim as a live agent, so nothing would reclaim it
 * until the staleness bound expired.
 */
export function collectQuestionPrimitives(content: string): string[] {
  return content
    .split('\n')
    .filter(l => /\bAskUserQuestion\b/.test(l))
    .map(l => l.trim());
}

/**
 * Foreign provider literals. `src/assets/agents/` is inside
 * provider-scope.test.ts's PROVIDER_SCAN_ROOTS with an allowlist confined to the
 * Git agent's resolution preamble, so this agent must name no provider at all.
 * That is not merely guard-appeasement: the provider token arrives in the spawn
 * directive, so a provider NAME in the prompt would be a second resolution site
 * (PF-023) as well as Phase-3b/3c vocabulary landing early (ADR-003).
 */
export const FOREIGN_PROVIDER_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ['jira', /\bjira\b/i],
  ['linear', /\blinear\b/i],
];

export function collectForeignProviderLiterals(content: string): string[] {
  return content
    .split('\n')
    .filter(l => FOREIGN_PROVIDER_RULES.some(([, token]) => token.test(l)))
    .map(l => l.trim());
}

/**
 * Named collector: lines instructing a FLAGGED `rm`.
 *
 * `rm -f` is denied by devflow's recommended deny-list, so an agent told to use one
 * stalls on a permission prompt it cannot answer — in the background, holding the
 * claim file, with the next session's gate reading that held claim as a live agent
 * (PF-003). `unlink` is the instruction; this collector is the other half.
 *
 * Short and long flags alike: the predicate is a dash after the verb, not a letter
 * after a dash, because `rm --force` is the same denied command as `rm -f` and the
 * narrower spelling let it through.
 *
 * NOT COVERED, deliberately (PF-064): a flag passed AFTER the operand
 * (`rm "$X" -f`). It is unnatural in a prompt and has never been written; a new
 * spelling gets a row in the probe below in the same commit as the prose that needs
 * it (ADR-025).
 */
export function collectFlaggedRm(content: string): string[] {
  return content
    .split('\n')
    .filter(l => /\brm\s+-/.test(l))
    .map(l => l.trim());
}

/**
 * Named collector: lines that would `chmod` the SHARED PARENT directory.
 *
 * `~/.devflow` is 0755 and shared by every other feature, so narrowing it is a
 * cross-feature break; the file inside it is the only thing this agent may re-mode.
 *
 * The predicate is "a chmod whose operand NAMES the devflow directory and does not
 * continue into it". `\S*` before the token admits every way the directory is
 * spelled in a prompt — `~/.devflow`, `"$HOME/.devflow"`, `$HOME/.devflow`,
 * `"$TRACKER_DEVFLOW_DIR"` — which the earlier `[A-Za-z_]*devflow` anchor could not:
 * it required the character before `devflow` to be a letter, underscore, `$`, `{` or
 * `"`, so every tilde- and slash-prefixed spelling walked straight through. The
 * trailing `\b(?!\/)` is what keeps the legitimate site green: a path that CONTINUES
 * past the directory (`"$TRACKER_DEVFLOW_DIR/tracker.md"`) is the file, not the
 * parent. The mode operand is `\S+` rather than `\d+` because `chmod go-rwx` narrows
 * the parent exactly as `chmod 700` does.
 */
export function collectParentChmod(content: string): string[] {
  return content
    .split('\n')
    .filter(l => /chmod\s+\S+\s+\S*(devflow|DEVFLOW_DIR)\b(?!\/)/i.test(l))
    .map(l => l.trim());
}

/**
 * Named collector: heredoc openers whose delimiter is UNQUOTED.
 *
 * The composed file carries scanned history strings and tracker text; an unquoted
 * delimiter expands them, which is command substitution over third-party input.
 */
export function collectUnquotedHeredocs(content: string): string[] {
  return content
    .split('\n')
    .filter(l => /<<-?\s*\w/.test(l))
    .map(l => l.trim());
}

/**
 * Named collector: lines that SHELL OUT to read `tracker.md`.
 *
 * Readers open it with the Read tool and an absolute path (PF-035): a shell read
 * puts the file's third-party content through word splitting and truncates silently
 * on the size bound the file-level rules set.
 *
 * Both spellings of the target are matched — the basename and the `$TRACKER_FILE`
 * variable the agent binds it to — and the verb may carry flags before the operand,
 * which the earlier `\b(cat|head|tail)\s+\S*tracker\.md` anchor forbade: it required
 * the path to be the verb's FIRST word, so `head -5 ~/.devflow/tracker.md` and
 * `cat "$TRACKER_FILE"` both passed (PF-064 — matcher expressiveness).
 *
 * NOT COVERED, deliberately: a read through a variable this agent does not define,
 * and a verb outside the list below.
 */
export function collectShellReadsOfTrackerFile(content: string): string[] {
  return content
    .split('\n')
    .filter(l => /\b(cat|head|tail|less|sed|awk|grep)\b[^\n]*(tracker\.md|\$\{?TRACKER_FILE\b)/.test(l))
    .map(l => l.trim());
}

/**
 * Named collector: every site in the agent's SHELL that resolves the devflow
 * directory from the environment.
 *
 * Scoped to the bash fences, never the prose: `## The write` names the expression
 * in order to forbid a second one, and a whole-file count would read that
 * prohibition as the violation it prohibits. PF-066's fourth defect is a duplicated
 * resolution — two spellings that can disagree, with the disagreement failing closed
 * and silent, because the scrubber is looked up under one root while the file is
 * written under another.
 */
export function collectDevflowDirResolutions(fences: readonly string[]): string[] {
  return [...fences.join('\n').matchAll(/\$\{DEVFLOW_DIR:-[^}]*\}/g)].map(m => m[0]);
}

/**
 * Named collector: sites instructing a write that ADVANCES the attempt counter.
 *
 * The property is "this agent never advances `.tracker.attempts`", not "never
 * touches it" — `## Finishing` step 2 still DELETES it on a successful write, and
 * that delete is correct. So the predicate pairs an advancing verb with the counter
 * (by basename or by the phrase the prose uses for it) inside one wrapped sentence,
 * and the text is normalised first because the agent hard-wraps: a line-scoped
 * matcher would miss a verb and its object split across two lines, and pinning
 * where a sentence happens to break is what PF-057 warns against.
 *
 * NOT COVERED, deliberately (PF-064 — an absence guard is only ever as wide as its
 * matcher, so the edge is written down rather than inferred from a green run): an
 * instruction that names neither a listed verb nor the counter — "write one more
 * than you read" would pass. A new spelling gets a row in the probe below, in the
 * same commit as the prose that needs it (ADR-025).
 */
const COUNTER_ADVANCING_VERB =
  /\b(increment|increments|incremented|bump|bumps|bumped|advance|advances|advanced|raise|raises|raised)\b/gi;
const COUNTER_NAMED = /(\.tracker\.attempts|attempt counter)/i;
const COUNTER_WINDOW_CHARS = 140;

export function collectCounterIncrementSites(content: string): string[] {
  const text = content.replace(/\s+/g, ' ');
  const sites: string[] = [];
  for (const match of text.matchAll(COUNTER_ADVANCING_VERB)) {
    const at = match.index ?? 0;
    const window = text.slice(Math.max(0, at - COUNTER_WINDOW_CHARS), at + COUNTER_WINDOW_CHARS);
    if (COUNTER_NAMED.test(window)) sites.push(window.trim());
  }
  return sites;
}

/**
 * Named collector: every ```bash fence in the agent, dedented to column 0.
 *
 * The agent's security controls are SHELL PROGRAMS that nothing type-checks and
 * that review reads as prose — which is how four classic shell defects shipped
 * together in six lines of the write chain (PF-066). Extracting the fences is what
 * lets the guards below RUN them: a claim primitive is exclusive or it is not, and
 * only an execution can tell the two spellings apart (PF-068 rule 3).
 *
 * Fences are matched with the <= 3-space indentation bound Markdown itself uses,
 * so a fence nested inside a numbered list item is collected and dedented by its
 * own opening indent rather than skipped.
 */
export function collectBashFences(content: string): string[] {
  const fences: string[] = [];
  let open: { indent: number; body: string[] } | null = null;
  for (const line of content.split('\n')) {
    if (open === null) {
      const opening = /^( {0,3})```bash[ \t]*$/.exec(line);
      if (opening) open = { indent: opening[1].length, body: [] };
      continue;
    }
    if (/^ {0,3}```[ \t]*$/.test(line)) {
      fences.push(open.body.join('\n'));
      open = null;
      continue;
    }
    open.body.push(line.slice(open.indent));
  }
  return fences;
}

const BASH_FENCES = collectBashFences(TRACKER_TEXT);

/**
 * The one fence matching `predicate`. Throws — never `.find(…)!` and never a skip:
 * a renamed or deleted fence must fail by name here rather than make every arm
 * below assert something about `undefined`.
 */
function oneFence(label: string, predicate: (fence: string) => boolean): string {
  const hits = BASH_FENCES.filter(predicate);
  if (hits.length !== 1) {
    throw new Error(
      `${TRACKER_SOURCE.path}: expected exactly one ${label} bash fence, found ${hits.length}. ` +
      'The executed guards below run the agent\'s own shell; a fence that moved, was renamed or ' +
      'was split is a change to a security control, not a formatting change.',
    );
  }
  return hits[0];
}

/** `## Environment` — the one resolution of every path the other two fences use. */
const ENV_FENCE = oneFence('environment', f => f.includes('TRACKER_DEVFLOW_DIR="${DEVFLOW_DIR'));
/** `## Step 0` — the claim. */
const CLAIM_FENCE = oneFence('claim', f => f.includes('"$TRACKER_CLAIM"'));
/** `## The write` — compose, scrub, shape-gate, place. */
const WRITE_FENCE = oneFence('write-chain', f => f.includes('redact-secrets.cjs'));

/** The heredoc slot the agent fills with the composed file. */
const COMPOSED_PLACEHOLDER = '<the composed file, literally>';

/** The last `## ` heading of the template — the shape gate's tail anchor. */
const TEMPLATE_H2 = TRACKER_SCHEMA_SECTIONS.filter(section => section.startsWith('## '));
const TEMPLATE_TAIL_HEADING = TEMPLATE_H2[TEMPLATE_H2.length - 1];

/** A minimal composition that satisfies the chain's shape gate. No trailing newline:
 *  the heredoc line the placeholder sits on supplies exactly one. */
const COMPOSED_FILE = [
  '---',
  'provider: probe-token',
  'inferred-from: /probe @ 2026-01-01T00:00:00Z',
  '---',
  '',
  '## Project',
  'site: https://example.test',
  '',
  '## Dedup Strategy',
  'rung: entity-property',
  'evidence: probe reached the entity-property capability',
].join('\n');

const SCRUBBER = 'redact-secrets.cjs';

interface Sandbox {
  /** An isolated `$HOME`. The chain writes under `$HOME/.devflow`; never the real one (PF-060). */
  home: string;
  devflowDir: string;
  trackerFile: string;
  /** Every path `mktemp` handed the chain, one per line (see `runShell`). */
  tmplog: string;
}

const SANDBOXES: string[] = [];

function makeSandbox(): Sandbox {
  const home = mkdtempSync(path.join(tmpdir(), 'devflow-tracker-agent-'));
  if (home === homedir() || !home.startsWith(tmpdir())) {
    throw new Error(`refusing to run the agent's write chain against ${home} — not a temp root`);
  }
  SANDBOXES.push(home);
  const devflowDir = path.join(home, '.devflow');
  mkdirSync(path.join(devflowDir, 'scripts'), { recursive: true });
  copyFileSync(path.join(scriptsDir(), SCRUBBER), path.join(devflowDir, 'scripts', SCRUBBER));
  return {
    home,
    devflowDir,
    trackerFile: path.join(devflowDir, 'tracker.md'),
    tmplog: path.join(home, 'mktemp.log'),
  };
}

afterAll(() => {
  for (const home of SANDBOXES) rmSync(home, { recursive: true, force: true });
});

interface ShellRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run a script under the sandbox's `$HOME`, with `DEVFLOW_DIR` deliberately unset
 * so `## Environment`'s own `${DEVFLOW_DIR:-$HOME/.devflow}` fallback is the thing
 * under test.
 *
 * `instrument` wraps `mktemp` in a shell function that records every path it hands
 * out. That is how the cleanup claim is checked at the paths mktemp REALLY chose:
 * on macOS mktemp ignores `TMPDIR`, so a harness that points `TMPDIR` at a scratch
 * directory and then inspects it finds nothing and reports the chain clean
 * (PF-045, and the mis-measurement PF-066 records). The wrapper makes the
 * `mktemp` status that of a pipeline, so the one arm that drives a mktemp FAILURE
 * runs uninstrumented.
 */
function runShell(
  script: string,
  sandbox: Sandbox,
  opts: { instrument?: boolean; stub?: string } = {},
): ShellRun {
  const { instrument = true, stub = '' } = opts;
  const prelude = instrument
    ? `TRACKER_TMPLOG=${JSON.stringify(sandbox.tmplog)}\n` +
      'mktemp() { command mktemp "$@" | tee -a "$TRACKER_TMPLOG"; }\n'
    : '';
  // Built key by key rather than spread-and-delete: `DEVFLOW_DIR` must be ABSENT,
  // so that `## Environment`'s own `${DEVFLOW_DIR:-$HOME/.devflow}` fallback is
  // what resolves the paths under test.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'DEVFLOW_DIR') env[key] = value;
  }
  env.HOME = sandbox.home;
  const run = spawnSync('bash', ['-c', prelude + stub + script], { env, encoding: 'utf-8' });
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

/**
 * A `node` that terminates the shell instead of scrubbing — the PF-056 kill,
 * delivered at the exact point the scrubber would run.
 *
 * A signal sent from outside would be deferred until the foreground command
 * returned, so the stub raises it from inside: deterministic, with no sleep and no
 * poll. What it models is the documented background outcome — the agent is killed
 * with `$RAW`, the PRE-scrub composition, already on disk.
 */
const KILLED_MID_SCRUB = 'node() { command kill -TERM $$; }\n';

/**
 * A `node` that stages a PERFECTLY VALID scrubbed file and STILL exits non-zero.
 *
 * The scrubber's refusal is the one failure the shape gate cannot also catch: an
 * empty or truncated body is refused by `[ -s ]` and the two greps whatever the
 * operator between them is, so an arm driven by a bad body proves nothing about the
 * `&&`. Here the size test and both greps PASS, and the scrubber's exit status is
 * the only thing standing between the composition and the placement — which is
 * exactly the property `toContain('&&')` claimed and could not check.
 */
const SCRUBBER_REFUSES = 'node() { command cat "$2" > "$3"; return 3; }\n';

/** Every path the instrumented `mktemp` handed out during a run. */
function recordedTemps(sandbox: Sandbox): string[] {
  if (!existsSync(sandbox.tmplog)) return [];
  return readFileSync(sandbox.tmplog, 'utf-8').split('\n').filter(l => l.trim() !== '');
}

/** Files the chain staged inside `~/.devflow` and did not clean up. */
function stagingResidue(sandbox: Sandbox): string[] {
  return readdirSync(sandbox.devflowDir).filter(entry => entry.startsWith('.tracker-staged'));
}

/**
 * The write chain, with the heredoc slot instantiated — what the agent actually
 * runs. An empty body removes the placeholder LINE rather than blanking it, because
 * a blank line is one byte and the size gate is about zero.
 */
function writeChain(body: string, fence: string = WRITE_FENCE): string {
  if (!fence.includes(COMPOSED_PLACEHOLDER)) {
    throw new Error(`the write fence no longer carries '${COMPOSED_PLACEHOLDER}' — nothing to compose into`);
  }
  const instantiated = body === ''
    ? fence.replace(`${COMPOSED_PLACEHOLDER}\n`, '')
    : fence.replace(COMPOSED_PLACEHOLDER, body);
  return `${ENV_FENCE}\n${instantiated}`;
}

/** The create-exclusive placement the scrub gate must guard. Named once. */
const PLACEMENT = 'ln "$SCRUBBED" "$TRACKER_FILE"';

/** Backslash continuations joined, so one logical statement is one string. */
function joinContinuations(fence: string): string {
  return fence.replace(/\\\n[ \t]*/g, ' ');
}

/**
 * Named collector: the ONE logical statement in which the scrubber is invoked.
 *
 * `toContain('&&')` over the fence was satisfied by the `&&` joining the two
 * `mktemp`s and by prose, and said nothing about WHICH commands the operator binds
 * — so a rewrite of the gate as `scrub | tee stage && place`, or as two statements
 * separated by `;`, kept it green while deleting the whole fail-closed property
 * (PF-066: a security control expressed as a shell chain in a prompt is a program
 * nothing type-checks).
 *
 * The statement is what matters because `&&` guarantees nothing across a statement
 * boundary: continuations are joined first, then the text is cut at every `;` and
 * every `|`, which are exactly the separators that end an `&&` chain's reach. The
 * scrubber's own fragment is returned, so a chain in which the scrubber's status is
 * hidden behind a pipe comes back WITHOUT the placement and the guard goes red.
 *
 * `null` when the scrubber is named in no statement or in more than one — an
 * ambiguous chain is reported rather than resolved by first-wins, which is how a
 * second, ungated invocation would otherwise pass.
 */
export function collectScrubChain(fence: string): string | null {
  const statements = joinContinuations(fence)
    .split('\n')
    .flatMap(line => line.split(/[;|]/));
  const hits = statements.filter(s => s.includes(SCRUBBER));
  return hits.length === 1 ? hits[0].trim() : null;
}

/**
 * Desugar the `&&` that follows the scrub invocation into a statement break.
 *
 * The known-bad spelling, produced from the REAL fence rather than hand-written, so
 * the probe cannot drift away from the chain it is the negative of. Spelling-
 * independent: it replaces the first `&&` on the scrubber's own logical line, so it
 * keeps working when the chain is reflowed.
 */
function breakScrubChain(fence: string): string {
  return joinContinuations(fence)
    .split('\n')
    .map(line => (line.includes(SCRUBBER) ? line.replace(/\s+&&\s+/, '\n') : line))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Frontmatter and identity
// ---------------------------------------------------------------------------

describe('Tracker agent frontmatter', () => {
  it('resolves through the shared resolver and is registry-declared (PF-021)', () => {
    expect(
      getAllAgentNames(),
      `'${TRACKER_SLUG}' must be declared in DEVFLOW_PLUGINS — an unregistered agent file is ` +
      'an orphan that build.test.ts fails and no installer copies',
    ).toContain(TRACKER_SLUG);
    expect([...resolveAllAgents().keys()]).toEqual(expect.arrayContaining(getAllAgentNames()));
    expect(TRACKER_TEXT.length, 'resolved Tracker agent is empty').toBeGreaterThan(0);
  });

  it(`declares name: ${TRACKER_NAME} byte-exactly`, () => {
    // Byte-exact because agent-name-guards.test.ts requires every subagent_type
    // literal to byte-equal a frontmatter name:, and 3a-3's hook spells this one.
    const split = splitFrontmatter(TRACKER_TEXT);
    expect(split, `${TRACKER_SOURCE.path}: no frontmatter block at offset 0`).not.toBeNull();
    expect(split!.inner.split('\n')).toContain(`name: ${TRACKER_NAME}`);
  });

  it('declares model: sonnet, matching the hook allowlist literal (OD-10)', () => {
    const split = splitFrontmatter(TRACKER_TEXT);
    expect(split!.inner.split('\n')).toContain('model: sonnet');
  });

  it("loadShippedDefaults() covers the registry and reports tracker as 'sonnet' (EC-77)", async () => {
    const defaults = await loadShippedDefaults();
    expect(Object.keys(defaults)).toEqual(expect.arrayContaining([...getAllAgentNames()]));
    expect(
      defaults[TRACKER_SLUG],
      "the shipped default must equal the hook's allowlisted TRACKER_MODEL literal",
    ).toBe('sonnet');
  });

  it('declares NO tools: key, and says why (EC-69, PF-031)', () => {
    const split = splitFrontmatter(TRACKER_TEXT);
    const keys = collectFrontmatterKeys(split!.inner);
    expect(keys.length, 'frontmatter parsed to no keys — the shape changed').toBeGreaterThan(0);
    expect(
      keys,
      'a tools: allowlist here is a silent constraint (PF-031): the tracker server names this ' +
      'agent must reach are user-configured and cannot be enumerated at authoring time, so any ' +
      'allowlist a reviewer "tightens" it to would kill tracker access at runtime, not at build time',
    ).not.toContain('tools');
    // The reason must be IN the file, or the next reviewer tightens it.
    expect(
      /cannot be\s+enumerated at authoring time/.test(TRACKER_TEXT),
      'the no-tools: rationale must be stated in the agent, not only in this test',
    ).toBe(true);
  });

  it('known-bad probe: the same extractor reports a seeded tools: key', () => {
    const seeded = 'name: Tracker\ndescription: seeded probe\nmodel: sonnet\ntools: Read, Bash\n';
    expect(collectFrontmatterKeys(seeded)).toEqual(['name', 'description', 'model', 'tools']);
    expect(collectFrontmatterKeys('skills:\n  - devflow:git\n  tools: Read\n')).toEqual(['skills']);
  });

  it('declares a non-empty skills: block that does not list devflow:compliance', () => {
    const split = splitFrontmatter(TRACKER_TEXT);
    const lines = split!.inner.split('\n');
    const start = lines.findIndex(l => /^skills:/.test(l));
    expect(start, 'skill-references.test.ts fails any agent with an empty skills: block').toBeGreaterThanOrEqual(0);
    const items: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (/^\S/.test(line)) break;
      const m = /^\s*-\s+(.+)$/.exec(line);
      if (m) items.push(m[1].trim());
    }
    expect(items.length, 'skills: block is empty').toBeGreaterThan(0);
    expect(items, 'avoids PF-002: a frontmatter compliance skill silently bails').not.toContain('devflow:compliance');
  });
});

// ---------------------------------------------------------------------------
// Read-only boundary, no delegation, no write-side command
// ---------------------------------------------------------------------------

describe('Tracker agent read-only boundary (§14.9 constraint 12, EC-69)', () => {
  it('opens with an Iron Law', () => {
    expect(TRACKER_TEXT).toContain('## Iron Law');
  });

  it('carries an explicit read-only boundary section', () => {
    expect(
      TRACKER_TEXT,
      'the absent tools: key is compensated in prose — without this section the agent has no ' +
      'stated boundary at all',
    ).toContain('## Read-only boundary');
  });

  it('names no delegation primitive (EC-29, EC-26)', () => {
    // Agents install per selected plugin and a subagent cannot spawn a subagent,
    // so a spawn literal here would be unreachable as well as wrong.
    expect(collectDelegationLiterals(TRACKER_TEXT)).toEqual([]);
  });

  it('names no write-side git or forge command', () => {
    expect(collectWriteSideCommands(TRACKER_TEXT)).toEqual([]);
  });

  it('names no interactive-question primitive (§3.3)', () => {
    expect(
      collectQuestionPrimitives(TRACKER_TEXT),
      'the agent runs from a SessionStart directive, where no human turn exists to answer a ' +
      'prompt. A question would hang a background spawn that is holding the claim file, and the ' +
      'lifecycle reads a held claim as a live agent — so nothing reclaims it until the staleness ' +
      'bound expires. §14.2 retired the DEGRADED reason that promised such a prompt',
    ).toEqual([]);
  });

  it('known-bad probe: EVERY write-side rule fires on its own shape', () => {
    // schema-scope.test.ts's shape table, applied to this collector: a probe that
    // seeds two lines against six patterns certifies the other four by not
    // contradicting them. One seeded line per rule, and the two lists asserted the
    // same length, is what makes a rule that stopped matching visible (PF-064).
    const SHAPES: ReadonlyArray<readonly [string, string]> = [
      ['git commit', 'Then git commit --only tracker.md to record it.'],
      ['git push', 'Finally git push origin HEAD.'],
      ['git add', 'Stage it with git add ~/.devflow/tracker.md.'],
      ['gh create', 'Open a tracking issue: gh issue create --title "conventions".'],
      ['curl', 'curl -sS "$SITE/rest/api/3/myself"'],
      ['wget', 'wget -qO- "$SITE/api/projects"'],
    ];
    expect(SHAPES.length, 'one shape per rule').toBe(WRITE_SIDE_RULES.length);
    for (const [label, line] of SHAPES) {
      expect(
        collectWriteSideCommands(`${line}\n`),
        `"${line}" must be reported by the ${label} rule`,
      ).toHaveLength(1);
    }
    // …and the matcher must not fire on the read-side git the bounded scan uses.
    expect(collectWriteSideCommands('Run git log --oneline to sample history.\n')).toEqual([]);
  });

  it('known-bad probe: the delegation and question collectors report seeded violations', () => {
    expect(collectDelegationLiterals('Spawn Agent(subagent_type="Code") next.\n')).toHaveLength(1);
    expect(
      collectQuestionPrimitives('If the key is ambiguous, use AskUserQuestion to confirm it.\n'),
      'the question collector must fire on the primitive it exists for',
    ).toHaveLength(1);
    // …nor on prose that merely discusses asking. The rule is about the TOOL.
    expect(
      collectQuestionPrimitives('Never ask the user; mark ambiguity with the sentinel instead.\n'),
      'prose about asking is not the primitive — reporting it sends the next reader to narrow ' +
      'the guard instead of to read the hit (PF-064)',
    ).toEqual([]);
  });

  it('names no foreign provider literal (PF-023, ADR-003)', () => {
    expect(
      collectForeignProviderLiterals(TRACKER_TEXT),
      'the provider token arrives in the spawn directive; naming a provider here is a second ' +
      'resolution site and provider-module vocabulary landing before its module',
    ).toEqual([]);
  });

  it('known-bad probe: EVERY provider token fires on its own shape', () => {
    const SHAPES: ReadonlyArray<readonly [string, string]> = [
      ['jira', 'Under jira, prefer the epic link.'],
      ['linear', 'Linear calls the same field a project milestone.'],
    ];
    expect(SHAPES.length, 'one shape per token').toBe(FOREIGN_PROVIDER_RULES.length);
    for (const [label, line] of SHAPES) {
      expect(
        collectForeignProviderLiterals(`${line}\n`),
        `"${line}" must be reported by the ${label} token`,
      ).toHaveLength(1);
    }
    // …and not on the words those tokens sit inside. A substring match here would
    // report the guard's own vocabulary and get the guard narrowed, not the hit read.
    expect(collectForeignProviderLiterals('Keep the inference linearly bounded.\n')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// `## Environment` — ONE resolution, stated before it is derived from
// ---------------------------------------------------------------------------

describe('Tracker agent devflow-directory resolution (PF-066 defect 4)', () => {
  /** The directive's field name, as `session-start-context` spells it. */
  const PROMPT_FIELD = 'Devflow directory:';
  /** The resolution expression, as BOTH sides must spell it. */
  const FALLBACK_LINE = 'TRACKER_DEVFLOW_DIR="${DEVFLOW_DIR:-$HOME/.devflow}"';

  it('states the precedence ABOVE the fence, which is where a prompt is read from', () => {
    // A prompt is read top-down, so whichever rule appears first is the one that
    // binds. A fence that derives the directory with the precedence stated four
    // paragraphs BELOW it teaches the fallback as the rule and the authoritative
    // value as an afterthought — the same duplicated-resolution defect PF-066
    // records, arriving through reading order rather than through a second spelling.
    const sites = [...TRACKER_TEXT.matchAll(new RegExp(PROMPT_FIELD, 'g'))].map(m => m.index ?? -1);
    expect(
      sites,
      `the agent never names the directive's \`${PROMPT_FIELD}\` field, so the value the hook ` +
      'resolved in the session that knows which devflow directory is in play arrives unread',
    ).toHaveLength(1);

    const fenceAt = TRACKER_TEXT.indexOf(FALLBACK_LINE);
    expect(fenceAt, 'the Environment fence no longer carries the fallback line').toBeGreaterThan(0);
    expect(
      sites[0],
      'the precedence must be stated before the fence derives anything, not after it',
    ).toBeLessThan(fenceAt);

    const preamble = TRACKER_TEXT.slice(TRACKER_TEXT.indexOf('## Environment'), fenceAt);
    expect(
      preamble,
      'stating the field first is not enough — the preamble has to say which of the two wins',
    ).toMatch(/authoritative/i);
  });

  it('resolves the directory from the environment exactly ONCE, in shell', () => {
    // Scoped to the fences: `## The write` names the expression in order to FORBID
    // a second one, and a whole-file count would read that prohibition as a hit.
    expect(
      collectDevflowDirResolutions(BASH_FENCES),
      'two environment resolutions can disagree, and the disagreement fails closed and silent — ' +
      'the scrubber is looked up under one root while the file is written under another, node ' +
      'exits non-zero, and inference never writes anything',
    ).toHaveLength(1);
  });

  it('known-bad probe: the resolution collector reports a second site', () => {
    expect(collectDevflowDirResolutions([
      FALLBACK_LINE,
      'node "${DEVFLOW_DIR:-$HOME/.devflow}/scripts/redact-secrets.cjs" "$RAW" "$SCRUBBED"',
    ])).toHaveLength(2);
    expect(
      collectDevflowDirResolutions(['node "$TRACKER_DEVFLOW_DIR/scripts/redact-secrets.cjs" x y']),
      'addressing the scrubber through the one resolved variable is the correct spelling',
    ).toEqual([]);
  });

  it("the fallback expression byte-equals the hook's own resolution of the same directory", () => {
    // The fallback is only safe because it cannot land anywhere the gate would not
    // have. Both sides are a literal in their own language with no shared import
    // (PF-013), so this is the only place the two spellings are compared.
    const hook = readFileSync(path.join(scriptsDir(), 'hooks', 'session-start-context'), 'utf-8');
    expect(ENV_FENCE.split('\n').map(l => l.trim())).toContain(FALLBACK_LINE);
    expect(
      hook.split('\n').map(l => l.trim()),
      'session-start-context no longer resolves TRACKER_DEVFLOW_DIR with this expression, so the ' +
      'agent\'s fallback can now resolve to a directory the gate never looked in',
    ).toContain(FALLBACK_LINE);
  });
});

// ---------------------------------------------------------------------------
// Claim / heartbeat / final-act — the lifecycle 3a-3's hook shares
// ---------------------------------------------------------------------------

describe('Tracker agent claim-file lifecycle (AC-3.17, EC-28)', () => {
  it('names the claim file and the attempt counter by their shared basenames', () => {
    // These two basenames are exported constants in src/core/tracker.ts and are
    // read by 3a-3's hook. Three spellings of one path is the drift PF-021 names.
    expect(TRACKER_TEXT).toContain('.tracker.processing');
    expect(TRACKER_TEXT).toContain('.tracker.attempts');
  });

  it('states the loser branch as an exit, not as a report', () => {
    expect(TRACKER_TEXT).toContain('exit silently');
  });

  it('touches a heartbeat and deletes the claim file as its final act', () => {
    expect(TRACKER_TEXT).toMatch(/\btouch\b/);
    expect(TRACKER_TEXT).toContain('FINAL act');
  });

  it('deletes the claim file with unlink, never a flagged rm (PF-003)', () => {
    // `rm -f` is denied by devflow's recommended deny-list: an agent instructed to
    // use it stalls on a permission prompt it cannot answer, in the background,
    // leaving the claim file behind and the next session suppressed.
    expect(
      collectFlaggedRm(TRACKER_TEXT),
      'use unlink; a flagged rm is denied and the agent runs unattended',
    ).toEqual([]);
    expect(TRACKER_TEXT).toMatch(/\bunlink\b/);
  });

  it('known-bad probe: the flagged-rm collector reports every seeded flag', () => {
    for (const line of ['rm -f "$TRACKER_CLAIM"', 'rm -rf "$TRACKER_DEVFLOW_DIR"', 'rm --force x']) {
      expect(collectFlaggedRm(`${line}\n`), `"${line}" must be reported`).toHaveLength(1);
    }
    // …and not on the instruction that REPLACES it, nor on the prose naming the ban.
    expect(collectFlaggedRm('unlink "$TRACKER_CLAIM"\n')).toEqual([]);
    expect(
      collectFlaggedRm('Use `unlink` — a flagged `rm` is denied by the deny-list.\n'),
      'the prose stating the ban must not read as the ban being broken',
    ).toEqual([]);
  });

  it('spends NO attempt of its own on a write-less exit — the gate already spent one [DR-02]', () => {
    // The counter has ONE incrementer, and it is the session-start gate, which
    // increments on EMISSION precisely so a run that crashes before Finishing
    // still costs an attempt [DR-02]. A second increment here makes every failed
    // cycle cost two: 0→emit→1→agent→2→emit→3→agent→4→emit→5→agent→6, i.e. three
    // directives against a cap documented as five.
    expect(
      collectCounterIncrementSites(TRACKER_TEXT),
      'the agent must not advance .tracker.attempts: the session-start gate increments on ' +
      'emission [DR-02], and two incrementers per cycle silently halve the OD-14 budget',
    ).toEqual([]);
    // Positive half: the agent has to SAY whose increment it is relying on, or the
    // next reader restores the one this guard deletes. Bounded (PF-018).
    expect(TRACKER_TEXT).toMatch(/write-less exit[\s\S]{0,400}?\[DR-02\]/);
  });

  it('known-bad probe: the increment collector reports the retired instruction', () => {
    expect(
      collectCounterIncrementSites(
        'On a write-less exit, increment `.tracker.attempts` **before** deleting the claim file.\n',
      ),
      'the collector must fire on the exact sentence it exists to keep out',
    ).toHaveLength(1);
    expect(
      collectCounterIncrementSites('Bump the attempt counter, then stop.\n'),
      'a second spelling of the same instruction',
    ).toHaveLength(1);
    // …and must NOT fire on the two counter writes that remain correct: deleting
    // it after a successful write, and the hook's increment stated as history.
    expect(
      collectCounterIncrementSites('On a successful write, delete `.tracker.attempts`.\n'),
    ).toEqual([]);
  });

  it('deletes the counter on a successful write [DR-02]', () => {
    expect(TRACKER_TEXT).toMatch(/successful write[\s\S]{0,200}?\.tracker\.attempts/i);
  });

  it('states the attempt cap in the shape the three-sided seam reads (OD-14)', () => {
    // The NUMBER is not compared here. `/\b5\b/` over a page of prose is satisfied
    // by any stray digit and says nothing about the two other parties that spell the
    // same cap — the hook's TRACKER_ATTEMPTS_MAX, which ENFORCES it, and
    // src/core/tracker.ts's exported constant, which `devflow tracker --status`
    // quotes back to the user. tests/seams/tracker-claim-staleness.test.ts compares
    // all three; what this arm owns is the SHAPE that seam depends on, so a
    // rewording that empties its collector fails in the file that was reworded.
    expect(
      TRACKER_TEXT,
      'the cap must be stated as a bold number WITH its unit — an unqualified `**5**` is any ' +
      'number at all, and the seam cannot bind to it',
    ).toMatch(/\*\*\d+ attempts?\*\*/);
    // The delegation names a suite that exists and really reads the hook literal —
    // a cross-suite coverage claim that cannot be greped is PF-018's third mechanism.
    const seam = readFileSync(
      path.join(ROOT, 'tests', 'seams', 'tracker-claim-staleness.test.ts'),
      'utf-8',
    );
    expect(seam, 'the seam this arm defers the comparison to must read the hook literal')
      .toContain('TRACKER_ATTEMPTS_MAX');
  });
});

// ---------------------------------------------------------------------------
// The write path: capability probe, D11 gate, create-exclusive write
// ---------------------------------------------------------------------------

describe('Tracker agent write path (AC-3.9, AC-3.15, §14.9 constraints 3 and 11)', () => {
  it('probes capabilities by description and degrades with the canonical literal', () => {
    expect(TRACKER_TEXT).toContain('## Capability probe');
    expect(
      TRACKER_TEXT,
      'the note text is the canonical §14.2 literal, never free prose',
    ).toContain('TRACEABILITY: DEGRADED (no tracker tool for {capability})');
    expect(
      /never by tool name/.test(TRACKER_TEXT),
      'selection is by capability description: published tool rosters disagree with each other',
    ).toBe(true);
  });

  it('writes NOTHING when no tracker capability is reachable, and treats denial as absence (EC-70, EC-71)', () => {
    // Pins the plan's own shorthand rather than a sentence: a prose guard that
    // breaks whenever the surrounding paragraph is reworded gets deleted, not fixed.
    expect(TRACKER_TEXT).toContain('denial ≡ absence');
    expect(
      TRACKER_TEXT,
      'a defaults-only file would satisfy the hook\'s existence gate forever and destroy the ' +
      'retry trigger permanently',
    ).toMatch(/write nothing/i);
  });

  it('binds the scrub and the create-exclusive placement into ONE && chain (AC-3.15)', () => {
    // Scoped to the STATEMENT, not to the fence and not to the file. `&&` guarantees
    // nothing across a statement boundary, so the property is "the scrubber's exit
    // status is the left operand of the operator that reaches the placement" —
    // which is the whole of D11 fail-closed for this sink.
    const chain = collectScrubChain(WRITE_FENCE);
    expect(
      chain,
      'the write fence invokes the scrubber in no single statement, or in more than one — an ' +
      'ambiguous chain is reported rather than resolved by reading the first',
    ).not.toBeNull();
    expect(
      chain!,
      'the scrubber and the placement sit in different statements: a `;` or a pipe between them ' +
      'means a refused scrub still publishes the file, which is the entire control',
    ).toContain(PLACEMENT);
    expect(chain!, 'the mode is set on the same chain, not after it').toContain('chmod 600');
    expect(TRACKER_TEXT).toContain('TRACEABILITY: DEGRADED (redaction unavailable)');
  });

  it('known-bad probe: the chain collector reports every way the gate can be unbound', () => {
    const place = `ln "$S" "$T"`;
    // 1. A statement break. The scrubber's status is discarded by the shell itself.
    expect(collectScrubChain(`node ${SCRUBBER} "$R" "$S"; ${place}`)).not.toContain(place);
    // 2. A pipeline. The `&&` is still there, but it binds `tee`'s status, not the
    //    scrubber's — the exact rewrite `toContain('&&')` could never distinguish.
    expect(
      collectScrubChain(`node ${SCRUBBER} "$R" | tee "$S" && ${place}`),
      'a pipe ends the chain the scrubber is on; what follows the && is gated on tee',
    ).not.toContain(place);
    // 3. A second, ungated invocation must be reported rather than resolved.
    expect(
      collectScrubChain(`node ${SCRUBBER} "$R" "$S" && ${place}\nnode ${SCRUBBER} "$R" "$S2"`),
    ).toBeNull();
    // …and the correct spelling, continuation included, must come back WITH the
    // placement, or the three negatives above are green for the wrong reason.
    expect(collectScrubChain(`node ${SCRUBBER} "$R" "$S" \\\n  && ${place}`)).toContain(place);
  });

  it('gates placement on a NON-EMPTY, template-shaped body (reliability-02)', () => {
    // The scrubber's status says it RAN. These three links say the thing it wrote
    // is worth publishing — head anchor, tail anchor, and not zero bytes.
    expect(WRITE_FENCE).toContain('[ -s "$SCRUBBED" ]');
    const greps = WRITE_FENCE.split('\n').filter(l => /grep -q/.test(l));
    expect(
      greps,
      'the shape gate brackets the composition at BOTH ends: the frontmatter key it opens with ' +
      'and the last template heading it closes with, so a truncation at either end is caught',
    ).toHaveLength(2);
    // Both anchors are bound to the SHARED schema oracle, so renaming a template
    // section tells you here that the chain's anchor has to move with it.
    expect(greps.join('\n')).toContain(`'^${TRACKER_SCHEMA_FRONTMATTER_KEYS[0]}: '`);
    expect(greps.join('\n')).toContain(`'^${TEMPLATE_TAIL_HEADING}$'`);
  });

  it('cleans both temp files from a trap on the same chain as the mktemps (reliability-09)', () => {
    expect(
      WRITE_FENCE,
      'cleanup placed AFTER the chain runs only when the chain returns; this agent is killed ' +
      'mid-run as a documented outcome (PF-056), and $RAW is the PRE-scrub composition',
    ).toMatch(/^trap '[^']*unlink "\$RAW"[^']*unlink "\$SCRUBBED"[^']*' EXIT INT TERM$/m);
    expect(
      WRITE_FENCE.split('\n').filter(l => /\bmktemp\b/.test(l)),
      'both staging paths come from mktemp — a hand-built temp name is a shared path',
    ).toHaveLength(2);
    expect(
      WRITE_FENCE,
      'each mktemp is a precondition, not an assumption: nothing is composed until both exist',
    ).toContain('|| exit 1');
  });

  it('does NOT reach for --emit: that mode exists only for comment sinks', () => {
    // Keeping the two justifications apart is what stops a later pass
    // "simplifying" the file sink onto --emit and losing the && chain with it.
    expect(TRACKER_TEXT).not.toContain('--emit');
  });

  it('writes create-exclusively and reports ALREADY_EXISTS, never a lock wait (§14.9 constraint 11)', () => {
    // Each refusing primitive is asserted at ITS OWN site. One `toContain` over the
    // whole file would let the claim's noclobber satisfy a claim about the write —
    // PF-064's corpus-reach failure, inside a single document.
    expect(
      WRITE_FENCE,
      'link(2) publishes a file that is ALREADY complete under a name that must not exist, so ' +
      '$TRACKER_FILE never holds a prefix of the content',
    ).toContain('ln "$SCRUBBED" "$TRACKER_FILE"');
    expect(CLAIM_FENCE, 'the claim refuses a taken path with an O_EXCL create').toContain('set -o noclobber');
    expect(TRACKER_TEXT).toContain('ALREADY_EXISTS');
    expect(
      TRACKER_TEXT,
      'unlink-and-retry is right for a staged atomic write and exactly wrong for a write-once file',
    ).toMatch(/not a lock wait/i);
  });

  it('single-quotes its heredoc delimiter', () => {
    // The heredoc guard over src/assets/ enforces this tree-wide; asserted here
    // too because an unquoted delimiter in THIS file expands the untrusted issue
    // text the heredoc carries.
    expect(
      collectUnquotedHeredocs(TRACKER_TEXT),
      'every heredoc delimiter must be quoted',
    ).toEqual([]);
    expect(TRACKER_TEXT).toContain("<<'EOF'");
  });

  it('known-bad probe: the heredoc collector reports every unquoted spelling', () => {
    for (const line of ['cat > "$RAW" <<EOF', 'cat > "$RAW" <<-EOF', 'cat > "$RAW" << EOF']) {
      expect(collectUnquotedHeredocs(`${line}\n`), `"${line}" must be reported`).toHaveLength(1);
    }
    // …and stays silent on both quoted spellings, or the guard reports the fix.
    expect(collectUnquotedHeredocs('cat > "$RAW" <<\'EOF\'\ncat > "$RAW" <<"EOF"\n')).toEqual([]);
  });

  it('does not chmod the shared parent directory', () => {
    expect(
      collectParentChmod(TRACKER_TEXT),
      '~/.devflow is 0755 and shared — narrowing it breaks every other feature',
    ).toEqual([]);
  });

  it('known-bad probe: the parent-chmod collector reports every spelling of the directory', () => {
    // The three the earlier `[A-Za-z_]*devflow` anchor measurably missed, plus the
    // variable spelling it did catch and a symbolic mode. An absence guard that
    // catches one spelling of its target is PF-064's first blindness.
    const SPELLINGS = [
      'chmod 700 ~/.devflow',
      'chmod 700 "$HOME/.devflow"',
      'chmod 755 $HOME/.devflow',
      'chmod 700 "$TRACKER_DEVFLOW_DIR"',
      'chmod go-rwx ~/.devflow',
    ];
    for (const line of SPELLINGS) {
      expect(collectParentChmod(`${line}\n`), `"${line}" must be reported`).toHaveLength(1);
    }
    // …and stays silent on the one chmod the agent is REQUIRED to run, and on any
    // path that continues past the directory into a file inside it.
    for (const line of [
      'chmod 600 "$TRACKER_FILE"',
      'chmod 600 "$TRACKER_DEVFLOW_DIR/tracker.md"',
      'chmod 600 ~/.devflow/tracker.md',
    ]) {
      expect(collectParentChmod(`${line}\n`), `"${line}" is the file, not the parent`).toEqual([]);
    }
  });

});

// ---------------------------------------------------------------------------
// The agent's shell, EXECUTED
//
// Every guard below RUNS the fence it names, against an isolated `$HOME` under the
// temp root, and asserts the OUTCOME rather than the wording. That is the standing
// instruction from the two pitfalls this agent wrote: a claim primitive is
// exclusive or it is not, and only a race can tell the two spellings apart
// (PF-068); a shell chain inside a prompt is a program nothing type-checks, whose
// defects are invisible to a reader of the prose and obvious to anyone who runs it
// (PF-066). Each negative is paired with a known-bad spelling driven through the
// SAME harness, so a green arm can never mean the harness stopped exercising
// anything (PF-018).
// ---------------------------------------------------------------------------

describe('Tracker agent claim primitive, executed (PF-068)', () => {
  it('refuses a path that is already taken — two claims, exactly one winner', () => {
    const sandbox = makeSandbox();
    const script = `${ENV_FENCE}\n${CLAIM_FENCE}\necho WON`;
    const first = runShell(script, sandbox);
    const second = runShell(script, sandbox);

    expect(first.stdout.trim(), `the winner did not proceed: ${first.stderr}`).toBe('WON');
    expect(
      second.stdout.trim(),
      'the second claimant proceeded — the claim excludes nobody, so both agents probe the ' +
      'user\'s tracker and the loser deletes the claim while the winner is still running',
    ).toBe('');
    expect(second.status, 'the loser exits SILENTLY: no output AND no failure').toBe(0);
    expect(existsSync(path.join(sandbox.devflowDir, '.tracker.processing'))).toBe(true);
  });

  it('known-bad probe: rename-to-claim produces TWO winners through the same harness', () => {
    // `mv src dst` is rename(2): an existing destination is REPLACED and mv exits
    // 0, so the loser branch is one the kernel never takes. The replaced claim file
    // also resets the staleness clock the other agent is judged by. A guard that
    // greps for the command name passes on both spellings, which is why the broken
    // one is driven through the harness that must report it.
    const sandbox = makeSandbox();
    const renameClaim = 'MARKER="$(command mktemp)"\nmv "$MARKER" "$TRACKER_CLAIM" || exit 0\necho WON';
    const script = `${ENV_FENCE}\n${renameClaim}`;
    const first = runShell(script, sandbox, { instrument: false });
    const second = runShell(script, sandbox, { instrument: false });
    expect([first.stdout.trim(), second.stdout.trim()]).toEqual(['WON', 'WON']);
  });
});

describe('Tracker agent write chain, executed (PF-066, AC-3.15)', () => {
  it('publishes a complete 0600 file and leaves no staging behind', () => {
    const sandbox = makeSandbox();
    const run = runShell(writeChain(COMPOSED_FILE), sandbox);

    expect(run.status, `the chain refused a well-formed composition: ${run.stderr}`).toBe(0);
    expect(readFileSync(sandbox.trackerFile, 'utf-8')).toBe(`${COMPOSED_FILE}\n`);
    expect(
      statSync(sandbox.trackerFile).mode & 0o777,
      'the file is CREATED 0600 — it may name a site and a project, and a world-readable window ' +
      'closed a moment later is still a window',
    ).toBe(0o600);
    expect(stagingResidue(sandbox)).toEqual([]);

    const temps = recordedTemps(sandbox);
    expect(
      temps,
      'the instrumented mktemp recorded nothing — the harness is not driving the chain',
    ).toHaveLength(2);
    expect(
      temps.filter(existsSync),
      '$RAW holds the PRE-scrub composition: leaving it behind keeps exactly the bytes the gate ' +
      'exists to remove, for the lifetime of the temp directory rather than of the run',
    ).toEqual([]);
  });

  it('refuses an EMPTY composition — the scrubber exits 0 on zero bytes', () => {
    const sandbox = makeSandbox();
    const run = runShell(writeChain(''), sandbox);

    expect(run.status, 'every link of the chain exits 0 on an empty body; the size test is the one that does not').not.toBe(0);
    expect(
      existsSync(sandbox.trackerFile),
      'a zero-byte tracker.md satisfies the session-start existence gate forever, so it does not ' +
      'fail the run — it retires the feature',
    ).toBe(false);
    expect(stagingResidue(sandbox)).toEqual([]);
    expect(recordedTemps(sandbox).filter(existsSync)).toEqual([]);
  });

  it('refuses a TRUNCATED composition — the tail heading never arrived', () => {
    const sandbox = makeSandbox();
    const truncated = COMPOSED_FILE.split(`\n${TEMPLATE_TAIL_HEADING}`)[0];
    expect(truncated, 'the fixture must actually lose the tail heading').not.toContain(TEMPLATE_TAIL_HEADING);

    const run = runShell(writeChain(truncated), sandbox);
    expect(run.status).not.toBe(0);
    expect(existsSync(sandbox.trackerFile)).toBe(false);
    expect(stagingResidue(sandbox)).toEqual([]);
  });

  it('known-bad probe: with the shape gate deleted, the same empty composition IS published', () => {
    // The RED half of the two arms above. Without it, "no file was written" is
    // equally consistent with a chain that never ran (PF-018).
    const sandbox = makeSandbox();
    const ungated = WRITE_FENCE.split('\n')
      .filter(line => !/\[ -s "\$SCRUBBED" \]|grep -q/.test(line))
      .join('\n');

    const run = runShell(writeChain('', ungated), sandbox, { instrument: false });
    expect(run.status, `the ungated chain should complete: ${run.stderr}`).toBe(0);
    expect(existsSync(sandbox.trackerFile)).toBe(true);
    expect(
      statSync(sandbox.trackerFile).size,
      'the ungated chain publishes a ZERO-BYTE tracker.md and reports success — the defect the ' +
      'three gate links exist for',
    ).toBe(0);
  });

  it('publishes NOTHING when the scrubber refuses, with a valid body already staged', () => {
    const sandbox = makeSandbox();
    const run = runShell(writeChain(COMPOSED_FILE), sandbox, { stub: SCRUBBER_REFUSES });

    expect(run.status, 'the chain reports the gate\'s verdict, not the trap\'s').not.toBe(0);
    expect(
      existsSync(sandbox.trackerFile),
      'the scrubber refused, so the composition is UNREDACTED by definition — and this file is ' +
      'written once, so publishing it now is publishing it permanently',
    ).toBe(false);
    expect(stagingResidue(sandbox)).toEqual([]);
    expect(recordedTemps(sandbox).filter(existsSync)).toEqual([]);
  });

  it('known-bad probe: with the scrub `&&` desugared to a statement break, the refusal IS published', () => {
    // The RED half of the arm above, produced from the REAL fence. Without it, "no
    // file was written" is equally consistent with a chain that never ran (PF-018),
    // and nothing distinguishes the `&&` from the `;` that would replace it.
    const sandbox = makeSandbox();
    const unbound = breakScrubChain(WRITE_FENCE);
    expect(unbound, 'the mutation found no `&&` on the scrubber line').not.toBe(WRITE_FENCE);
    expect(collectScrubChain(unbound), 'the mutation must actually unbind the gate').not.toContain(PLACEMENT);

    const run = runShell(writeChain(COMPOSED_FILE, unbound), sandbox, {
      stub: SCRUBBER_REFUSES,
      instrument: false,
    });
    expect(run.status, `the unbound chain reports success: ${run.stderr}`).toBe(0);
    expect(
      existsSync(sandbox.trackerFile),
      'with the scrubber\'s status discarded by a statement boundary, an unredacted composition ' +
      'reaches the write-once file and the run reports success — the defect the chain exists for',
    ).toBe(true);
  });

  it('refuses a path already taken and leaves the winner\'s bytes untouched (ALREADY_EXISTS)', () => {
    const sandbox = makeSandbox();
    writeFileSync(sandbox.trackerFile, 'the winner wrote this\n');

    const run = runShell(writeChain(COMPOSED_FILE), sandbox);
    expect(run.status, 'the write is create-exclusive: a taken name is a lost race, not a retry').not.toBe(0);
    expect(
      readFileSync(sandbox.trackerFile, 'utf-8'),
      'the winner\'s content is the answer — never unlink and retry',
    ).toBe('the winner wrote this\n');
    expect(stagingResidue(sandbox)).toEqual([]);
  });

  it('removes the PRE-scrub composition when the run is KILLED at the scrub (PF-056)', () => {
    const sandbox = makeSandbox();
    const run = runShell(writeChain(COMPOSED_FILE), sandbox, { stub: KILLED_MID_SCRUB });

    expect(run.status, 'a killed run never publishes').not.toBe(0);
    expect(existsSync(sandbox.trackerFile)).toBe(false);
    const temps = recordedTemps(sandbox);
    expect(temps, 'the kill must land AFTER both staging files exist, or the arm proves nothing').toHaveLength(2);
    expect(
      temps.filter(existsSync),
      'the trap is what covers this path: cleanup written after the chain never runs at all when ' +
      'the shell is terminated, and $RAW is the unredacted body',
    ).toEqual([]);
  });

  it('known-bad probe: with the trap removed, the killed run leaves both temp files on disk', () => {
    const sandbox = makeSandbox();
    const untrapped = WRITE_FENCE.split('\n')
      .filter(line => !/^trap /.test(line))
      .join('\n')
      .replace('GATE=$?;', 'GATE=$?; unlink "$RAW"; unlink "$SCRUBBED";');

    const run = runShell(writeChain(COMPOSED_FILE, untrapped), sandbox, { stub: KILLED_MID_SCRUB });
    expect(run.status).not.toBe(0);
    const temps = recordedTemps(sandbox);
    expect(temps).toHaveLength(2);
    expect(
      temps.filter(existsSync),
      'cleanup placed after the chain is the spelling this probe seeds: it runs on the refusal ' +
      'paths and not on the kill path, which is the one the background watchdog produces',
    ).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Inference bounds, sentinels and provenance
// ---------------------------------------------------------------------------

describe('Tracker agent inference bounds (EC-27, EC-72, EC-73, [DR-15])', () => {
  it('NAMES the bounded-scan reference instead of restating it [DR-15]', () => {
    expect(
      TRACKER_TEXT,
      'the bounds, the untrusted-strings block and the post-composition check live in one ' +
      'single-authority corpus; a second hand-maintained copy is the divergence Phase 0 repaired',
    ).toContain('references/learn-conventions.md');
  });

  it('restates none of the four bounded-scan literals [DR-15]', () => {
    for (const literal of ['head -50', 'head -20', '--limit 30', '--max-count=200']) {
      expect(
        TRACKER_TEXT,
        `'${literal}' is a Guard-2 test literal owned by references/learn-conventions.md — ` +
        'naming the reference is the load instruction; copying its bounds forks them',
      ).not.toContain(literal);
    }
  });

  it('addresses the reference skill-relatively, never through an install path (§14.5)', () => {
    expect(TRACKER_TEXT).not.toContain('~/.claude');
  });

  it('marks ambiguity with the hard sentinel and never invents a value', () => {
    expect(TRACKER_TEXT).toContain('# UNRESOLVED: {section} — edit this line');
    expect(TRACKER_TEXT).toMatch(/never an invented value/i);
  });

  it('requires >= 3 occurrences AND >= 60% share, never the first match (EC-73)', () => {
    expect(TRACKER_TEXT).toMatch(/3 occurrences/);
    expect(TRACKER_TEXT).toMatch(/60%/);
    expect(TRACKER_TEXT).toMatch(/never the first match/i);
  });

  it('refuses git-history inference outside a real project root (EC-27)', () => {
    expect(TRACKER_TEXT).toMatch(/\$HOME/);
    expect(TRACKER_TEXT).toMatch(/git marker/i);
    expect(TRACKER_TEXT).toContain('inferred-from:');
  });

  it('records the dedup rank as a hint that may only narrow the probe order (OD-11)', () => {
    expect(TRACKER_TEXT).toMatch(/narrow the probe order/i);
    expect(TRACKER_TEXT).toMatch(/live probe is the sole authority/i);
  });

  it('states the report contract as the file itself, with the status enum', () => {
    expect(TRACKER_TEXT).toContain('**Status**: WRITTEN | ALREADY_EXISTS | DEGRADED ({reason})');
  });
});

// ---------------------------------------------------------------------------
// The schema template (P3a-S16) — the writer half of conflict C12
// ---------------------------------------------------------------------------

describe('~/.devflow/tracker.md schema template (§14.3, P3a-S16)', () => {
  const template = collectTrackerTemplate(TRACKER_TEXT);

  it('embeds a tagged template fence', () => {
    expect(
      template,
      `no \`\`\`${TRACKER_TEMPLATE_FENCE_TAG} fence in the agent — the schema's writer half is missing`,
    ).not.toBeNull();
    expect(template!.length).toBeGreaterThan(0);
  });

  it('carries exactly the §14.3 headings, in order, and at least 11 of them [DR-21]', () => {
    const headings = collectTrackerTemplateHeadings(template!);
    expect(headings).toEqual([...TRACKER_SCHEMA_SECTIONS]);
    expect(
      TRACKER_SCHEMA_SECTIONS.length,
      'the two-sided equality test in 3a-4 binds to >= 11 sections',
    ).toBeGreaterThanOrEqual(11);
  });

  it('known-bad probe: a renamed or dropped heading is reported', () => {
    const renamed = template!.replace('## Tech Debt', '## Technical Debt');
    expect(collectTrackerTemplateHeadings(renamed)).not.toEqual([...TRACKER_SCHEMA_SECTIONS]);
    const dropped = template!.split('\n').filter(l => l.trim() !== '## Wave Filter').join('\n');
    expect(collectTrackerTemplateHeadings(dropped)).not.toEqual([...TRACKER_SCHEMA_SECTIONS]);
  });

  it('declares provider: and inferred-from: and DROPS learned: (ADR-003 clause iii)', () => {
    for (const key of TRACKER_SCHEMA_FRONTMATTER_KEYS) {
      expect(template!, `template frontmatter must declare ${key}:`).toContain(`${key}:`);
    }
    expect(
      template!,
      'learned: has no stated consumer — an unread frontmatter key is residue',
    ).not.toContain('learned:');
  });

  it('pins the file-level bounds, the mode, and the Read-tool rule (PF-035)', () => {
    expect(TRACKER_TEXT).toContain('120 lines');
    expect(TRACKER_TEXT).toContain('8,000 characters');
    expect(TRACKER_TEXT).toContain('0600');
    // A positive assertion, not only the negative: the read instruction must
    // actually spell an absolute path.
    expect(TRACKER_TEXT).toMatch(/absolute path/i);
    expect(
      collectShellReadsOfTrackerFile(TRACKER_TEXT),
      'tracker.md is read with the Read tool, never shelled out (PF-035): a shell read puts its ' +
      'third-party content through word splitting and truncates silently at the size bound',
    ).toEqual([]);
  });

  it('known-bad probe: the shell-read collector reports flagged and variable spellings', () => {
    for (const line of [
      'cat ~/.devflow/tracker.md',
      'head -5 ~/.devflow/tracker.md',
      'tail -n 20 "$HOME/.devflow/tracker.md"',
      'cat "$TRACKER_FILE"',
      'grep -q "^provider: " "$TRACKER_FILE"',
    ]) {
      expect(collectShellReadsOfTrackerFile(`${line}\n`), `"${line}" must be reported`).toHaveLength(1);
    }
    // …and not on the chain's own greps over the STAGING file, nor on prose that
    // merely names the file. Reporting either sends the next reader to narrow the
    // guard instead of to read the hit (PF-064).
    expect(collectShellReadsOfTrackerFile('grep -q \'^provider: \' "$SCRUBBED"\n')).toEqual([]);
    expect(
      collectShellReadsOfTrackerFile('You write exactly one content path: `~/.devflow/tracker.md`.\n'),
    ).toEqual([]);
  });

  it("reuses the metachar guard, reworded for a machine-local file", () => {
    expect(
      TRACKER_TEXT,
      'the borrowed "git-tracked and team-shared" clause does not transfer: this file is ' +
      'machine-local, and the reason it is untrusted is that it is hand-editable',
    ).toContain('hand-editable and machine-wide');
    expect(TRACKER_TEXT).not.toContain('git-tracked and team-shared');
  });

  it('gives every section a scope, an absent-default and a validator — no blank cells (AC-3.16)', () => {
    const rows = collectTrackerSchemaRows(TRACKER_TEXT);
    expect(
      rows.map(r => r.section.replace(/`/g, '').replace(/ →.*$/, '')),
      'every template heading needs a validator row',
    ).toEqual(expect.arrayContaining(TRACKER_SCHEMA_SECTIONS.filter(s => s.startsWith('## '))));
    for (const row of rows) {
      expect(row.scope, `${row.section}: blank scope`).not.toBe('');
      expect(row.absent, `${row.section}: blank absent-default`).not.toBe('');
      expect(row.validator, `${row.section}: blank validator`).not.toBe('');
      expect(
        ['global-safe', 'repo-derived'],
        `${row.section}: scope must be one of the two §14.3 values, got '${row.scope}'`,
      ).toContain(row.scope);
    }
  });

  it('known-bad probe: the row parser reports a blanked cell and ignores escaped pipes', () => {
    const blanked = '| `## Assignee` | global-safe |  | enum |';
    expect(collectTrackerSchemaRows(blanked)[0].absent).toBe('');
    const escaped = '| `## Assignee` | global-safe | `none` | enum: `none` \\| `self` |';
    const parsed = collectTrackerSchemaRows(escaped);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].validator).toContain('self');
  });

  it('distinguishes a sentinel from an absent section', () => {
    expect(TRACKER_TEXT).toMatch(/sentinel and an absent section are different outcomes/i);
  });
});

// ---------------------------------------------------------------------------
// Registration (P3a-S10) — structural Guard-5 pass, no roster row
// ---------------------------------------------------------------------------

describe('Tracker agent registration (P3a-S10, EC-68)', () => {
  it('is declared by a commands-less plugin, so Guard 5 reverse passes structurally', () => {
    // registry-integrity's reverse check skips plugins whose commands spawn
    // nothing (`if (spawned.size === 0) continue`). A hook-spawned agent escapes
    // it because its owning plugin ships no commands — NOT because it is
    // exempted. Recording it here is what stops the next reader from "fixing"
    // the pass with an exemption, which is the vacuous-guard trap.
    const owners = DEVFLOW_PLUGINS.filter(p => p.agents.includes(TRACKER_SLUG));
    expect(owners.length, `${TRACKER_SLUG} must be declared by exactly one plugin`).toBe(1);
    expect(
      owners[0].commands,
      `${owners[0].name} must stay commands-less for the structural pass to hold`,
    ).toEqual([]);
  });

  it('shares its owning plugin with the other hook-spawned agent', () => {
    // learning escapes Guard 5 reverse for exactly the same reason. Asserting
    // they sit together means a future split of that plugin cannot silently move
    // one out from under the structural pass.
    const owners = DEVFLOW_PLUGINS.filter(p => p.agents.includes(TRACKER_SLUG));
    expect(owners[0].agents).toContain('learning');
  });

  it('adds NO _roster.mds row — the roster is set-equal to dist spawn sites', () => {
    const roster = readFileSync(ROSTER_SRC, 'utf-8');
    expect(
      roster,
      'agent-name-guards asserts set-equality both ways between _roster.mds and the agentType ' +
      'values in dist/commands/. Tracker appears in no command, so a roster row fails ' +
      'inRosterNotInDist — and the roster resolver throws on a name it cannot read.',
    ).not.toContain(TRACKER_NAME);
    // Non-vacuity: the roster really is the file this assertion thinks it is.
    expect(roster, 'roster corpus is wrong — it should list the workflow agents').toContain('Synthesize');
  });

  it('adds nothing to the orchestrator charter', () => {
    const charter = readFileSync(
      path.join(ROOT, 'src', 'assets', 'scripts', 'hooks', 'assets', 'orchestrator-charter.md'),
      'utf-8',
    );
    expect(charter).not.toContain(TRACKER_NAME);
  });
});
