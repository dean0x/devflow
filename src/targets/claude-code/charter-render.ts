/**
 * Install-time render of the ambient orchestrator charter, and the implement sentinel.
 *
 * D-CHARTER-INSTALL-RENDER: the packaged charter (src/assets/scripts/hooks/assets/orchestrator-charter.md)
 * is the FULL text. It routes to workflows and agents that a machine may not install, so `devflow init`
 * writes a copy with the lines of every uninstalled owner deleted, and the session-start hook injects that
 * copy whole. Decided here:
 *
 *   - The render only deletes. It inserts no text and reads no name into the output: the inventory (which
 *     commands and agents the selection installs) is used for presence checks alone. The full source is
 *     also the fallback, so a render that cannot run installs the full charter and warns; it never aborts
 *     the install.
 *   - The span table is the whole contract between the charter text and this module. Every span is counted
 *     in the ORIGINAL source before any removal, and a span that occurs 0 or more than 1 times fails the
 *     render, so wording drift in the charter surfaces at install time and in the test, never as a
 *     silently wrong charter. The edits are ranges of the original source applied once, and two chosen
 *     ranges that share bytes fail the render rather than cut through each other.
 *   - The two debug-command spans overlap on `, else ` by design (`devflow:debug, else Explore ...`). They
 *     share one owner with opposite polarity, so a render removes exactly one of them: the fallback
 *     sentence when debug is installed, the command mention when it is not.
 *   - devflow-ambient's agents count as installed whatever the selection says. The charter belongs to that
 *     plugin, and it is installed in every shipped configuration; `devflow ambient --enable` warns when it
 *     is not.
 *   - The sentinel (`hooks/assets/implement-installed`) exists exactly when devflow-implement is installed.
 *     The per-prompt preamble branches on its existence with a shell builtin, so the plan-handoff directive
 *     runs only where the workflow it names exists. This module is the only writer of the charter and the
 *     sentinel at install time; the verbatim script copy skips both.
 *   - `sentinelMode: 'remove-only'` is the uninstall mode. An uninstall re-renders from the manifest
 *     record and may take the sentinel away, but never creates one.
 *   - After a package upgrade the installed charter stays as rendered until the next `devflow init`.
 *
 * Never throws: every failure is a warning and a `failed` outcome, because the install must not die on a
 * charter. Silent on success.
 */
import { promises as fs } from 'fs';
import * as path from 'path';

import { scriptsDir as packagedScriptsDir } from '../../core/assets.js';
import { writeFileAtomicExclusive } from '../../core/fs-atomic.js';
import { DEVFLOW_PLUGINS, LEGACY_PLUGIN_NAMES } from '../../core/plugins.js';

/** The charter, relative to the scripts directory (packaged and installed alike). */
export const CHARTER_RELPATH = 'hooks/assets/orchestrator-charter.md';

/** The sentinel, relative to the scripts directory. It exists exactly when devflow-implement is installed. */
export const HANDOFF_SENTINEL_RELPATH = 'hooks/assets/implement-installed';

/** The plugin whose agents the charter always treats as installed. */
const AMBIENT_PLUGIN = 'devflow-ambient';

/** The permission bits of an installed charter or sentinel: the hooks directory is installed executable. */
const INSTALLED_MODE = 0o755;

/** The command whose presence the sentinel records. */
const HANDOFF_COMMAND = 'implement';

/** Something the registry installs and a span depends on. */
export interface CharterOwner {
  readonly kind: 'command' | 'agent';
  /** A command name without the leading slash, or an agent slug. */
  readonly name: string;
}

/** A workflow named in the charter's workflow list; kept while its command is installed. */
export interface CharterListItem {
  /** The exact characters the item has in the joined list. */
  readonly text: string;
  readonly owner: CharterOwner;
}

/** A piece of the charter that goes away with its owner. */
export interface CharterSpan {
  /** `text` matches the exact characters. `line` matches every line that starts with `text`. */
  readonly shape: 'text' | 'line';
  readonly text: string;
  readonly owner: CharterOwner;
  /** Whether the render removes the span when its owner is absent, or (the debug fallback only) present. */
  readonly removedWhen: 'absent' | 'present';
}

/** The workflow list's items, in the order the charter joins them with `, `. */
export const CHARTER_WORKFLOW_ITEMS: readonly CharterListItem[] = [
  { text: 'devflow:implement', owner: { kind: 'command', name: 'implement' } },
  { text: 'devflow:plan', owner: { kind: 'command', name: 'plan' } },
  { text: 'devflow:research', owner: { kind: 'command', name: 'research' } },
  { text: 'devflow:explore', owner: { kind: 'command', name: 'explore' } },
  { text: 'devflow:code-review', owner: { kind: 'command', name: 'code-review' } },
  { text: 'devflow:resolve', owner: { kind: 'command', name: 'resolve' } },
  {
    text: 'devflow:bug-analysis (hunt bugs in a branch before merge)',
    owner: { kind: 'command', name: 'bug-analysis' },
  },
];

/** The joined list as the charter spells it: it occurs once, on the workflow bullet. */
export const CHARTER_WORKFLOW_LIST: string = CHARTER_WORKFLOW_ITEMS.map(item => item.text).join(', ');

/** Every other span: removal-only, each tied to one owner. */
export const CHARTER_SPANS: readonly CharterSpan[] = [
  {
    shape: 'text',
    text: 'Fix (`OPERATION:` validation-fix, alignment-fix, qa-fix or ci-fix), else ',
    owner: { kind: 'agent', name: 'fix' },
    removedWhen: 'absent',
  },
  {
    shape: 'text',
    text: 'devflow:debug, else ',
    owner: { kind: 'command', name: 'debug' },
    removedWhen: 'absent',
  },
  {
    shape: 'text',
    text: ', else Explore investigates and Code fixes',
    owner: { kind: 'command', name: 'debug' },
    removedWhen: 'present',
  },
  {
    shape: 'text',
    text: '; never the Debug agent',
    owner: { kind: 'agent', name: 'debug' },
    removedWhen: 'absent',
  },
  {
    shape: 'line',
    text: '- Plan handoff: ',
    owner: { kind: 'command', name: HANDOFF_COMMAND },
    removedWhen: 'absent',
  },
];

/** What a selection of plugins installs, as far as the charter's spans can tell. */
export interface CharterInventory {
  /** Command names without a leading slash. */
  readonly commands: ReadonlySet<string>;
  readonly agents: ReadonlySet<string>;
}

/**
 * The commands and agents a plugin selection installs.
 *
 * Only names in DEVFLOW_PLUGINS count: a manifest is file content, so an unknown, deleted or hostile name
 * selects nothing, and a name that reaches here from a legacy install maps to its current plugin the way
 * the rest of the codebase maps it ({@link LEGACY_PLUGIN_NAMES}). devflow-ambient's agents are always
 * included. The names are used for presence checks only and never reach the rendered text.
 */
export function charterInventory(pluginNames: readonly string[]): CharterInventory {
  const selected = new Set<string>();
  for (const raw of pluginNames) {
    selected.add(Object.hasOwn(LEGACY_PLUGIN_NAMES, raw) ? LEGACY_PLUGIN_NAMES[raw] : raw);
  }
  const commands = new Set<string>();
  const agents = new Set<string>();
  for (const plugin of DEVFLOW_PLUGINS) {
    if (plugin.name === AMBIENT_PLUGIN) {
      for (const agent of plugin.agents) agents.add(agent);
    }
    if (!selected.has(plugin.name)) continue;
    for (const command of plugin.commands) commands.add(command.startsWith('/') ? command.slice(1) : command);
    for (const agent of plugin.agents) agents.add(agent);
  }
  return { commands, agents };
}

export type CharterRenderResult =
  | { readonly ok: true; readonly content: string }
  | {
      readonly ok: false;
      readonly reason: 'missing' | 'repeated' | 'overlap';
      /** The span (its text, or its line prefix) the render could not place. */
      readonly span: string;
    };

/** One range of the original source and what replaces it. */
interface Edit {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
  readonly span: string;
}

/** Where one span sits in the original source, and the range its removal cuts. */
interface Located {
  readonly start: number;
  readonly end: number;
}

/** How many times `needle` occurs in `haystack`, overlapping occurrences included. Bounded by the haystack length. */
function occurrencesOf(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  for (let from = haystack.indexOf(needle); from !== -1; from = haystack.indexOf(needle, from + 1)) count++;
  return count;
}

/** The range of the whole line that holds `index`, its newline included. */
function lineRangeAt(source: string, index: number): Located {
  const start = index === 0 ? 0 : source.lastIndexOf('\n', index - 1) + 1;
  const newline = source.indexOf('\n', index);
  return { start, end: newline === -1 ? source.length : newline + 1 };
}

/** The one place `span` sits in `source`, or the way it fails to. */
function locateSpan(source: string, span: CharterSpan): Located | { readonly reason: 'missing' | 'repeated' } {
  if (span.shape === 'text') {
    const count = occurrencesOf(source, span.text);
    if (count !== 1) return { reason: count === 0 ? 'missing' : 'repeated' };
    const start = source.indexOf(span.text);
    return { start, end: start + span.text.length };
  }
  const starts: number[] = [];
  let lineStart = 0;
  for (const line of source.split('\n')) {
    if (line.startsWith(span.text)) starts.push(lineStart);
    lineStart += line.length + 1;
  }
  if (starts.length !== 1) return { reason: starts.length === 0 ? 'missing' : 'repeated' };
  return lineRangeAt(source, starts[0]);
}

/**
 * `source` with the spans of every uninstalled owner deleted.
 *
 * Pure. Counts every span in the original source first and fails on a span that occurs 0 or more than 1
 * times; a render that cannot be trusted returns `{ok: false}` and the caller keeps the full source. The
 * workflow list keeps its installed items in order (with none kept, the whole bullet line goes), every
 * other span goes when its owner is absent (or, for the debug fallback, present).
 */
export function renderCharter(
  source: string,
  installedCommands: ReadonlySet<string>,
  installedAgents: ReadonlySet<string>,
): CharterRenderResult {
  const installed = (owner: CharterOwner): boolean =>
    (owner.kind === 'command' ? installedCommands : installedAgents).has(owner.name);

  // 1. Place every span in the original source, before anything is removed.
  const listCount = occurrencesOf(source, CHARTER_WORKFLOW_LIST);
  if (listCount !== 1) {
    return { ok: false, reason: listCount === 0 ? 'missing' : 'repeated', span: CHARTER_WORKFLOW_LIST };
  }
  const listStart = source.indexOf(CHARTER_WORKFLOW_LIST);
  const placed: Array<{ readonly span: CharterSpan; readonly at: Located }> = [];
  for (const span of CHARTER_SPANS) {
    const at = locateSpan(source, span);
    if ('reason' in at) return { ok: false, reason: at.reason, span: span.text };
    placed.push({ span, at });
  }

  // 2. Decide the edits, all against the original source.
  const edits: Edit[] = [];
  const kept = CHARTER_WORKFLOW_ITEMS.filter(item => installed(item.owner));
  if (kept.length === 0) {
    edits.push({ ...lineRangeAt(source, listStart), replacement: '', span: CHARTER_WORKFLOW_LIST });
  } else if (kept.length < CHARTER_WORKFLOW_ITEMS.length) {
    edits.push({
      start: listStart,
      end: listStart + CHARTER_WORKFLOW_LIST.length,
      replacement: kept.map(item => item.text).join(', '),
      span: CHARTER_WORKFLOW_LIST,
    });
  }
  for (const { span, at } of placed) {
    const present = installed(span.owner);
    if (span.removedWhen === 'absent' ? !present : present) {
      edits.push({ start: at.start, end: at.end, replacement: '', span: span.text });
    }
  }

  // 3. Apply them once, left to right. Two edits that share bytes cannot both be right.
  edits.sort((a, b) => a.start - b.start);
  let out = '';
  let at = 0;
  for (const edit of edits) {
    if (edit.start < at) return { ok: false, reason: 'overlap', span: edit.span };
    out += source.slice(at, edit.start) + edit.replacement;
    at = edit.end;
  }
  return { ok: true, content: out + source.slice(at) };
}

/** What happened to one installed file. */
export type CharterFileOutcome =
  /** This run wrote, changed or removed the file. */
  | 'rewritten'
  /** The file is in place and correct. */
  | 'unchanged'
  /** The file is not there and this run left it so: nothing to render over, nothing to remove, or never created. */
  | 'absent'
  /** The file was left as it was because something went wrong (a warning says what) or the change guard refused. */
  | 'failed';

export interface InstallRenderedCharterOptions {
  /** The installed scripts directory (`~/.devflow/scripts`). Must be absolute. */
  readonly scriptsDir: string;
  /** The effective selection: plugin names, or plugin definitions. Names outside DEVFLOW_PLUGINS select nothing. */
  readonly plugins: ReadonlyArray<string | { readonly name: string }>;
  readonly warn: (msg: string) => void;
  /** A change guard for a legacy local install (D-CLI-NO-SYMLINK); omitted, every target may change. */
  readonly mayChange?: (target: string) => Promise<boolean>;
  /** Render over a file that is installed; never create one. The uninstall mode. */
  readonly onlyIfInstalled?: boolean;
  /** `sync` writes the sentinel while implement is installed; `remove-only` never creates it. */
  readonly sentinelMode: 'sync' | 'remove-only';
  /** The packaged scripts directory to read the full charter and the sentinel from. Tests only; omitted, the package's own. */
  readonly packagedScriptsDir?: string;
}

export interface InstallRenderedCharterResult {
  readonly charter: CharterFileOutcome;
  readonly sentinel: CharterFileOutcome;
}

/** The file's bytes, or null when there is no such file. Any other failure throws to the caller's catch. */
async function readIfPresent(file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Write `text` unless `current` already holds exactly those bytes, atomically and executable. */
async function writeIfChanged(
  file: string,
  current: Buffer | null,
  text: string,
  mayChange: InstallRenderedCharterOptions['mayChange'],
): Promise<CharterFileOutcome> {
  if (current !== null && current.equals(Buffer.from(text, 'utf-8'))) return 'unchanged';
  if (mayChange !== undefined && !(await mayChange(file))) return 'failed';
  await fs.mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomicExclusive(file, text, INSTALLED_MODE);
  return 'rewritten';
}

/** Remove the sentinel; a file that is already gone is not an error. */
async function removeFile(
  file: string,
  current: Buffer | null,
  mayChange: InstallRenderedCharterOptions['mayChange'],
): Promise<CharterFileOutcome> {
  if (current === null) return 'absent';
  if (mayChange !== undefined && !(await mayChange(file))) return 'failed';
  try {
    await fs.unlink(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return 'absent';
  }
  return 'rewritten';
}

/** Why a render failed, in a sentence for the warning. */
function describeFailure(result: Extract<CharterRenderResult, { ok: false }>): string {
  const problem = {
    missing: 'is missing from',
    repeated: 'occurs more than once in',
    overlap: 'overlaps another span in',
  }[result.reason];
  return `the span "${result.span}" ${problem} the packaged charter, so the full charter was installed.`;
}

/**
 * Write the charter rendered for `plugins`, and sync the implement sentinel with it.
 *
 * Called by installViaFileCopy after the script copy, by `init --hud-only`, and by the selective
 * uninstall phase. The two files are independent: each has its own try/catch, so a failure on one never
 * costs the other. Bytes are compared with the bytes on disk at the moment of writing, so a rerun that
 * changes nothing writes nothing.
 */
export async function installRenderedCharter(opts: InstallRenderedCharterOptions): Promise<InstallRenderedCharterResult> {
  const { scriptsDir: target, plugins, mayChange, onlyIfInstalled = false, sentinelMode } = opts;
  const warn = (msg: string): void => {
    try { opts.warn(msg); } catch { /* a closed sink must not fail the install */ }
  };

  // Precondition, asserted in production code: a relative scriptsDir would resolve against the working directory.
  if (!path.isAbsolute(target)) {
    warn(`charter render: scriptsDir is not an absolute path ("${target}") — the installed charter was not rendered`);
    return { charter: 'failed', sentinel: 'failed' };
  }

  const inventory = charterInventory(plugins.map(plugin => (typeof plugin === 'string' ? plugin : plugin.name)));
  const charterTarget = path.join(target, CHARTER_RELPATH);
  const sentinelTarget = path.join(target, HANDOFF_SENTINEL_RELPATH);

  const packagedRoot = (): string | null => {
    try {
      return opts.packagedScriptsDir ?? packagedScriptsDir();
    } catch (err) {
      warn(`charter render: cannot find the packaged scripts — ${String(err)}`);
      return null;
    }
  };

  const installCharter = async (): Promise<CharterFileOutcome> => {
    try {
      const current = await readIfPresent(charterTarget);
      if (current === null && onlyIfInstalled) return 'absent';
      const root = packagedRoot();
      if (root === null) return 'failed';
      const source = await fs.readFile(path.join(root, CHARTER_RELPATH), 'utf-8');
      const rendered = renderCharter(source, inventory.commands, inventory.agents);
      if (!rendered.ok) warn(`charter render: ${describeFailure(rendered)}`);
      return await writeIfChanged(charterTarget, current, rendered.ok ? rendered.content : source, mayChange);
    } catch (err) {
      warn(`charter render: could not install the charter (${charterTarget}) — ${String(err)}`);
      return 'failed';
    }
  };

  const syncSentinel = async (): Promise<CharterFileOutcome> => {
    try {
      const current = await readIfPresent(sentinelTarget);
      if (!inventory.commands.has(HANDOFF_COMMAND)) return await removeFile(sentinelTarget, current, mayChange);
      if (sentinelMode === 'remove-only' || (current === null && onlyIfInstalled)) {
        return current === null ? 'absent' : 'unchanged';
      }
      const root = packagedRoot();
      if (root === null) return 'failed';
      const text = await fs.readFile(path.join(root, HANDOFF_SENTINEL_RELPATH), 'utf-8');
      return await writeIfChanged(sentinelTarget, current, text, mayChange);
    } catch (err) {
      warn(`charter render: could not sync the implement sentinel (${sentinelTarget}) — ${String(err)}`);
      return 'failed';
    }
  };

  const charter = await installCharter();
  const sentinel = await syncSentinel();
  return { charter, sentinel };
}
