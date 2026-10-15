/**
 * tests/fixtures/forbidden-argv.ts
 *
 * THE list of spellings that skip a permission check, select the skip-all mode or
 * pre-approve tools without limiting a path. It is data only and registers no test,
 * so any test file may import it:
 *
 *   - tests/eager-memory-refresh.test.ts — no argv form the memory worker passes to
 *     `claude -p` carries one
 *   - tests/guards/no-permission-skip-in-hooks.test.ts — no file under
 *     src/assets/scripts/hooks/ spells one
 *
 * Both read this one array, so the argv check and the source check cannot drift apart.
 */

export const FORBIDDEN_ARGV = [
  '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions', 'bypassPermissions', '--allowedTools',
] as const;
