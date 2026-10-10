/**
 * Language-focus stamp for the installed /code-review command.
 *
 * D-LANGUAGE-FOCUS-STAMP: /code-review spawns a language focus only when its file-type trigger fires AND
 * the focus appears on one fixed-prefix line of the installed command. That line replaces the run-time
 * `test -f` probe of Claude Code's directory; the installer writes it from the registry and the effective
 * selection ({@link installedLanguageFocuses}), so the prompt reads a fact instead of discovering one.
 * Decided here:
 *
 *   - The carrier is one line, `Installed language focuses: <list>`, shipped as `(none)` in
 *     src/assets/commands/code-review.mds and found again by an anchored match, so a later run can
 *     re-stamp a copy an earlier run stamped. It carries no MDS interpolation braces, and it sits outside
 *     every learning arm, so both variants carry it. A separate stamped file would add a file to the
 *     install walk and the install goldens, which an in-place rewrite leaves unchanged.
 *   - Only code-review.md carries it. /dynamic-build spawns every review focus and drops none (plan
 *     decision 1), so it has no stamp, no reduced classes and no DIFF_FILE.
 *   - The stamp describes what is on disk, so it is computed from the EFFECTIVE selection
 *     (`FileCopyOptions.effectivePlugins`), never from the plugins one run copies, and it is applied after
 *     the command copy and the orphan sweep, whether or not code-review's own plugin is in the run. The
 *     rewrite compares the bytes it is about to write with the bytes now on disk, at the moment it writes,
 *     so no earlier same-run copy or pre-clean can defeat it.
 *   - `devflow uninstall --plugin` removes a language plugin's skill but no command, so its name would
 *     stay in the stamped copy; the selective phase re-stamps from the plugins that remain, through
 *     {@link restampInstalledCommands} like the install.
 *   - Composition with the learning converge (D-LEARNING-VARIANT-INSTALL), pinned: the converge rewrites
 *     installed command files from dist or dist/learning-off, and those files carry the shipped `(none)`
 *     line. It therefore applies {@link carryLanguageStamp} inside its own write path, putting the stamp
 *     it finds on the installed copy into the variant it writes. The alternative, re-stamping after every
 *     converge write, would make a steady-state run see a stamped copy that differs from its source, rewrite
 *     it and re-stamp it on every `devflow init`; carrying keeps the converge's byte comparison honest, so a
 *     run that changes nothing writes nothing, and it leaves one authority for the list: install and
 *     uninstall change it, a variant switch never does.
 *   - No prompt rule for a damaged stamp exists: no legitimate configuration produces one. A copy with
 *     no stamp line, or several, is reported here as a warning and left as it is.
 *   - Nothing here decides a diff's class or which focuses a diff gets. Those are prompt rules the
 *     orchestrator executes; this module only turns the registry and a selection into a list.
 *
 * Never throws: every failure is a warning, because the install must not die on a stamp.
 */
import { promises as fs } from 'fs';
import * as path from 'path';

import { writeFileAtomicExclusive } from '../../core/fs-atomic.js';
import { mdFileName } from '../../core/orphan-sweep.js';
import { installedLanguageFocuses, type PluginDefinition } from '../../core/plugins.js';

/** The fixed prefix of the stamp line; the prompt and the anchored match share it. */
export const LANGUAGE_STAMP_PREFIX = 'Installed language focuses: ';

/** What an empty list renders as, and what the build ships. */
export const LANGUAGE_STAMP_NONE = '(none)';

/** Installed commands that carry the stamp line. Only /code-review (plan decision 1). */
export const LANGUAGE_STAMPED_COMMANDS: readonly string[] = ['code-review'];

/** The most focuses one stamp lists; the registry has eight, so the bound is generous. */
const MAX_STAMPED_FOCUSES = 16;

/** One focus name is a plain lowercase skill name. */
const FOCUS_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** A well-formed list as rendered: `(none)`, or comma-space separated plain names. */
const STAMP_VALUE_RE = /^(?:\(none\)|[a-z][a-z0-9-]{0,31}(?:, [a-z][a-z0-9-]{0,31}){0,15})$/;

/** The stamp line, anchored to a whole line. Rebuilt per use: a global regex carries state. */
const stampLineRe = (): RegExp => /^Installed language focuses: [^\r\n]*$/gm;

/** The full stamp line for a list. */
export function renderLanguageStamp(focuses: readonly string[]): string {
  return `${LANGUAGE_STAMP_PREFIX}${focuses.length === 0 ? LANGUAGE_STAMP_NONE : focuses.join(', ')}`;
}

export type ApplyLanguageStampResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly reason: 'no-stamp-line' | 'several-stamp-lines' | 'bad-focus-name' };

/**
 * `content` with its one stamp line replaced by the rendering of `focuses`.
 *
 * Pure. Refuses a list holding anything but plain skill names, so no prompt text can ride in on it, and
 * refuses a file with no stamp line or several rather than guessing which one is the carrier.
 */
export function applyLanguageStamp(content: string, focuses: readonly string[]): ApplyLanguageStampResult {
  if (focuses.length > MAX_STAMPED_FOCUSES || !focuses.every(name => FOCUS_NAME_RE.test(name))) {
    return { ok: false, reason: 'bad-focus-name' };
  }
  const lines = [...content.matchAll(stampLineRe())];
  if (lines.length === 0) return { ok: false, reason: 'no-stamp-line' };
  if (lines.length > 1) return { ok: false, reason: 'several-stamp-lines' };
  const at = lines[0].index ?? 0;
  return { ok: true, content: content.slice(0, at) + renderLanguageStamp(focuses) + content.slice(at + lines[0][0].length) };
}

/**
 * `source` with its stamp line replaced by the one on `installed`.
 *
 * The learning converge's write path (see the header): the variant it installs keeps the list the
 * install stamped. Returns `source` unchanged unless both sides hold exactly one stamp line and the
 * installed one is a well-formed list, so a damaged or hostile line is never copied into a fresh file.
 */
export function carryLanguageStamp(source: string, installed: string): string {
  const from = [...installed.matchAll(stampLineRe())];
  const into = [...source.matchAll(stampLineRe())];
  if (from.length !== 1 || into.length !== 1) return source;
  const carried = from[0][0];
  if (!STAMP_VALUE_RE.test(carried.slice(LANGUAGE_STAMP_PREFIX.length))) return source;
  const at = into[0].index ?? 0;
  return source.slice(0, at) + carried + source.slice(at + into[0][0].length);
}

export interface RestampOptions {
  /** Claude Code's config directory. Must be absolute. */
  readonly claudeDir: string;
  /** The plugins whose skill closure is, or stays, installed: the effective selection. */
  readonly effectivePlugins: readonly PluginDefinition[];
  readonly warn: (msg: string) => void;
  /** A change guard for a legacy local install (D-CLI-NO-SYMLINK); omitted, every target may change. */
  readonly mayChange?: (target: string) => Promise<boolean>;
}

export interface RestampResult {
  /** The list stamped (or left stamped), in registry order. */
  readonly focuses: readonly string[];
  /** Commands (without `.md`) whose installed copy this run rewrote. */
  readonly rewritten: readonly string[];
  /** Commands whose installed copy already held the list. */
  readonly unchanged: readonly string[];
  /** Commands that are not installed: nothing to stamp. */
  readonly absent: readonly string[];
  /** Commands left as they were because the copy was damaged, unreadable, guarded or unwritable. */
  readonly failed: readonly string[];
}

/**
 * Stamp every installed copy that carries the stamp with the list for `effectivePlugins`.
 *
 * Called by installViaFileCopy after the command copy and the orphan sweep (every install shape) and by
 * the selective uninstall phase after the removals. A command that is not installed is left absent, so a
 * `--plugin` run never gains a command it did not install.
 */
export async function restampInstalledCommands(opts: RestampOptions): Promise<RestampResult> {
  const { claudeDir, effectivePlugins, warn, mayChange } = opts;
  const focuses = installedLanguageFocuses(effectivePlugins);
  const rewritten: string[] = [];
  const unchanged: string[] = [];
  const absent: string[] = [];
  const failed: string[] = [];

  // Precondition, asserted in production code: a relative claudeDir would resolve the targets
  // against the working directory.
  if (!path.isAbsolute(claudeDir)) {
    warn(`language stamp: claudeDir is not an absolute path ("${claudeDir}") — the installed commands were not stamped`);
    return { focuses, rewritten, unchanged, absent, failed: [...LANGUAGE_STAMPED_COMMANDS] };
  }

  for (const command of LANGUAGE_STAMPED_COMMANDS) {
    const target = path.join(claudeDir, 'commands', 'devflow', mdFileName(command));
    let current: string;
    try {
      current = await fs.readFile(target, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        absent.push(command);
      } else {
        warn(`language stamp: cannot read ${mdFileName(command)} (${target}) — ${String(err)}`);
        failed.push(command);
      }
      continue;
    }

    const stamped = applyLanguageStamp(current, focuses);
    if (!stamped.ok) {
      warn(
        stamped.reason === 'no-stamp-line'
          ? `language stamp: ${mdFileName(command)} has no stamp line, so the installed language focuses were not recorded. Run \`devflow init\` to reinstall it.`
          : `language stamp: ${mdFileName(command)} has ${stamped.reason === 'several-stamp-lines' ? 'several stamp lines' : 'an unusable language list'}, so it was left as it is. Run \`devflow init\` to reinstall it.`,
      );
      failed.push(command);
      continue;
    }
    // Compared at the moment of writing, against what is on disk now.
    if (stamped.content === current) {
      unchanged.push(command);
      continue;
    }
    try {
      if (mayChange !== undefined && !(await mayChange(target))) {
        failed.push(command);
        continue;
      }
      await writeFileAtomicExclusive(target, stamped.content);
      rewritten.push(command);
    } catch (err) {
      warn(`language stamp: could not rewrite ${mdFileName(command)} (${target}) — ${String(err)}`);
      failed.push(command);
    }
  }

  return { focuses, rewritten, unchanged, absent, failed };
}
