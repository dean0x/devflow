/**
 * tests/evidence-policy/cli-seam.test.ts
 *
 * Suite for the CLI's view of the evidence policy (PR3a phase C):
 * src/core/evidence-policy.ts (the require() seam onto the package's own
 * resolve-evidence-policy.cjs) and its two call sites in
 * src/cli/commands/compliance.ts (`--status`, and the `--enable`/`--set`
 * suggestion).
 *
 * Shape of the suite:
 *   - the loader: it resolves join(scriptsDir(), …) — the PACKAGE copy — shape-
 *     checks the surface, and returns a Result for a missing or unusable module;
 *   - the pure helpers, fixtured from the real resolver's own output (PF-043);
 *   - source guards, each with a named collector, a non-empty corpus and a
 *     known-bad probe (PF-064): no TS parser copy, no fs write API in the seam, and
 *     no write call anywhere in src/**\/*.ts whose path argument reaches
 *     .devflow/policy.json (D-POLICY-NO-WRITE, applies ADR-024);
 *   - the built CLI end to end, from a temp HOME and a temp cwd (PF-060), with gh
 *     faked by the scripted shim so no run touches the network.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { scriptsDir } from '../../src/core/assets.js';
import { normalizeComplianceFeature } from '../../src/core/compliance.js';
import {
  EVIDENCE_POLICY_MODULE_SURFACE,
  RESOLVER_SCRIPT_NAME,
  evidencePolicyStatusLine,
  evidencePolicySuggestion,
  formatEvidencePolicyStatus,
  formatEvidencePolicyUnavailable,
  loadEvidencePolicyModule,
  type EvidencePolicyModule,
  type EvidencePolicyResolution,
} from '../../src/core/evidence-policy.js';
import { ROOT, makeManifest, requireBuiltCli, walkFiles } from '../helpers.js';
import {
  ARGV,
  RESOLVER_SCRIPT,
  buildScriptedShim,
  createFakeBin,
  realGit,
  scenarioCalls,
  scopedEnv,
  scriptedExec,
  type ExecFn,
  type FakeBin,
  type ScriptedShim,
} from './scripted-shim.js';

const NODE_REQUIRE = createRequire(import.meta.url);

/** resolve() with its injected exec — the CLI never passes one, the tests do. */
type ResolveWithDeps = (
  opts: { dir: string; compliance?: unknown },
  deps?: { exec?: ExecFn },
) => EvidencePolicyResolution;

/** The .cjs's parsePolicyBytes — used only to prove the suggestion's bytes are a valid file. */
type ParsePolicyBytes = (buf: Uint8Array) => { kind: string; policy?: string };

const REQUIRED_BODY = '{"version":1,"evidencePolicy":"required"}\n';
const STANDARD_BODY = '{"version":1,"evidencePolicy":"standard"}\n';

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'df-policy-cli-'));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function loadedModule(): EvidencePolicyModule {
  const loaded = loadEvidencePolicyModule();
  if (!loaded.ok) throw new Error(`fixture: the package resolver did not load (${loaded.error.kind})`);
  return loaded.value;
}

// ---------------------------------------------------------------------------
// The loader (D-POLICY-CJS-SEAM)
// ---------------------------------------------------------------------------

describe('loadEvidencePolicyModule — the package copy, shape-checked, never a throw', () => {
  it('loads join(scriptsDir(), resolve-evidence-policy.cjs) — the package copy, not ~/.devflow/scripts', () => {
    const packageCopy = path.join(scriptsDir(), RESOLVER_SCRIPT_NAME);
    expect(packageCopy).toBe(RESOLVER_SCRIPT);
    expect(packageCopy.startsWith(path.join(ROOT, 'src', 'assets', 'scripts'))).toBe(true);

    const loaded = loadEvidencePolicyModule();
    expect(loaded.ok).toBe(true);
    // The same module object the require cache holds for that exact path.
    expect(loaded.ok && loaded.value).toBe(NODE_REQUIRE(packageCopy));
  });

  it('every surface key is exported by the .cjs with the declared kind', () => {
    const raw = NODE_REQUIRE(RESOLVER_SCRIPT) as Record<string, unknown>;
    const keys = Object.keys(EVIDENCE_POLICY_MODULE_SURFACE);
    expect(keys.length).toBeGreaterThanOrEqual(9);
    for (const [key, kind] of Object.entries(EVIDENCE_POLICY_MODULE_SURFACE)) {
      const value = raw[key];
      switch (kind) {
        case 'function': expect(typeof value, key).toBe('function'); break;
        case 'string': expect(typeof value, key).toBe('string'); break;
        case 'regexp': expect(value, key).toBeInstanceOf(RegExp); break;
        case 'object': expect(typeof value === 'object' && value !== null, key).toBe(true); break;
        case 'string-array':
          expect(Array.isArray(value) && value.every(v => typeof v === 'string'), key).toBe(true);
          break;
        default: throw new Error(`unknown surface kind ${String(kind)}`);
      }
    }
  });

  it('the transcribed vocabularies match the .cjs (a new token forces the TS types to follow)', () => {
    const mod = loadedModule();
    expect([...mod.POLICIES]).toEqual(['required', 'standard']);
    expect([...mod.SOURCES]).toEqual(['file', 'worktree', 'default', 'invalid', 'error']);
    expect([...mod.WARNINGS]).toEqual(['remote-unavailable', 'invalid-file', 'raised-by-compliance', 'pr-changes-policy']);
    expect(Object.keys(mod.MECHANISM_INPUTS).sort()).toEqual(['required', 'standard']);
  });

  it('a directory without the script ⇒ Err not-found (no throw)', () => {
    const empty = fs.mkdtempSync(path.join(tmp, 'no-script-'));
    const loaded = loadEvidencePolicyModule(empty);
    expect(loaded.ok).toBe(false);
    expect(!loaded.ok && loaded.error.kind).toBe('not-found');
  });

  it('a script missing or mistyping surface keys ⇒ Err unusable naming each one', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'partial-'));
    fs.writeFileSync(
      path.join(dir, RESOLVER_SCRIPT_NAME),
      "'use strict';\nmodule.exports = { POLICIES: ['required', 'standard'], resolve: 'not a function' };\n",
    );
    const loaded = loadEvidencePolicyModule(dir);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.kind).toBe('unusable');
    expect(loaded.error.kind === 'unusable' && loaded.error.detail).toMatch(/resolve/);
    expect(loaded.error.kind === 'unusable' && loaded.error.detail).toMatch(/serializePolicy/);
    expect(loaded.error.kind === 'unusable' && loaded.error.detail).not.toMatch(/POLICIES/);
  });

  it('a script that throws while loading ⇒ Err unusable (no throw)', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'throws-'));
    fs.writeFileSync(path.join(dir, RESOLVER_SCRIPT_NAME), "'use strict';\nthrow new Error('boom');\n");
    const loaded = loadEvidencePolicyModule(dir);
    expect(loaded.ok).toBe(false);
    expect(!loaded.ok && loaded.error.kind).toBe('unusable');
  });

  it('a non-object export ⇒ Err unusable', () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'scalar-'));
    fs.writeFileSync(path.join(dir, RESOLVER_SCRIPT_NAME), "'use strict';\nmodule.exports = 42;\n");
    const loaded = loadEvidencePolicyModule(dir);
    expect(!loaded.ok && loaded.error.kind).toBe('unusable');
  });
});

// ---------------------------------------------------------------------------
// formatEvidencePolicyStatus / formatEvidencePolicyUnavailable
// ---------------------------------------------------------------------------

describe('formatEvidencePolicyStatus', () => {
  const inputs = { ISSUE_REQUIRED: true, APPLY_CONVENTIONS: true, REQUIRE_NON_AUTHOR_APPROVAL: true } as const;

  it.each([
    [{ policy: 'required', source: 'file', ref: 'main', warnings: [], inputs }, 'Evidence policy: required (source: file)'],
    [
      { policy: 'standard', source: 'default', ref: 'none', warnings: ['remote-unavailable'], inputs },
      'Evidence policy: standard (source: default) [warn: remote-unavailable]',
    ],
    [
      { policy: 'required', source: 'worktree', ref: 'none', warnings: ['remote-unavailable', 'raised-by-compliance'], inputs },
      'Evidence policy: required (source: worktree) [warn: remote-unavailable, raised-by-compliance]',
    ],
    [{ policy: 'required', source: 'error', ref: 'none', warnings: [], inputs }, 'Evidence policy: required (source: error)'],
  ] as const)('%j ⇒ %s', (r, expected) => {
    expect(formatEvidencePolicyStatus(r)).toBe(expected);
  });

  it('renders the real resolver output — a fail-closed resolution reads required (source: error)', () => {
    const resolve = loadedModule().resolve as ResolveWithDeps;
    const throwingExec: ExecFn = () => { throw new Error('spawn exploded'); };
    const r = resolve({ dir: tmp, compliance: null }, { exec: throwingExec });
    expect(formatEvidencePolicyStatus(r)).toBe('Evidence policy: required (source: error)');
  });

  it('renders the real resolver output — reachable remote file with a differing HEAD', () => {
    const root = fs.mkdtempSync(path.join(tmp, 'reachable-'));
    const { exec } = scriptedExec(scenarioCalls({
      root, defaultBranch: 'main', remote: { bytes: STANDARD_BODY }, head: 'absent',
    }));
    const resolve = loadedModule().resolve as ResolveWithDeps;
    const r = resolve({ dir: root, compliance: { enabled: false, frameworks: [] } }, { exec });
    expect(formatEvidencePolicyStatus(r)).toBe('Evidence policy: standard (source: file) [warn: pr-changes-policy]');
  });

  it('names the remedy for each loader failure kind', () => {
    expect(formatEvidencePolicyUnavailable({ kind: 'not-found', path: '/x' }))
      .toBe('Evidence policy: unavailable (resolver not found — reinstall devflow-kit)');
    expect(formatEvidencePolicyUnavailable({ kind: 'unusable', path: '/x', detail: 'resolve' }))
      .toBe('Evidence policy: unavailable (resolver failed to load — reinstall devflow-kit)');
  });
});

// ---------------------------------------------------------------------------
// evidencePolicyStatusLine — the --status composition
// ---------------------------------------------------------------------------

describe('evidencePolicyStatusLine', () => {
  it('a loader failure is the whole handling: one unavailable line', () => {
    expect(evidencePolicyStatusLine({ ok: false, error: { kind: 'not-found', path: '/x' } }, { dir: tmp, compliance: null }))
      .toBe('Evidence policy: unavailable (resolver not found — reinstall devflow-kit)');
  });

  it("passes the caller's dir and compliance state straight to resolve (no second manifest read)", () => {
    const calls: Array<{ dir: string; compliance?: unknown }> = [];
    const mod = loadedModule();
    const stub: EvidencePolicyModule = {
      ...mod,
      resolve: (opts) => {
        calls.push(opts);
        return { policy: 'standard', source: 'default', ref: 'none', warnings: [], inputs: mod.MECHANISM_INPUTS.standard };
      },
    };
    const state = { enabled: false, frameworks: ['soc2'] };
    const line = evidencePolicyStatusLine({ ok: true, value: stub }, { dir: '/some/repo', compliance: state });
    expect(line).toBe('Evidence policy: standard (source: default)');
    expect(calls).toHaveLength(1);
    expect(calls[0].dir).toBe('/some/repo');
    expect(calls[0].compliance).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// evidencePolicySuggestion — printed by --enable/--set, never written
// ---------------------------------------------------------------------------

describe('evidencePolicySuggestion — iff the compliance default is required', () => {
  const ROWS: ReadonlyArray<readonly [string, unknown]> = [
    ['enabled + [soc2]', { enabled: true, frameworks: ['soc2'] }],
    ['enabled + zero frameworks (binding: still required)', { enabled: true, frameworks: [] }],
    ['enabled + iso27001 alias', { enabled: true, frameworks: ['iso27001'] }],
    ['enabled + unknown id', { enabled: true, frameworks: ['foo'] }],
    ['disabled + [soc2]', { enabled: false, frameworks: ['soc2'] }],
    ['disabled + []', { enabled: false, frameworks: [] }],
    ['null', null],
    ['undefined', undefined],
    ['enabled as a string', { enabled: 'yes', frameworks: [] }],
    ['frameworks not an array', { enabled: true, frameworks: 'soc2' }],
  ];

  it.each(ROWS)('%s ⇒ suggestion iff normalizeComplianceFeature says enabled', (_label, state) => {
    const mod = loadedModule();
    const suggestion = evidencePolicySuggestion(state, mod);
    const expectRequired = normalizeComplianceFeature(state).enabled;
    expect(mod.complianceDefault(state)).toBe(expectRequired ? 'required' : 'standard');
    if (expectRequired) {
      expect(suggestion).not.toBeNull();
      expect(suggestion).toContain(REQUIRED_BODY);
    } else {
      expect(suggestion).toBeNull();
    }
  });

  it('the rows cover both outcomes, including enabled with zero frameworks', () => {
    const mod = loadedModule();
    const outcomes = ROWS.map(([, s]) => evidencePolicySuggestion(s, mod) !== null);
    expect(outcomes).toContain(true);
    expect(outcomes).toContain(false);
    expect(evidencePolicySuggestion({ enabled: true, frameworks: [] }, mod)).not.toBeNull();
  });

  it('names the file, where it goes, and that devflow never writes it', () => {
    const text = evidencePolicySuggestion({ enabled: true, frameworks: ['gdpr'] }, loadedModule()) ?? '';
    expect(text).toContain('.devflow/policy.json');
    expect(text).toContain('default branch');
    expect(text).toMatch(/devflow (?:never|does not) write/);
  });

  it('the suggested bytes are a valid policy file by the resolver\'s own parser', () => {
    const mod = loadedModule();
    const parse = (NODE_REQUIRE(RESOLVER_SCRIPT) as { parsePolicyBytes: ParsePolicyBytes }).parsePolicyBytes;
    for (const policy of mod.POLICIES) {
      const body = mod.serializePolicy(policy);
      expect(body).not.toBeNull();
      expect(parse(Buffer.from(body ?? ''))).toEqual({ kind: 'valid', policy });
    }
    const text = evidencePolicySuggestion({ enabled: true, frameworks: [] }, mod) ?? '';
    const jsonLine = text.split('\n').find(l => l.startsWith('{'));
    expect(jsonLine).toBeDefined();
    expect(parse(Buffer.from(`${jsonLine}\n`))).toEqual({ kind: 'valid', policy: 'required' });
  });

  it('a serializer that refuses ⇒ no suggestion (nothing half-formed is printed)', () => {
    const mod = loadedModule();
    expect(evidencePolicySuggestion({ enabled: true, frameworks: [] }, { ...mod, serializePolicy: () => null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Source guards (PF-064: named collector, non-empty corpus, known-bad probe)
// ---------------------------------------------------------------------------

interface SourceFile {
  readonly rel: string;
  readonly content: string;
}

/** src/**\/*.ts minus src/assets — the TypeScript the CLI is built from. */
function tsCorpus(): SourceFile[] {
  const srcRoot = path.join(ROOT, 'src');
  const assetsRoot = path.join(srcRoot, 'assets') + path.sep;
  return walkFiles(srcRoot, f => f.endsWith('.ts') && !f.startsWith(assetsRoot))
    .map(f => ({ rel: path.relative(ROOT, f), content: fs.readFileSync(f, 'utf8') }));
}

/** String literals first, so a `//` inside a string is never taken for a comment. */
const TOKEN_RE = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const isComment = (t: string): boolean => t.startsWith('//') || t.startsWith('/*');
const blank = (t: string): string => t.replace(/[^\n]/g, ' ');

/** Comments blanked (same length), string literals kept. */
function codeOf(src: string): string {
  return src.replace(TOKEN_RE, t => (isComment(t) ? blank(t) : t));
}

/** Comments AND string bodies blanked (same length) — for bracket and separator scans. */
function structureOf(src: string): string {
  return src.replace(TOKEN_RE, t => (isComment(t) ? blank(t) : t[0] + blank(t.slice(1, -1)) + t[t.length - 1]));
}

/** Longest extent a scan will walk from one site — keeps every scan bounded. */
const MAX_EXTENT = 40_000;

/** Index just past the bracket that closes the one at `open` in `structure`, or -1. */
function closeOf(structure: string, open: number): number {
  let depth = 0;
  for (let i = open; i < structure.length && i < open + MAX_EXTENT; i++) {
    const ch = structure[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Split an argument list (without its parens) at depth-0 commas; offsets index `structure`. */
function splitArgs(structure: string, from: number, to: number): Array<[number, number]> {
  const parts: Array<[number, number]> = [];
  let depth = 0;
  let start = from;
  for (let i = from; i < to; i++) {
    const ch = structure[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push([start, i]);
      start = i + 1;
    }
  }
  if (structure.slice(start, to).trim() !== '') parts.push([start, to]);
  return parts;
}

/** String-literal bodies in code (comments skipped). */
function literalBodies(code: string): string[] {
  return [...code.matchAll(TOKEN_RE)].map(m => m[0]).filter(t => !isComment(t)).map(t => t.slice(1, -1));
}

/**
 * A gitignore line naming the file — the carve-out pattern `!.devflow/policy.json`
 * or a `#` comment line of the managed block (post-install.ts). Neither is a path
 * a write could target.
 */
const isGitignoreLine = (body: string): boolean => /^\s*[!#]/.test(body);

/**
 * A literal that names the policy file as a PATH: it spells `policy.json`, is not
 * a gitignore line, and (template substitutions aside) holds no whitespace — prose
 * that merely mentions the file is not a path.
 */
function hasPolicyPathLiteral(code: string): boolean {
  return literalBodies(code).some(b =>
    b.includes('policy.json') && !isGitignoreLine(b) && !/\s/.test(b.replace(/\$\{[^}]*\}/g, 'x')));
}

/**
 * A literal that MENTIONS the file anywhere — the test for argv sinks, where a
 * shell command string or a git pathspec embeds it (`printf x > .devflow/policy.json`).
 */
function hasPolicyMention(code: string): boolean {
  return literalBodies(code).some(b => b.includes('policy.json') && !isGitignoreLine(b));
}

/** Every gitignore-line literal naming the file — proves the matcher reads, and exempts, the carve-out. */
function policyGitignoreLiterals(code: string): string[] {
  return literalBodies(code).filter(b => b.includes('policy.json') && isGitignoreLine(b));
}

const DECL_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]{1,200})?=(?![=>])|\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*[<(]|(?:^|[;{}])\s*([A-Za-z_$][\w$]*)\s*=(?![=>])/gm;

interface Definition {
  readonly name: string;
  readonly text: string;
}

/** Every binding in a file with the code text it binds (a declaration's initializer, a function's body). */
function collectDefinitions(src: string): Definition[] {
  const code = codeOf(src);
  const structure = structureOf(src);
  const defs: Definition[] = [];
  for (const m of structure.matchAll(DECL_RE)) {
    const name = m[1] ?? m[2] ?? m[3];
    const at = (m.index ?? 0) + m[0].length;
    let end: number;
    if (m[2] !== undefined) {
      const params = structure.indexOf('(', (m.index ?? 0));
      const paramsEnd = params === -1 ? -1 : closeOf(structure, params);
      const body = paramsEnd === -1 ? -1 : structure.indexOf('{', paramsEnd);
      end = body === -1 ? -1 : closeOf(structure, body);
    } else {
      end = -1;
      let depth = 0;
      for (let i = at; i < structure.length && i < at + MAX_EXTENT; i++) {
        const ch = structure[i];
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') {
          if (depth === 0) { end = i; break; }
          depth--;
        } else if (ch === ';' && depth === 0) { end = i; break; }
      }
    }
    defs.push({ name, text: code.slice(at, end === -1 ? Math.min(code.length, at + MAX_EXTENT) : end) });
  }
  return defs;
}

/** A whole-word matcher for any of `names`, or null for none. */
function namesRe(names: ReadonlySet<string>): RegExp | null {
  if (names.size === 0) return null;
  const alternation = [...names].map(n => n.replace(/\$/g, '\\$')).join('|');
  return new RegExp(`(?<![\\w$])(?:${alternation})(?![\\w$])`);
}

/** Names a file exports by declaration (`export const|function|class X`) or list (`export { X }`). */
function exportedNames(src: string): Set<string> {
  const code = codeOf(src);
  const names = new Set<string>();
  for (const m of code.matchAll(/\bexport\s+(?:default\s+)?(?:async\s+)?(?:const|let|var|class|function\s*\*?)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const local = part.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '');
      if (local !== '') names.add(local);
    }
  }
  return names;
}

/** Local names a file binds from named imports (`import { a, b as c } from …` ⇒ a, c). */
function importedNames(src: string): Set<string> {
  const code = codeOf(src);
  const names = new Set<string>();
  for (const m of code.matchAll(/\bimport\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const pieces = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
      const local = pieces[pieces.length - 1].trim();
      if (local !== '') names.add(local);
    }
  }
  return names;
}

/** The fixed point inside one file: every binding that reaches a policy-path literal or a tainted name. */
function taintWithin(defs: readonly Definition[], seed: Iterable<string>): Set<string> {
  const tainted = new Set(seed);
  for (let round = 0; round <= defs.length; round++) {
    const aliasRe = namesRe(tainted);
    let grew = false;
    for (const d of defs) {
      if (tainted.has(d.name)) continue;
      if (hasPolicyPathLiteral(d.text) || (aliasRe !== null && aliasRe.test(d.text))) {
        tainted.add(d.name);
        grew = true;
      }
    }
    if (!grew) break;
  }
  return tainted;
}

/**
 * Per file, the names whose binding reaches a policy-path literal — directly, or
 * through another such name. Taint stays inside the file that binds it and
 * crosses files only as an EXPORTED name that another file IMPORTS, so a common
 * local name (`block`, `content`) in one file never taints its namesake in
 * another. Bounded: each outer round must taint a new export.
 */
function collectPolicyAliases(files: readonly SourceFile[]): Map<string, Set<string>> {
  const infos = files.map(f => ({
    rel: f.rel,
    defs: collectDefinitions(f.content),
    exported: exportedNames(f.content),
    imported: importedNames(f.content),
  }));
  const taintedExports = new Set<string>();
  const byFile = new Map<string, Set<string>>();
  for (let round = 0; round <= infos.length; round++) {
    let grew = false;
    for (const info of infos) {
      const seed = [...info.imported].filter(n => taintedExports.has(n));
      const tainted = taintWithin(info.defs, seed);
      byFile.set(info.rel, tainted);
      for (const n of tainted) {
        if (info.exported.has(n) && !taintedExports.has(n)) {
          taintedExports.add(n);
          grew = true;
        }
      }
    }
    if (!grew) break;
  }
  return byFile;
}

/**
 * The sink surface (PF-064: derived from what can write, not from offenders seen):
 * every fs write/move/copy/link/open verb, every project write helper by verb
 * family (writeManifest, writeFileAtomicExclusive, appendLines, copyDirectory …),
 * and every child-process spawn (a shell or git argv can write a file too).
 */
const SINK_RE = /(?<![\w$])((?:[A-Za-z_$][\w$]*\.)*)(write[\w$]*|append[\w$]*|rename[\w$]*|copy[\w$]*|cp|cpSync|symlink|symlinkSync|link|linkSync|createWriteStream|truncate|truncateSync|open|openSync|spawn|spawnSync|exec|execSync|execFile|execFileSync)\s*\(/g;
const TWO_PATH_VERB = /^(?:rename|copy|cp|symlink|link)/;
const ARGV_VERB = /^(?:spawn|exec)/;
const FS_QUALIFIER = /(?:^|\.)(?:fs|fsp|promises)\.$/;

interface SinkSite {
  readonly rel: string;
  readonly callee: string;
  /** Spawn/exec: the argv (any literal mention counts); every other verb: the path argument(s). */
  readonly argv: boolean;
  readonly pathArgs: readonly string[];
}

/** Every sink call in a file with the argument text(s) that name what it writes. */
function collectSinkSites(file: SourceFile): SinkSite[] {
  const code = codeOf(file.content);
  const structure = structureOf(file.content);
  const sites: SinkSite[] = [];
  for (const m of structure.matchAll(SINK_RE)) {
    const at = m.index ?? 0;
    const [, qualifier, verb] = m;
    if (/\bfunction\s*\*?\s*$/.test(structure.slice(Math.max(0, at - 24), at))) continue;
    if ((verb === 'open' || verb === 'openSync') && !FS_QUALIFIER.test(qualifier)) continue;
    const open = at + m[0].length - 1;
    const close = closeOf(structure, open);
    const args = splitArgs(structure, open + 1, close === -1 ? Math.min(structure.length, open + MAX_EXTENT) : close - 1);
    const argv = ARGV_VERB.test(verb);
    const take = argv ? args.length : TWO_PATH_VERB.test(verb) ? 2 : 1;
    sites.push({
      rel: file.rel,
      callee: `${qualifier}${verb}`,
      argv,
      pathArgs: args.slice(0, take).map(([s, e]) => code.slice(s, e).trim()),
    });
  }
  return sites;
}

/**
 * Named collector (D-POLICY-NO-WRITE): every write-capable call in the corpus
 * whose PATH argument reaches .devflow/policy.json — by literal, or through a
 * binding that does. Keyed on the path argument, never on file co-occurrence:
 * post-install.ts writes .gitignore and names the policy file only as a pattern.
 *
 * Not covered (stated so an empty result is not over-read): object-property and
 * destructured aliases, a path assembled from fragments that never spell
 * `policy.json` (`'policy' + '.json'`), and code outside src/**\/*.ts.
 */
function collectPolicyWriteSites(files: readonly SourceFile[]): string[] {
  const aliases = collectPolicyAliases(files);
  const offenders: string[] = [];
  for (const f of files) {
    const aliasRe = namesRe(aliases.get(f.rel) ?? new Set());
    for (const site of collectSinkSites(f)) {
      const literal = site.argv ? hasPolicyMention : hasPolicyPathLiteral;
      if (site.pathArgs.some(a => literal(a) || (aliasRe !== null && aliasRe.test(a)))) {
        offenders.push(`${site.rel}: ${site.callee}(${site.pathArgs.join(', ').slice(0, 120)})`);
      }
    }
  }
  return offenders;
}

describe('source guards — no repo write, no parser copy (D-POLICY-NO-WRITE, D-POLICY-CJS-SEAM)', () => {
  const CORPUS = tsCorpus();
  const SEAM_REL = path.join('src', 'core', 'evidence-policy.ts');
  const CLI_REL = path.join('src', 'cli', 'commands', 'compliance.ts');
  const GITIGNORE_WRITER_REL = path.join('src', 'targets', 'claude-code', 'post-install.ts');
  const byRel = (rel: string): SourceFile => {
    const f = CORPUS.find(c => c.rel === rel);
    if (f === undefined) throw new Error(`corpus is missing ${rel}`);
    return f;
  };
  const probeFile = (content: string): SourceFile => ({ rel: 'probe.ts', content });

  it('the corpus reaches every file on the CLI path and the gitignore writer', () => {
    expect(CORPUS.length).toBeGreaterThan(50);
    for (const rel of [SEAM_REL, CLI_REL, GITIGNORE_WRITER_REL]) expect(byRel(rel).content.length).toBeGreaterThan(0);
    expect(CORPUS.some(f => f.rel.startsWith(path.join('src', 'assets')))).toBe(false);
  });

  it('the matchers read the real tree: sinks are found, and the carve-out pattern is seen and exempt', () => {
    const sinks = CORPUS.flatMap(collectSinkSites);
    expect(sinks.length).toBeGreaterThan(40);
    expect(collectSinkSites(byRel(CLI_REL)).map(s => s.callee)).toContain('writeManifest');
    expect(collectSinkSites(byRel(GITIGNORE_WRITER_REL)).some(s => s.callee.endsWith('writeFile'))).toBe(true);
    const carveOut = policyGitignoreLiterals(codeOf(byRel(GITIGNORE_WRITER_REL).content));
    expect(carveOut).toContain('!.devflow/policy.json');
    expect(carveOut.some(l => l.startsWith('#'))).toBe(true);
    expect(hasPolicyPathLiteral(codeOf(byRel(SEAM_REL).content))).toBe(true);
    // Taint crosses files through import: the CLI's binding of the seam's suggestion is seen.
    expect(collectPolicyAliases(CORPUS).get(CLI_REL)?.has('evidencePolicySuggestion')).toBe(true);
  });

  it('no write call in src/**/*.ts has a path argument that reaches .devflow/policy.json', () => {
    expect(collectPolicyWriteSites(CORPUS)).toEqual([]);
  });

  it.each([
    ['a literal path', "await fs.writeFile(path.join(root, '.devflow', 'policy.json'), body);"],
    ['a relative literal', "fs.writeFileSync('.devflow/policy.json', body);"],
    ['a one-hop alias', "const target = path.join(root, '.devflow/policy.json');\nawait fs.promises.writeFile(target, body);"],
    ['a two-hop alias', "const REL = '.devflow/policy.json';\nconst abs = join(root, REL);\nwriteFileAtomicExclusive(abs, body);"],
    ['a helper function', "function policyFile(r: string) { return join(r, '.devflow', 'policy.json'); }\nfs.appendFileSync(policyFile(root), body);"],
    ['a rename destination', "const dest = join(root, '.devflow/policy.json');\nawait fs.rename(tmpPath, dest);"],
    ['a copy destination', "fs.copyFileSync(src, join(root, '.devflow', 'policy.json'));"],
    ['an fs.open handle', "const h = await fs.promises.open(join(root, '.devflow/policy.json'), 'w');"],
    ['a git argv', `${'spawn'}Sync('git', ['add', '.devflow/policy.json'], { cwd: root });`],
    ['a shell redirect', `${'exec'}Sync("printf x > .devflow/policy.json");`],
  ])('known-bad probe: %s is reported', (_label, seeded) => {
    expect(collectPolicyWriteSites([...CORPUS, probeFile(seeded)])).toHaveLength(1);
  });

  it('known-bad probe: an exported path imported and written in another file is reported', () => {
    const exporter: SourceFile = { rel: 'probe-paths.ts', content: "export const TEAM_POLICY = join('.devflow', 'policy.json');\n" };
    const writer: SourceFile = {
      rel: 'probe-writer.ts',
      content: "import { TEAM_POLICY } from './probe-paths.js';\nconst target = join(root, TEAM_POLICY);\nawait fs.writeFile(target, body);\n",
    };
    expect(collectPolicyWriteSites([...CORPUS, exporter, writer])).toEqual(['probe-writer.ts: fs.writeFile(target)']);
  });

  it('negative control: a same-named local in a file that does not import it is not tainted', () => {
    const tainting: SourceFile = { rel: 'probe-a.ts', content: "const target = '.devflow/policy.json';\n" };
    const unrelated: SourceFile = { rel: 'probe-b.ts', content: "const target = join(root, 'notes.txt');\nfs.writeFileSync(target, body);\n" };
    expect(collectPolicyWriteSites([tainting, unrelated])).toEqual([]);
  });

  it.each([
    ['a gitignore write whose CONTENT carries the carve-out', "const LINE = '!.devflow/policy.json';\nawait fs.writeFile(gitignorePath, appendText(existing, LINE));"],
    ['printing the suggestion', "const suggestion = `commit it as .devflow/policy.json`;\np.note(suggestion, 'Evidence policy');"],
    ['writing the policy TEXT to another path', "const text = 'see .devflow/policy.json';\nfs.writeFileSync(logPath, text);"],
    ['a function declaration named like a sink', "function writePolicyNote(msg: string) { return msg; }"],
  ])('negative control: %s is not reported', (_label, seeded) => {
    expect(collectPolicyWriteSites([probeFile(seeded)])).toEqual([]);
  });

  it('the seam module imports no fs API and makes no write-capable call', () => {
    const seam = byRel(SEAM_REL);
    const imports = [...seam.content.matchAll(/^import[^;]*?from\s+['"]([^'"]+)['"]/gm)].map(m => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter(i => /^(?:node:)?fs(?:\/promises)?$/.test(i))).toEqual([]);
    expect(collectSinkSites(seam)).toEqual([]);
    // Probe: a seeded fs import and write call are both seen.
    const seeded = `import { promises as fs } from 'fs';\n${seam.content}\nawait fs.writeFile(p, x);\n`;
    expect([...seeded.matchAll(/^import[^;]*?from\s+['"]([^'"]+)['"]/gm)].map(m => m[1])).toContain('fs');
    expect(collectSinkSites(probeFile(seeded)).map(s => s.callee)).toEqual(['fs.writeFile']);
  });

  /** Named collector: code lines that read or spell the policy file's key — a TS parser copy. */
  function collectPolicyParserCopies(files: readonly SourceFile[]): string[] {
    const KEY_RE = /(['"])evidencePolicy\1|\.evidencePolicy(?![\w$])|(?<![\w$])evidencePolicy\s*[:?]/;
    return files.flatMap(f => codeOf(f.content).split('\n')
      .filter(l => KEY_RE.test(l))
      .map(l => `${f.rel}: ${l.trim()}`));
  }

  it('no TypeScript file parses or spells the policy file (the .cjs is the only parser)', () => {
    expect(collectPolicyParserCopies(CORPUS)).toEqual([]);
    expect(collectPolicyParserCopies([probeFile('const v = JSON.parse(raw).evidencePolicy;')])).toHaveLength(1);
    expect(collectPolicyParserCopies([probeFile("const shape = { version: 1, evidencePolicy: 'required' };")])).toHaveLength(1);
    expect(collectPolicyParserCopies([probeFile('evidencePolicySuggestion(state, mod);')])).toEqual([]);
  });

  it('carries the phase-C design decisions at their code sites (AC-12)', () => {
    const seam = byRel(SEAM_REL).content;
    expect(seam).toContain('D-POLICY-CJS-SEAM');
    expect(seam).toContain('D-POLICY-NO-WRITE');
    expect(seam).toContain('ADR-024');
  });
});

// ---------------------------------------------------------------------------
// The built CLI, end to end (temp HOME, temp cwd, gh faked — PF-060)
// ---------------------------------------------------------------------------

interface CliRun {
  readonly status: number | null;
  readonly out: string;
}

describe('devflow compliance — the built CLI (AC-9, AC-10)', () => {
  let cli: string;
  let fakeGh: FakeBin;

  beforeAll(() => {
    cli = requireBuiltCli();
    fakeGh = createFakeBin(tmp, ['gh']);
  });

  /** A fresh temp HOME (never the developer's) holding a manifest with this compliance state. */
  function makeHome(compliance: { enabled: boolean; frameworks: string[] }): string {
    const home = fs.mkdtempSync(path.join(tmp, 'home-'));
    fs.mkdirSync(path.join(home, '.devflow'), { recursive: true });
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    const manifest = makeManifest({ features: { ...makeManifest().features, compliance } });
    fs.writeFileSync(path.join(home, '.devflow', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return home;
  }

  /** A fresh temp git repository with an unborn HEAD — never inside the developer's checkout. */
  function makeRepo(home: string): string {
    const repo = fs.mkdtempSync(path.join(tmp, 'repo-'));
    realGit(repo, home, ['init', '-q', '-b', 'main']);
    return repo;
  }

  function runCli(o: { home: string; cwd: string; args: readonly string[]; shim?: ScriptedShim }): CliRun {
    // PF-060 echo-check: HOME and cwd must both be under this suite's tmp dir.
    for (const p of [o.home, o.cwd]) {
      if (!p.startsWith(tmp + path.sep)) throw new Error(`refusing to run the CLI outside the suite tmp dir: ${p}`);
    }
    const shimEnv: Record<string, string> = o.shim === undefined
      ? {}
      : { ...o.shim.env, PATH: `${o.shim.dir}${path.delimiter}${process.env.PATH ?? ''}` };
    const r = spawnSync(process.execPath, [cli, ...o.args], {
      cwd: o.cwd,
      env: scopedEnv(o.home, {
        CLAUDE_CODE_DIR: path.join(o.home, '.claude'),
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        CI: '1',
        ...shimEnv,
      }),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  }

  /** Every file under `dir` with its bytes — a before/after proof that nothing was written. */
  function snapshot(dir: string): Map<string, string> {
    return new Map(walkFiles(dir, () => true).map(f => [path.relative(dir, f), fs.readFileSync(f, 'latin1')]));
  }

  it('--status outside any repository ⇒ standard (source: default), flagged remote-unavailable', () => {
    const home = makeHome({ enabled: false, frameworks: [] });
    const cwd = fs.mkdtempSync(path.join(tmp, 'not-a-repo-'));
    const r = runCli({ home, cwd, args: ['compliance', '--status'] });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('Evidence policy: standard (source: default) [warn: remote-unavailable]');
  }, 60_000);

  it('--status offline in a repo: the worktree file governs and compliance raises it', () => {
    const home = makeHome({ enabled: true, frameworks: ['soc2'] });
    const repo = makeRepo(home);
    fs.mkdirSync(path.join(repo, '.devflow'));
    fs.writeFileSync(path.join(repo, '.devflow', 'policy.json'), STANDARD_BODY);
    const shim = buildScriptedShim(fakeGh, tmp, [
      { tool: 'gh', args: ARGV.probe, exit: 1, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' },
    ]);
    const before = snapshot(repo);
    const r = runCli({ home, cwd: repo, args: ['compliance', '--status'], shim });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('Evidence policy: required (source: worktree) [warn: remote-unavailable, raised-by-compliance]');
    expect(shim.readLog().map(argv => argv.join(' '))).toEqual([`gh ${ARGV.probe.join(' ')}`]);
    expect(snapshot(repo)).toEqual(before);
  }, 60_000);

  it('--status online: the default branch file governs, read with a GET', () => {
    const home = makeHome({ enabled: false, frameworks: [] });
    const repo = makeRepo(home);
    const shim = buildScriptedShim(fakeGh, tmp, [
      { tool: 'gh', args: ARGV.probe, stdout: 'main\n' },
      { tool: 'gh', args: ARGV.contents('main'), stdout: REQUIRED_BODY },
    ]);
    const r = runCli({ home, cwd: repo, args: ['compliance', '--status'], shim });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('Evidence policy: required (source: file) [warn: pr-changes-policy]');
    expect(shim.readLog()).toEqual([['gh', ...ARGV.probe], ['gh', ...ARGV.contents('main')]]);
  }, 60_000);

  it.each([
    ['--set gdpr', { enabled: false, frameworks: [] }, ['compliance', '--set', 'gdpr']],
    ['--set "" (zero frameworks — binding: still required)', { enabled: false, frameworks: [] }, ['compliance', '--set', '']],
    ['--enable from disabled', { enabled: false, frameworks: ['soc2'] }, ['compliance', '--enable']],
  ] as const)('%s prints the suggestion and writes nothing into the repository', (_label, state, args) => {
    const home = makeHome({ enabled: state.enabled, frameworks: [...state.frameworks] });
    const repo = makeRepo(home);
    const before = snapshot(repo);
    const r = runCli({ home, cwd: repo, args });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain('Evidence policy');
    expect(r.out).toContain(REQUIRED_BODY.trimEnd());
    expect(r.out).toContain('.devflow/policy.json');
    expect(fs.existsSync(path.join(repo, '.devflow', 'policy.json'))).toBe(false);
    expect(snapshot(repo)).toEqual(before);
  }, 60_000);

  it('--disable prints no suggestion', () => {
    const home = makeHome({ enabled: true, frameworks: ['gdpr'] });
    const repo = makeRepo(home);
    const r = runCli({ home, cwd: repo, args: ['compliance', '--disable'] });
    expect(r.status, r.out).toBe(0);
    expect(r.out).not.toContain('evidencePolicy');
    expect(r.out).not.toContain('Evidence policy');
  }, 60_000);
});
