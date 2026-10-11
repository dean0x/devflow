/**
 * Who else defines an agent type: the install-edge check behind devflow's Explore
 * override.
 *
 * Pure core (`parseAgentType`) with one bounded I/O function (`findForeignAgentOwner`)
 * at the installer edge. Result-style outcomes: nothing here throws.
 *
 * D-EXPLORE-OVERRIDE: devflow ships an agent whose frontmatter `name:` is `Explore`,
 * the same type as the Explore agent built into Claude Code. This is a documented,
 * supported override, not a collision: Claude Code merges its agent sources into one
 * map keyed by the exact `name:` string, in the order built-in, plugin, user, project,
 * flag, policy, and a later source replaces an earlier one. A user-level agent named
 * Explore therefore replaces the built-in for every session on the machine, plan mode
 * included, because the lookup is by agent type and no session mode bypasses it.
 *
 * Verified against Claude Code 2.1.296 (`claude --version`) by reading the binary:
 *   - the merge is `bz` (the Map keyed by `agentType`, last source wins);
 *   - the built-in Explore is `omitClaudeMd: true` with `model: "inherit"`, and its
 *     inherit-cap to Opus is gated on `source === "built-in"`, so it does not follow
 *     the override;
 *   - `omitGitStatus` is set by `agentType === "Explore" || agentType === "Plan"` and
 *     checks no source, so devflow's Explore is spared the git-status block too;
 *   - agents are matched with strict equality, so `explore` and `Explore` are two
 *     different agents.
 * Uninstalling removes devflow's copy, and the built-in applies again.
 *
 * D-EXPLORE-NO-CLOBBER: two user-level agents with one type fall back to file load
 * order, so devflow never installs a second Explore beside the user's own. The install
 * skips its copy when another file under the agents directory defines the type, and
 * never touches that file. Matching is exact, as Claude Code's is: a lowercase
 * `explore` agent is a different agent and does not block the install.
 */
import { promises as fs, constants as fsConstants, type Dirent } from 'fs';
import type { FileHandle } from 'fs/promises';
import * as path from 'path';

/**
 * Registry agents that deliberately take over a built-in agent type, mapped to the
 * frontmatter `name:` they ship. The install checks each against the user's own agents.
 */
export const BUILTIN_OVERRIDE_AGENTS: ReadonlyMap<string, string> = new Map([['explore', 'Explore']]);

/** Bytes read from the start of an agent file: enough for any frontmatter name line. */
export const FRONTMATTER_READ_BYTES = 4096;

/** Directory levels below the agents directory that the scan descends. */
export const MAX_AGENT_SCAN_DEPTH = 3;

/** Entries the scan inspects before it stops: a user directory is not an archive. */
export const MAX_AGENT_SCAN_ENTRIES = 500;

/** Frontmatter lines inspected for the name key. */
const MAX_FRONTMATTER_LINES = 60;

export type AgentOwnerScanError = {
  readonly kind: 'unreadable-root';
  readonly dir: string;
  readonly reason: string;
};

export type AgentOwnerScan =
  | { readonly ok: true; readonly value: string | undefined }
  | { readonly ok: false; readonly error: AgentOwnerScanError };

/**
 * The agent type a markdown file declares: the top-level `name:` key of its leading
 * `---` frontmatter block, unquoted. Undefined when the file has no closed frontmatter
 * block, no top-level `name:` key, or an empty value.
 *
 * Reads only the key Claude Code keys agents by. It is deliberately not a YAML parser:
 * a name written any other way (block scalar, flow mapping) reads as absent, so the
 * check errs toward installing rather than skipping.
 */
export function parseAgentType(head: string): string | undefined {
  const lines = head.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trimEnd() !== '---') return undefined;

  const limit = Math.min(lines.length, MAX_FRONTMATTER_LINES);
  for (let i = 1; i < limit; i++) {
    const line = lines[i];
    if (line.trimEnd() === '---') return undefined;
    const key = /^name[ \t]*:(.*)$/.exec(line);
    if (key === null) continue;
    return closesFrontmatter(lines, i + 1, limit) ? unquoteScalar(key[1]) : undefined;
  }
  return undefined;
}

/** True when a `---` line closes the block somewhere in `lines[from, limit)`. */
function closesFrontmatter(lines: readonly string[], from: number, limit: number): boolean {
  for (let i = from; i < limit; i++) {
    if (lines[i].trimEnd() === '---') return true;
  }
  return false;
}

function unquoteScalar(raw: string): string | undefined {
  const value = raw.trim();
  const quoted = /^(["'])(.*?)\1(?:[ \t]+#.*)?$/.exec(value);
  const text = quoted !== null ? quoted[2] : value.replace(/[ \t]+#.*$/, '');
  const trimmed = text.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * The first file under `agentsRoot`, outside `ownDir`, whose frontmatter declares
 * `agentType`: undefined when there is none.
 *
 * Bounded: descends at most {@link MAX_AGENT_SCAN_DEPTH} levels, inspects at most
 * {@link MAX_AGENT_SCAN_ENTRIES} entries and reads at most {@link FRONTMATTER_READ_BYTES}
 * bytes of any file. Symlinks, to files or directories, are never followed. A missing
 * agents directory means no owner; an unreadable root is an error outcome; an
 * unreadable entry below it is skipped. Entries are visited in sorted order, so the
 * answer does not depend on the filesystem's listing order.
 */
export async function findForeignAgentOwner(opts: {
  readonly agentsRoot: string;
  readonly ownDir: string;
  readonly agentType: string;
}): Promise<AgentOwnerScan> {
  const { agentsRoot, ownDir, agentType } = opts;
  const own = path.resolve(ownDir);
  let inspected = 0;

  const walk = async (dir: string, depth: number): Promise<string | undefined> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (depth === 0) throw err;
      return undefined;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      if (inspected >= MAX_AGENT_SCAN_ENTRIES) return undefined;
      inspected++;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (path.resolve(full) === own || depth >= MAX_AGENT_SCAN_DEPTH) continue;
        const found = await walk(full, depth + 1);
        if (found !== undefined) return found;
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      if (parseAgentType(await readHead(full)) === agentType) return full;
    }
    return undefined;
  };

  try {
    return { ok: true, value: await walk(agentsRoot, 0) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, value: undefined };
    return {
      ok: false,
      error: { kind: 'unreadable-root', dir: agentsRoot, reason: err instanceof Error ? err.message : String(err) },
    };
  }
}

/** The first {@link FRONTMATTER_READ_BYTES} bytes of a file as text; '' when it cannot be read. */
async function readHead(file: string): Promise<string> {
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const buffer = Buffer.alloc(FRONTMATTER_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, FRONTMATTER_READ_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString('utf-8');
  } catch {
    return '';
  } finally {
    await handle?.close().catch(() => { /* nothing to recover: the read is already settled */ });
  }
}
