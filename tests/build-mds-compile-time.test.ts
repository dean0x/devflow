/**
 * Compile-time guard for the MDS reference modules.
 *
 * WHAT THIS HOLDS SHUT
 *
 * `@mdscript/mds`'s resolver deep-copies the captured scope of a SELECTIVE
 * import (`@import { a, b } from "./_mcp.mds"`), and then snapshots the whole
 * set of captured functions once more per `@define` in the importing module. The
 * imported graph is therefore copied once per define: two modules that
 * selectively imported 8 names from `_mcp.mds` and 7 from `_common.mds` went
 * from tens of milliseconds to ~4.6 SECONDS each, which roughly doubled
 * `npm run build:mds` (~4 s → ~10 s).
 *
 * That is invisible locally and fatal in CI: a vitest run spawns ~52 full builds
 * (tests/build-mds-generator-hosts.test.ts and tests/build-mds.test.ts, plus the
 * memoised `buildCommittedTree` in tests/helpers.ts), and on a 2-core runner a
 * single build then exceeded the 60 s `spawnSync` timeout. CI run 35472010050
 * failed exactly there, as three unrelated-looking ETIMEDOUTs. The fix is the
 * ALIAS import form (`@import "./_mcp.mds" as mcp`), whose captures are shallow;
 * it changes lookup, not expansion, so the emitted bytes are unchanged.
 *
 * Nothing about that failure names its cause, so this file makes the cause the
 * thing that goes red. It measures rather than greps: a future import form with
 * the same cliff, or a resolver regression in a dependency bump, is caught by
 * the budget even though neither would trip a syntax check.
 *
 * READS ONLY. Every compile here is in-process (`compileFile` returns the output
 * and writes nothing) and the seeded probe is written to a temp directory — the
 * repo's own src/ and dist/ are never touched, so this file cannot repair or
 * corrupt a tree a parallel vitest worker is reading (avoids PF-055).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { init, compileFile } from '@mdscript/mds';
import { MDS_REFERENCE_MODULES, MDS_REFERENCE_PARTIALS } from './fixtures/mds-manifest.js';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Per-module compile budget, in milliseconds.
 *
 * Measured on the shipped sources: `_mcp` ~1 ms, `_github` ~13 ms, `_jira` and
 * `_linear` ~22 ms each. The cliff this guard exists for is ~4,600 ms per
 * module. 1,500 ms sits ~60× above the measurement — room for a loaded 2-core
 * CI runner and for the modules to keep growing — and ~3× below the cliff, so
 * the failure mode it names is the only one it can report.
 */
const COMPILE_BUDGET_MS = 1_500;

/** Every `.mds` under src/assets/mds/, module and partial alike, repo-relative. */
const REFERENCE_SOURCES: readonly string[] = [
  ...MDS_REFERENCE_MODULES,
  ...MDS_REFERENCE_PARTIALS,
];

/** Compile one repo-relative source in-process and return its output and elapsed ms. */
async function timeCompile(relPath: string): Promise<{ output: string; ms: number }> {
  const started = Date.now();
  const result = await compileFile(path.join(ROOT, relPath), {});
  return { output: result.output, ms: Date.now() - started };
}

/**
 * Named collector: the measurements that blew the budget, as report lines.
 *
 * Separated from the measuring so the known-bad probe below can drive it with a
 * seeded row — a collector that quietly stopped reporting would otherwise leave
 * every arm here green over any measurement at all.
 */
export function collectOverBudget(
  measurements: readonly { readonly label: string; readonly ms: number }[],
  budgetMs: number,
): string[] {
  return measurements
    .filter(m => m.ms > budgetMs)
    .map(m => `${m.label}: ${m.ms} ms (budget ${budgetMs} ms)`);
}

/**
 * Rewrite a module's ALIAS imports back into the SELECTIVE form, faithfully.
 *
 * Used only by the known-bad probe. The imported names are read off the call
 * sites (`{alias.name(`) rather than listed here, so the probe reconstructs
 * whatever the module actually uses and cannot drift out of step with it.
 *
 * `only` restricts the rewrite to the named aliases. The probe rewrites the
 * `_mcp.mds` import alone: the cliff is exponential in the imported graph
 * (PF-073), so rewriting EVERY import made the probe's own cost grow with each
 * define `_common.mds` gained — at 13 exports (#359) it no longer finished inside
 * its 120 s timeout, although the shipped alias build compiles in ~40 ms. One
 * selective import still lands two orders of magnitude over the alias form and
 * over the budget, which is all the probe has to show.
 */
export function toSelectiveImports(source: string, only?: ReadonlySet<string>): string {
  const aliasToModule = new Map<string, string>();
  for (const m of source.matchAll(/^@import\s+"(\.\/[^"]+)"\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/gm)) {
    if (only === undefined || only.has(m[2])) aliasToModule.set(m[2], m[1]);
  }

  const namesByAlias = new Map<string, Set<string>>();
  for (const m of source.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\(/g)) {
    const [, alias, name] = m;
    if (!aliasToModule.has(alias)) continue;
    const seen = namesByAlias.get(alias) ?? new Set<string>();
    seen.add(name);
    namesByAlias.set(alias, seen);
  }

  let out = source;
  for (const [alias, module] of aliasToModule) {
    const names = [...(namesByAlias.get(alias) ?? new Set<string>())].sort();
    out = out.replace(
      new RegExp(String.raw`^@import\s+"${module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\s+as\s+${alias}\s*$`, 'm'),
      `@import { ${names.join(', ')} } from "${module}"`,
    );
    out = out.replaceAll(`{${alias}.`, '{');
  }
  return out;
}

describe('MDS reference modules compile well under the define-capture cliff', () => {
  let tmpDir: string;

  beforeAll(async () => {
    await init();
    // Warm the addon before anything is timed, so no measurement below is
    // charged for one-time lazy initialisation. `_mcp.mds` is the cheapest
    // module on the roster (it imports nothing, ~1 ms), and it IS timed later —
    // a warm-up outside the roster would be a second module to keep in step for
    // no gain, and the first timed measurement would pay the initialisation
    // this call absorbs.
    await compileFile(path.join(ROOT, 'src/assets/mds/tracker/_mcp.mds'), {});
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devflow-mds-time-'));
  }, 120_000);

  afterAll(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('the roster this ranges over is real (PF-018)', () => {
    expect(REFERENCE_SOURCES.length, 'an empty roster measures nothing').toBeGreaterThan(0);
    expect(
      REFERENCE_SOURCES,
      'the tool-call provider modules are the ones that carry the heavy import graph — ' +
      'a roster that has lost them is measuring only the cheap modules',
    ).toEqual(expect.arrayContaining([
      'src/assets/mds/tracker/_jira.mds',
      'src/assets/mds/tracker/_linear.mds',
    ]));
  });

  it('every reference module compiles inside the budget', async () => {
    const measurements: { label: string; ms: number }[] = [];
    for (const relPath of REFERENCE_SOURCES) {
      const { ms } = await timeCompile(relPath);
      measurements.push({ label: relPath, ms });
    }

    const over = collectOverBudget(measurements, COMPILE_BUDGET_MS);
    expect(
      over,
      `MDS module(s) over the compile budget:\n  ${over.join('\n  ')}\n\n` +
      `This is almost always the resolver's define-capture cliff: a SELECTIVE import ` +
      `(\`@import { a, b } from "./x.mds"\`) captures each named function by deep copy, and the ` +
      `captured set is snapshotted again per \`@define\` in the importing module. Convert the ` +
      `import to the ALIAS form (\`@import "./x.mds" as x\`, call sites \`{x.name()}\`): the ` +
      `emitted bytes are identical and the resolve cost stops compounding. A build this slow ` +
      `does not fail locally — it times the ~52 build-spawning suites out on a 2-core CI runner ` +
      `(run 35472010050), where it reads as an unrelated spawnSync ETIMEDOUT.`,
    ).toEqual([]);
  }, 120_000);

  it('known-bad probe: the same collector reports an over-budget measurement', () => {
    expect(
      collectOverBudget(
        [{ label: 'seed/_fast.mds', ms: 5 }, { label: 'seed/_slow.mds', ms: COMPILE_BUDGET_MS + 1 }],
        COMPILE_BUDGET_MS,
      ),
      'a seeded over-budget module must be reported',
    ).toEqual([`seed/_slow.mds: ${COMPILE_BUDGET_MS + 1} ms (budget ${COMPILE_BUDGET_MS} ms)`]);
  });

  it('known-bad probe: the pre-fix selective-import spelling is over the budget, and far slower', async () => {
    // The cliff proved rather than asserted. The probe REBUILDS the selective
    // form from the shipped module, compiles both, and requires: same bytes
    // (so the two spellings are genuinely interchangeable and the fix cost
    // nothing), and a compile time that the budget arm above would have caught.
    const shippedRel = 'src/assets/mds/tracker/_jira.mds';
    const shipped = await fs.readFile(path.join(ROOT, shippedRel), 'utf8');
    const selective = toSelectiveImports(shipped, new Set(['mcp']));

    expect(
      selective,
      'the probe rewrote nothing — the shipped module no longer uses alias imports, so this ' +
      'probe is inert and the budget arm above is unproven',
    ).not.toBe(shipped);
    expect(selective, 'the rewrite must produce the selective import form').toMatch(
      /^@import \{ [^}]+ \} from "\.\/_mcp\.mds"$/m,
    );

    const trackerDir = path.join(ROOT, 'src', 'assets', 'mds', 'tracker');
    for (const entry of await fs.readdir(trackerDir)) {
      if (entry.endsWith('.mds')) {
        await fs.copyFile(path.join(trackerDir, entry), path.join(tmpDir, entry));
      }
    }
    const probePath = path.join(tmpDir, '_jira.mds');
    await fs.writeFile(probePath, selective, 'utf8');

    const alias = await timeCompile(shippedRel);
    const probeStarted = Date.now();
    const probeOut = (await compileFile(probePath, {})).output;
    const probeMs = Date.now() - probeStarted;

    expect(
      probeOut,
      'alias and selective imports must emit the same bytes — if they do not, the speed-up was ' +
      'bought with a content change and the byte-equality claim in the module headers is false',
    ).toBe(alias.output);

    expect(
      collectOverBudget([{ label: 'probe/_jira.mds', ms: probeMs }], COMPILE_BUDGET_MS),
      `the selective-import spelling compiled in ${probeMs} ms, inside the ${COMPILE_BUDGET_MS} ms ` +
      `budget. Either the resolver no longer deep-copies per define (in which case this guard and ` +
      `the alias imports it protects can go) or the budget has been raised past the failure it ` +
      `names. Do not raise it to make this green.`,
    ).toHaveLength(1);

    expect(
      probeMs,
      `the selective form (${probeMs} ms) must be dramatically slower than the alias form ` +
      `(${alias.ms} ms) — a probe that is merely a little slower is measuring noise, not the cliff`,
    ).toBeGreaterThan(Math.max(alias.ms, 1) * 10);
  }, 120_000);
});
