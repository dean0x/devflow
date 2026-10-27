/**
 * The install-time render of the ambient orchestrator charter (src/targets/claude-code/charter-render.ts).
 *
 * The packaged charter is the FULL text and also the fallback. The render only deletes spans whose owner
 * (a workflow command or a roster agent) is not installed, so the charter never names a skill or agent
 * the machine lacks. This file holds the pure render over every plugin set of the registry-derived
 * domain, the span table's own integrity, the inventory, and the writer on temp directories.
 *
 * The domain is derived from the registry and the source charter, never from the span table: a plugin
 * enters it when it declares a command the charter names (`devflow:<command>`) or an agent that
 * devflow-ambient does not declare and the charter names. A new routing line that names a new owner
 * therefore widens the domain without anyone editing this file, and a span table that forgot the owner
 * fails the per-set checks. The oracle below spells its own strings for the same reason.
 *
 * HOME safety: every directory below is an mkdtemp; nothing reads or writes the real ~/.claude or
 * ~/.devflow, and no test runs the CLI.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { scriptsDir as packagedScriptsDir } from '../../src/core/assets.js';
import {
  DEVFLOW_PLUGINS,
  getAllAgentNames,
  getAllCommandNames,
  type PluginDefinition,
} from '../../src/core/plugins.js';
import {
  CHARTER_RELPATH,
  CHARTER_SPANS,
  CHARTER_WORKFLOW_ITEMS,
  CHARTER_WORKFLOW_LIST,
  HANDOFF_SENTINEL_RELPATH,
  type InstallRenderedCharterOptions,
  type RemoveHandoffSentinelOptions,
  charterInventory,
  installRenderedCharter,
  removeHandoffSentinel,
  renderCharter,
} from '../../src/targets/claude-code/charter-render.js';
import {
  HANDOFF_PREFIX,
  collectCharterContentViolations,
  collectCharterKnowledgeDefects,
  collectCharterRoutingViolations,
} from '../helpers/charter-guards.js';

const SOURCE = readFileSync(path.join(packagedScriptsDir(), CHARTER_RELPATH), 'utf-8');
const SENTINEL_SOURCE = readFileSync(path.join(packagedScriptsDir(), HANDOFF_SENTINEL_RELPATH), 'utf-8');

const stripSlash = (cmd: string): string => (cmd.startsWith('/') ? cmd.slice(1) : cmd);
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordIn = (text: string, word: string, flags = ''): boolean => new RegExp(`\\b${escapeRe(word)}\\b`, flags).test(text);
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const plugin = (name: string): PluginDefinition => {
  const found = DEVFLOW_PLUGINS.find(p => p.name === name);
  if (found === undefined) throw new Error(`no such plugin: ${name}`);
  return found;
};
const CORE = plugin('devflow-core-skills');
const AMBIENT = plugin('devflow-ambient');

/** Independent oracle input: the seven workflow items, typed here and not read from the span table. */
const WORKFLOWS: ReadonlyArray<readonly [command: string, text: string]> = [
  ['implement', 'devflow:implement'],
  ['plan', 'devflow:plan'],
  ['research', 'devflow:research'],
  ['explore', 'devflow:explore'],
  ['code-review', 'devflow:code-review'],
  ['resolve', 'devflow:resolve'],
  ['bug-analysis', 'devflow:bug-analysis (hunt bugs in a branch before merge)'],
];
const WORKFLOW_LIST = WORKFLOWS.map(([, text]) => text).join(', ');
const WORKFLOW_LINE_PREFIX = '- Real-scale work matching a workflow: invoke the full skill instead: ';
const FIX_TEXT = 'Fix (`OPERATION:` `validation-fix`, `alignment-fix`, `qa-fix` or `ci-fix`), else ';
const DEBUG_COMMAND_TEXT = 'devflow:debug, else ';
const DEBUG_FALLBACK_TEXT = ', else Explore investigates and Code fixes';
const DEBUG_AGENT_TEXT = '; never the Debug agent';
const HANDOFF_LINE_PREFIX = '- Plan handoff: ';
/** A workflow the charter must never route to: release, self-review and the dynamic-* family. (The Harden line says "self-review" in prose.) */
const FORBIDDEN_ROUTE = /\brelease\b|dynamic-|devflow:self-review|\/self-review/i;
const TEXT_SPANS = [FIX_TEXT, DEBUG_COMMAND_TEXT, DEBUG_FALLBACK_TEXT, DEBUG_AGENT_TEXT] as const;

/** The most plugins a domain may hold: 2^12 sets keeps the loop small. */
const MAX_DOMAIN = 12;

/** Plugins a charter line makes worth varying: see the header. */
const DOMAIN: PluginDefinition[] = DEVFLOW_PLUGINS
  .filter(p => p !== CORE && p !== AMBIENT)
  .filter(p =>
    p.commands.map(stripSlash).some(cmd => new RegExp(`devflow:${escapeRe(cmd)}(?![\\w-])`).test(SOURCE)) ||
    p.agents.some(agent => !AMBIENT.agents.includes(agent) && wordIn(SOURCE, agent, 'i')),
  );

interface Installed {
  readonly commands: Set<string>;
  readonly agents: Set<string>;
}

/** What a set of plugins installs, spelled from the registry without the code under test. */
function installedBy(plugins: readonly PluginDefinition[]): Installed {
  return {
    commands: new Set(plugins.flatMap(p => p.commands.map(stripSlash))),
    agents: new Set(plugins.flatMap(p => p.agents)),
  };
}

/** The source with each uninstalled owner's spans deleted, by plain string replacement and line filters. */
function oracle(installed: Installed): string {
  const keep = WORKFLOWS.filter(([cmd]) => installed.commands.has(cmd)).map(([, text]) => text);
  let out = SOURCE;
  out = keep.length === 0
    ? out.split('\n').filter(line => !line.includes(WORKFLOW_LIST)).join('\n')
    : out.replace(WORKFLOW_LIST, () => keep.join(', '));
  if (!installed.agents.has('fix')) out = out.replace(FIX_TEXT, () => '');
  out = installed.commands.has('debug')
    ? out.replace(DEBUG_FALLBACK_TEXT, () => '')
    : out.replace(DEBUG_COMMAND_TEXT, () => '');
  if (!installed.agents.has('debug')) out = out.replace(DEBUG_AGENT_TEXT, () => '');
  if (!installed.commands.has('implement')) {
    out = out.split('\n').filter(line => !line.startsWith(HANDOFF_LINE_PREFIX)).join('\n');
  }
  return out;
}

/** Every line a source line can become: text spans deleted in any combination, or the list cut to any non-empty subset. */
function lineVariants(line: string): Set<string> {
  const variants = new Set<string>([line]);
  for (let mask = 1; mask < 1 << TEXT_SPANS.length; mask++) {
    let next = line;
    TEXT_SPANS.forEach((text, i) => {
      if (mask & (1 << i) && next.includes(text)) next = next.replace(text, () => '');
    });
    variants.add(next);
  }
  if (line.includes(WORKFLOW_LIST)) {
    for (let mask = 1; mask < 1 << WORKFLOWS.length; mask++) {
      const kept = WORKFLOWS.filter((_, i) => mask & (1 << i)).map(([, text]) => text);
      variants.add(line.replace(WORKFLOW_LIST, () => kept.join(', ')));
    }
  }
  return variants;
}

/**
 * The source is the union of the two debug alternatives (`devflow:debug, else Explore investigates ...`), so
 * no render equals it: debug installed removes the fallback sentence, debug absent removes the command.
 * The fullest render is the source less the fallback.
 */
const SOURCE_LESS_DEBUG_FALLBACK = SOURCE.replace(DEBUG_FALLBACK_TEXT, () => '');

const SOURCE_LINES = SOURCE.split('\n');
const SOURCE_LINE_VARIANTS = SOURCE_LINES.map(lineVariants);
const WORKFLOW_LINE_INDEX = SOURCE_LINES.findIndex(line => line.includes(WORKFLOW_LIST));
const HANDOFF_LINE_INDEX = SOURCE_LINES.findIndex(line => line.startsWith(HANDOFF_LINE_PREFIX));

/** Walks the render against the source in order. Returns the source lines the render dropped, or null when a line has no source. */
function droppedLines(rendered: string): number[] | null {
  const dropped: number[] = [];
  let at = 0;
  for (const line of rendered.split('\n')) {
    while (at < SOURCE_LINES.length && !SOURCE_LINE_VARIANTS[at].has(line)) dropped.push(at++);
    if (at === SOURCE_LINES.length) return null;
    at++;
  }
  while (at < SOURCE_LINES.length) dropped.push(at++);
  return dropped;
}

function render(installed: Installed) {
  return renderCharter(SOURCE, installed.commands, installed.agents);
}

describe('the test domain', () => {
  it('derives its plugins from the registry and the source charter', () => {
    const names = DOMAIN.map(p => p.name);
    expect(names.length, 'the domain must stay small enough to enumerate').toBeLessThanOrEqual(MAX_DOMAIN);
    // A floor, not a pin: the domain may grow with the charter, and may not silently shrink.
    expect(names).toEqual(
      expect.arrayContaining([
        'devflow-implement', 'devflow-plan', 'devflow-research', 'devflow-explore', 'devflow-code-review',
        'devflow-resolve', 'devflow-bug-analysis', 'devflow-debug', 'devflow-dynamic',
      ]),
    );
    expect(names).not.toContain('devflow-release');
    expect(names).not.toContain('devflow-self-review');
  });
});

describe('renderCharter over every plugin set of the domain', () => {
  it('holds every invariant for every set', () => {
    const failures: string[] = [];
    let sets = 0;
    for (let mask = 0; mask < 1 << DOMAIN.length; mask++) {
      sets++;
      const subset = DOMAIN.filter((_, i) => mask & (1 << i));
      const label = `{${subset.map(p => p.name.replace('devflow-', '')).join(',')}}`;
      const plugins = [CORE, AMBIENT, ...subset];
      const installed = installedBy(plugins);
      const inventory = charterInventory(plugins.map(p => p.name));
      if ([...inventory.commands].sort().join() !== [...installed.commands].sort().join()) {
        failures.push(`${label}: inventory commands differ from the registry's`);
      }
      if ([...inventory.agents].sort().join() !== [...installed.agents].sort().join()) {
        failures.push(`${label}: inventory agents differ from the registry's`);
      }

      const result = render(installed);
      if (!result.ok) {
        failures.push(`${label}: render failed (${result.reason}: ${result.span})`);
        continue;
      }
      const text = result.content;

      for (const token of text.matchAll(/devflow:([a-z][a-z-]*)/g)) {
        if (!installed.commands.has(token[1])) failures.push(`${label}: names the uninstalled workflow devflow:${token[1]}`);
      }
      for (const agent of getAllAgentNames()) {
        if (wordIn(text, capital(agent)) && !installed.agents.has(agent)) failures.push(`${label}: names the uninstalled agent ${capital(agent)}`);
      }
      if (FORBIDDEN_ROUTE.test(text)) failures.push(`${label}: names release, dynamic-* or self-review`);

      if (text !== oracle(installed)) failures.push(`${label}: differs from the string-replace oracle`);

      const dropped = droppedLines(text);
      const expectedDropped = [
        ...(WORKFLOWS.some(([cmd]) => installed.commands.has(cmd)) ? [] : [WORKFLOW_LINE_INDEX]),
        ...(installed.commands.has('implement') ? [] : [HANDOFF_LINE_INDEX]),
      ].sort((a, b) => a - b);
      if (dropped === null) failures.push(`${label}: a rendered line is neither a source line nor one with spans deleted`);
      else if (dropped.join() !== expectedDropped.join()) failures.push(`${label}: dropped source lines ${dropped.join()} (expected ${expectedDropped.join()})`);

      if (Buffer.byteLength(text) > Buffer.byteLength(SOURCE)) failures.push(`${label}: grew past the source`);
      if (Buffer.byteLength(text) !== text.length) failures.push(`${label}: bytes differ from chars`);

      const workflowLine = text.split('\n').find(line => line.startsWith(WORKFLOW_LINE_PREFIX));
      const kept = WORKFLOWS.filter(([cmd]) => installed.commands.has(cmd)).map(([, t]) => t);
      if (kept.length === 0 ? workflowLine !== undefined : workflowLine !== `${WORKFLOW_LINE_PREFIX}${kept.join(', ')}.`) {
        failures.push(`${label}: workflow line is ${JSON.stringify(workflowLine)}`);
      }
      const gate = installed.agents.has('fix')
        ? 'Gate failures: Fix (`OPERATION:` `validation-fix`, `alignment-fix`, `qa-fix` or `ci-fix`), else Code (`OPERATION: implement`).'
        : 'Gate failures: Code (`OPERATION: implement`).';
      if (!text.split('\n').some(line => line.endsWith(gate))) failures.push(`${label}: gate-failure sentence is not "${gate}"`);
      const debugTail = `${installed.commands.has('debug') ? 'devflow:debug' : 'Explore investigates and Code fixes'}${installed.agents.has('debug') ? '; never the Debug agent' : ''}.`;
      const debugHead = 'All debug work (root cause of a reported bug): ';
      if (!text.split('\n').some(line => line.endsWith(debugHead + debugTail))) failures.push(`${label}: debug sentence does not end "${debugTail}"`);
      if (text.split('\n').filter(line => line.startsWith(HANDOFF_LINE_PREFIX)).length !== (installed.commands.has('implement') ? 1 : 0)) {
        failures.push(`${label}: handoff line present/absent does not follow implement`);
      }

      const content = collectCharterContentViolations(text);
      const allowed = installed.commands.has('implement')
        ? []
        : [`expected exactly one line naming "${HANDOFF_PREFIX}", found 0`];
      if (content.join('|') !== allowed.join('|')) failures.push(`${label}: content violations ${JSON.stringify(content)}`);
      const routing = collectCharterRoutingViolations(text);
      if (routing.length > 0) failures.push(`${label}: routing violations ${JSON.stringify(routing)}`);
      const knowledge = collectCharterKnowledgeDefects(text);
      if (knowledge.length > 0) failures.push(`${label}: knowledge defects ${JSON.stringify(knowledge)}`);
    }

    expect(sets).toBe(2 ** DOMAIN.length);
    expect(failures.slice(0, 20)).toEqual([]);
  });

  it('renders the full set as the source less the debug fallback sentence', () => {
    const result = render(installedBy([CORE, AMBIENT, ...DOMAIN]));
    expect(result).toEqual({ ok: true, content: SOURCE_LESS_DEBUG_FALLBACK });
    expect(SOURCE.length - SOURCE_LESS_DEBUG_FALLBACK.length).toBe(DEBUG_FALLBACK_TEXT.length);
  });

  it('never renders the source itself: one of the two debug alternatives always goes', () => {
    for (const debug of [true, false]) {
      const plugins = [CORE, AMBIENT, ...DOMAIN.filter(p => debug || p.name !== 'devflow-debug')];
      const result = render(installedBy(plugins));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.content.length).toBeLessThan(SOURCE.length);
    }
  });

  it('renders every registry plugin as the full set and never names release, dynamic-* or self-review workflows', () => {
    const inventory = charterInventory(DEVFLOW_PLUGINS.map(p => p.name));
    const result = renderCharter(SOURCE, inventory.commands, inventory.agents);
    expect(result).toEqual({ ok: true, content: SOURCE_LESS_DEBUG_FALLBACK });
    expect(SOURCE).not.toMatch(FORBIDDEN_ROUTE);
  });

  it('renders the empty set: no workflow, no Fix route, no Debug agent, no handoff', () => {
    const result = render(installedBy([CORE, AMBIENT]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).not.toMatch(/devflow:/);
    expect(result.content).not.toContain('Fix');
    expect(result.content).not.toContain('Debug agent');
    expect(result.content).toContain('All debug work (root cause of a reported bug): Explore investigates and Code fixes.');
  });

  it('is deterministic and leaves its inputs alone', () => {
    const installed = installedBy([CORE, AMBIENT, plugin('devflow-plan')]);
    const before = [installed.commands.size, installed.agents.size];
    expect(render(installed)).toEqual(render(installed));
    expect([installed.commands.size, installed.agents.size]).toEqual(before);
  });
});

describe('the span table', () => {
  const lineCount = (prefix: string): number => SOURCE_LINES.filter(line => line.startsWith(prefix)).length;
  const textCount = (text: string): number => SOURCE.split(text).length - 1;

  it('matches the source charter exactly once per span', () => {
    expect(CHARTER_WORKFLOW_LIST).toBe(WORKFLOW_LIST);
    expect(textCount(WORKFLOW_LIST)).toBe(1);
    for (const span of CHARTER_SPANS) {
      const count = span.shape === 'line' ? lineCount(span.text) : textCount(span.text);
      expect(count, `span ${JSON.stringify(span.text)}`).toBe(1);
    }
    expect(CHARTER_SPANS.map(span => span.text).sort()).toEqual(
      [...TEXT_SPANS, HANDOFF_LINE_PREFIX].sort(),
    );
    expect(CHARTER_WORKFLOW_ITEMS.map(item => item.text)).toEqual(WORKFLOWS.map(([, text]) => text));
  });

  it('names an owner declared in DEVFLOW_PLUGINS for every span and item', () => {
    const commands = new Set(getAllCommandNames());
    const agents = new Set(getAllAgentNames());
    const owners = [...CHARTER_SPANS.map(span => span.owner), ...CHARTER_WORKFLOW_ITEMS.map(item => item.owner)];
    for (const owner of owners) {
      expect(owner.kind === 'command' ? commands : agents, `${owner.kind} ${owner.name}`).toContain(owner.name);
    }
    expect(AMBIENT.agents.length).toBeGreaterThan(0);
  });

  it('pairs the two debug-command spans as one owner with opposite polarity', () => {
    const [absentSpan, presentSpan] = [DEBUG_COMMAND_TEXT, DEBUG_FALLBACK_TEXT].map(
      text => CHARTER_SPANS.find(span => span.text === text),
    );
    expect(absentSpan?.owner).toEqual({ kind: 'command', name: 'debug' });
    expect(presentSpan?.owner).toEqual(absentSpan?.owner);
    expect(absentSpan?.removedWhen).toBe('absent');
    expect(presentSpan?.removedWhen).toBe('present');
    // They overlap on ", else " in the source, so a render may remove only one of them.
    expect(SOURCE).toContain(`${DEBUG_COMMAND_TEXT}Explore investigates and Code fixes`);
  });

  // One character is changed at the end that no neighbour shares: the two debug spans overlap on ", else ",
  // so cutting a whole span would break its twin too and hide which one the render reported.
  it.each([
    ['the Fix span', FIX_TEXT, `#${FIX_TEXT.slice(1)}`],
    ['the debug command span', DEBUG_COMMAND_TEXT, `#${DEBUG_COMMAND_TEXT.slice(1)}`],
    ['the debug fallback span', DEBUG_FALLBACK_TEXT, `${DEBUG_FALLBACK_TEXT.slice(0, -1)}#`],
    ['the debug agent span', DEBUG_AGENT_TEXT, `#${DEBUG_AGENT_TEXT.slice(1)}`],
    ['the workflow list', WORKFLOW_LIST, `#${WORKFLOW_LIST.slice(1)}`],
  ])('fails when %s is missing from the source', (_what, text, mutated) => {
    const seeded = SOURCE.replace(text, () => mutated);
    expect(seeded).not.toBe(SOURCE);
    const result = renderCharter(seeded, new Set(), new Set());
    expect(result).toMatchObject({ ok: false, reason: 'missing', span: text });
  });

  it('fails when the handoff line is missing from the source', () => {
    const seeded = SOURCE_LINES.filter(line => !line.startsWith(HANDOFF_LINE_PREFIX)).join('\n');
    const result = renderCharter(seeded, new Set(), new Set());
    expect(result).toMatchObject({ ok: false, reason: 'missing', span: HANDOFF_LINE_PREFIX });
  });

  it.each([
    ['a text span', FIX_TEXT],
    ['the debug command span', DEBUG_COMMAND_TEXT],
    ['the debug fallback span', DEBUG_FALLBACK_TEXT],
    ['the debug agent span', DEBUG_AGENT_TEXT],
    ['the workflow list', WORKFLOW_LIST],
    ['the handoff line', HANDOFF_LINE_PREFIX],
  ])('fails when %s occurs twice in the source', (_what, text) => {
    const seeded = `${SOURCE}\n${text}`;
    const result = renderCharter(seeded, new Set(), new Set());
    expect(result).toMatchObject({ ok: false, reason: 'repeated', span: text });
  });

  it('fails when two removals would overlap, instead of cutting through both', () => {
    // Move the Fix span into the handoff line: each span still occurs once, but with Fix and implement
    // both absent the line removal and the text removal share bytes.
    const moved = SOURCE.replace(FIX_TEXT, () => '').replace(HANDOFF_LINE_PREFIX, () => `${HANDOFF_LINE_PREFIX}${FIX_TEXT}`);
    const result = renderCharter(moved, new Set(), new Set());
    expect(result).toMatchObject({ ok: false, reason: 'overlap' });
    expect(renderCharter(moved, new Set(['implement']), new Set(['fix'])).ok).toBe(true);
  });
});

describe('charterInventory', () => {
  it('always holds the ambient agents and nothing else for no plugins', () => {
    const inventory = charterInventory([]);
    expect([...inventory.commands]).toEqual([]);
    expect([...inventory.agents].sort()).toEqual([...AMBIENT.agents].sort());
  });

  it('holds command names without a leading slash and the agents of each named plugin', () => {
    const inventory = charterInventory(['devflow-implement', 'devflow-bug-analysis']);
    expect([...inventory.commands].sort()).toEqual(['bug-analysis', 'implement']);
    expect(inventory.agents.has('fix')).toBe(true);
    expect(inventory.agents.has('debug')).toBe(true);
    expect(inventory.agents.has('tracker')).toBe(false);
  });

  it('maps a legacy plugin name and ignores names outside DEVFLOW_PLUGINS', () => {
    const inventory = charterInventory([
      'devflow-specify', 'devflow-audit-claude', 'not-a-plugin', '__proto__', 'constructor', 'toString', '',
    ]);
    expect([...inventory.commands]).toEqual(['plan']);
    expect([...inventory.agents].sort()).toEqual([...new Set([...AMBIENT.agents, ...plugin('devflow-plan').agents])].sort());
  });

  it('never carries a name that is not a registry name', () => {
    const inventory = charterInventory(['devflow-plan', 'evil; rm -rf /', 'devflow-plan\n']);
    const known = new Set([...getAllCommandNames(), ...getAllAgentNames()]);
    for (const name of [...inventory.commands, ...inventory.agents]) expect(known).toContain(name);
  });
});

describe('installRenderedCharter', () => {
  let root: string;
  let installed: string;
  let warnings: string[];

  const charterPath = (): string => path.join(installed, CHARTER_RELPATH);
  const sentinelPath = (): string => path.join(installed, HANDOFF_SENTINEL_RELPATH);
  const warn = (msg: string): void => { warnings.push(msg); };
  const exists = (file: string): Promise<boolean> => fs.access(file).then(() => true, () => false);
  const names = (...plugins: string[]): string[] => ['devflow-core-skills', 'devflow-ambient', ...plugins];
  const FOUNDER = names('devflow-code-review', 'devflow-implement', 'devflow-plan', 'devflow-release', 'devflow-resolve');

  const sync = (plugins: InstallRenderedCharterOptions['plugins'], extra: Partial<InstallRenderedCharterOptions> = {}) =>
    installRenderedCharter({ scriptsDir: installed, plugins, warn, mode: 'install', ...extra });

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'charter-render-'));
    installed = path.join(root, 'scripts');
    await fs.mkdir(path.join(installed, 'hooks', 'assets'), { recursive: true });
    warnings = [];
  });

  afterEach(async () => {
    await fs.chmod(path.join(installed, 'hooks', 'assets'), 0o755).catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes the full-set charter and the sentinel for a full install, silently, with mode 0755', async () => {
    const result = await sync(DEVFLOW_PLUGINS.map(p => p.name));
    expect(result).toEqual({ charter: 'rewritten', sentinel: 'rewritten' });
    expect(await fs.readFile(charterPath(), 'utf-8')).toBe(SOURCE_LESS_DEBUG_FALLBACK);
    expect(await fs.readFile(sentinelPath(), 'utf-8')).toBe(SENTINEL_SOURCE);
    expect((await fs.stat(charterPath())).mode & 0o777).toBe(0o755);
    expect((await fs.stat(sentinelPath())).mode & 0o777).toBe(0o755);
    expect(warnings).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')(
    'gives a new file mode 0755 under any umask, the mode the script copy sets on the next run',
    async () => {
      const previous = process.umask(0o077);
      try {
        await sync(FOUNDER);
      } finally {
        process.umask(previous);
      }
      expect((await fs.stat(charterPath())).mode & 0o777).toBe(0o755);
      expect((await fs.stat(sentinelPath())).mode & 0o777).toBe(0o755);
    },
  );

  it('writes the rendered charter for a narrowed set', async () => {
    const result = await sync(FOUNDER);
    expect(result).toEqual({ charter: 'rewritten', sentinel: 'rewritten' });
    const inventory = charterInventory(FOUNDER);
    const expected = renderCharter(SOURCE, inventory.commands, inventory.agents);
    expect(expected.ok).toBe(true);
    expect(await fs.readFile(charterPath(), 'utf-8')).toBe(expected.ok ? expected.content : '');
    expect(await fs.readFile(charterPath(), 'utf-8')).not.toBe(SOURCE);
    expect(await fs.readFile(charterPath(), 'utf-8')).not.toContain('devflow:research');
    expect(await exists(sentinelPath())).toBe(true);
  });

  it('accepts plugin definitions as well as plugin names', async () => {
    const byObject = await sync([CORE, AMBIENT, plugin('devflow-plan')]);
    const afterObject = await fs.readFile(charterPath(), 'utf-8');
    await fs.rm(charterPath());
    const byName = await sync(names('devflow-plan'));
    expect(byObject).toEqual(byName);
    expect(afterObject).toBe(await fs.readFile(charterPath(), 'utf-8'));
  });

  it('writes nothing on a rerun: outcomes unchanged, bytes and mtime kept', async () => {
    await sync(FOUNDER);
    const past = new Date('2020-01-01T00:00:00Z');
    await Promise.all([charterPath(), sentinelPath()].map(file => fs.utimes(file, past, past)));
    const before = await Promise.all([charterPath(), sentinelPath()].map(async file => ({
      bytes: await fs.readFile(file),
      mtime: (await fs.stat(file)).mtimeMs,
    })));
    const again = await sync(FOUNDER);
    expect(again).toEqual({ charter: 'unchanged', sentinel: 'unchanged' });
    const after = await Promise.all([charterPath(), sentinelPath()].map(async file => ({
      bytes: await fs.readFile(file),
      mtime: (await fs.stat(file)).mtimeMs,
    })));
    expect(after).toEqual(before);
    expect(warnings).toEqual([]);
  });

  it('removes the sentinel when implement is not installed, and reports it absent on the next run', async () => {
    await sync(FOUNDER);
    expect(await exists(sentinelPath())).toBe(true);
    const without = names('devflow-plan');
    expect(await sync(without)).toEqual({ charter: 'rewritten', sentinel: 'rewritten' });
    expect(await exists(sentinelPath())).toBe(false);
    expect(await fs.readFile(charterPath(), 'utf-8')).not.toContain(HANDOFF_PREFIX);
    expect(await sync(without)).toEqual({ charter: 'unchanged', sentinel: 'absent' });
    expect(warnings).toEqual([]);
  });

  it('in uninstall mode creates neither file on a machine that has none', async () => {
    expect(await sync(FOUNDER, { mode: 'uninstall' })).toEqual({ charter: 'absent', sentinel: 'absent' });
    expect(await exists(charterPath())).toBe(false);
    expect(await exists(sentinelPath())).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('in uninstall mode renders over an installed charter, leaves the sentinel while implement stays, and removes it when implement goes', async () => {
    await fs.writeFile(charterPath(), SOURCE, { mode: 0o755 });
    await fs.writeFile(sentinelPath(), 'stale marker\n');

    expect(await sync(FOUNDER, { mode: 'uninstall' })).toEqual({ charter: 'rewritten', sentinel: 'unchanged' });
    expect(await fs.readFile(charterPath(), 'utf-8')).not.toContain('devflow:research');
    expect(await fs.readFile(sentinelPath(), 'utf-8')).toBe('stale marker\n');

    expect(await sync(names('devflow-plan'), { mode: 'uninstall' })).toMatchObject({ charter: 'rewritten', sentinel: 'rewritten' });
    expect(await fs.readFile(charterPath(), 'utf-8')).not.toContain('devflow:implement');
    expect(await exists(sentinelPath())).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('creates the hooks/assets directory when the copy left none', async () => {
    await fs.rm(path.join(installed, 'hooks'), { recursive: true });
    expect(await sync(FOUNDER)).toEqual({ charter: 'rewritten', sentinel: 'rewritten' });
    expect(await exists(charterPath())).toBe(true);
  });

  it('replaces a stale or hand-edited installed charter', async () => {
    await fs.writeFile(charterPath(), 'old text\n');
    expect((await sync(FOUNDER)).charter).toBe('rewritten');
    expect(await fs.readFile(charterPath(), 'utf-8')).not.toBe('old text\n');
  });

  it('warns and does not throw when the charter target cannot be read', async () => {
    await fs.mkdir(charterPath(), { recursive: true });
    const result = await sync(FOUNDER);
    expect(result.charter).toBe('failed');
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('charter');
  });

  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'warns and does not throw when the install directory is not writable',
    async () => {
      await fs.chmod(path.join(installed, 'hooks', 'assets'), 0o555);
      const result = await sync(FOUNDER);
      expect(result).toEqual({ charter: 'failed', sentinel: 'failed' });
      expect(warnings.length).toBe(2);
    },
  );

  it('leaves both files alone when the change guard refuses the target', async () => {
    const refused: string[] = [];
    const result = await sync(FOUNDER, { mayChange: async target => { refused.push(target); return false; } });
    expect(result).toEqual({ charter: 'failed', sentinel: 'failed' });
    expect(refused.sort()).toEqual([charterPath(), sentinelPath()].sort());
    expect(await exists(charterPath())).toBe(false);
    expect(await exists(sentinelPath())).toBe(false);
  });

  it('in uninstall mode keeps an installed sentinel when the change guard refuses its removal', async () => {
    await sync(FOUNDER);
    const sentinelBytes = await fs.readFile(sentinelPath(), 'utf-8');
    const asked: string[] = [];
    const result = await sync(names('devflow-plan'), {
      mode: 'uninstall',
      mayChange: async target => { asked.push(target); return target !== sentinelPath(); },
    });
    expect(result).toEqual({ charter: 'rewritten', sentinel: 'failed' });
    expect(asked).toContain(sentinelPath());
    expect(await fs.readFile(sentinelPath(), 'utf-8')).toBe(sentinelBytes);
    expect(warnings).toEqual([]);
  });

  it.each([
    ['install', 'implement stays', FOUNDER],
    ['install', 'implement goes', names('devflow-plan')],
    ['uninstall', 'implement stays', FOUNDER],
    ['uninstall', 'implement goes', names('devflow-plan')],
  ] as const)('in %s mode, when %s, asks the change guard about each file before it reads one', async (mode, _case, plugins) => {
    // A directory where a file belongs cannot be read as a file, so any read of it would warn.
    await fs.mkdir(charterPath());
    await fs.mkdir(sentinelPath());
    const asked: string[] = [];
    const result = await sync(plugins, { mode, mayChange: async target => { asked.push(target); return false; } });
    expect(result).toEqual({ charter: 'failed', sentinel: 'failed' });
    expect(asked.sort()).toEqual([charterPath(), sentinelPath()].sort());
    expect(warnings).toEqual([]);
  });

  it('warns once and installs the full source when a span is missing from the packaged charter', async () => {
    const packaged = path.join(root, 'packaged');
    await fs.mkdir(path.join(packaged, 'hooks', 'assets'), { recursive: true });
    const seeded = SOURCE.replace(DEBUG_AGENT_TEXT, () => '');
    await fs.writeFile(path.join(packaged, CHARTER_RELPATH), seeded);
    await fs.writeFile(path.join(packaged, HANDOFF_SENTINEL_RELPATH), SENTINEL_SOURCE);

    const result = await sync(FOUNDER, { packagedScriptsDir: packaged });
    expect(result).toEqual({ charter: 'rewritten', sentinel: 'rewritten' });
    expect(await fs.readFile(charterPath(), 'utf-8')).toBe(seeded);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain(DEBUG_AGENT_TEXT);
  });

  it('warns and reports failed when the packaged source is unreadable, without throwing', async () => {
    const packaged = path.join(root, 'empty-packaged');
    await fs.mkdir(packaged, { recursive: true });
    const result = await sync(FOUNDER, { packagedScriptsDir: packaged });
    expect(result).toEqual({ charter: 'failed', sentinel: 'failed' });
    expect(warnings.length).toBe(2);
    expect(await exists(charterPath())).toBe(false);
  });

  it('refuses a relative scripts directory with one warning', async () => {
    const result = await installRenderedCharter({ scriptsDir: 'scripts', plugins: FOUNDER, warn, mode: 'install' });
    expect(result).toEqual({ charter: 'failed', sentinel: 'failed' });
    expect(warnings.length).toBe(1);
  });

  it('survives a warn callback that throws', async () => {
    await fs.mkdir(charterPath(), { recursive: true });
    const result = await installRenderedCharter({
      scriptsDir: installed,
      plugins: FOUNDER,
      warn: () => { throw new Error('sink closed'); },
      mode: 'install',
    });
    expect(result.charter).toBe('failed');
  });
});

describe('removeHandoffSentinel', () => {
  let root: string;
  let installed: string;
  let warnings: string[];

  const charterPath = (): string => path.join(installed, CHARTER_RELPATH);
  const sentinelPath = (): string => path.join(installed, HANDOFF_SENTINEL_RELPATH);
  const warn = (msg: string): void => { warnings.push(msg); };
  const exists = (file: string): Promise<boolean> => fs.access(file).then(() => true, () => false);

  const remove = (removedPlugins: string[], extra: Partial<RemoveHandoffSentinelOptions> = {}) =>
    removeHandoffSentinel({ scriptsDir: installed, removedPlugins, warn, ...extra });

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'charter-sentinel-'));
    installed = path.join(root, 'scripts');
    warnings = [];
    await installRenderedCharter({
      scriptsDir: installed, plugins: DEVFLOW_PLUGINS.map(p => p.name), warn, mode: 'install',
    });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('removes the sentinel when implement is among the removed plugins and leaves the charter as it is', async () => {
    const charter = await fs.readFile(charterPath());
    expect(await exists(sentinelPath())).toBe(true);
    expect(await remove(['devflow-implement'])).toBe('rewritten');
    expect(await exists(sentinelPath())).toBe(false);
    expect(await fs.readFile(charterPath())).toEqual(charter);
    expect(await remove(['devflow-implement'])).toBe('absent');
    expect(warnings).toEqual([]);
  });

  it('leaves the sentinel when the removed plugins keep implement installed', async () => {
    expect(await remove(['devflow-plan', 'devflow-code-review'])).toBe('unchanged');
    expect(await exists(sentinelPath())).toBe(true);
  });

  it('keeps the sentinel the change guard refuses to remove, after asking about it', async () => {
    const asked: string[] = [];
    const result = await remove(['devflow-implement'], { mayChange: async target => { asked.push(target); return false; } });
    expect(result).toBe('failed');
    expect(asked).toEqual([sentinelPath()]);
    expect(await fs.readFile(sentinelPath(), 'utf-8')).toBe(SENTINEL_SOURCE);
    expect(warnings).toEqual([]);
  });

  it('creates nothing on a machine that has no scripts directory', async () => {
    await fs.rm(installed, { recursive: true });
    expect(await remove(['devflow-implement'])).toBe('absent');
    expect(await exists(installed)).toBe(false);
  });

  it('refuses a relative scripts directory with one warning', async () => {
    expect(await remove(['devflow-implement'], { scriptsDir: 'scripts' })).toBe('failed');
    expect(warnings.length).toBe(1);
    expect(await exists(sentinelPath())).toBe(true);
  });
});
