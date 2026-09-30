/**
 * settings-atomic-write — every write of a Claude settings file in `src/` goes
 * through `writeSettingsFileAtomic` (D-SETTINGS-ATOMIC, src/core/fs-atomic.ts).
 *
 * The rule: a write call (`writeFile`, `writeFileSync`, `appendFile`,
 * `appendFileSync`, `writeFileAtomicExclusive`, `copyFile`) whose target argument
 * names a settings path is a violation. Managed settings (`managed-settings.json`,
 * written through sudo) are a different file with their own writer and are not
 * matched.
 *
 * What a green run does NOT prove (PF-064): the matcher reads the target argument
 * as spelled, so a settings path held in a variable whose name does not say
 * "settings" is not seen. Every current writer names it `settingsPath` or
 * `userSettingsPath…`; the reach arm below fails by name if that stops being true.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import * as path from 'path';
import { ROOT, walkFiles } from '../helpers.js';

const WRITE_CALL_RE = /\b(writeFile|writeFileSync|appendFile|appendFileSync|writeFileAtomicExclusive|copyFile)\(\s*([^,()]+)/g;
const SETTINGS_TARGET_RE = /settings/i;
const MANAGED_TARGET_RE = /managed/i;

interface Source { readonly rel: string; readonly content: string }

function collectNonAtomicSettingsWrites(sources: readonly Source[]): string[] {
  const offenders: string[] = [];
  for (const { rel, content } of sources) {
    for (const m of content.matchAll(WRITE_CALL_RE)) {
      const target = m[2].trim();
      if (SETTINGS_TARGET_RE.test(target) && !MANAGED_TARGET_RE.test(target)) {
        offenders.push(`${rel}: ${m[1]}(${target}, …)`);
      }
    }
  }
  return offenders;
}

const SRC = path.join(ROOT, 'src');
const CORPUS: Source[] = walkFiles(SRC, f => f.endsWith('.ts'))
  .map(abs => ({ rel: path.relative(ROOT, abs), content: readFileSync(abs, 'utf-8') }))
  .filter(s => s.rel !== path.join('src', 'core', 'fs-atomic.ts'));

describe('D-SETTINGS-ATOMIC: settings.json is written only through writeSettingsFileAtomic', () => {
  it('reaches the known settings writers', () => {
    const writers = CORPUS.filter(s => s.content.includes('writeSettingsFileAtomic(')).map(s => s.rel);
    for (const rel of ['src/cli/commands/debug.ts', 'src/cli/commands/init.ts', 'src/cli/commands/uninstall.ts', 'src/targets/claude-code/post-install.ts']) {
      expect(writers, `${rel} no longer calls writeSettingsFileAtomic`).toContain(rel);
    }
  });

  it('no other write call targets a settings path', () => {
    expect(collectNonAtomicSettingsWrites(CORPUS)).toEqual([]);
  });

  it.each([
    ['a plain writeFile', "await fs.writeFile(settingsPath, updated, 'utf-8');"],
    ['a sync write', 'writeFileSync(userSettingsPath, body);'],
    ['the non-following atomic writer', 'await writeFileAtomicExclusive(settingsPath, merged);'],
  ])('red probe: %s is reported', (_label, line) => {
    expect(collectNonAtomicSettingsWrites([{ rel: 'probe.ts', content: line }])).toHaveLength(1);
  });

  it('the helper itself, and managed settings, are not reported', () => {
    expect(collectNonAtomicSettingsWrites([{ rel: 'probe.ts', content: [
      'await writeSettingsFileAtomic(settingsPath, updated);',
      "await fs.writeFile(managedSettingsPath, content, 'utf-8');",
    ].join('\n') }])).toEqual([]);
  });
});
