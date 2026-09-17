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
 *       "13 command outputs byte-…"     — the dist/-vs-src/ byte compare is non-vacuous
 *   - tests/packaging.test.ts
 *       Guard 6                         — the same output set, the generator hosts' compiled
 *                                         agents, and the shipped .mds sources, inside the tarball
 *   - tests/mds-variants.test.ts
 *       "validateOutputName"            — every basename the build owns is accepted by the name rule
 *
 * Length floors (`>= 13`, `>= 11`) are asserted alongside the set-equality in
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

/** All 13 command hosts compiled into dist/commands/. */
export const MDS_COMMAND_HOSTS = [
  ...KNOWLEDGE_COMMAND_HOSTS,
  ...DYNAMIC_COMMAND_HOSTS,
] as const;

/**
 * The 12 partials in src/assets/commands/_partials/. A partial declares no
 * `output-dir:`, so the build skips it — it is imported by hosts instead.
 * The `_` prefix is the partial convention (and is refused by validateOutputName,
 * so a partial can never become an output filename by accident).
 */
export const MDS_PARTIALS = [
  '_compliance',
  '_decisions',
  '_engine',
  '_factory',
  '_knowledge',
  '_plan_contract',
  '_preamble',
  '_publication',
  '_roster',
  '_ticket_template',
  '_tracker',
  '_wave',
] as const;

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
 * Generator hosts: .mds sources outside src/assets/commands/ that compile to a
 * destination other than dist/commands. Today exactly one — the Git agent,
 * src/assets/agents/git.mds → dist/agents/git.md.
 */
export const MDS_GENERATOR_HOSTS = ['git'] as const;

/**
 * Reference modules: .mds sources under src/assets/mds/ that the build COMPILES,
 * each fanning out into MANY output files instead of one. Five today:
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
 *      tracker through a tool call being registered. `tracker/jira` is such a
 *      provider, so the gate is open and this module compiles like any other. See
 *      MCP_CONTRACT_MODULE / mcpContractIsGenerated in src/core/mds-variants.ts,
 *      and DEFERRED_REFERENCE_MODULE_SOURCES below for the roster of what the gate
 *      currently holds back.)
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
 * TRACKER_OPS / GIT_CROSS_CUTTING_DOCS in src/core/mds-variants.ts, so there is
 * one roster, not a production copy and a test copy that can drift.
 */
export const MDS_REFERENCE_MODULES = [
  'src/assets/mds/tracker/_github.mds',
  'src/assets/mds/tracker/_jira.mds',
  'src/assets/mds/tracker/_linear.mds',
  'src/assets/mds/tracker/_mcp.mds',
  'src/assets/mds/git/_references.mds',
] as const;

/**
 * Hand-authored files copied verbatim into dist/commands/. release.md inlines its
 * own COMPLIANCE gate and is not MDS-compiled; the divergence is permanent (SG-13).
 */
export const HAND_AUTHORED_COMMAND_FILES = ['release.md'] as const;

/**
 * The 14 files that must exist in dist/commands/ after a build: the 13 compiled
 * hosts plus release.md. This is DIST_FILES — deployed-behaviour scope (§14.5).
 */
export const DIST_COMMAND_FILES: readonly string[] = [
  ...MDS_COMMAND_HOSTS.map(h => `${h}.md`),
  ...HAND_AUTHORED_COMMAND_FILES,
];

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
