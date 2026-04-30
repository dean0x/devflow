/**
 * devflow kb — per-feature knowledge base management.
 * Thin router that delegates each subcommand to its own module.
 */
import { Command } from 'commander';

import { handleToggle, addKbHook, removeKbHook, hasKbHook } from './toggle.js';
import { handleList } from './list.js';
import { handleCheck } from './check.js';
import { handleCreate } from './create.js';
import { handleRefresh } from './refresh.js';
import { handleRemove } from './remove.js';

// Re-export hook utilities and sidecar helpers for callers that import from kb.js
export { addKbHook, removeKbHook, hasKbHook };
export type { SidecarData } from '../../utils/sidecar.js';
export { readSidecar } from '../../utils/sidecar.js';

export const kbCommand = new Command('kb')
  .description('Manage per-feature knowledge bases')
  .option('--enable', 'Enable per-feature knowledge bases')
  .option('--disable', 'Disable per-feature knowledge bases')
  .option('--status', 'Show KB feature status')
  .action(async (options: { enable?: boolean; disable?: boolean; status?: boolean }) => {
    await handleToggle(options);
  });

kbCommand
  .command('list')
  .description('List all feature KBs with staleness status')
  .action(async () => {
    await handleList();
  });

kbCommand
  .command('check')
  .description('Check all KBs for staleness')
  .action(async () => {
    await handleCheck();
  });

kbCommand
  .command('create <slug>')
  .description('Create a new KB via claude -p exploration')
  .action(async (slug: string) => {
    await handleCreate(slug);
  });

kbCommand
  .command('refresh [slug]')
  .description('Refresh stale KB(s). Omit slug to refresh all stale KBs.')
  .action(async (slug?: string) => {
    await handleRefresh(slug);
  });

kbCommand
  .command('remove <slug>')
  .description('Remove a KB and its index entry')
  .action(async (slug: string) => {
    await handleRemove(slug);
  });
