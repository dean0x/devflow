/**
 * Writer ↔ reader seam: the dedup ladder is ONE vocabulary with two ends.
 *
 * `## Dedup Strategy` in `~/.devflow/tracker.md` is written by the Tracker agent
 * and read by the provider mechanics. The two ends never meet at runtime: the agent
 * writes the file on one machine-wide setup run, and the mechanics read it months
 * later inside a Git spawn. Nothing reconciles them, and the failure is silent —
 * the recorded rung is a HINT that narrows the probe order (OD-11), so a hint the
 * reader mis-reads narrows the probe toward a rung that was never probed, which is
 * a WRONG narrowing rather than a refused one.
 *
 * That is what this file pins. Before it, the writer recorded one of five values
 * (`entity-property`, `comment-edit-in-place`, `remote-link`, `attachment-url`,
 * `post-with-warning`) and the mechanics read a four-rung ladder whose third rung
 * was an author-filtered first-line marker. Ranks 1 and 2 agreed; 3 and 4 did not,
 * in both directions: two writer values appeared in no reader, and the rung the
 * mechanics actually land on could not be recorded at all.
 *
 * The ladder is now stated ONCE, as the `dedup_ladder` define beside the capability
 * table in `src/assets/mds/tracker/_mcp.mds`, and expanded into each tool-call
 * provider's mechanics. This seam is the other half: the writer's enum is compared
 * against that ladder, so a rung added on one side and not the other is red here
 * instead of being discovered as a mis-narrowed probe.
 *
 * Modelled on `tests/seams/tracker-claim-staleness.test.ts`, and asserted the same
 * way: the ladder is read from the SOURCE module (the generated contract carries the
 * emitted half only), every collector is driven by a known-bad sample in the same
 * `it`, and a side that states nothing is REPORTED as unstated rather than read as
 * agreement (PF-018).
 *
 * §14.4 is asserted too: a rung is named for the CAPABILITY it needs, never for a
 * tool. That is checked against the contract's own capability table rather than
 * against a list here, so the vocabulary stays closed at both ends.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';

import { MCP_BACKED_PROVIDER_SUBDIRS } from '../../src/core/mds-variants.js';
import { compiledSkillRefsDir } from '../../src/core/assets.js';
import { ROOT, resolveAgentSource } from '../helpers.js';

const MCP_MODULE = path.join(ROOT, 'src', 'assets', 'mds', 'tracker', '_mcp.mds');
const LADDER_DEFINE = 'dedup_ladder';
const LADDER_HEADING = '### Dedup ladder';
const SCHEMA_SECTION = '## Dedup Strategy';

/** The module source of one tool-call provider, addressed through the registry. */
function providerModule(subdir: string): { name: string; source: string } {
  const name = subdir.slice('tracker/'.length);
  return {
    name,
    source: readFileSync(path.join(ROOT, 'src', 'assets', 'mds', 'tracker', `_${name}.mds`), 'utf-8'),
  };
}

/** One provider's generated `backlink-shipped-issues` reference — where the ladder lands. */
function generatedBacklink(name: string): string {
  return readFileSync(
    path.join(compiledSkillRefsDir(ROOT), 'tracker', name, 'backlink-shipped-issues.md'),
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// Named collectors
// ---------------------------------------------------------------------------

/** A rung of the shared ladder, in the order the contract states it. */
export interface LadderRung {
  readonly position: number;
  readonly token: string;
}

/**
 * Named collector: the body of one `@define` in an MDS module.
 *
 * Returns `''` when the define is absent, so a renamed define is reported by the
 * arms below as an empty ladder rather than throwing somewhere unrelated.
 */
export function collectDefineBody(source: string, name: string): string {
  const open = source.indexOf(`@define ${name}(`);
  if (open === -1) return '';
  const end = source.indexOf('\n@end', open);
  return end === -1 ? source.slice(open) : source.slice(open, end);
}

/**
 * Named collector: the ladder's rungs, as position + TOKEN.
 *
 * The contract spells each rung `**<n> \`<token>\`**` — the number because the
 * ladder is ordered and one provider's mechanics state which rank they reach, the
 * backticked token because that is what `## Dedup Strategy` records. Both halves are
 * returned so the order can be checked as well as the set: a ladder whose rungs were
 * renumbered without being reordered would otherwise read as unchanged.
 */
export function collectLadderRungs(source: string): LadderRung[] {
  const body = collectDefineBody(source, LADDER_DEFINE);
  return [...body.matchAll(/\*\*(\d+) `([a-z][a-z-]*)`\*\*/g)]
    .map(match => ({ position: Number(match[1]), token: match[2] }));
}

/**
 * Named collector: the capability descriptions the ladder names.
 *
 * Italics are the contract's own spelling for "a row of the capability table", used
 * by every mechanics file that names one. Returned so the §14.4 arm can check each
 * against the table rather than against a list written here.
 *
 * SINGLE asterisks only. A `**bold**` span is emphasis on an instruction, and its
 * inner text would otherwise be collected as a capability — which would report the
 * ladder's own imperatives as undefined capabilities and make the arm below fail for
 * a reason that is not a drift.
 */
export function collectLadderCapabilities(source: string): string[] {
  const body = collectDefineBody(source, LADDER_DEFINE);
  return [...body.matchAll(/(?<!\*)\*([a-z][a-z ,/-]+)\*(?!\*)/g)].map(match => match[1].trim());
}

/**
 * Named collector: the capability names the contract's own table defines.
 *
 * The table is the authority for that vocabulary — it is where the rows live and
 * where "select by capability DESCRIPTION, never by tool name" is stated — so the
 * admitted set is parsed from it. Read from the SOURCE module for the reason
 * `tests/tracker/schema-scope.test.ts` reads it there: the generated copy exists
 * only while the generation gate is open, and a guard about this vocabulary must not
 * go quiet in the other gate state.
 */
export function collectContractCapabilities(source: string): string[] {
  return source
    .split('\n')
    .filter(line => /^\| /.test(line))
    .map(line => line.split('|')[1]?.trim() ?? '')
    .filter(cell => cell !== '' && cell !== 'Capability' && !/^-+$/.test(cell));
}

/**
 * Named collector: the tokens the Tracker agent's `## Dedup Strategy` row admits.
 *
 * The schema table is the writer's closed set — the row that says what may be
 * written into the file at all — so it is the writer side of this seam. Backticked
 * spans in the row's validator cell only; the section name in the first cell is
 * skipped, or the heading would come back as a value.
 */
export function collectWriterRungEnum(agent: string): string[] {
  const row = agent
    .split('\n')
    .find(line => line.startsWith(`| \`${SCHEMA_SECTION}\``));
  if (row === undefined) return [];
  const cells = row.split('|').slice(2);
  return [...cells.join('|').matchAll(/`([a-z][a-z-]*)`/g)].map(match => match[1]);
}

/**
 * Named collector: the rung tokens the agent's capability PROBE table records.
 *
 * The probe table maps a capability the agent can observe to what it fills. A fill
 * naming a token outside the ladder is a value the agent would write and no reader
 * could act on — the same defect as an unstated enum value, one table over.
 */
export function collectWriterProbeFills(agent: string): string[] {
  return [...agent.matchAll(new RegExp(`\`${SCHEMA_SECTION}\` \\(\`([a-z][a-z-]*)\`\\)`, 'g'))]
    .map(match => match[1]);
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

describe('tracker dedup ladder seam: the writer records rungs the readers can act on', () => {
  const contract = readFileSync(MCP_MODULE, 'utf-8');
  const agent = resolveAgentSource('tracker').content;
  const rungs = collectLadderRungs(contract);

  it('the contract states the ladder (collector is live)', () => {
    expect(
      rungs,
      `no \`${LADDER_DEFINE}\` rungs parsed out of ${path.relative(ROOT, MCP_MODULE)} — the shared ` +
        'ladder was renamed or lost its `**<n> `token`**` spelling, and every arm below would be ' +
        'comparing the writer against nothing',
    ).not.toHaveLength(0);
    expect(
      rungs.map(rung => rung.position),
      'the rungs must be numbered contiguously from 1: one provider states the RANK it reaches, so ' +
        'a gap or a repeat makes that statement name a rung nobody can find',
    ).toEqual(rungs.map((_, index) => index + 1));

    // Known-bad, same it: a renamed define yields no rungs, and a seeded ladder is
    // read in its stated order rather than sorted.
    expect(collectLadderRungs('@define other():\n**1 `a`** → **2 `b`**\n@end\n')).toEqual([]);
    expect(
      collectLadderRungs(`@define ${LADDER_DEFINE}():\n**1 \`a-b\`** → **2 \`c\`**\n@end\n`),
    ).toEqual([{ position: 1, token: 'a-b' }, { position: 2, token: 'c' }]);
  });

  it('the Tracker agent states its closed set of rung tokens (collector is live)', () => {
    const enumTokens = collectWriterRungEnum(agent);
    expect(
      enumTokens,
      `the Tracker agent's \`${SCHEMA_SECTION}\` schema row admits no backticked token — the ` +
        'writer half of this seam is missing, and the comparison below would pass over an empty set',
    ).not.toHaveLength(0);

    // Known-bad, same it: the section name in the first cell is not a value, a row
    // for another section is not this row, and a missing row reports [].
    expect(
      collectWriterRungEnum('| `## Dedup Strategy` | global-safe | probe live | enum: `a` \\| `b-c` |'),
    ).toEqual(['a', 'b-c']);
    expect(collectWriterRungEnum('| `## Assignee` | global-safe | `none` | enum: `none` \\| `self` |'))
      .toEqual([]);
    expect(collectWriterRungEnum('no table here\n')).toEqual([]);
  });

  it('the writer\'s enum and the contract\'s ladder are the same set, both directions', () => {
    const ladderTokens = rungs.map(rung => rung.token).sort();
    const enumTokens = [...collectWriterRungEnum(agent)].sort();

    const unstated = enumTokens.filter(token => !ladderTokens.includes(token));
    expect(
      unstated,
      `the Tracker agent may record rung token(s) no provider's ladder states: ${unstated.join(', ')}. ` +
        'A recorded rung is a hint that NARROWS the probe order (OD-11), so a token the reader ' +
        'cannot place narrows the probe toward a rung that was never probed — a wrong narrowing, ' +
        'not a refused one.',
    ).toEqual([]);

    const unrecordable = ladderTokens.filter(token => !enumTokens.includes(token));
    expect(
      unrecordable,
      `the ladder has rung(s) the Tracker agent cannot record: ${unrecordable.join(', ')}. The rung ` +
        'the mechanics actually land on must be writable, or the hint is silent exactly where it ' +
        'would have helped.',
    ).toEqual([]);
  });

  it('every token the probe table fills with is a rung of the ladder', () => {
    const ladderTokens = rungs.map(rung => rung.token);
    const fills = collectWriterProbeFills(agent);
    expect(
      fills,
      'the capability probe table fills `## Dedup Strategy` with no token — the agent probes ' +
        'capabilities and records nothing this seam can compare',
    ).not.toHaveLength(0);

    const stray = [...new Set(fills)].filter(token => !ladderTokens.includes(token));
    expect(
      stray,
      `the probe table records token(s) outside the ladder: ${stray.join(', ')}`,
    ).toEqual([]);

    // Known-bad, same it: a fill for another rung spelling is collected, and prose
    // that merely mentions the section is not a fill.
    expect(collectWriterProbeFills('| x | `## Dedup Strategy` (`remote-link`) |')).toEqual(['remote-link']);
    expect(collectWriterProbeFills('records `## Dedup Strategy` with its evidence')).toEqual([]);
  });

  it('every rung is named for a CAPABILITY the contract defines, never for a tool (§14.4)', () => {
    const capabilities = collectContractCapabilities(contract);
    expect(
      capabilities,
      'no capability rows parsed from the contract — the table is the authority for this ' +
        'vocabulary, and an empty set would admit every spelling',
    ).not.toHaveLength(0);

    const named = collectLadderCapabilities(contract);
    expect(
      named,
      'the ladder names no capability at all. A rung that names no capability is a rung selected ' +
        'by something else — a tool name, or nothing — which is what §14.4 forbids',
    ).not.toHaveLength(0);

    const undefined_ = named.filter(capability => !capabilities.includes(capability));
    expect(
      undefined_,
      `the ladder names capabilit(ies) the contract's table does not define: ${undefined_.join(', ')}. ` +
        'Tool rosters disagree across vendors and versions, so a rung selected by anything but a ' +
        'defined capability is a rung that resolves differently per server.',
    ).toEqual([]);

    // Known-bad, same it: the collectors are driven over a seeded contract.
    expect(collectContractCapabilities('| Capability | Unavailable ⇒ |\n|---|---|\n| search | x |'))
      .toEqual(['search']);
    expect(
      collectLadderCapabilities(`@define ${LADDER_DEFINE}():\n**1 \`a\`** (*batch fetch*)\n@end\n`),
    ).toEqual(['batch fetch']);
    expect(
      collectLadderCapabilities(`@define ${LADDER_DEFINE}():\n**post anyway** (*search*)\n@end\n`),
      'a bold instruction is not a capability — collecting one would report the ladder\'s own ' +
        'imperatives as undefined vocabulary',
    ).toEqual(['search']);
  });

  it('the agent records a rung TOKEN, never a bare rank number', () => {
    // The defect this seam was written for: an integer means whatever its writer was
    // counting, and the two ends were counting different ladders.
    const template = agent.slice(agent.indexOf(`${SCHEMA_SECTION}\n`, agent.indexOf('```tracker-md-template')));
    expect(
      /^rung: /m.test(template),
      'the template must record the rung under a `rung:` key holding a token from the enum',
    ).toBe(true);
    expect(
      /^rank: /m.test(template),
      'a `rank:` field records a number, which is exactly the spelling the two ends disagreed about',
    ).toBe(false);
  });

  it('each tool-call provider expands the shared ladder instead of restating one', () => {
    expect(
      MCP_BACKED_PROVIDER_SUBDIRS.length,
      'no tool-call provider is registered — the reader half of this seam would be vacuous',
    ).toBeGreaterThan(0);

    for (const subdir of MCP_BACKED_PROVIDER_SUBDIRS) {
      const { name, source } = providerModule(subdir);
      const invocations = source.split(`{${LADDER_DEFINE}()}`).length - 1;
      expect(
        invocations,
        `${name} invokes {${LADDER_DEFINE}()} ${invocations} time(s) — it must be exactly one: none ` +
          'means the module states a ladder of its own again, and two means the reference ships it twice',
      ).toBe(1);

      const generated = generatedBacklink(name);
      expect(
        generated.split(LADDER_HEADING).length - 1,
        `${name}'s backlink reference must carry the ladder exactly once`,
      ).toBe(1);
      for (const rung of rungs) {
        expect(
          generated.includes(`\`${rung.token}\``),
          `${name}'s backlink reference does not name the \`${rung.token}\` rung`,
        ).toBe(true);
      }
    }
  });
});
