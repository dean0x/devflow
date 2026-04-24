import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { isClaudeCliAvailable } from '../utils/cli.js';
import { getGitRoot } from '../utils/git.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @internal */
const _require = createRequire(import.meta.url);

interface FeatureKbModule {
  listKBs: (worktreePath: string) => Array<{ slug: string; name: string; category: string; directories: string[]; lastUpdated: string }>;
  checkAllStaleness: (worktreePath: string) => Record<string, { stale: boolean; changedFiles: string[] }>;
  checkStaleness: (worktreePath: string, slug: string) => { stale: boolean; changedFiles: string[] };
  findOverlapping: (worktreePath: string, changedFiles: string[]) => string[];
  removeEntry: (worktreePath: string, slug: string) => void;
  validateSlug: (slug: string) => void;
}

// dist/cli/commands/kb.js → ../../.. → project root (where scripts/ lives)
const featureKb: FeatureKbModule = _require(
  path.join(__dirname, '..', '..', '..', 'scripts', 'hooks', 'lib', 'feature-kb.cjs')
);

/** Tools passed to `claude -p` when spawning the KB Builder agent. */
const KB_AGENT_TOOLS = 'Read,Grep,Glob,Write,Bash';

/**
 * Validate a KB slug and exit with an error message if invalid.
 * Centralises the repeated try/catch pattern across create/refresh/remove.
 */
function exitOnInvalidSlug(slug: string): void {
  try {
    featureKb.validateSlug(slug);
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

/**
 * Get the git root for the current directory, or cwd if not in a git repo.
 */
async function getWorktreePath(): Promise<string> {
  return (await getGitRoot()) ?? process.cwd();
}

export const kbCommand = new Command('kb')
  .description('Manage per-feature knowledge bases');

// ---------------------------------------------------------------------------
// devflow kb list
// ---------------------------------------------------------------------------

kbCommand
  .command('list')
  .description('List all feature KBs with staleness status')
  .action(async () => {
    p.intro(color.cyan('Feature Knowledge Bases'));

    const worktreePath = await getWorktreePath();
    const kbs = featureKb.listKBs(worktreePath);
    const staleness = featureKb.checkAllStaleness(worktreePath);

    if (kbs.length === 0) {
      p.log.info(
        'No feature KBs found. KBs are created automatically during planning, or manually via ' +
        color.cyan('devflow kb create <slug>') + '.'
      );
      p.outro('');
      return;
    }

    p.log.info(`Found ${kbs.length} feature KB${kbs.length === 1 ? '' : 's'} in ${color.dim(worktreePath)}`);
    console.log('');

    for (const kb of kbs) {
      const staleInfo = staleness[kb.slug];
      const isStale = staleInfo?.stale ?? false;
      const statusBadge = isStale ? color.yellow('[STALE]') : color.green('[current]');

      console.log(`  ${color.bold(kb.name)} ${statusBadge}`);
      console.log(`    slug:       ${color.dim(kb.slug)}`);
      console.log(`    category:   ${color.dim(kb.category)}`);
      console.log(`    updated:    ${color.dim(kb.lastUpdated)}`);
      console.log(`    dirs:       ${color.dim(kb.directories.join(', '))}`);
      if (isStale && staleInfo.changedFiles.length > 0) {
        const shown = staleInfo.changedFiles.slice(0, 3).join(', ');
        const overflow = staleInfo.changedFiles.length > 3 ? ` +${staleInfo.changedFiles.length - 3} more` : '';
        console.log(`    changed:    ${color.yellow(shown)}${overflow}`);
      }
      console.log('');
    }

    p.outro(`Run ${color.cyan('devflow kb check')} to see staleness details`);
  });

// ---------------------------------------------------------------------------
// devflow kb check
// ---------------------------------------------------------------------------

kbCommand
  .command('check')
  .description('Check all KBs for staleness')
  .action(async () => {
    p.intro(color.cyan('KB Staleness Check'));

    const worktreePath = await getWorktreePath();
    const kbs = featureKb.listKBs(worktreePath);
    const staleness = featureKb.checkAllStaleness(worktreePath);

    if (kbs.length === 0) {
      p.log.info('No feature KBs found.');
      p.outro('');
      return;
    }

    let staleCount = 0;

    for (const kb of kbs) {
      const staleInfo = staleness[kb.slug];
      const isStale = staleInfo?.stale ?? false;
      if (isStale) {
        staleCount++;
        p.log.warn(`${kb.name} (${kb.slug}) is stale`);
        for (const f of staleInfo.changedFiles.slice(0, 5)) {
          console.log(`    ${color.yellow('•')} ${f}`);
        }
        if (staleInfo.changedFiles.length > 5) {
          console.log(`    ${color.yellow('•')} ...and ${staleInfo.changedFiles.length - 5} more`);
        }
      } else {
        p.log.success(`${kb.name} (${kb.slug}) is current`);
      }
    }

    if (staleCount > 0) {
      p.outro(`${staleCount} KB${staleCount === 1 ? '' : 's'} need refresh. Run: ${color.cyan('devflow kb refresh')}`);
    } else {
      p.outro('All KBs are current');
    }
  });

// ---------------------------------------------------------------------------
// devflow kb create <slug>
// ---------------------------------------------------------------------------

kbCommand
  .command('create <slug>')
  .description('Create a new KB via claude -p exploration')
  .action(async (slug: string) => {
    exitOnInvalidSlug(slug);
    p.intro(color.cyan(`Create Feature KB: ${slug}`));

    if (!isClaudeCliAvailable()) {
      p.log.error('claude CLI not found on PATH. Install Claude Code first.');
      process.exit(1);
    }

    const worktreePath = await getWorktreePath();

    const name = await p.text({
      message: 'Feature name (human-readable)',
      placeholder: 'e.g., CLI Command System',
      validate: (v) => (v.trim().length < 3 ? 'Name must be at least 3 characters' : undefined),
    });
    if (p.isCancel(name)) { p.cancel('Cancelled.'); return; }

    const directoriesRaw = await p.text({
      message: 'Directories (comma-separated, e.g., src/cli/commands/,src/cli/utils/)',
      placeholder: 'src/feature/',
      validate: (v) => (v.trim().length === 0 ? 'Enter at least one directory' : undefined),
    });
    if (p.isCancel(directoriesRaw)) { p.cancel('Cancelled.'); return; }

    const directories = (directoriesRaw as string).split(',').map((d) => d.trim()).filter(Boolean);
    const dirList = directories.map((d) => `"${d}"`).join(', ');

    const s = p.spinner();
    s.start('Creating KB...');

    const prompt = [
      `You are the KB Builder agent. Create a feature knowledge base for the following area:`,
      ``,
      `FEATURE_SLUG: ${slug}`,
      `FEATURE_NAME: ${name as string}`,
      `DIRECTORIES: [${dirList}]`,
      `WORKTREE_PATH: ${worktreePath}`,
      ``,
      `Follow the devflow:feature-kb skill's 4-phase process:`,
      `1. Scan the directories to identify key files and entry points`,
      `2. Extract architecture, conventions, patterns, integration points`,
      `3. Distill into actionable cross-cutting knowledge`,
      `4. Write .features/${slug}/KNOWLEDGE.md with all required sections`,
      ``,
      `Then run: node scripts/hooks/lib/feature-kb.cjs update-index "${worktreePath}" \\`,
      `  --slug="${slug}" --name="${name as string}" \\`,
      `  --directories='${JSON.stringify(directories)}' \\`,
      `  --referencedFiles='[]' \\`,
      `  --category="component-patterns" \\`,
      `  --createdBy="devflow-kb"`,
      ``,
      `Create the directory if needed. Report KB_STATUS when done.`,
    ].join('\n');

    try {
      execFileSync('claude', [
        '-p', prompt,
        '--allowedTools', KB_AGENT_TOOLS,
        '--dangerously-skip-permissions',
      ], {
        cwd: worktreePath,
        stdio: 'pipe',
        encoding: 'utf8',
      });
      s.stop('KB created successfully');
      p.log.success(`KB written to .features/${slug}/KNOWLEDGE.md`);
    } catch (err) {
      s.stop('KB creation failed');
      p.log.error(`claude exited with error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    p.outro(`Run ${color.cyan(`devflow kb list`)} to see all KBs`);
  });

// ---------------------------------------------------------------------------
// devflow kb refresh [slug]
// ---------------------------------------------------------------------------

kbCommand
  .command('refresh [slug]')
  .description('Refresh stale KB(s). Omit slug to refresh all stale KBs.')
  .action(async (slug?: string) => {
    p.intro(color.cyan(slug ? `Refresh KB: ${slug}` : 'Refresh Stale KBs'));

    if (slug) exitOnInvalidSlug(slug);

    if (!isClaudeCliAvailable()) {
      p.log.error('claude CLI not found on PATH. Install Claude Code first.');
      process.exit(1);
    }

    const worktreePath = await getWorktreePath();

    // Determine which slugs to refresh
    let slugsToRefresh: string[];
    if (slug) {
      slugsToRefresh = [slug];
    } else {
      const staleness = featureKb.checkAllStaleness(worktreePath);
      slugsToRefresh = Object.entries(staleness)
        .filter(([, info]) => info.stale)
        .map(([s]) => s);
    }

    if (slugsToRefresh.length === 0) {
      p.log.success('No stale KBs found — everything is current.');
      p.outro('');
      return;
    }

    p.log.info(`Refreshing ${slugsToRefresh.length} KB${slugsToRefresh.length === 1 ? '' : 's'}: ${slugsToRefresh.join(', ')}`);

    for (const kbSlug of slugsToRefresh) {
      const s = p.spinner();
      s.start(`Refreshing ${kbSlug}...`);

      const staleInfo = featureKb.checkStaleness(worktreePath, kbSlug);
      const kbPath = path.join(worktreePath, '.features', kbSlug, 'KNOWLEDGE.md');
      let existingContent = '';
      try {
        existingContent = await fs.readFile(kbPath, 'utf8');
      } catch { /* new KB */ }

      const prompt = [
        `You are the KB Builder agent refreshing a stale feature knowledge base.`,
        ``,
        `FEATURE_SLUG: ${kbSlug}`,
        `WORKTREE_PATH: ${worktreePath}`,
        `CHANGED_FILES: ${JSON.stringify(staleInfo.changedFiles)}`,
        ``,
        existingContent ? `EXISTING_KB:\n${existingContent}` : '',
        ``,
        `Instructions:`,
        `- Update the stale sections based on CHANGED_FILES`,
        `- Preserve any manually added content`,
        `- Do not regenerate from scratch`,
        `- Write the updated KB to .features/${kbSlug}/KNOWLEDGE.md`,
        `- Run update-index to refresh lastUpdated timestamp`,
      ].filter(Boolean).join('\n');

      try {
        execFileSync('claude', [
          '-p', prompt,
          '--allowedTools', KB_AGENT_TOOLS,
          '--dangerously-skip-permissions',
        ], {
          cwd: worktreePath,
          stdio: 'pipe',
          encoding: 'utf8',
        });
        s.stop(`${kbSlug} refreshed`);
      } catch (err) {
        s.stop(`${kbSlug} refresh failed`);
        p.log.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    p.outro('Refresh complete');
  });

// ---------------------------------------------------------------------------
// devflow kb remove <slug>
// ---------------------------------------------------------------------------

kbCommand
  .command('remove <slug>')
  .description('Remove a KB and its index entry')
  .action(async (slug: string) => {
    exitOnInvalidSlug(slug);
    p.intro(color.cyan(`Remove KB: ${slug}`));

    const confirmed = await p.confirm({
      message: `Remove KB '${slug}' and its KNOWLEDGE.md? This cannot be undone.`,
      initialValue: false,
    });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Removal cancelled.');
      return;
    }

    const worktreePath = await getWorktreePath();

    try {
      featureKb.removeEntry(worktreePath, slug);
      p.log.success(`KB '${slug}' removed`);
    } catch (err) {
      p.log.error(`Failed to remove KB: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    p.outro('Done');
  });
