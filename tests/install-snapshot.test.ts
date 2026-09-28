/**
 * Machine-wide regression net (#388, epic #387 PR1): install snapshots, round
 * trips, the installed-hook matrix, and the golden generator.
 *
 * Each in-process config is installed ONCE, in `beforeAll`, into its own sandbox
 * by the BUILT CLI (`npm run build` first) and re-initialised with the same argv,
 * then:
 * - TP-2: the baseline and post-init walks, settings.json, manifest and repo
 *   config.json equal `tests/fixtures/golden/install-snapshot-{config}.txt`;
 * - TP-5: a second init with the same argv changes nothing the snapshot records —
 *   AC-3's `(none)`, which every install golden's re-init section also carries;
 * - TP-6: a non-interactive `uninstall` leaves exactly the golden's keep list;
 * - TP-7 (github only): every installed hook runs in four locations, one test per
 *   hook and location, against `hook-matrix.txt`.
 * TP-8 runs the generator itself into a temp `--out-dir`.
 *
 * Capture, normalisation and rendering live in `install-snapshot-helpers.ts`, the
 * module `scripts/update-golden.ts install-snapshot` writes the goldens through;
 * its header carries D-SNAPSHOT-SANDBOX, D-SNAPSHOT-NORMALISE, D-SNAPSHOT-SCOPE and
 * D-HOOK-MATRIX. A mismatch here means install behaviour changed: fix the source,
 * or — when the change is intended — regenerate in a fixture-only `test(snapshot):`
 * commit whose PR body justifies each hunk.
 *
 * D-SPAWN-BUDGET: PR1 allows 12 CLI spawns across the unit suite. This file spends
 * 9 — init, re-init and uninstall for github and jira-hipaa in-process, and the
 * same three for all-off inside TP-8's generator run — plus 32 hook spawns.
 * `all-off` has no in-process describe: TP-8 regenerates exactly that config and
 * compares the WHOLE file byte-for-byte, so its TP-2, TP-5 and TP-6 claims are all
 * proven there, through the generator's own path, for no extra spawn.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { ROOT, loadGolden, requireBuiltCli } from './helpers.js'
import {
  HOOK_LOCATIONS, HOOK_MATRIX_CONFIG, HOOK_MATRIX_GOLDEN, INSTALL_CONFIGS, SKIPPED_HOOKS, SUBPROCESS_TIMEOUT_MS,
  REINIT_HEADING, UNINSTALL_HEADINGS, baselineSections, buildNormaliser, captureBaseline, captureInstall, captureUninstall,
  cellHeading, diffTree, findConfig, lineDiff, installGoldenName, installedHooks, matrixNormaliser, normaliseText,
  parseCellHeading, parseGolden, pathSlug, readPackageVersion, readSandbox, removeSandbox, renderManifest,
  renderReinitDiff, renderSettings, runCliOk, runHookCell, skippedCellBody, snapshotNormaliser, createSandbox,
  type Baseline, type HookLocation, type InstallConfig, type InstalledHook, type Normaliser, type Sandbox,
  type Section, type TreeState,
} from './install-snapshot-helpers.js'

requireBuiltCli()

const VERSION = readPackageVersion()
const GOLDENS_DIR = path.join(ROOT, 'tests', 'fixtures', 'golden')
/** The repo's own tsx, never `npx tsx` (see tests/goldens/github-status-lines.test.ts). */
const TSX_BIN = path.join(ROOT, 'node_modules', '.bin', 'tsx')
/** The config TP-8 regenerates: the cheapest install, and the one only TP-8 covers (D-SPAWN-BUDGET). */
const GENERATOR_CONFIG = 'all-off'

/**
 * The hook matrix golden, read at collection time: its cells declare the per-cell
 * tests below. The first matrix test proves the cell set equals the installed hooks
 * crossed with the four locations, so a hook added to or dropped from settings.json
 * fails by name instead of silently going unrun.
 */
const MATRIX = parseGolden(loadGolden(HOOK_MATRIX_GOLDEN))

function expectSections(sections: readonly Section[], golden: ReadonlyMap<string, string>): void {
  for (const s of sections) expect(s.body, `## ${s.heading}`).toBe(golden.get(s.heading))
}

describe('snapshot normaliser (TP-3)', () => {
  it('maps a sandbox path in its logical and realpath forms, and in its log slug', () => {
    const real = mkdtempSync(path.join(os.tmpdir(), 'devflow-normalise-'))
    const link = `${real}-link`
    try {
      symlinkSync(real, link)
      const n = buildNormaliser({ '<SANDBOX>': link }, VERSION, ['<SANDBOX>'])
      const resolved = realpathSync(link)
      const text = `${link}/a ${resolved}/b logs/${pathSlug(resolved)}-repo logs/${pathSlug(link)}-wt`
      expect(normaliseText(text, n)).toBe('<SANDBOX>/a <SANDBOX>/b logs/<SANDBOX>-repo logs/<SANDBOX>-wt')
    } finally {
      rmSync(link, { force: true })
      rmSync(real, { recursive: true, force: true })
    }
  })

  it('maps a nested path to its own token before its parent\'s', () => {
    const n = buildNormaliser({ '<SANDBOX>': '/sandbox', '<HOME>': '/sandbox/home' }, VERSION)
    expect(normaliseText('/sandbox/home/.claude /sandbox/repo', n)).toBe('<HOME>/.claude <SANDBOX>/repo')
  })

  it('maps ISO timestamps, with or without milliseconds or an offset', () => {
    const n = buildNormaliser({}, VERSION)
    expect(normaliseText('2026-09-27T21:11:01.985Z 2026-09-27T21:11:01Z 2026-09-27T21:11:01+02:00', n))
      .toBe('<TIMESTAMP> <TIMESTAMP> <TIMESTAMP>')
  })

  it('renders a release-bumped manifest identically once package.json carries the same bump (PF-079)', () => {
    const manifest = (version: string): string =>
      JSON.stringify({ version, installedAt: '2026-09-27T21:11:01.985Z', features: { hud: true } })
    const today = renderManifest(manifest(VERSION), buildNormaliser({}, VERSION))
    expect(renderManifest(manifest('99.0.0'), buildNormaliser({}, '99.0.0'))).toBe(today)
    expect(today).toContain('"version": "<VERSION>"')
  })

  it('leaves a manifest version that is not the package version in the open', () => {
    const rendered = renderManifest(JSON.stringify({ version: '0.0.1' }), buildNormaliser({}, VERSION))
    expect(rendered).toContain('"version": "0.0.1"')
  })

  it('collapses permissions.deny to its entry count and keeps every other key', () => {
    const raw = JSON.stringify({ permissions: { deny: ['a', 'b', 'c'], allow: ['x'] }, tui: 'fullscreen' })
    expect(JSON.parse(renderSettings(raw, buildNormaliser({}, VERSION)))).toEqual({
      permissions: { deny: '<3 entries>', allow: ['x'] },
      tui: 'fullscreen',
    })
  })
})

describe('re-init line diff', () => {
  it('reports nothing for identical input', () => {
    expect(lineDiff(['a', 'b'], ['a', 'b'])).toEqual([])
  })

  it('reports a changed line as a removal then an addition under the hunk\'s first-install line', () => {
    expect(lineDiff(['a', '- x', 'c'], ['a', 'x x', 'c'])).toEqual(['@@ line 2 @@', '- - x', '+ x x'])
  })

  it('opens one hunk per separated run of changes', () => {
    expect(lineDiff(['a', 'b', 'c', 'd'], ['a', 'B', 'c', 'd', 'e'])).toEqual(['@@ line 2 @@', '- b', '+ B', '@@ line 5 @@', '+ e'])
  })
})

function describeHookMatrix(sandbox: () => Sandbox): void {
  describe('hook matrix (TP-7)', () => {
    let hooks: InstalledHook[] = []
    let baseline: TreeState = new Map()
    let n: Normaliser
    const executed = new Map<HookLocation, string[]>(HOOK_LOCATIONS.map(l => [l, []]))

    beforeAll(() => {
      const sb = sandbox()
      hooks = installedHooks(readFileSync(path.join(sb.home, '.claude', 'settings.json'), 'utf-8'))
      baseline = readSandbox(sb)
      n = matrixNormaliser(sb, VERSION)
    })

    it('the golden holds one cell per installed hook per location, in settings order', () => {
      expect([...MATRIX.keys()]).toEqual(HOOK_LOCATIONS.flatMap(location => hooks.map(hook => cellHeading(location, hook))))
      for (const location of HOOK_LOCATIONS) {
        for (const hook of hooks.filter(h => h.name in SKIPPED_HOOKS)) {
          expect(MATRIX.get(cellHeading(location, hook))).toBe(skippedCellBody(hook))
        }
      }
    })

    for (const [heading, body] of MATRIX) {
      const { location, name } = parseCellHeading(heading)
      const cell = name in SKIPPED_HOOKS ? it.skip : it
      cell(heading, () => {
        const hook = hooks.find(h => cellHeading(location, h) === heading)
        if (!hook) throw new Error(`no installed hook matches the golden cell '${heading}'`)
        const rendered = runHookCell(sandbox(), baseline, hook, location, n)
        executed.get(location)?.push(name)
        expect(rendered).toBe(body)
      }, SUBPROCESS_TIMEOUT_MS)
    }

    it('each location runs every hook but one, and the one skipped is memory-worker', () => {
      for (const location of HOOK_LOCATIONS) {
        const ran = executed.get(location) ?? []
        expect(ran, location).toHaveLength(hooks.length - 1)
        expect(hooks.map(h => h.name).filter(name => !ran.includes(name)), location).toEqual(['memory-worker'])
      }
    })

    it('leaves the sandbox exactly as the install left it', () => {
      expect(diffTree(baseline, readSandbox(sandbox()))).toEqual({ added: [], modified: [], removed: [] })
    })
  })
}

function describeConfig(config: InstallConfig): void {
  describe(`install snapshot: ${config.name}`, () => {
    const golden = parseGolden(loadGolden(installGoldenName(config)))
    let sb: Sandbox | undefined
    let n: Normaliser
    let baseline: Baseline
    let first: Section[] = []
    let second: Section[] = []
    const sandbox = (): Sandbox => {
      if (!sb) throw new Error(`the ${config.name} sandbox was not created — see the beforeAll failure`)
      return sb
    }

    beforeAll(() => {
      sb = createSandbox()
      n = snapshotNormaliser(sb, VERSION)
      baseline = captureBaseline(sb)
      runCliOk(sb, ['init', ...config.initArgs])
      first = captureInstall(sb, n)
      runCliOk(sb, ['init', ...config.initArgs])
      second = captureInstall(sb, n)
    }, 2 * SUBPROCESS_TIMEOUT_MS)

    afterAll(() => removeSandbox(sb))

    it('the baseline and the install match the golden (TP-2)', () => {
      const sections = [...baselineSections(baseline, n), ...first]
      expect([...golden.keys()]).toEqual([...sections.map(s => s.heading), REINIT_HEADING, ...UNINSTALL_HEADINGS])
      expectSections(sections, golden)
    })

    it('a second init with the same argv changes nothing the snapshot records (TP-5, AC-3)', () => {
      expect(renderReinitDiff(first, second)).toBe('(none)')
    })

    if (config.name === HOOK_MATRIX_CONFIG) describeHookMatrix(sandbox)

    it('a non-interactive uninstall restores the baseline apart from the golden keep list (TP-6)', () => {
      const sb = sandbox()
      runCliOk(sb, ['uninstall'])
      expectSections(captureUninstall(sb, baseline, n), golden)
    }, SUBPROCESS_TIMEOUT_MS)
  })
}

for (const config of INSTALL_CONFIGS.filter(c => c.name !== GENERATOR_CONFIG)) describeConfig(config)

describe('re-init goldens (TP-5, AC-3)', () => {
  it.each(INSTALL_CONFIGS.map(c => c.name))('install-snapshot-%s records no re-init difference', (name) => {
    expect(parseGolden(loadGolden(installGoldenName(findConfig(name)))).get(REINIT_HEADING)).toBe('(none)')
  })
})

function hashGoldens(): Record<string, string> {
  return Object.fromEntries(readdirSync(GOLDENS_DIR).sort().map(name => [
    name, createHash('sha256').update(readFileSync(path.join(GOLDENS_DIR, name))).digest('hex'),
  ]))
}

describe('install-snapshot generator (TP-8)', () => {
  it(`regenerates ${GENERATOR_CONFIG} into --out-dir only, byte-for-byte equal to its live golden, and leaves every live golden untouched`, () => {
    const config = findConfig(GENERATOR_CONFIG)
    const before = hashGoldens()
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'devflow-golden-'))
    try {
      const result = spawnSync(
        TSX_BIN,
        ['scripts/update-golden.ts', 'install-snapshot', '--only', config.name, '--out-dir', outDir],
        { cwd: ROOT, encoding: 'utf-8', timeout: 3 * SUBPROCESS_TIMEOUT_MS, env: { ...process.env } },
      )
      if (result.error) throw result.error
      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0)
      expect(readdirSync(outDir)).toEqual([installGoldenName(config)])
      expect(readFileSync(path.join(outDir, installGoldenName(config)), 'utf-8'))
        .toBe(loadGolden(installGoldenName(config)))
      expect(hashGoldens()).toEqual(before)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 3 * SUBPROCESS_TIMEOUT_MS)
})
