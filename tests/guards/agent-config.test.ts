/**
 * agent-config — the shipped model, effort, tool policy and preload of fifteen
 * agents, and the rule that no agent body directs a tool its frontmatter removes.
 *
 * Decisions recorded here. Each is a D-series note at the code that carries it;
 * the ones that live in a markdown body, which cannot hold JSDoc, are named here.
 *
 *  - D-AGENT-CONFIG-TABLE      tests/fixtures/agent-config.ts (AGENT_CONFIG): the
 *                              shipped row of every agent, and the departures from
 *                              the plan's tool table.
 *  - D-SHARED-DENYLIST         tests/fixtures/agent-config.ts (SHARED_DENYLIST) and
 *                              the denylist arm below.
 *  - D-TOOL-BODY-MATCH         the tool/body arm below.
 *  - D-PRELOAD-TRIM            AGENT_CONFIG's preload sets and the preload arm
 *                              below; src/core/plugins.ts at each trimmed
 *                              `requires:` entry.
 *  - D-DIAGNOSE-FOCUS-SKILLS   tests/fixtures/agent-config.ts
 *                              (DIAGNOSE_FOCUS_SKILLS) and the Diagnose arm below.
 *                              The decision itself lives in the Focus Areas table
 *                              of the Diagnose agent: a "Pattern skill
 *                              (load on demand)" column and one instruction before
 *                              Step 1 to load the row's skills with the Skill tool,
 *                              continuing with the methodology if a load fails.
 *  - D-LEARNING-SHIPPED-ROW    tests/fixtures/agent-config.ts (the learning row).
 *  - D-STRUCTURED-RETURN-TOOL  the structured-return arm below.
 *
 * Body-level decisions, pinned by the phrases they carry:
 *  - Knowledge refreshes an existing file with `Edit` and uses `Write` only to
 *    create one (Direct Write Protocol in the Knowledge agent). Without
 *    it the granted `Edit` goes unused and the agent rewrites whole files.
 *  - Synthesize states decisions and pitfalls in words, never by ledger ID
 *    (src/assets/agents/synthesize.md). Under `omitClaudeMd` it no longer receives
 *    the project CLAUDE.md, so its own body has to carry the rule.
 *  - Learning names no Grep or Glob tool (src/assets/agents/learning.md). An agent
 *    that has Bash is given neither tool, so its search steps are Bash commands.
 *
 * What a green run does NOT prove
 * -------------------------------
 * - The tool/body arm reads tool NAMES a body uses in one of four shapes (a call, "the X
 *   tool", a skill load, a ToolSearch `select:`). A body that directs a tool in other
 *   words ("update the file", with no Edit) passes. The invariant it serves is wider than
 *   the arm: every verb a body uses has to map to a granted tool.
 * - It reads the agent body and the SKILL.md of each preloaded skill. A skill's
 *   references/ files, and a skill loaded on demand, are outside it.
 * - It proves nothing about what the runtime offers: a denied name the runtime does not
 *   expose is assumed to be a no-op, and an allowlisted Grep or Glob is inert for an agent
 *   that also has Bash. Live spawn checks answer those.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

import { getAllAgentNames } from '../../src/core/plugins.js';
import { ROOT, resolveAgentSource, splitFrontmatter, walkFiles } from '../helpers.js';
import {
  AGENT_CONFIG,
  DIAGNOSE_FOCUS_SKILLS,
  EXEMPT_AGENTS,
  SHARED_DENYLIST,
  type AgentConfigRow,
} from '../fixtures/agent-config.js';

const SKILLS_DIR = path.join(ROOT, 'src', 'assets', 'skills');
const COMMANDS_DIR = path.join(ROOT, 'src', 'assets', 'commands');

/** The frontmatter keys an agent file may carry; a misspelt key would silently ship nothing. */
const KNOWN_KEYS: readonly string[] = [
  'name',
  'description',
  'model',
  'effort',
  'skills',
  'tools',
  'disallowedTools',
  'omitClaudeMd',
];

// ---------------------------------------------------------------------------
// Frontmatter parser
// ---------------------------------------------------------------------------

/** An agent's frontmatter as the guard reads it. A list or scalar is null when its key is absent. */
interface AgentFrontmatter {
  /** Every top-level key, in order. */
  keys: string[];
  model: string | null;
  effort: string | null;
  tools: string[] | null;
  disallowedTools: string[] | null;
  skills: string[] | null;
  /** The raw `omitClaudeMd:` value. */
  omitClaudeMd: string | null;
}

function unquote(value: string): string {
  return value.replace(/^(["'])(.*)\1$/, '$2');
}

/**
 * Parse a frontmatter block's inner text. Reads both list forms the agent files use:
 * an inline array (`tools: ["Bash", "Read"]`) and a YAML block list. A scalar line that
 * continues onto another line is not read; no key this guard pins is written that way.
 */
function parseAgentFrontmatter(inner: string): AgentFrontmatter {
  const keys: string[] = [];
  const scalars = new Map<string, string>();
  const lists = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of inner.split(/\r?\n/)) {
    const item = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (item && current !== null) {
      lists.get(current)?.push(unquote(item[1]));
      continue;
    }
    const pair = /^([A-Za-z][A-Za-z0-9]*):[ \t]*(.*?)[ \t]*$/.exec(line);
    if (!pair) continue;
    current = pair[1];
    keys.push(current);
    const value = pair[2];
    const inline = /^\[(.*)\]$/.exec(value);
    if (inline) {
      lists.set(current, inline[1].split(',').map(part => unquote(part.trim())).filter(part => part !== ''));
    } else if (value === '') {
      lists.set(current, []);
    } else {
      scalars.set(current, unquote(value));
    }
  }
  return {
    keys,
    model: scalars.get('model') ?? null,
    effort: scalars.get('effort') ?? null,
    tools: lists.get('tools') ?? null,
    disallowedTools: lists.get('disallowedTools') ?? null,
    skills: lists.get('skills') ?? null,
    omitClaudeMd: scalars.get('omitClaudeMd') ?? null,
  };
}

// ---------------------------------------------------------------------------
// Named collectors: the table, the denylist, completeness
// ---------------------------------------------------------------------------

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
}

function duplicates(list: readonly string[]): string[] {
  return list.filter((name, i) => list.indexOf(name) !== i);
}

/** The names a row says the agent denies, in the denylist agent's case. */
function expectedDenylist(row: AgentConfigRow): string[] | null {
  return row.policy.kind === 'deny' ? [...SHARED_DENYLIST, ...row.policy.extra] : null;
}

/**
 * Every way one agent's frontmatter departs from its row. Pure: the live arm and the
 * seeded probes run this same function.
 */
function collectRowViolations(name: string, fm: AgentFrontmatter, row: AgentConfigRow): string[] {
  const out: string[] = [];
  const at = `${name}.md`;

  for (const key of fm.keys) {
    if (!KNOWN_KEYS.includes(key)) out.push(`${at}: unknown frontmatter key "${key}"`);
  }
  if (fm.model !== row.model) out.push(`${at}: model is ${fm.model ?? 'absent'}, the row says ${row.model}`);
  if (fm.effort !== row.effort) {
    out.push(`${at}: effort is ${fm.effort ?? 'absent'}, the row says ${row.effort ?? 'no effort line'}`);
  }

  if (row.policy.kind === 'allow') {
    if (fm.tools === null) out.push(`${at}: no tools list, the row says an allowlist`);
    else if (!sameSet(fm.tools, row.policy.tools)) {
      out.push(`${at}: tools are [${fm.tools.join(', ')}], the row says [${row.policy.tools.join(', ')}]`);
    }
    if (fm.disallowedTools !== null) out.push(`${at}: an allowlist agent declares disallowedTools`);
  } else {
    const expected = expectedDenylist(row) as string[];
    if (fm.disallowedTools === null) out.push(`${at}: no disallowedTools list, the row says a denylist`);
    else if (!sameSet(fm.disallowedTools, expected)) {
      out.push(`${at}: disallowedTools are [${fm.disallowedTools.join(', ')}], the row says [${expected.join(', ')}]`);
    }
    if (fm.tools !== null) out.push(`${at}: a denylist agent declares tools`);
  }
  for (const [key, list] of [['tools', fm.tools], ['disallowedTools', fm.disallowedTools], ['skills', fm.skills]] as const) {
    if (list !== null && duplicates(list).length > 0) out.push(`${at}: ${key} repeats ${duplicates(list).join(', ')}`);
  }

  const omit = fm.omitClaudeMd;
  if (row.omitClaudeMd && omit !== 'true') out.push(`${at}: omitClaudeMd is ${omit ?? 'absent'}, the row says true`);
  if (!row.omitClaudeMd && omit !== null && omit !== 'false') out.push(`${at}: omitClaudeMd is ${omit}, the row says it is off`);

  if (row.skills !== null) {
    const declared = (fm.skills ?? []).map(skill => skill.replace(/^devflow:/, ''));
    if (!sameSet(declared, row.skills)) {
      out.push(`${at}: skills are [${declared.join(', ')}], the row says [${row.skills.join(', ')}]`);
    }
    if (row.skills.length === 0 && fm.skills !== null) out.push(`${at}: declares a skills key, the row says none`);
  }
  return out;
}

/** Every way the shared denylist, or a denylist agent's use of it, breaks the rules. */
function collectDenylistViolations(name: string, fm: AgentFrontmatter): string[] {
  const out: string[] = [];
  const names = [...(fm.tools ?? []), ...(fm.disallowedTools ?? [])];
  for (const tool of names) {
    if (tool.includes('*')) out.push(`${name}.md: "${tool}" is a wildcard; spell every tool name out`);
  }
  for (const tool of fm.disallowedTools ?? []) {
    if (tool === 'WebFetch' || tool === 'WebSearch' || tool.startsWith('mcp__')) {
      out.push(`${name}.md: denies "${tool}"; a denylist agent keeps its MCP and web access`);
    }
  }
  return out;
}

/** Registered agents and table rows that do not line up, and exemptions without a reason. */
function collectCompletenessViolations(
  registered: readonly string[],
  table: readonly string[],
  exempt: Readonly<Record<string, string>>,
): string[] {
  const out: string[] = [];
  for (const name of registered) {
    if (!table.includes(name) && !Object.hasOwn(exempt, name)) {
      out.push(`${name}: registered, but in neither AGENT_CONFIG nor EXEMPT_AGENTS`);
    }
  }
  for (const name of table) {
    if (!registered.includes(name)) out.push(`${name}: has a row but is not a registered agent`);
    if (Object.hasOwn(exempt, name)) out.push(`${name}: is both in AGENT_CONFIG and exempt`);
  }
  for (const [name, reason] of Object.entries(exempt)) {
    if (!registered.includes(name)) out.push(`${name}: exempt but not a registered agent`);
    if (reason.trim() === '') out.push(`${name}: exempt with no recorded reason`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Named collectors: D-TOOL-BODY-MATCH
// ---------------------------------------------------------------------------

/** Every built-in tool name a body can direct, apart from MCP tools, which are read by prefix. */
const TOOL_VOCABULARY: readonly string[] = [
  'Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash', 'Skill', 'Monitor', 'ToolSearch', 'TaskStop',
  'StructuredOutput', 'WebFetch', 'WebSearch', ...SHARED_DENYLIST,
];
const TOOL_ALTERNATION = TOOL_VOCABULARY.join('|');

/** `Name(` as a call, not a longer identifier or a path segment. */
const CALL_FORM = new RegExp(`(?<![\\w.$/-])(${TOOL_ALTERNATION})\\(`, 'g');
/** "the Name tool" and "your Name tool", with or without backticks: this covers "using the" and "with the" too. */
const PHRASE_FORM = new RegExp(`\\b(?:the|your)\\s+\`?(${TOOL_ALTERNATION})\`?\\s+tool\\b`, 'g');
/** A skill load: "load" or "invoke the Skill tool", then a skill name, in the same sentence. */
const SKILL_LOAD_FORM = /\b(?:[Ll]oad|[Ii]nvoke the Skill tool)\b[^.\n]{0,80}?`?devflow:[a-z]/g;
/** A ToolSearch load: `select:` followed by a tool name. */
const SELECT_FORM = /\bselect:[A-Za-z]/g;
/** An MCP tool, named by its full `mcp__` identifier. */
const MCP_FORM = /\bmcp__[A-Za-z0-9_-]+/g;
/** A sentence that negates what it names directs nothing. */
const NEGATION = /\b(?:never|do not|does not|don't|must not|cannot|can't|no)\b/i;

/** The sentence around `index`: bounded by a newline or by sentence punctuation followed by whitespace. */
function sentenceAt(text: string, index: number): string {
  let from = index;
  while (from > 0 && text[from - 1] !== '\n' && !(/[.!?]/.test(text[from - 1]) && /\s/.test(text[from] ?? ''))) from--;
  let to = index;
  while (to < text.length && text[to] !== '\n' && !(/[.!?]/.test(text[to]) && /\s/.test(text[to + 1] ?? ''))) to++;
  return text.slice(from, to + 1).trim();
}

interface ToolInvocation {
  tool: string;
  line: number;
  sentence: string;
  negated: boolean;
}

/** Every tool a text directs, in the four shapes the arm reads (plus MCP names), with its sentence. */
function collectToolInvocations(text: string): ToolInvocation[] {
  const found: ToolInvocation[] = [];
  const add = (index: number, tool: string): void => {
    const sentence = sentenceAt(text, index);
    found.push({ tool, line: text.slice(0, index).split('\n').length, sentence, negated: NEGATION.test(sentence) });
  };
  for (const m of text.matchAll(CALL_FORM)) add(m.index, m[1]);
  for (const m of text.matchAll(PHRASE_FORM)) add(m.index, m[1]);
  for (const m of text.matchAll(SKILL_LOAD_FORM)) add(m.index, 'Skill');
  for (const m of text.matchAll(SELECT_FORM)) add(m.index, 'ToolSearch');
  for (const m of text.matchAll(MCP_FORM)) add(m.index, m[0]);
  return found;
}

/** A text of an agent's loaded set: its own body, or the body of a skill it preloads. */
interface BodyUnit {
  /** `body`, or `skill:<name>`. */
  source: string;
  text: string;
}

interface ToolBodyViolation {
  agent: string;
  source: string;
  tool: string;
  line: number;
  sentence: string;
}

/** True when the frontmatter removes `tool`: absent from an allowlist, or present in a denylist. */
function removes(fm: AgentFrontmatter, tool: string): boolean {
  if (fm.tools !== null) return !fm.tools.includes(tool);
  if (fm.disallowedTools !== null) return fm.disallowedTools.includes(tool);
  return false;
}

/**
 * D-TOOL-BODY-MATCH: every tool a body directs has to be a tool the agent holds. An
 * allowlist silently constrains how an agent can act, and a denylist removes a tool the
 * body may still direct, so a body that sends the agent to a removed tool sends it to a
 * tool it does not have. The arm reads the agent body and the SKILL.md of each preloaded
 * skill, because a preloaded skill is part of what the agent is told. A sentence that
 * negates the invocation ("never", "do not", "must not", "no") directs nothing and is
 * exempt.
 */
function collectToolBodyViolations(agent: string, fm: AgentFrontmatter, units: readonly BodyUnit[]): ToolBodyViolation[] {
  const out: ToolBodyViolation[] = [];
  for (const unit of units) {
    for (const inv of collectToolInvocations(unit.text)) {
      if (inv.negated || !removes(fm, inv.tool)) continue;
      out.push({ agent, source: unit.source, tool: inv.tool, line: inv.line, sentence: inv.sentence.slice(0, 160) });
    }
  }
  return out;
}

interface ToolBodyException {
  agent: string;
  source: string;
  tool: string;
  reason: string;
}

/**
 * The tool/body findings that are known and accepted, each with its reason. This is the
 * exemption half of D-TOOL-BODY-MATCH and is one authority with the arm above it: a
 * finding is either fixed or listed here, and an entry that no longer matches a finding
 * fails the guard, so the list can only shrink.
 */
const TOOL_BODY_EXCEPTIONS: readonly ToolBodyException[] = [];

function isExcepted(v: ToolBodyViolation, exceptions: readonly ToolBodyException[]): boolean {
  return exceptions.some(e => e.agent === v.agent && e.source === v.source && e.tool === v.tool);
}

// ---------------------------------------------------------------------------
// Named collectors: Diagnose, schema-bearing spawns
// ---------------------------------------------------------------------------

/** The section of a document from its `## <heading>` line to the next `## ` line. */
function sectionOf(document: string, heading: string): string {
  const text = `\n${document}`;
  const from = text.indexOf(`\n## ${heading}\n`);
  if (from === -1) return '';
  const start = from + 1;
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start, next === -1 ? undefined : next);
}

/** The Focus Areas table as a map from focus to the skills its third column names, unprefixed. */
function collectFocusTable(body: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const line of sectionOf(body, 'Focus Areas').split('\n')) {
    const cells = line.split('|').map(cell => cell.trim());
    const focus = /^`([a-z]+)`$/.exec(cells[1] ?? '');
    if (!focus || cells.length < 5) continue;
    const skills = [...(cells[cells.length - 2] ?? '').matchAll(/`devflow:([a-z0-9-]+)`/g)].map(m => m[1]);
    rows.set(focus[1], skills);
  }
  return rows;
}

/** A `devflow:` reference followed by a placeholder opener: a template, not a skill name. */
function collectPrefixlessTemplates(text: string): string[] {
  return [...text.matchAll(/devflow:[{<$[*%][^\s`"')]*/g)].map(m => m[0]);
}

/** The agent types spawned with a `schema:` option, which return their result through StructuredOutput. */
function collectSchemaSpawnTypes(text: string): Set<string> {
  const types = new Set<string>();
  for (const m of text.matchAll(/agentType\s*:\s*["']([A-Za-z]+)["']\s*,\s*schema\s*:/g)) types.add(m[1]);
  return types;
}

/** The text with whitespace runs collapsed, so a pin survives a reflow. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// The live corpus
// ---------------------------------------------------------------------------

interface AgentRecord {
  name: string;
  fm: AgentFrontmatter;
  body: string;
  units: BodyUnit[];
}

function readText(file: string): string {
  // A guard that skips an absent file is not a guard.
  if (!existsSync(file)) throw new Error(`${path.relative(ROOT, file)} is absent`);
  return readFileSync(file, 'utf-8');
}

function bodyOf(text: string): string {
  return splitFrontmatter(text)?.body ?? text;
}

function readAgent(name: string): AgentRecord {
  const text = resolveAgentSource(name).content;
  const split = splitFrontmatter(text);
  if (!split) throw new Error(`${name}.md has no frontmatter block`);
  const fm = parseAgentFrontmatter(split.inner);
  const units: BodyUnit[] = [{ source: 'body', text: split.body }];
  for (const skill of fm.skills ?? []) {
    const skillName = skill.replace(/^devflow:/, '');
    units.push({ source: `skill:${skillName}`, text: bodyOf(readText(path.join(SKILLS_DIR, skillName, 'SKILL.md'))) });
  }
  return { name, fm, body: split.body, units };
}

const AGENT_NAMES = Object.keys(AGENT_CONFIG);
const agents = new Map<string, AgentRecord>(AGENT_NAMES.map(name => [name, readAgent(name)]));
const agent = (name: string): AgentRecord => agents.get(name) as AgentRecord;

// ---------------------------------------------------------------------------
// Synthetic frontmatter for the probes
// ---------------------------------------------------------------------------

/** A frontmatter block's inner text for `row`, with `mutate` applied to the parsed shape first. */
function renderRow(name: string, row: AgentConfigRow, mutate: (fm: AgentFrontmatter) => void = () => undefined): AgentFrontmatter {
  const lines = [`name: ${name}`, `model: ${row.model}`];
  if (row.effort !== null) lines.push(`effort: ${row.effort}`);
  const block = (key: string, list: readonly string[]): void => {
    lines.push(`${key}:`, ...list.map(item => `  - ${item}`));
  };
  if ((row.skills ?? []).length > 0) block('skills', (row.skills as string[]).map(skill => `devflow:${skill}`));
  if (row.policy.kind === 'allow') block('tools', row.policy.tools);
  else block('disallowedTools', expectedDenylist(row) as string[]);
  if (row.omitClaudeMd) lines.push('omitClaudeMd: true');
  const fm = parseAgentFrontmatter(lines.join('\n'));
  mutate(fm);
  return fm;
}

// ---------------------------------------------------------------------------
// The arms
// ---------------------------------------------------------------------------

describe('the table: every agent ships its row (D-AGENT-CONFIG-TABLE)', () => {
  it('parses every agent in the table, each with a model', () => {
    expect([...agents.keys()].sort()).toEqual([...AGENT_NAMES].sort());
    for (const record of agents.values()) {
      expect(record.fm.model, `${record.name}.md has no model`).not.toBeNull();
    }
  });

  for (const name of AGENT_NAMES) {
    it(`${name}.md carries its row`, () => {
      expect(collectRowViolations(name, agent(name).fm, AGENT_CONFIG[name])).toEqual([]);
    });
  }

  it('Triage stays opus and Code stays sonnet', () => {
    expect(agent('triage').fm.model).toBe('opus');
    expect(agent('code').fm.model).toBe('sonnet');
  });

  describe('known-bad probes: one mutated field makes the collector report', () => {
    it('is quiet on a synthetic frontmatter built from each row', () => {
      for (const name of AGENT_NAMES) {
        expect(collectRowViolations(name, renderRow(name, AGENT_CONFIG[name]), AGENT_CONFIG[name]), name).toEqual([]);
      }
    });

    const probes: ReadonlyArray<readonly [string, string, (fm: AgentFrontmatter) => void]> = [
      ['a changed model', 'triage', fm => { fm.model = 'haiku'; }],
      ['a dropped effort', 'triage', fm => { fm.effort = null; }],
      ['an effort where the row ships none', 'learning', fm => { fm.effort = 'high'; }],
      ['a changed effort', 'validate', fm => { fm.effort = 'high'; }],
      ['a tool removed from an allowlist', 'triage', fm => { fm.tools = (fm.tools ?? []).slice(1); }],
      ['a tool added to an allowlist', 'triage', fm => { fm.tools = [...(fm.tools ?? []), 'Write']; }],
      ['a name removed from a denylist', 'code', fm => { fm.disallowedTools = (fm.disallowedTools ?? []).slice(1); }],
      ['Skill missing from a denylist that adds it', 'scrutinize', fm => {
        fm.disallowedTools = (fm.disallowedTools ?? []).filter(tool => tool !== 'Skill');
      }],
      ['a denylist on an allowlist agent', 'triage', fm => { fm.disallowedTools = ['Agent']; }],
      ['an allowlist on a denylist agent', 'code', fm => { fm.tools = ['Read']; }],
      ['omitClaudeMd turned off', 'skim', fm => { fm.omitClaudeMd = null; }],
      ['omitClaudeMd turned on', 'triage', fm => { fm.omitClaudeMd = 'true'; }],
      ['omitClaudeMd turned on for Learning, which keeps CLAUDE.md', 'learning', fm => { fm.omitClaudeMd = 'true'; }],
      ['a trimmed preload restored', 'validate', fm => { fm.skills = [...(fm.skills ?? []), 'devflow:testing']; }],
      ['a skills key where the row has none', 'learning', fm => { fm.skills = ['devflow:apply-decisions']; }],
      ['an unknown key', 'research', fm => { fm.keys = [...fm.keys, 'disallowedtools']; }],
      ['a duplicated tool', 'triage', fm => { fm.tools = [...(fm.tools ?? []), 'Read']; }],
    ];
    for (const [label, name, mutate] of probes) {
      it(`reports ${label}`, () => {
        const violations = collectRowViolations(name, renderRow(name, AGENT_CONFIG[name], mutate), AGENT_CONFIG[name]);
        expect(violations.length, label).toBeGreaterThan(0);
      });
    }
  });

  describe('the frontmatter parser reads both list forms', () => {
    it('reads an inline array and a block list, and a key with no list as absent', () => {
      const fm = parseAgentFrontmatter('name: X\nmodel: haiku\ntools: ["Bash", "Read"]\nskills:\n  - devflow:security\n  - devflow:regression\n');
      expect(fm.tools).toEqual(['Bash', 'Read']);
      expect(fm.skills).toEqual(['devflow:security', 'devflow:regression']);
      expect(fm.disallowedTools).toBeNull();
      expect(fm.omitClaudeMd).toBeNull();
    });
  });
});

describe('completeness: every registered agent has a row or a reason', () => {
  it('lines the registry up with the table and the exemptions', () => {
    expect(collectCompletenessViolations(getAllAgentNames(), AGENT_NAMES, EXEMPT_AGENTS)).toEqual([]);
  });

  it('records a reason for each exemption', () => {
    expect(Object.keys(EXEMPT_AGENTS).sort()).toEqual(['git', 'tracker']);
    for (const reason of Object.values(EXEMPT_AGENTS)) expect(reason.trim().length).toBeGreaterThan(0);
  });

  it('known-bad probes: an unlisted agent, a stale row and an unexplained exemption are reported', () => {
    expect(collectCompletenessViolations(['code', 'newagent'], ['code'], {})).toEqual([
      'newagent: registered, but in neither AGENT_CONFIG nor EXEMPT_AGENTS',
    ]);
    expect(collectCompletenessViolations(['code'], ['code', 'gone'], {})).toEqual([
      'gone: has a row but is not a registered agent',
    ]);
    expect(collectCompletenessViolations(['code', 'git'], ['code'], { git: ' ' })).toEqual([
      'git: exempt with no recorded reason',
    ]);
  });
});

describe('one shared denylist (D-SHARED-DENYLIST)', () => {
  it('holds exactly seventeen distinct names, each spelled out', () => {
    expect(SHARED_DENYLIST).toHaveLength(17);
    expect(duplicates(SHARED_DENYLIST)).toEqual([]);
    for (const tool of SHARED_DENYLIST) expect(tool, tool).toMatch(/^[A-Z][A-Za-z]+$/);
  });

  it('Code and Research deny exactly the list, and Scrutinize and Simplify deny it plus Skill', () => {
    for (const name of ['code', 'research']) {
      expect(sameSet(agent(name).fm.disallowedTools ?? [], SHARED_DENYLIST), name).toBe(true);
    }
    for (const name of ['scrutinize', 'simplify']) {
      expect(sameSet(agent(name).fm.disallowedTools ?? [], [...SHARED_DENYLIST, 'Skill']), name).toBe(true);
    }
  });

  it('the two policies never mix, and no list holds a wildcard or denies MCP or web access', () => {
    for (const record of agents.values()) {
      expect(record.fm.tools !== null && record.fm.disallowedTools !== null, `${record.name} mixes policies`).toBe(false);
      expect(collectDenylistViolations(record.name, record.fm), record.name).toEqual([]);
    }
  });

  it('known-bad probes: a wildcard, a denied WebFetch and a denied MCP name are reported', () => {
    const base = renderRow('code', AGENT_CONFIG.code);
    expect(collectDenylistViolations('x', { ...base, disallowedTools: ['mcp__*'] })).toHaveLength(2);
    expect(collectDenylistViolations('x', { ...base, disallowedTools: ['WebFetch'] })).toHaveLength(1);
    expect(collectDenylistViolations('x', { ...base, disallowedTools: ['mcp__claude-in-chrome__navigate'] })).toHaveLength(1);
    expect(collectDenylistViolations('x', { ...base, tools: ['Read', 'mcp__*'] })).toHaveLength(1);
    expect(collectDenylistViolations('x', base)).toEqual([]);
  });
});

describe('preload trims (D-PRELOAD-TRIM)', () => {
  it('Validate and Test no longer preload testing, Evaluate no longer preloads software-design', () => {
    expect(agent('validate').fm.skills).not.toContain('devflow:testing');
    expect(agent('test').fm.skills).not.toContain('devflow:testing');
    expect(agent('evaluate').fm.skills).not.toContain('devflow:software-design');
  });

  it('Diagnose preloads none of the five pattern skills it now loads on demand', () => {
    const preloaded = agent('diagnose').fm.skills ?? [];
    for (const skill of ['security', 'reliability', 'regression', 'consistency', 'complexity']) {
      expect(preloaded, skill).not.toContain(`devflow:${skill}`);
    }
  });

  it('Learning has no skills key at all', () => {
    expect(agent('learning').fm.skills).toBeNull();
    expect(agent('learning').fm.keys).not.toContain('skills');
  });
});

describe('Diagnose loads its pattern skills on demand (D-DIAGNOSE-FOCUS-SKILLS)', () => {
  const body = (): string => agent('diagnose').body;

  it('has one Focus Areas row per focus, naming each skill literally', () => {
    const table = collectFocusTable(body());
    expect([...table.keys()].sort()).toEqual(Object.keys(DIAGNOSE_FOCUS_SKILLS).sort());
    for (const [focus, skills] of Object.entries(DIAGNOSE_FOCUS_SKILLS)) {
      expect(table.get(focus), focus).toEqual(skills);
    }
  });

  it('every skill the table names is loadable with the Skill tool', () => {
    expect(agent('diagnose').fm.tools).toContain('Skill');
  });

  it('carries the load instruction before Step 1, with a fallback and no stop rule', () => {
    const text = flat(body());
    const instruction = 'invoke the Skill tool with `Skill(skill="devflow:…")` for each skill in the row for your FOCUS';
    const fallback = 'If an invocation fails, continue with this methodology: the skill adds patterns but is not required.';
    expect(text).toContain(instruction);
    expect(text).toContain(fallback);
    expect(text.indexOf(instruction)).toBeLessThan(text.indexOf('### Step 1'));
    const paragraph = text.slice(text.indexOf(instruction), text.indexOf(fallback) + fallback.length);
    expect(paragraph).not.toMatch(/\b(?:stop|abort|halt|refuse|BLOCKED)\b/i);
  });

  it('names no prefix-less skill template', () => {
    expect(collectPrefixlessTemplates(body())).toEqual([]);
  });

  it('known-bad probes: a prefix-less template is reported, a literal name and an ellipsis are not', () => {
    const template = ['dev', 'flow:{FOCUS}'].join('');
    expect(collectPrefixlessTemplates(`Load \`${template}\` first.`)).toEqual([template]);
    expect(collectPrefixlessTemplates('Load `devflow:<name>` or devflow:$SKILL.')).toHaveLength(2);
    expect(collectPrefixlessTemplates('Load `devflow:security` and `Skill(skill="devflow:…")`.')).toEqual([]);
  });

  it('known-bad probe: a focus table missing a skill is read as missing it', () => {
    const broken = [
      '## Focus Areas', '',
      '| Focus | What | Pattern skill |', '|---|---|---|',
      '| `functional` | logic | `devflow:regression` |', '',
      '## Next', '',
    ].join('\n');
    expect(collectFocusTable(broken).get('functional')).toEqual(['regression']);
  });
});

describe('tool/body agreement (D-TOOL-BODY-MATCH)', () => {
  it('reads every table agent: its body, plus a unit per preloaded skill', () => {
    for (const record of agents.values()) {
      expect(record.units.map(unit => unit.source)[0], record.name).toBe('body');
      expect(record.units.length, record.name).toBe(1 + (record.fm.skills?.length ?? 0));
      for (const unit of record.units) expect(unit.text.length, `${record.name}/${unit.source}`).toBeGreaterThan(0);
    }
  });

  it('sees both a call and a "the X tool" phrase on the live corpus', () => {
    const reviewBody = collectToolInvocations(agent('review').body);
    expect(reviewBody.some(inv => inv.tool === 'Skill' && !inv.negated)).toBe(true);
    const diagnoseBody = collectToolInvocations(agent('diagnose').body);
    expect(diagnoseBody.some(inv => inv.tool === 'Write' && !inv.negated)).toBe(true);
  });

  const allFindings = (): ToolBodyViolation[] =>
    [...agents.values()].flatMap(record => collectToolBodyViolations(record.name, record.fm, record.units));

  it('no body or preloaded skill directs a tool its frontmatter removes', () => {
    const open = allFindings().filter(v => !isExcepted(v, TOOL_BODY_EXCEPTIONS));
    expect(
      open.map(v => `${v.agent}: ${v.source}:${v.line} directs ${v.tool} :: ${v.sentence}`),
      'Fix the body, grant the tool in the row, or record a reasoned exception in TOOL_BODY_EXCEPTIONS',
    ).toEqual([]);
  });

  it('every recorded exception still matches a finding (the list only shrinks)', () => {
    const findings = allFindings();
    for (const exception of TOOL_BODY_EXCEPTIONS) {
      expect(
        findings.some(v => isExcepted(v, [exception])),
        `stale exception ${exception.agent}/${exception.source}/${exception.tool}: delete it`,
      ).toBe(true);
      expect(exception.reason.trim().length).toBeGreaterThan(0);
    }
  });

  describe('known-bad probes', () => {
    const noSkill = renderRow('x', AGENT_CONFIG.triage);
    const noEdit = renderRow('x', AGENT_CONFIG.evaluate);
    const denySkill = renderRow('x', AGENT_CONFIG.scrutinize);
    const unitOf = (text: string): BodyUnit[] => [{ source: 'body', text }];
    const loaded = (text: string, fm: AgentFrontmatter): string[] =>
      collectToolBodyViolations('x', fm, unitOf(text)).map(v => v.tool);

    it('reports a body that tells a no-Skill agent to load a skill', () => {
      expect(loaded('Before analysis, load `devflow:security` and apply it.', noSkill)).toEqual(['Skill']);
      expect(loaded('Invoke the Skill tool with `devflow:regression`.', noSkill)).toContain('Skill');
      expect(loaded('Call Skill(skill="devflow:regression") first.', noSkill)).toEqual(['Skill']);
    });

    it('does not report "Never: Edit any file", and does not report a negated invocation', () => {
      expect(loaded('**Never:**\n- Edit any file\n- Run builds', noEdit)).toEqual([]);
      expect(loaded('Never use the Edit tool on this file.', noEdit)).toEqual([]);
      expect(loaded('Do not call Edit(file) here.', noEdit)).toEqual([]);
    });

    it('reports "the Edit tool" and "Edit(" for an agent without Edit', () => {
      expect(loaded('Patch the file with the Edit tool.', noEdit)).toEqual(['Edit']);
      expect(loaded('Patch it: Edit(path, old, new).', noEdit)).toEqual(['Edit']);
      expect(loaded('Patch the file with the `Edit` tool.', noEdit)).toEqual(['Edit']);
    });

    it('reports a ToolSearch select: load and an MCP tool outside the allowlist', () => {
      expect(loaded('Run ToolSearch with query "select:WebFetch".', noSkill)).toEqual(['ToolSearch']);
      expect(loaded('Then call mcp__claude-in-chrome__navigate.', noSkill)).toEqual(['mcp__claude-in-chrome__navigate']);
    });

    it('reports a tool a denylist removes, and leaves a tool it keeps', () => {
      expect(loaded('Load `devflow:security` first.', denySkill)).toEqual(['Skill']);
      expect(loaded('Spawn it with Agent(subagent_type="Explore").', denySkill)).toEqual(['Agent']);
      expect(loaded('Read the file with the Read tool.', denySkill)).toEqual([]);
    });

    it('reports nothing for a granted tool', () => {
      expect(loaded('Read the file with the Read tool, then call Skill(skill="devflow:security").', renderRow('x', AGENT_CONFIG.review))).toEqual([]);
    });

    it('does not read a path segment or a longer identifier as a call', () => {
      expect(loaded('See src/Agent(1) and MyAgent(x) and foo.Skill(y).', noSkill)).toEqual([]);
    });
  });
});

describe('structured return (D-STRUCTURED-RETURN-TOOL)', () => {
  it('Review, Design and Synthesize hold StructuredOutput', () => {
    for (const name of ['review', 'design', 'synthesize']) {
      expect(agent(name).fm.tools, name).toContain('StructuredOutput');
    }
  });

  const commandTexts = (): string[] =>
    walkFiles(COMMANDS_DIR, file => file.endsWith('.mds') || file.endsWith('.md')).map(file => readFileSync(file, 'utf-8'));

  it('every agent type a command spawns with a schema: option can return through the tool', () => {
    const types = new Set<string>();
    for (const text of commandTexts()) for (const type of collectSchemaSpawnTypes(text)) types.add(type);
    expect([...types].sort(), 'the scan must read the three schema-bearing agent types').toEqual(['Design', 'Review', 'Synthesize']);
    for (const type of types) {
      const row = agents.get(type.toLowerCase());
      expect(row, `${type} is spawned with a schema but has no table row`).toBeDefined();
      if (row?.fm.tools !== null && row !== undefined) {
        expect(row.fm.tools, `${type} is spawned with a schema but lacks StructuredOutput`).toContain('StructuredOutput');
      }
    }
  });

  it('known-bad probe: a schema-bearing spawn is read at either argument order and ignored without one', () => {
    expect([...collectSchemaSpawnTypes('agent(`go`, { agentType: "Triage", schema: S });')]).toEqual(['Triage']);
    expect([...collectSchemaSpawnTypes('agent(`go`, { agentType: "Code" });')]).toEqual([]);
  });
});

describe('body-level decisions', () => {
  it('Knowledge refreshes with Edit and writes only to create (Direct Write Protocol)', () => {
    const protocol = flat(sectionOf(agent('knowledge').body, 'Direct Write Protocol'));
    expect(protocol).toContain('Refresh an existing `KNOWLEDGE.md` or `index.md` with `Edit`, changing only the lines that differ');
    expect(protocol).toContain('use `Write` only to create a file that does not exist yet');
    expect(agent('knowledge').fm.tools).toContain('Edit');
  });

  it('Synthesize states decisions and pitfalls in words, never by ledger ID', () => {
    expect(flat(agent('synthesize').body)).toContain(
      'state a decision or pitfall as its rule in words, never by its ledger ID',
    );
  });

  it('Learning names no Grep or Glob tool, and searches with Bash commands', () => {
    const body = agent('learning').body;
    expect(body).not.toMatch(/\b(?:Grep|Glob)\b/);
    expect(body).toContain('`git grep -P`');
  });

  it('known-bad probe: the Learning check sees a tool name in prose', () => {
    expect('Search the repository (Grep, Glob) for a test.').toMatch(/\b(?:Grep|Glob)\b/);
    expect('each a glob relative to the repository root').not.toMatch(/\b(?:Grep|Glob)\b/);
  });
});
