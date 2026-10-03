/**
 * Init location invariance (#406 item 19; audit appendix 09-tests.md, strategy item 4).
 *
 * D-INIT-LOCATION-INVARIANCE: `devflow init` installs one machine, wherever it is
 * run from. The BUILT CLI (`npm run build` first) runs the same non-interactive
 * init — the github install-snapshot argv — once per location in INIT_LOCATIONS,
 * each in a fresh sandbox, and:
 *   - the machine side (every entry init adds under HOME, settings.json and the
 *     manifest, normalised) is identical to the repo-root run's, in every location;
 *   - the per-repository writes land only at the checkout's toplevel, and are the
 *     same set there as at the repo root — none in a subdirectory, none outside git,
 *     none at a HOME that is itself a repository (D-INIT-NOT-HOME).
 *
 * The space sits in the REPOSITORY path only: a HOME containing a space is not a
 * supported layout (the hooks' settings.json commands carry HOME unquoted), so the
 * matrix does not claim it. Every spawn runs under a temp HOME checked by
 * `sandboxEnv` / `assertTempHome`; a fake `claude` is first on PATH.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'fs'
import * as path from 'path'
import { requireBuiltCli, sandboxEnv } from './helpers.js'
import { assertTempHome } from './setup/home-isolation.js'
import {
  SUBPROCESS_TIMEOUT_MS, buildNormaliser, createSandbox, diffTree, excludeGitAndLogs, findConfig, normaliseText,
  readPackageVersion, readTree, removeSandbox, renderManifest, renderSettings, renderTree, sandboxChildEnv,
  type Exclude, type Sandbox,
} from './install-snapshot-helpers.js'

const CLI = requireBuiltCli()
const INIT_ARGS = findConfig('github').initArgs

/** Where init runs, and where its per-repository files belong. */
interface LocationLayout {
  /** The directory init runs in. */
  readonly cwd: string
  /** The HOME the child sees (a symlink in one location). */
  readonly home: string
  /** The checkout toplevel the per-repository files belong at, or null for none. */
  readonly toplevel: string | null
}

interface InitLocation {
  readonly name: string
  readonly layout: (sb: Sandbox) => LocationLayout
}

const GIT_IDENTITY = [
  '-c', 'user.name=Devflow Location', '-c', 'user.email=location@example.invalid',
  '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main',
] as const

function git(sb: Sandbox, cwd: string, args: readonly string[]): void {
  const r = spawnSync('git', [...GIT_IDENTITY, ...args], {
    cwd, env: sandboxEnv(sb.home, { GIT_CONFIG_NOSYSTEM: '1' }), encoding: 'utf-8', timeout: SUBPROCESS_TIMEOUT_MS,
  })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} exited ${r.status}: ${r.stderr}`)
}

const SPACED_REPO = 'repo with space'
const HOME_LINK = 'home-link'

/** The locations, in report order; `root` is the reference every other one is held to. */
export const INIT_LOCATIONS: readonly InitLocation[] = [
  { name: 'root', layout: sb => ({ cwd: sb.repo, home: sb.home, toplevel: sb.repo }) },
  { name: 'subdirectory', layout: sb => ({ cwd: sb.sub, home: sb.home, toplevel: sb.repo }) },
  { name: 'linked worktree', layout: sb => ({ cwd: sb.worktree, home: sb.home, toplevel: sb.worktree }) },
  { name: 'non-git directory', layout: sb => ({ cwd: sb.nonGit, home: sb.home, toplevel: null }) },
  {
    name: 'repository path with a space',
    layout: sb => {
      const repo = path.join(sb.root, SPACED_REPO)
      mkdirSync(repo, { recursive: true })
      writeFileSync(path.join(repo, 'README.md'), '# spaced fixture\n')
      git(sb, repo, ['init', '-q'])
      git(sb, repo, ['add', '-A'])
      git(sb, repo, ['commit', '-q', '-m', 'fixture'])
      return { cwd: repo, home: sb.home, toplevel: repo }
    },
  },
  {
    name: 'symlinked HOME',
    layout: sb => {
      const link = path.join(sb.root, HOME_LINK)
      symlinkSync(sb.home, link)
      return { cwd: sb.repo, home: link, toplevel: sb.repo }
    },
  },
  {
    name: 'repository rooted at HOME',
    layout: sb => {
      git(sb, sb.home, ['init', '-q'])
      return { cwd: sb.home, home: sb.home, toplevel: null }
    },
  },
]

interface LocationResult {
  readonly status: number | null
  readonly output: string
  /** Normalised machine side: HOME additions, settings.json, manifest. */
  readonly machine: string
  /** Every path init added or changed outside HOME, sandbox-relative. */
  readonly repoWrites: readonly string[]
  /** The toplevel, sandbox-relative, or null. */
  readonly toplevel: string | null
}

/** The non-HOME half of the sandbox: HOME (and its link) belong to the machine side. */
const excludeHome: Exclude = (rel, name) => name === '.git' || rel === 'home' || rel === HOME_LINK

function runLocation(location: InitLocation, sb: Sandbox): LocationResult {
  const layout = location.layout(sb)
  assertTempHome(layout.home)
  const homeBefore = readTree(sb.home, excludeGitAndLogs, false)
  const restBefore = readTree(sb.root, excludeHome, true)

  const r = spawnSync(process.execPath, [CLI, 'init', ...INIT_ARGS], {
    cwd: layout.cwd,
    env: sandboxChildEnv(sb, { HOME: layout.home, USERPROFILE: layout.home }),
    encoding: 'utf-8',
    timeout: SUBPROCESS_TIMEOUT_MS,
  })
  if (r.error) throw r.error

  const n = buildNormaliser({ '<HOME>': layout.home, '<SANDBOX>': sb.root }, readPackageVersion(), ['<SANDBOX>'])
  const homeAfter = readTree(sb.home, excludeGitAndLogs, false)
  const added = new Map([...homeAfter].filter(([rel]) => !homeBefore.has(rel)))
  const settings = path.join(sb.home, '.claude', 'settings.json')
  const manifest = path.join(sb.home, '.devflow', 'manifest.json')
  const machine = [
    '## HOME additions', renderTree(added, n),
    '## settings.json', existsSync(settings) ? renderSettings(readFileSync(settings, 'utf-8'), n) : '(absent)',
    '## manifest.json', existsSync(manifest) ? renderManifest(readFileSync(manifest, 'utf-8'), n) : '(absent)',
  ].join('\n')

  const { added: restAdded, modified, removed } = diffTree(restBefore, readTree(sb.root, excludeHome, true))
  return {
    status: r.status,
    output: normaliseText(`${r.stdout ?? ''}${r.stderr ?? ''}`, n),
    machine,
    repoWrites: [...restAdded, ...modified, ...removed.map(rel => `(removed) ${rel}`)].sort(),
    toplevel: layout.toplevel === null ? null : path.relative(sb.root, layout.toplevel),
  }
}

/** The writes under `toplevel`, relative to it, and every write outside it. */
function relocate(writes: readonly string[], toplevel: string | null): { inside: string[]; outside: string[] } {
  if (toplevel === null) return { inside: [], outside: [...writes] }
  const prefix = `${toplevel}/`
  return {
    inside: writes.filter(w => w.startsWith(prefix)).map(w => w.slice(prefix.length)),
    outside: writes.filter(w => !w.startsWith(prefix)),
  }
}

describe('init location invariance (D-INIT-LOCATION-INVARIANCE)', () => {
  const sandboxes: Sandbox[] = []
  const results = new Map<string, LocationResult>()

  beforeAll(() => {
    for (const location of INIT_LOCATIONS) {
      const sb = createSandbox()
      sandboxes.push(sb)
      results.set(location.name, runLocation(location, sb))
    }
  }, INIT_LOCATIONS.length * 2 * SUBPROCESS_TIMEOUT_MS)

  afterAll(() => {
    for (const sb of sandboxes) removeSandbox(sb)
  })

  const result = (name: string): LocationResult => {
    const r = results.get(name)
    if (!r) throw new Error(`no init result for '${name}' — see the beforeAll failure`)
    return r
  }

  it('the matrix stays registered in numeric-floors.json', () => {
    expect(INIT_LOCATIONS.length).toBeGreaterThanOrEqual(7)
    expect(INIT_LOCATIONS[0].name).toBe('root')
  })

  it('the repo-root run installs the machine and writes the per-repository files (the reference)', () => {
    const root = result('root')
    expect(root.status, root.output).toBe(0)
    expect(root.machine).toContain('.devflow/manifest.json')
    expect(relocate(root.repoWrites, root.toplevel).inside).toContain('.devflow/config.json')
    expect(relocate(root.repoWrites, root.toplevel).outside).toEqual([])
  })

  for (const location of INIT_LOCATIONS.slice(1)) {
    describe(location.name, () => {
      it('init succeeds', () => {
        const r = result(location.name)
        expect(r.status, r.output).toBe(0)
      })

      it('the machine side is identical to the repo-root run\'s', () => {
        expect(result(location.name).machine).toBe(result('root').machine)
      })

      it('per-repository files land only at the checkout toplevel, the same set as at the repo root', () => {
        const r = result(location.name)
        const root = result('root')
        const { inside, outside } = relocate(r.repoWrites, r.toplevel)
        expect(outside, 'writes outside the checkout toplevel').toEqual([])
        expect(inside).toEqual(r.toplevel === null ? [] : relocate(root.repoWrites, root.toplevel).inside)
      })
    })
  }
})
