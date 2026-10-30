import { promises as fs } from 'fs';
import * as path from 'path';
import { LEGACY_COMMAND_NAMES, LEGACY_RULE_NAMES } from '../../core/plugins.js';
import { isUnrealFolder, type LinkReport } from '../../targets/claude-code/linked-folder.js';

/** How many legacy files {@link sweepLegacyDevflowFiles} removed from each folder. */
export interface LegacySweepResult {
  staleCommandsRemoved: number;
  staleRulesRemoved: number;
}

/**
 * Whether the sweep may remove files from `dir`: the install did not refuse it, and `lstat` shows a
 * real folder or nothing. `readdir` and `rm` of a path below a link act on the folder it points to.
 */
async function mayRemoveFrom(report: Pick<LinkReport, 'refusedFolders'>, dir: string): Promise<boolean> {
  return !report.refusedFolders.includes(dir) && !(await isUnrealFolder(dir));
}

/**
 * Remove the files that earlier releases installed into `commands/devflow` and `rules/devflow` and
 * that no release installs now: the legacy command and rule names, and every `*-teams.md` command.
 * Runs on every install shape, since the full install's pre-clean covers only a full install.
 *
 * A folder the install refused (`report.refusedFolders`) or that is a link now is skipped whole: the
 * sweep reads and removes nothing there, and the folder it points to is left as it is. Never throws.
 *
 * @param opts.legacyCommands - Legacy command names; defaults to the registry list.
 * @param opts.legacyRules - Legacy rule names; defaults to the registry list.
 */
export async function sweepLegacyDevflowFiles(opts: {
  claudeDir: string;
  report: Pick<LinkReport, 'refusedFolders'>;
  legacyCommands?: readonly string[];
  legacyRules?: readonly string[];
}): Promise<LegacySweepResult> {
  const { claudeDir, report } = opts;
  const legacyCommands = opts.legacyCommands ?? LEGACY_COMMAND_NAMES;
  const legacyRules = opts.legacyRules ?? LEGACY_RULE_NAMES;
  const result: LegacySweepResult = { staleCommandsRemoved: 0, staleRulesRemoved: 0 };

  const commandsDir = path.join(claudeDir, 'commands', 'devflow');
  if (await mayRemoveFrom(report, commandsDir)) {
    for (const legacy of legacyCommands) {
      try {
        await fs.rm(path.join(commandsDir, `${legacy}.md`));
        result.staleCommandsRemoved++;
      } catch { /* absent — expected for most entries */ }
    }
    // Orphaned *-teams.md workflow command variants left by the Agent Teams refactor. None is ever
    // re-installed, so a blanket sweep is safe on any install type.
    try {
      for (const entry of await fs.readdir(commandsDir)) {
        if (!entry.endsWith('-teams.md')) continue;
        try {
          await fs.rm(path.join(commandsDir, entry));
          result.staleCommandsRemoved++;
        } catch { /* already gone */ }
      }
    } catch { /* commands folder absent — nothing to sweep */ }
  }

  const rulesDir = path.join(claudeDir, 'rules', 'devflow');
  if (await mayRemoveFrom(report, rulesDir)) {
    for (const legacy of legacyRules) {
      try {
        await fs.rm(path.join(rulesDir, `${legacy}.md`));
        result.staleRulesRemoved++;
      } catch { /* absent — expected for most entries */ }
    }
  }

  return result;
}
