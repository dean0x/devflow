/**
 * The skill files a compliance-off install removes by exact name, and the restore that
 * puts them back (AC-41).
 *
 * The list is {@link COMPLIANCE_OFF_REMOVED_SKILL_FILES}: one constant, read by the install
 * and by the compliance converge. This module does the file work and holds no policy:
 *
 *   - {@link removeComplianceOffFiles} runs with compliance off, AFTER the skill copy that
 *     would otherwise re-create a file;
 *   - {@link restoreComplianceOffFiles} runs with compliance on and writes back the files
 *     that a skill copy puts in place, from the same source the install would copy.
 *
 * Both are Results, never throws: an entry that cannot be handled is `refused` with its
 * reason, the next entry still runs, and the caller decides what a refusal costs.
 *
 * Link and directory rules, shared by both halves (the same posture as the converged-root
 * check, D-CONVERGED-ROOT-REAL):
 *   - every path is checked with `lstat`, never `stat`, so a link is seen as a link;
 *   - a link AT the entry is unlinked (the link, never its target) by a removal and replaced
 *     by a restore, so nothing is read or written through it;
 *   - a directory AT the entry is refused and reported, never recursed into;
 *   - a link or a non-directory ABOVE the entry, below the skills directory, is refused: the
 *     operation would otherwise reach a file through someone else's directory.
 *
 * Bound: the loops run over the entries of the list (three) and the segments of one entry.
 */
import { constants as fsConstants, promises as fs } from 'fs';
import * as path from 'path';

import { COMPLIANCE_OFF_REMOVED_SKILL_FILES } from '../../core/compliance-off-files.js';
import { unprefixSkillName } from '../../core/plugins.js';

/** An entry that was not handled, and why. */
export interface ComplianceOffFileRefusal {
  /** The entry, spelled as in {@link COMPLIANCE_OFF_REMOVED_SKILL_FILES}. */
  readonly entry: string;
  readonly reason: string;
}

export interface ComplianceOffRemovalResult {
  /** Entries that were present and are now gone (a file or a link, unlinked). */
  readonly removed: readonly string[];
  /** Entries that could not be removed: a directory at the path, a link above it, or an I/O error. */
  readonly refused: readonly ComplianceOffFileRefusal[];
}

export interface ComplianceOffRestoreResult {
  /** Entries written back because the file was absent or differed from its source. */
  readonly restored: readonly string[];
  /** Entries already holding the source bytes. */
  readonly unchanged: readonly string[];
  /** Entries that could not be restored. */
  readonly refused: readonly ComplianceOffFileRefusal[];
}

/** What lies on the way to an entry, from the skills directory down to the entry's parent. */
type Ancestors =
  | { readonly kind: 'ok' }
  /** The directory at `index` of the entry's segments does not exist. */
  | { readonly kind: 'absent'; readonly index: number }
  | { readonly kind: 'refused'; readonly reason: string };

const errno = (err: unknown): string | undefined => (err as NodeJS.ErrnoException).code;

/** The entry as segments, or why it is not a plain relative path below the skills directory. */
function entrySegments(entry: string): { ok: true; segments: string[] } | { ok: false; reason: string } {
  const segments = entry.split('/');
  const plain = segments.length >= 2 && segments.every(segment => segment !== '' && segment !== '.' && segment !== '..' && !segment.includes('\\'));
  return plain ? { ok: true, segments } : { ok: false, reason: 'the entry is not a plain relative path' };
}

/** Walk the directories above the entry's last segment with `lstat`. */
async function inspectAncestors(skillsDir: string, segments: readonly string[]): Promise<Ancestors> {
  let current = skillsDir;
  for (let index = 0; index < segments.length - 1; index++) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (err) {
      if (errno(err) === 'ENOENT') return { kind: 'absent', index };
      return { kind: 'refused', reason: `cannot inspect ${current} (${errno(err) ?? String(err)})` };
    }
    if (stat.isSymbolicLink()) return { kind: 'refused', reason: `${current} is a link, so nothing is changed through it` };
    if (!stat.isDirectory()) return { kind: 'refused', reason: `${current} is not a directory` };
  }
  return { kind: 'ok' };
}

/**
 * Remove each entry of the list under `skillsDir`. An entry that is absent is a no-op.
 *
 * @param skillsDir - `{claudeDir}/skills`. Injected, so a test never touches the real one.
 * @param entries - Defaults to {@link COMPLIANCE_OFF_REMOVED_SKILL_FILES}; injectable so a
 *   known-bad list is provable.
 */
export async function removeComplianceOffFiles(
  skillsDir: string,
  entries: readonly string[] = COMPLIANCE_OFF_REMOVED_SKILL_FILES,
): Promise<ComplianceOffRemovalResult> {
  const removed: string[] = [];
  const refused: ComplianceOffFileRefusal[] = [];

  for (const entry of entries) {
    const parsed = entrySegments(entry);
    if (!parsed.ok) {
      refused.push({ entry, reason: parsed.reason });
      continue;
    }
    const ancestors = await inspectAncestors(skillsDir, parsed.segments);
    if (ancestors.kind === 'absent') continue;
    if (ancestors.kind === 'refused') {
      refused.push({ entry, reason: ancestors.reason });
      continue;
    }

    const target = path.join(skillsDir, ...parsed.segments);
    let stat;
    try {
      stat = await fs.lstat(target);
    } catch (err) {
      if (errno(err) === 'ENOENT') continue;
      refused.push({ entry, reason: `cannot inspect ${target} (${errno(err) ?? String(err)})` });
      continue;
    }
    if (stat.isDirectory()) {
      refused.push({ entry, reason: `${target} is a directory, so it is not removed. Delete it by hand.` });
      continue;
    }
    if (!stat.isFile() && !stat.isSymbolicLink()) {
      refused.push({ entry, reason: `${target} is not a regular file or a link, so it is not removed. Delete it by hand.` });
      continue;
    }
    try {
      await fs.unlink(target);
      removed.push(entry);
    } catch (err) {
      if (errno(err) === 'ENOENT') continue;
      refused.push({ entry, reason: `could not remove ${target} (${errno(err) ?? String(err)})` });
    }
  }
  return { removed, refused };
}

export interface RestoreComplianceOffFilesOptions {
  /** `{claudeDir}/skills`. */
  readonly skillsDir: string;
  /**
   * The directory a skill installs from, by its unprefixed name: the valid shadow, else the
   * shipped source. Injected, so this module holds no shadow rule. May throw; a throw refuses
   * the entry.
   */
  readonly sourceDirOf: (skillName: string) => Promise<string>;
  /** Entries another converger writes (the overlay owns every generated reference), left alone here. */
  readonly ownedElsewhere?: ReadonlySet<string>;
  /** Defaults to {@link COMPLIANCE_OFF_REMOVED_SKILL_FILES}. */
  readonly entries?: readonly string[];
}

/** Whether `a` and `b` hold the same bytes; any read error answers false. */
async function sameBytes(a: string, b: string): Promise<boolean> {
  try {
    const [x, y] = await Promise.all([fs.readFile(a), fs.readFile(b)]);
    return x.equals(y);
  } catch {
    return false;
  }
}

/** Copy `source` over `target` through a sibling temp file and a rename, so no reader sees a partial file. */
async function copyIntoPlace(source: string, target: string): Promise<void> {
  const temp = `${target}.tmp.${process.pid}`;
  try {
    await fs.unlink(temp).catch((err: unknown) => {
      if (errno(err) !== 'ENOENT') throw err;
    });
    await fs.copyFile(source, temp, fsConstants.COPYFILE_EXCL);
    // A reference is read-only instruction text; the overlay normalises the same mode.
    await fs.chmod(temp, 0o644);
    await fs.rename(temp, target);
  } catch (err) {
    await fs.unlink(temp).catch(() => undefined);
    throw err;
  }
}

/**
 * Write back each entry whose file exists in its skill's source and is missing from, or
 * differs in, the installed skill.
 *
 * It acts on a skill that is ALREADY installed and never installs one: an entry whose skill
 * directory is absent is left alone, as a partial install of another plugin must be. An entry
 * whose source has no such file is left alone too (a shadow that ships none installs none, and a
 * fresh install of the same shadow agrees). Rename replaces a link at the entry, never writes
 * through it.
 */
export async function restoreComplianceOffFiles(opts: RestoreComplianceOffFilesOptions): Promise<ComplianceOffRestoreResult> {
  const { skillsDir, sourceDirOf } = opts;
  const entries = opts.entries ?? COMPLIANCE_OFF_REMOVED_SKILL_FILES;
  const restored: string[] = [];
  const unchanged: string[] = [];
  const refused: ComplianceOffFileRefusal[] = [];

  for (const entry of entries) {
    if (opts.ownedElsewhere?.has(entry) === true) continue;
    const parsed = entrySegments(entry);
    if (!parsed.ok) {
      refused.push({ entry, reason: parsed.reason });
      continue;
    }
    const { segments } = parsed;

    const ancestors = await inspectAncestors(skillsDir, segments);
    if (ancestors.kind === 'refused') {
      refused.push({ entry, reason: ancestors.reason });
      continue;
    }
    // The skill directory is the first ancestor: a skill that is not installed is not ours to create.
    if (ancestors.kind === 'absent' && ancestors.index === 0) continue;

    let sourceFile: string;
    try {
      sourceFile = path.join(await sourceDirOf(unprefixSkillName(segments[0])), ...segments.slice(1));
      if (!(await fs.stat(sourceFile)).isFile()) continue;
    } catch (err) {
      if (errno(err) === 'ENOENT') continue;
      refused.push({ entry, reason: `cannot read the source of ${entry} (${errno(err) ?? String(err)})` });
      continue;
    }

    const target = path.join(skillsDir, ...segments);
    let existing: 'absent' | 'file' | 'link' | 'directory' | 'other' = 'absent';
    try {
      const stat = await fs.lstat(target);
      existing = stat.isSymbolicLink() ? 'link' : stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other';
    } catch (err) {
      if (errno(err) !== 'ENOENT') {
        refused.push({ entry, reason: `cannot inspect ${target} (${errno(err) ?? String(err)})` });
        continue;
      }
    }
    if (existing === 'directory' || existing === 'other') {
      refused.push({ entry, reason: `${target} is ${existing === 'directory' ? 'a directory' : 'not a regular file'}, so it is not replaced. Delete it by hand.` });
      continue;
    }
    if (existing === 'file' && (await sameBytes(sourceFile, target))) {
      unchanged.push(entry);
      continue;
    }

    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await copyIntoPlace(sourceFile, target);
      restored.push(entry);
    } catch (err) {
      refused.push({ entry, reason: `could not write ${target} (${errno(err) ?? String(err)})` });
    }
  }
  return { restored, unchanged, refused };
}
