/**
 * Guard: the per-plugin skill closure (`requires:`) is bidirectionally complete.
 *
 * Skills are plugin-scoped (rules already were; agents and commands always have
 * been). A plugin therefore installs `skills ∪ requires`, and every `devflow:`
 * skill reference reachable from what that plugin installs has to land inside
 * that set — otherwise a selected plugin ships a prompt pointing at a skill the
 * install does not carry.
 *
 * The corpus is WIDENED past commands and agents to the skill bodies themselves
 * (design review C1): `review-methodology/SKILL.md` names ten pattern skills,
 * `git/SKILL.md` names `worktree-support`, `test-driven-development/SKILL.md`
 * names `testing`. An installed skill's own references are install-visible, so
 * the closure is iterated to a fixed point over
 *   dist/commands/*.md  ∪  agent sources  ∪  SKILL.md + references/** of every
 *   skill already in the closure
 * bounded by the number of registry skills (a skill is scanned at most once).
 *
 * Both directions are load-bearing:
 *   - forward  — a reference with no in-scope skill is a dangling prompt;
 *   - reverse  — a `requires` entry nothing references is a skill the user
 *     installs for no reason, and the table stops being derivable from evidence.
 *
 * Cloned from registry-integrity.test.ts Guard 1 (forward) / Guard 2 (reverse),
 * including its named-collector + synthetic-probe shape: every assertion runs
 * through the same collector the known-bad probe exercises, so a collector that
 * silently sees nothing cannot make the guard pass (PF-018).
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import {
  DEVFLOW_PLUGINS,
  FEATURE_OWNED_SKILLS,
  SKILL_NAMESPACE,
  PRESENCE_GATED_SKILLS,
  TEMPLATE_SKILL_REFS,
  getAllSkillNames,
  skillsOf,
  type PluginDefinition,
} from '../../src/core/plugins.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SKILLS_DIR = path.join(ROOT, 'src', 'assets', 'skills');
const COMMANDS_DIR = path.join(ROOT, 'dist', 'commands');
const AGENT_DIRS = [path.join(ROOT, 'dist', 'agents'), path.join(ROOT, 'src', 'assets', 'agents')];

/**
 * Every distinct reference the corpus must clear, over the widened corpus.
 * Non-vacuity: a scanner that stopped matching would drop to zero and this
 * floor is what notices. Measured 2026-09-19 over 200 files / 297 sites.
 */
const REF_TOKEN_FLOOR = 44;

/**
 * The namespace prefix, composed rather than spelled inline in the probes below.
 *
 * The probes deliberately feed the scanner names that are NOT skills — a typo, an
 * undeclared reference — and that is the whole point of them. Writing those as
 * source literals would also hand them to `tests/skill-references.test.ts`, whose
 * job is to catch exactly such a name appearing anywhere under `tests/`. The
 * probe input is byte-identical either way; only the spelling in this file moves,
 * so the global scanner stays strict instead of gaining an exemption for the one
 * file whose subject is invalid references.
 */
const NS = `${SKILL_NAMESPACE}`;

// ---------------------------------------------------------------------------
// Named collectors
// ---------------------------------------------------------------------------

/** One `devflow:` occurrence, with the bytes immediately to its left. */
interface RawRef {
  /** Full reference as written, e.g. `devflow:security` or `devflow:{focus}`. */
  readonly raw: string;
  /** The part after the colon. */
  readonly token: string;
  /** Repo-relative file it was found in. */
  readonly file: string;
}

/**
 * Named collector: every `devflow:`-prefixed SKILL reference in one file body.
 *
 * Two `devflow:` spellings in this repo are not skill references and are
 * classified out by their left context rather than by an allowlist of names —
 * an allowlist would also swallow a misspelt skill, which is precisely the
 * defect the forward arm exists to catch:
 *   - `/devflow:dynamic-plan`      — a slash-command reference (leading `/`);
 *   - `<!-- devflow:review-summary` — a devflow marker comment.
 * Everything else is a skill reference and must resolve.
 */
export function collectSkillRefs(body: string, file: string): RawRef[] {
  const refs: RawRef[] = [];
  for (const match of body.matchAll(/(.{0,5})devflow:([A-Za-z0-9_{}-]+)/g)) {
    const left = match[1];
    if (left.endsWith('/')) continue;      // slash-command reference
    if (left.includes('<!--')) continue;   // devflow marker comment
    refs.push({ raw: `devflow:${match[2]}`, token: match[2], file });
  }
  return refs;
}

/**
 * Resolve one reference against a scope.
 *
 * A reference carrying a `{...}` placeholder is a TEMPLATE. It resolves through
 * the literal prefix in front of the placeholder: the Research agent's
 * `research-{RESEARCH_TYPE}` form resolves iff at least one in-scope skill
 * starts with `research-`. A template with NO literal prefix —
 * `devflow:{focus}` — has nothing to resolve against, and that is exactly the
 * one classified exception the registry declares.
 */
function resolveRef(ref: RawRef, scope: ReadonlySet<string>): 'in-scope' | 'template-exception' | 'out-of-scope' {
  if (TEMPLATE_SKILL_REFS.some(t => t.literal === ref.raw)) return 'template-exception';
  const brace = ref.token.indexOf('{');
  if (brace >= 0) {
    const prefix = ref.token.slice(0, brace);
    if (prefix.length === 0) return 'out-of-scope';
    return [...scope].some(s => s.startsWith(prefix)) ? 'in-scope' : 'out-of-scope';
  }
  // Presence-gated and feature-owned skills are referenced opportunistically:
  // the referencing prompt probes for the skill and proceeds without it.
  if ((PRESENCE_GATED_SKILLS as readonly string[]).includes(ref.token)) return 'in-scope';
  if ((FEATURE_OWNED_SKILLS as readonly string[]).includes(ref.token)) return 'in-scope';
  return scope.has(ref.token) ? 'in-scope' : 'out-of-scope';
}

async function walkMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walkMarkdown(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

async function firstExistingAgentSource(name: string): Promise<string | undefined> {
  for (const dir of AGENT_DIRS) {
    const candidate = path.join(dir, `${name}.md`);
    try {
      await fs.access(candidate);
      return candidate;
    } catch { /* try the next directory in preference order */ }
  }
  return undefined;
}

async function readRefs(files: readonly string[]): Promise<RawRef[]> {
  const refs: RawRef[] = [];
  for (const file of files) {
    let body: string;
    try { body = await fs.readFile(file, 'utf-8'); } catch { continue; }
    refs.push(...collectSkillRefs(body, path.relative(ROOT, file)));
  }
  return refs;
}

/**
 * Named collector: the fixed-point reference closure of one plugin's installed
 * corpus. Returns every reference seen, so both arms read the same evidence.
 *
 * Bounded: each skill body is scanned at most once, so the loop runs at most
 * `getAllSkillNames().length + 1` times.
 */
async function collectPluginRefs(plugin: PluginDefinition): Promise<RawRef[]> {
  const scope = skillsOf([plugin]);
  const seen: RawRef[] = [];
  const scanned = new Set<string>();

  let frontier: string[] = [];
  for (const command of plugin.commands) {
    frontier.push(path.join(COMMANDS_DIR, `${command.replace(/^\//, '')}.md`));
  }
  for (const agent of plugin.agents) {
    const source = await firstExistingAgentSource(agent);
    if (source !== undefined) frontier.push(source);
  }

  const bound = getAllSkillNames().length + 2;
  for (let round = 0; round < bound && frontier.length > 0; round++) {
    seen.push(...await readRefs(frontier));
    const next: string[] = [];
    for (const skill of scope) {
      if (scanned.has(skill)) continue;
      scanned.add(skill);
      next.push(...await walkMarkdown(path.join(SKILLS_DIR, skill)));
    }
    frontier = next;
  }
  return seen;
}

// ---------------------------------------------------------------------------
// Forward: every reference resolves inside skills ∪ requires
// ---------------------------------------------------------------------------

describe('requires closure (forward): every skill reference resolves in scope', () => {
  it('every devflow: reference in a plugin corpus resolves inside skills ∪ requires', async () => {
    const violations: string[] = [];
    for (const plugin of DEVFLOW_PLUGINS) {
      const scope = skillsOf([plugin]);
      for (const ref of await collectPluginRefs(plugin)) {
        if (resolveRef(ref, scope) === 'out-of-scope') {
          violations.push(`${plugin.name}: ${ref.raw} referenced by ${ref.file}`);
        }
      }
    }
    expect(
      violations,
      'Every devflow: skill reference reachable from a plugin must resolve inside that ' +
      "plugin's skills ∪ requires. Add the skill to the owning plugin's requires: in " +
      `src/core/plugins.ts, or classify it in TEMPLATE_SKILL_REFS:\n  ${violations.join('\n  ')}`,
    ).toEqual([]);
  });

  it('known-bad probe: an undeclared reference in a synthetic corpus is caught', () => {
    const refs = collectSkillRefs(`Load via Skill(skill="${NS}undeclared").`, 'synthetic.md');
    expect(refs.map(r => r.raw)).toEqual([`${NS}undeclared`]);
    expect(resolveRef(refs[0], new Set(['security']))).toBe('out-of-scope');
  });

  it('known-bad probe: the two non-skill devflow: spellings are classified out, a typo is not', () => {
    const body = [
      `See \`/${NS}dynamic-plan\` for the planning pass.`,
      `<!-- ${NS}review-summary ts:{TS} -->`,
      `Load \`${NS}securty\` for the security pass.`,
    ].join('\n');
    expect(collectSkillRefs(body, 'synthetic.md').map(r => r.raw)).toEqual([`${NS}securty`]);
  });
});

// ---------------------------------------------------------------------------
// Reverse: nothing in requires is unreferenced
// ---------------------------------------------------------------------------

describe('requires closure (reverse): no requires entry is dead weight', () => {
  it('every requires entry is referenced somewhere in its plugin corpus', async () => {
    const violations: string[] = [];
    for (const plugin of DEVFLOW_PLUGINS) {
      if (plugin.requires.length === 0) continue;
      const referenced = new Set((await collectPluginRefs(plugin)).map(r => r.token));
      for (const required of plugin.requires) {
        if (!referenced.has(required)) {
          violations.push(`${plugin.name}: requires '${required}' but nothing in its corpus references it`);
        }
      }
    }
    expect(
      violations,
      'A requires entry nothing references installs a skill for no reason. Remove it, or ' +
      `reference it from a command, agent or skill body:\n  ${violations.join('\n  ')}`,
    ).toEqual([]);
  });

  it('known-bad probe: a synthetic plugin requiring an unreferenced skill is caught', async () => {
    const synthetic: PluginDefinition = {
      name: 'devflow-synthetic',
      description: 'probe',
      commands: [],
      agents: [],
      skills: [],
      requires: ['nonexistent-skill'],
      rules: [],
    };
    const referenced = new Set((await collectPluginRefs(synthetic)).map(r => r.token));
    expect(referenced.has('nonexistent-skill')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Structural: what may and may not appear in requires
// ---------------------------------------------------------------------------

describe('requires structure', () => {
  it('every requires entry is a known registry skill', () => {
    const known = new Set(getAllSkillNames());
    const unknown = DEVFLOW_PLUGINS.flatMap(p =>
      p.requires.filter(r => !known.has(r)).map(r => `${p.name}: ${r}`));
    expect(unknown, `requires entries must name registry skills:\n  ${unknown.join('\n  ')}`).toEqual([]);
  });

  it('requires is disjoint from skills — a plugin never requires what it owns', () => {
    const overlap = DEVFLOW_PLUGINS.flatMap(p =>
      p.requires.filter(r => p.skills.includes(r)).map(r => `${p.name}: ${r}`));
    expect(overlap, `owned skills must not be restated in requires:\n  ${overlap.join('\n  ')}`).toEqual([]);
  });

  it('no feature-owned skill appears in any requires (compliance is never plugin-scoped)', () => {
    const leaked = DEVFLOW_PLUGINS.flatMap(p =>
      p.requires.filter(r => (FEATURE_OWNED_SKILLS as readonly string[]).includes(r)).map(r => `${p.name}: ${r}`));
    expect(leaked, `feature-owned skills are installed by their feature, never by a plugin:\n  ${leaked.join('\n  ')}`).toEqual([]);
  });

  it('no presence-gated language skill appears in any requires (AC-25)', () => {
    const leaked = DEVFLOW_PLUGINS.flatMap(p =>
      p.requires.filter(r => (PRESENCE_GATED_SKILLS as readonly string[]).includes(r)).map(r => `${p.name}: ${r}`));
    expect(
      leaked,
      'Language skills ship with optional plugins and are probed for at spawn time, never ' +
      `required:\n  ${leaked.join('\n  ')}`,
    ).toEqual([]);
  });

  it('/code-review presence-gates every language focus before spawning it', async () => {
    // The counterpart of the arm above: language skills stay out of `requires`
    // ONLY because the command probes for them. If this gate is ever removed,
    // `/code-review` spawns a Review agent whose pattern skill is not installed.
    const body = await fs.readFile(path.join(COMMANDS_DIR, 'code-review.md'), 'utf-8');
    const gate = body.split('\n').find(line => line.includes('Language focus presence gate'));
    expect(gate, 'dist/commands/code-review.md must carry the language focus presence gate').toBeDefined();
    expect(gate).toContain('~/.claude/skills/devflow:{focus}/SKILL.md');
    for (const focus of PRESENCE_GATED_SKILLS) {
      expect(gate, `the gate must name the ${focus} focus`).toContain(`\`${focus}\``);
      expect(
        body,
        `the Phase 2 spawn table must mark ${focus} presence-gated, not merely conditional`,
      ).toContain(`| ${focus} | presence-gated | devflow:${focus} |`);
    }
  });

  it('PRESENCE_GATED_SKILLS is exactly the command-less optional plugins\' skills', () => {
    const expected = DEVFLOW_PLUGINS
      .filter(p => p.optional === true && p.commands.length === 0)
      .flatMap(p => p.skills)
      .sort();
    expect([...PRESENCE_GATED_SKILLS].sort()).toEqual(expected);
    expect(PRESENCE_GATED_SKILLS.length, 'derived set must be non-empty').toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The classified exception, and the non-vacuity floor
// ---------------------------------------------------------------------------

describe('classified template exception', () => {
  it('every declared template literal still occurs in the corpus (no stale exemption)', async () => {
    const bodies: string[] = [];
    for (const dir of [COMMANDS_DIR, ...AGENT_DIRS, SKILLS_DIR]) {
      for (const file of await walkMarkdown(dir)) bodies.push(await fs.readFile(file, 'utf-8'));
    }
    const corpus = bodies.join('\n');
    for (const template of TEMPLATE_SKILL_REFS) {
      expect(
        corpus.includes(template.literal),
        `TEMPLATE_SKILL_REFS declares "${template.literal}" but nothing writes it — a stale ` +
        'exemption is an exemption nobody can lose (PF-067).',
      ).toBe(true);
    }
  });

  it('the exception is the ONE prefix-less template: every other template resolves by prefix', () => {
    for (const template of TEMPLATE_SKILL_REFS) {
      const token = template.literal.slice('devflow:'.length);
      expect(
        token.indexOf('{'),
        `"${template.literal}" has a literal prefix and therefore resolves without an exemption`,
      ).toBe(0);
    }
  });

  it(`the corpus carries at least ${REF_TOKEN_FLOOR} distinct skill references (non-vacuity)`, async () => {
    const distinct = new Set<string>();
    for (const dir of [COMMANDS_DIR, ...AGENT_DIRS, SKILLS_DIR]) {
      for (const file of await walkMarkdown(dir)) {
        const body = await fs.readFile(file, 'utf-8');
        for (const ref of collectSkillRefs(body, file)) distinct.add(ref.raw);
      }
    }
    expect(
      distinct.size,
      'A scanner that stopped matching would make both arms pass over an empty corpus.',
    ).toBeGreaterThanOrEqual(REF_TOKEN_FLOOR);
  });
});
