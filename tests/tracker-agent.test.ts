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

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

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
 * Lines naming a write-side git or forge command. The agent is read-only
 * (§14.9 constraint 12) and its write path runs no git command at all.
 */
export function collectWriteSideCommands(content: string): string[] {
  const patterns: RegExp[] = [
    /\bgit\s+commit\b/,
    /\bgit\s+push\b/,
    /\bgit\s+add\b/,
    /\bgh\s+\w+\s+create\b/,
    /\bcurl\b/,
    /\bwget\b/,
  ];
  return content
    .split('\n')
    .filter(l => patterns.some(p => p.test(l)))
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
export function collectForeignProviderLiterals(content: string): string[] {
  const tokens: readonly RegExp[] = [/\bjira\b/i, /\blinear\b/i];
  return content
    .split('\n')
    .filter(l => tokens.some(t => t.test(l)))
    .map(l => l.trim());
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

  it('known-bad probe: all three collectors report seeded violations', () => {
    expect(collectDelegationLiterals('Spawn Agent(subagent_type="Code") next.\n')).toHaveLength(1);
    expect(collectWriteSideCommands('Then git commit -- tracker.md and gh issue create.\n')).toHaveLength(1);
    expect(
      collectQuestionPrimitives('If the key is ambiguous, use AskUserQuestion to confirm it.\n'),
      'the question collector must fire on the primitive it exists for',
    ).toHaveLength(1);
    // The matcher must not fire on the read-side git the bounded scan legitimately uses.
    expect(collectWriteSideCommands('Run git log --oneline to sample history.\n')).toEqual([]);
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

  it('known-bad probe: the provider collector reports a seeded literal', () => {
    expect(collectForeignProviderLiterals('Under jira, prefer the epic link.\n')).toHaveLength(1);
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

  it('claims atomically and makes the loser exit silently, never overwrite', () => {
    expect(TRACKER_TEXT).toMatch(/\bmv\b/);
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
    const flaggedRm = TRACKER_TEXT.split('\n').filter(l => /\brm\s+-\w/.test(l));
    expect(flaggedRm, 'use unlink; a flagged rm is denied and the agent runs unattended').toEqual([]);
    expect(TRACKER_TEXT).toMatch(/\bunlink\b/);
  });

  it('increments the counter BEFORE deleting the claim file on a write-less exit [DR-02]', () => {
    // The ordering is the whole rule: 3a-1 ships the reader, the remover and the
    // install-artifact entry, and 3a-3 ships the >= 5 cap. Without an incrementer
    // in the one place that knows a run produced nothing, the cap never engages.
    // Ordered and BOUNDED (PF-018: no unbounded [\s\S]*), and tolerant of where
    // the prose wraps — a guard that breaks on a reflow gets "fixed" by deleting it.
    expect(TRACKER_TEXT).toMatch(
      /increment[\s\S]{0,60}?\.tracker\.attempts[\s\S]{0,40}?before[\s\S]{0,60}?claim/i,
    );
  });

  it('deletes the counter on a successful write [DR-02]', () => {
    expect(TRACKER_TEXT).toMatch(/successful write[\s\S]{0,200}?\.tracker\.attempts/i);
  });

  it('states the attempt cap as N = 5 (OD-14)', () => {
    expect(TRACKER_TEXT).toMatch(/\b5\b/);
    expect(TRACKER_TEXT).toContain('attempt');
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

  it('gates the write through the scrubber in a single && chain, fail-closed (AC-3.15)', () => {
    expect(TRACKER_TEXT).toContain('redact-secrets.cjs');
    expect(TRACKER_TEXT).toContain('mktemp');
    expect(TRACKER_TEXT).toContain('chmod 600');
    expect(TRACKER_TEXT).toContain('TRACEABILITY: DEGRADED (redaction unavailable)');
    expect(
      TRACKER_TEXT,
      'a pipeline hides the scrubber exit status; the chain is what makes it fail-closed',
    ).toContain('&&');
  });

  it('does NOT reach for --emit: that mode exists only for comment sinks', () => {
    // Keeping the two justifications apart is what stops a later pass
    // "simplifying" the file sink onto --emit and losing the && chain with it.
    expect(TRACKER_TEXT).not.toContain('--emit');
  });

  it('writes create-exclusively and reports ALREADY_EXISTS, never a lock wait (§14.9 constraint 11)', () => {
    expect(TRACKER_TEXT).toContain('set -o noclobber');
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
    const heredocs = TRACKER_TEXT.split('\n').filter(l => /<<-?\s*\w/.test(l));
    expect(heredocs, 'every heredoc delimiter must be quoted').toEqual([]);
    expect(TRACKER_TEXT).toContain("<<'EOF'");
  });

  it('does not chmod the shared parent directory', () => {
    const parentChmod = TRACKER_TEXT.split('\n').filter(l => /chmod\s+\d+\s+"?\$?\{?[A-Za-z_]*devflow/i.test(l));
    expect(parentChmod, '~/.devflow is 0755 and shared — narrowing it breaks every other feature').toEqual([]);
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
    const shellReads = TRACKER_TEXT.split('\n').filter(l => /\b(cat|head|tail)\s+\S*tracker\.md/.test(l));
    expect(shellReads, 'tracker.md is read with the Read tool, never shelled out (PF-035)').toEqual([]);
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
