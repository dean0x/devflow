/**
 * MDS name manifests — the single definition of *which* files the build owns.
 *
 * A count answers "how many?"; these manifests answer "which?". Every assertion
 * site compares against them in both directions, so a rename plus an addition in
 * the same commit cannot stay green.
 *
 * Bidirectional-registry model, mirroring src/core/compliance-compose.ts:20/:36/:50
 * ("every token here must exist in the template; every template token must be
 * listed here"). Every file that imports these manifests, and what each enforces,
 * named here so a reader of the manifest can find its guards:
 *
 *   - tests/build-mds.test.ts
 *       "MDS host discovery"            — hosts and partials on disk, both directions
 *       "expected-command-set guard"    — the dist/commands/*.md output set
 *   - tests/build-mds-generator-hosts.test.ts
 *       "printed host/partial counts…"  — the counts the build itself prints
 *       "14 command outputs byte-…"     — the dist/-vs-src/ byte compare is non-vacuous
 *   - tests/packaging.test.ts
 *       Guard 6                         — the same output set, the generator hosts' compiled
 *                                         agents, the learning-off variants and the shipped
 *                                         .mds sources, inside the tarball
 *   - tests/learning/learning-variants-build.test.ts
 *       LEARNING_VARIANT_HOSTS          — the learning-off files on disk, both directions
 *   - tests/learning/learning-variants-arms.test.ts
 *       LEARNING_VARIANT_HOSTS          — the hosts whose compiled body carries an arm, both directions
 *       SETTINGS_BLOCK_HOSTS_LEARNING_OFF — the commands that keep the settings block with learning off
 *   - tests/mds-variants.test.ts
 *       "validateOutputName"            — every basename the build owns is accepted by the name rule
 *   - tests/commands/settings-partial.test.ts
 *       SETTINGS_BLOCK_HOSTS            — the compiled commands that carry the settings block
 *   - tests/guards/provider-scope.test.ts
 *       SETTINGS_BLOCK_HOSTS            — the files whose settings-line shape may name every provider
 *
 * Length floors (`>= 14` hosts, `>= 15` partials) are asserted alongside the set-equality in
 * tests/build-mds.test.ts and registered in tests/fixtures/numeric-floors.json.
 * A floor never decreases; a manifest entry may only be added or renamed in step
 * with the file on disk.
 */

/** The 9 knowledge-workflow command hosts (src/assets/commands/<name>.mds). */
export const KNOWLEDGE_COMMAND_HOSTS = [
  'bug-analysis',
  'code-review',
  'debug',
  'explore',
  'implement',
  'plan',
  'research',
  'resolve',
  'self-review',
] as const;

/** The 4 dynamic-workflow command hosts (src/assets/commands/<name>.mds). */
export const DYNAMIC_COMMAND_HOSTS = [
  'dynamic-build',
  'dynamic-plan',
  'dynamic-profile',
  'dynamic-tickets',
] as const;

/** The release command host (src/assets/commands/release.mds). */
export const RELEASE_COMMAND_HOSTS = ['release'] as const;

/** All 14 command hosts compiled into dist/commands/. */
export const MDS_COMMAND_HOSTS = [
  ...KNOWLEDGE_COMMAND_HOSTS,
  ...DYNAMIC_COMMAND_HOSTS,
  ...RELEASE_COMMAND_HOSTS,
] as const;

/**
 * The 15 partials in src/assets/commands/_partials/, by BASENAME. A partial
 * declares no `output-dir:`, so the build skips it — it is imported by hosts
 * instead. The `_` prefix is the partial convention (and is refused by
 * validateOutputName, so a partial can never become an output filename by
 * accident).
 *
 * Not the whole partial roster: MDS_REFERENCE_PARTIALS below holds the ones that
 * live outside this directory, and ALL_MDS_PARTIALS is the union the build counts.
 */
export const MDS_PARTIALS = [
  '_compliance',
  '_decisions',
  '_docs_root',
  '_engine',
  '_evidence_policy',
  '_factory',
  '_knowledge',
  '_plan_contract',
  '_preamble',
  '_publication',
  '_roster',
  '_settings',
  '_ticket_template',
  '_tracker',
  '_wave',
] as const;

/**
 * Partials that live OUTSIDE `src/assets/commands/_partials/`, by repo-relative
 * source path — the same addressing as MDS_REFERENCE_MODULES, and for the same
 * reason: a basename is only unique inside one directory.
 *
 * Two today. `_common.mds` holds the lines every tracker module writes
 * identically, including the CLI provider's — the counterpart to `_mcp.mds`,
 * which owns what is shared only by the TOOL-CALL providers. `_steps.mds` holds the
 * provider-neutral step text of the tracker operations that left the Git agent
 * (D-NEUTRAL-STEP-MOVE), in a module of its own because the resolver's compile cost
 * is exponential in a module's define count and `_common.mds` has no room left. Each
 * is a partial because it declares no `output-dir:`: the build skips it and it
 * reaches the artifact only through the modules that import it.
 *
 * This roster is what makes the partial discovery below a repo-wide walk rather
 * than a listing of one directory. A partial parked outside `_partials/` was
 * previously invisible to every assertion here while still being counted by the
 * build, so the printed count and the manifest could disagree with nothing red.
 */
export const MDS_REFERENCE_PARTIALS = [
  'src/assets/mds/tracker/_common.mds',
  'src/assets/mds/tracker/_steps.mds',
] as const;

/**
 * Every partial the build walks past, and therefore the number it prints as
 * "N partial(s) skipped (no output-dir:)". Addressed as repo-relative paths so
 * the two halves compose without a directory being implied.
 */
export const ALL_MDS_PARTIALS: readonly string[] = [
  ...MDS_PARTIALS.map(name => `src/assets/commands/_partials/${name}.mds`),
  ...MDS_REFERENCE_PARTIALS,
];

/**
 * The hosts that adopt `_partials/_tracker.mds` (P2-S9). Named as a set, not a
 * count, for the same reason as every other roster here: a count stays green when
 * one adopter is dropped and another added in the same commit.
 *
 * These are the five commands that either parse issue references out of
 * `$ARGUMENTS` or read a Git-agent Output block — the two things the partial's
 * defines govern. A sixth command that starts doing either must join this list
 * rather than restate the rule inline, which is the divergence P2-S9 removed.
 */
export const TRACKER_PARTIAL_ADOPTERS = [
  'debug',
  'dynamic-build',
  'dynamic-plan',
  'implement',
  'plan',
] as const;

/**
 * The hosts that adopt `_partials/_evidence_policy.mds` (SDLC-evidence PR3b,
 * #362). Named as a set for the same reason as TRACKER_PARTIAL_ADOPTERS.
 *
 * These are the eight commands that act on the resolved evidence policy. Each
 * resolves it once per run through `evidence_policy()`, so the invocation and its
 * parse have one authority, and each imports the define rather than restating it.
 */
export const EVIDENCE_POLICY_PARTIAL_ADOPTERS = [
  'bug-analysis',
  'code-review',
  'dynamic-build',
  'dynamic-tickets',
  'implement',
  'plan',
  'release',
  'resolve',
] as const;

/**
 * The hosts whose compiled text carries the `_partials/_settings.mds` block (#392,
 * D-SETTINGS-LINE): all 14 command hosts, each expanding `settings_resolve()` exactly
 * once, before the earliest of its consumers. The hosts import the partial themselves,
 * as alias imports; no partial does. Named as a set for the same reason as the rosters
 * above: the provider-scope guard allowlists the block's closed provider set in exactly
 * these files, and tests/commands/settings-partial.test.ts holds the set to the build.
 *
 * The block count (14) and the learning-off count (8) are test-local constants beside
 * their assertions, not manifest rows: a count held here would be a second place to
 * keep in step with this set.
 */
export const SETTINGS_BLOCK_HOSTS = [
  'bug-analysis',
  'code-review',
  'debug',
  'dynamic-build',
  'dynamic-plan',
  'dynamic-profile',
  'dynamic-tickets',
  'explore',
  'implement',
  'plan',
  'release',
  'research',
  'resolve',
  'self-review',
] as const

/**
 * The hosts whose learning-OFF build still carries the settings block: the ones with
 * a consumer other than learning (a compliance lens, a publication gate or a knowledge
 * write-back). The other six of SETTINGS_BLOCK_HOSTS (bug-analysis, dynamic-plan,
 * dynamic-profile, dynamic-tickets, release, research) only read the line for the
 * decisions gate or a Skim spawn, so the block sits inside their learning-on arm.
 * Named as a set; the learning-off count (8) is a test-local constant beside its
 * assertion.
 */
export const SETTINGS_BLOCK_HOSTS_LEARNING_OFF = [
  'code-review',
  'debug',
  'dynamic-build',
  'explore',
  'implement',
  'plan',
  'resolve',
  'self-review',
] as const

/**
 * Generator hosts: .mds sources outside src/assets/commands/ that compile to a
 * destination other than dist/commands. Ten today, all agents:
 * src/assets/agents/{name}.mds → dist/agents/{name}.md. Git is the first; the other
 * nine (the agents that declare learning input, plus Skim) are hosts so their
 * learning arms can be built into the learning-off variant. The rest of the agents
 * stay hand-authored, and an agent never has both an .md and an .mds source.
 */
export const MDS_GENERATOR_HOSTS = [
  'code',
  'design',
  'diagnose',
  'git',
  'knowledge',
  'research',
  'review',
  'scrutinize',
  'skim',
  'triage',
] as const;

/**
 * The hosts whose compiled body carries a learning arm, and therefore have a
 * learning-off variant: each is `<kind>/<name>`, the path under
 * `dist/learning-off/` without its `.md`. Named as a set, not a count, for the
 * same reason as every other roster here: a count stays green when one host
 * loses its arm and another gains one in the same commit.
 *
 * All 14 command hosts (each loads decisions, or hands them on, behind an arm)
 * and the nine agent hosts that declare `DECISIONS_CONTEXT` (eight) or take the
 * `LEARNING` input (Skim). The Learning agent, `learning.md`, is hand-authored
 * and runs only when learning is on, so it has no variant. The assertions over
 * this set hold at every step: the printed variant count and the files under
 * `dist/learning-off/` both equal it in both directions, the packed tarball
 * carries exactly these files, and an arm added without a row (or a row left
 * after its arm goes) turns one of them red.
 */
export const LEARNING_VARIANT_HOSTS: readonly string[] = [
  ...MDS_COMMAND_HOSTS.map(h => `commands/${h}`),
  ...[
    'code',
    'design',
    'diagnose',
    'knowledge',
    'research',
    'review',
    'scrutinize',
    'skim',
    'triage',
  ].map(h => `agents/${h}`),
];

/** The `dist/learning-off/`-relative file of every host in LEARNING_VARIANT_HOSTS. */
export const LEARNING_OFF_FILES: readonly string[] = LEARNING_VARIANT_HOSTS.map(h => `${h}.md`);

/**
 * Reference modules: .mds sources under src/assets/mds/ that the build COMPILES,
 * each fanning out into MANY output files instead of one. Six today:
 *   src/assets/mds/tracker/_github.mds  → dist/skills/git/references/tracker/github/*.md
 *     (kind 'fanout' — one file per entry of TRACKER_OPS)
 *   src/assets/mds/tracker/_jira.mds    → dist/skills/git/references/tracker/jira/*.md
 *     (kind 'fanout' — the same TRACKER_OPS roster, which is what makes file-set
 *      parity across providers a compile-time property)
 *   src/assets/mds/tracker/_linear.mds  → dist/skills/git/references/tracker/linear/*.md
 *     (kind 'fanout' — the same roster again; three providers is where the parity
 *      scan stops being vacuous, §8.11)
 *   src/assets/mds/tracker/_mcp.mds     → dist/skills/git/references/tracker/_mcp.md
 *     (kind 'contract' — GENERATION IS GATED on a provider that reaches its
 *      tracker through a tool call being registered. Such a provider is
 *      registered, so the gate is open and this module compiles like any other.
 *      The gate and its roster live in src/core/mds-variants.ts, not here:
 *      MCP_CONTRACT_MODULE / mcpContractIsGenerated decide whether it compiles,
 *      GATED_REFERENCE_MODULE_SOURCES is the roster of modules the gate can hold
 *      back, and deferredReferenceModuleSources() is the subset it holds back for
 *      a given registry.)
 *   src/assets/mds/git/_pr.mds          → dist/skills/git/references/pr/*.md
 *     (kind 'fanout' — one file per entry of PR_HOST_OPS. Under no provider:
 *      pull requests, PR reviews and PR checks stay on GitHub whatever the
 *      issue tracker is, so these are the same eight files for everyone.)
 *   src/assets/mds/git/_references.mds  → dist/skills/git/references/*.md
 *     (kind 'named' — the cross-cutting documents, GIT_CROSS_CUTTING_DOCS)
 *
 * Named by repo-relative source path, not by basename, and deliberately NOT part
 * of ALL_MDS_HOSTS: that roster exists because each of its entries becomes an
 * output FILENAME, and a reference module's filenames come from its operation
 * registry in src/core/mds-variants.ts. `_github` would not even pass
 * validateOutputName — which is the point, and why the two sets are separate
 * rather than one set with an exception.
 *
 * The emitted file set itself is not restated here: it is derived from
 * TRACKER_OPS / PR_HOST_OPS / GIT_CROSS_CUTTING_DOCS in src/core/mds-variants.ts,
 * so there is one roster, not a production copy and a test copy that can drift.
 */
export const MDS_REFERENCE_MODULES = [
  'src/assets/mds/tracker/_github.mds',
  'src/assets/mds/tracker/_jira.mds',
  'src/assets/mds/tracker/_linear.mds',
  'src/assets/mds/tracker/_mcp.mds',
  'src/assets/mds/tracker/_contract.mds',
  'src/assets/mds/git/_pr.mds',
  'src/assets/mds/git/_references.mds',
] as const;

/**
 * The 14 files that must exist in dist/commands/ after a build: one per command
 * host. This is DIST_FILES — deployed-behaviour scope (§14.5). Every command is a
 * compiled host, so no file here is copied rather than compiled.
 */
export const DIST_COMMAND_FILES: readonly string[] = MDS_COMMAND_HOSTS.map(h => `${h}.md`);

/**
 * Every host basename that becomes an output FILENAME: command hosts + generator
 * hosts. Reference modules are excluded by construction — see
 * MDS_REFERENCE_MODULES.
 */
export const ALL_MDS_HOSTS: readonly string[] = [
  ...MDS_COMMAND_HOSTS,
  ...MDS_GENERATOR_HOSTS,
];

/**
 * Total hosts the build DISCOVERS — everything declaring `output-dir:`, which is
 * the number the build prints as "N host(s) to compile:".
 */
export const ALL_DISCOVERED_HOSTS: readonly string[] = [
  ...MDS_COMMAND_HOSTS,
  ...MDS_GENERATOR_HOSTS,
  ...MDS_REFERENCE_MODULES,
];
