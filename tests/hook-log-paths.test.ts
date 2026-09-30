/**
 * D-LOG-DIR-CAP, hook side: `log-paths`' devflow_log_dir caps ~/.devflow/logs
 * whenever it creates a new per-cwd log folder, so a machine that never re-runs
 * `devflow init` (which holds the full, exact prune in src/core/hook-log-dirs.ts)
 * still stops accumulating folders.
 *
 * Every run sources the real `log-paths` under a temp HOME built by `sandboxEnv`,
 * which refuses a real home before anything runs (PF-060). No `claude` is spawned.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import { existsSync, promises as fs, readFileSync, lstatSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { sandboxEnv } from './helpers.js'
import { MAX_HOOK_LOG_DIRS } from '../src/core/hook-log-dirs.js'

const LOG_PATHS = path.resolve(import.meta.dirname, '..', 'src', 'assets', 'scripts', 'hooks', 'log-paths')
const LOG_PATHS_SOURCE = readFileSync(LOG_PATHS, 'utf-8')

/** One shell constant from log-paths, e.g. `_DF_MAX_HOOK_LOG_DIRS=200`. */
function shellConstant(name: string): number {
  const match = new RegExp(`^${name}=(\\d+)$`, 'm').exec(LOG_PATHS_SOURCE)
  if (!match) throw new Error(`log-paths defines no ${name}=<number>`)
  return Number(match[1])
}

const BATCH = shellConstant('_DF_LOG_DIRS_PRUNED_PER_CALL')

let home: string
let logs: string

/** Run devflow_log_dir for `cwd` exactly as a hook does, and return the dir it printed. */
function logDirFor(cwd: string): string {
  const r = spawnSync('bash', ['-c', 'source "$1" && devflow_log_dir "$2"', 'log-paths-test', LOG_PATHS, cwd], {
    env: sandboxEnv(home),
    encoding: 'utf-8',
    timeout: 30_000,
  })
  if (r.error) throw r.error
  expect(r.status, r.stderr).toBe(0)
  return r.stdout.trim()
}

/**
 * Seed `count` log folders named old-0000…, each holding one log file. Folder i is
 * (count - i) minutes old, so old-0000 is the oldest.
 */
async function seedDirs(count: number, prefix = 'old'): Promise<string[]> {
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    const name = `${prefix}-${String(i).padStart(4, '0')}`
    const dir = path.join(logs, name)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, '.capture-turn.log'), 'x\n')
    const at = new Date(Date.now() - (count - i) * 60_000)
    await fs.utimes(path.join(dir, '.capture-turn.log'), at, at)
    await fs.utimes(dir, at, at)
    names.push(name)
  }
  return names
}

async function logFolders(): Promise<string[]> {
  const entries = await fs.readdir(logs, { withFileTypes: true })
  return entries.filter(e => e.isDirectory()).map(e => e.name).sort()
}

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'df-log-paths-home-'))
  logs = path.join(home, '.devflow', 'logs')
  await fs.mkdir(logs, { recursive: true })
})

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true })
})

describe('D-LOG-DIR-CAP: log-paths shares its cap with init', () => {
  it('the hook cap equals MAX_HOOK_LOG_DIRS', () => {
    expect(shellConstant('_DF_MAX_HOOK_LOG_DIRS')).toBe(MAX_HOOK_LOG_DIRS)
  })

  it('removes a bounded batch per call, smaller than the cap', () => {
    expect(BATCH).toBeGreaterThan(0)
    expect(BATCH).toBeLessThan(MAX_HOOK_LOG_DIRS)
  })
})

describe('D-LOG-DIR-CAP: devflow_log_dir caps the log folders when it creates one', () => {
  it('trims to the cap, oldest first, and keeps the folder it just created', async () => {
    const extra = 5
    const seeded = await seedDirs(MAX_HOOK_LOG_DIRS + extra)

    const created = logDirFor('/work/new-project')

    expect(path.basename(created)).toBe('work-new-project')
    const left = await logFolders()
    expect(left).toHaveLength(MAX_HOOK_LOG_DIRS)
    expect(left).toContain('work-new-project')
    // The new folder takes one slot, so the extra + 1 oldest go.
    for (const gone of seeded.slice(0, extra + 1)) expect(left).not.toContain(gone)
    expect(left).toContain(seeded[extra + 1])
  }, 30_000)

  it('removes at most one batch in a call, leaving a larger backlog to later calls', async () => {
    const backlog = BATCH + 30
    await seedDirs(MAX_HOOK_LOG_DIRS + backlog)

    logDirFor('/work/first')
    expect(await logFolders()).toHaveLength(MAX_HOOK_LOG_DIRS + backlog + 1 - BATCH)

    logDirFor('/work/second')
    expect(await logFolders()).toHaveLength(MAX_HOOK_LOG_DIRS)
  }, 30_000)

  it('does nothing when the folder already exists (the common path)', async () => {
    const seeded = await seedDirs(MAX_HOOK_LOG_DIRS + 5)
    const existing = seeded[0]

    const dir = logDirFor(`/${existing}`)

    expect(path.basename(dir)).toBe(existing)
    expect(await logFolders()).toHaveLength(MAX_HOOK_LOG_DIRS + 5)
  }, 30_000)

  it('does nothing at or below the cap', async () => {
    await seedDirs(MAX_HOOK_LOG_DIRS - 1)

    logDirFor('/work/new-project')

    expect(await logFolders()).toHaveLength(MAX_HOOK_LOG_DIRS)
  }, 30_000)

  it('never touches files at the logs root or symbolic links, and does not count them', async () => {
    const seeded = await seedDirs(MAX_HOOK_LOG_DIRS)
    const ancient = new Date(Date.now() - 365 * 24 * 3_600_000)
    await fs.writeFile(path.join(logs, 'proxy.log'), 'proxy\n')
    await fs.utimes(path.join(logs, 'proxy.log'), ancient, ancient)
    const target = await fs.mkdtemp(path.join(os.tmpdir(), 'df-log-paths-target-'))
    try {
      await fs.writeFile(path.join(target, 'keep.txt'), 'keep\n')
      await fs.symlink(target, path.join(logs, 'linked'))
      await fs.lutimes(path.join(logs, 'linked'), ancient, ancient)

      logDirFor('/work/new-project')

      expect(readFileSync(path.join(logs, 'proxy.log'), 'utf-8')).toBe('proxy\n')
      expect(lstatSync(path.join(logs, 'linked')).isSymbolicLink()).toBe(true)
      expect(readFileSync(path.join(target, 'keep.txt'), 'utf-8')).toBe('keep\n')
      // Only folders count: 200 seeded + the new one is one over, so exactly the oldest folder goes.
      const left = await logFolders()
      expect(left).not.toContain(seeded[0])
      expect(left).toContain(seeded[1])
    } finally {
      await fs.rm(target, { recursive: true, force: true })
    }
  }, 30_000)

  it('ranks a folder by its newest log, not its own mtime', async () => {
    const seeded = await seedDirs(MAX_HOOK_LOG_DIRS + 1)
    // The oldest folder's log was just appended to: an append leaves the folder mtime alone.
    const busy = path.join(logs, seeded[0])
    const folderMtime = (await fs.stat(busy)).mtime
    await fs.appendFile(path.join(busy, '.capture-turn.log'), 'fresh\n')
    await fs.utimes(busy, folderMtime, folderMtime)

    logDirFor('/work/new-project')

    const left = await logFolders()
    expect(left).toContain(seeded[0])
    expect(left).not.toContain(seeded[1])
  }, 30_000)

  it('creates the folder with owner-only permissions whether or not it prunes', async () => {
    await seedDirs(MAX_HOOK_LOG_DIRS + 1)

    const dir = logDirFor('/work/new-project')

    expect(existsSync(dir)).toBe(true)
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700)
  }, 30_000)
})
