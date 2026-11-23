---
feature: hud-status-line
name: HUD status line
description: "Use when adding or changing a HUD component, hud.json config, the week forecast, Codex quota, or the devflow hud command. Keywords: HUD, statusLine, hud.json, weekForecast, codexQuota, tokenmeter."
category: architecture
directories: [src/hud, src/hud/components, src/cli/commands/hud.ts, src/cli/commands/init.ts]
created: 2026-11-23
updated: 2026-11-23
---

# HUD status line

## Rules

- **KB-INV-1** The installed HUD runs from `~/.devflow/scripts/hud/index.js` with no `package.json` and no `node_modules` above it: a file in `src/hud` imports only modules that compile into that import closure, never an npm package.
- **KB-INV-2** All I/O happens in the gather step of `src/hud/index.ts`. A component is `(ctx) => Promise<ComponentResult | null>` and reads only `ctx`; `null` hides it.
- **KB-INV-3** A new component needs a `ComponentId` in `types.ts`, an entry in `COMPONENT_MAP` and in `LINE_GROUPS` in `render.ts`, and an entry in `HUD_COMPONENTS` in `config.ts` only if it is on by default.
- **KB-INV-4** `render` drops a component that throws or rejects and prints the others. If `run` fails or the `OVERALL_TIMEOUT` timer fires, `main` prints nothing.
- **KB-INV-5** `weekForecastFrom` is a copy of the `forecastFrom` formula of the pinned tokenmeter release. The contract test in `tests/tokenmeter-contract.test.ts` runs the pinned `tokenmeter statusline` and compares percent and run-out hours with the HUD.
- **KB-INV-6** The week forecast reads the raw `rate_limits.seven_day` from stdin through `parseWeekPoint`, not `ctx.usage`. Any invalid input gives output byte for byte equal to the output with the forecast off.
- **KB-INV-7** Codex quota comes only through `src/hud/tokenmeter.ts`: it runs the verified local tokenmeter binary read from install state, with no shell, no HUD stdin, an allowlisted env, a byte cap, a deadline and a cache.
- **KB-INV-8** `HudConfig` has three fields (`enabled`, `detail`, `forecast`). `loadConfig` builds the object from these known keys only. `detail` and `forecast` are on only for a strict `true`; `enabled` is off only for a strict `false`.
- **KB-INV-9** Every writer of `hud.json` spreads the loaded config and changes only its own field: `{ ...loadConfig(), field }`. `devflow hud` and both HUD saves in `init.ts` follow this.
- **KB-INV-10** The config path is always `$HOME/.devflow/hud.json`. No environment variable moves it.
- **KB-INV-11** A `statusLine` is devflow's only when its command ends in `/.devflow/scripts/hud.sh` or the legacy `/.devflow/scripts/statusline.sh`. `isDevFlowStatusLine` is the one predicate; every add, remove and check goes through it.
- **KB-INV-12** With the HUD off, `resolveComponents` returns only `versionBadge`, so users still see upgrade notices.
- **KB-AP-1** Adding a field to `HudConfig` without adding it to `loadConfig`: the loader drops it, so the next `devflow hud` or `devflow init` save erases it, with no error. The same applies to a key a user adds by hand.
- **KB-AP-2** Saving a fresh object such as `saveConfig({ enabled: true })`: it resets `detail` and `forecast`. Spread the loaded config.
- **KB-AP-3** Naming `forecast` in `src/hud/index.ts`, or importing anything but colors, types and usage-quota into `week-forecast.ts`: the guard in `tests/guards/hud-usage-source.test.ts` fails. The forecast must stay a no-I/O component.
- **KB-AP-4** Reading `ctx.usage` in the forecast: `index.ts` clamps it to 0-100, so an out-of-range stdin value would show a forecast instead of hiding it.
- **KB-AP-5** Opening a network connection, reading a credential file, looking up `tokenmeter` on PATH or reading Codex logs in `src/hud`: the same guard rejects each one.
- **KB-AP-6** Building a child env by copying `process.env` and deleting keys: use the `ENV_KEYS` allowlist in `tokenmeter.ts` and the filtered PATH, and keep `NODE_OPTIONS` out.
- **KB-AP-7** Adding a component to `COMPONENT_MAP` but not to `LINE_GROUPS`: TypeScript does not catch it and the component never shows, because `render` walks only `LINE_GROUPS`.
- **KB-AP-8** Detecting a user turn in the transcript by type `human`: Claude Code writes `user`. Build parser fixtures from sampled real entries.
- **KB-AP-9** Awaiting the Codex cache write inside the render budget: `index.ts` passes `waitForCache: false`, and the installed-layout test checks that the cache file exists after the process exits.

## Overview

The HUD is the status line that Claude Code starts through `~/.devflow/scripts/hud.sh`. That script runs `node hud/index.js`. Claude Code sends one JSON object on stdin (model, cwd, context window, cost, session id, transcript path and `rate_limits`). The HUD prints up to five ANSI lines.

The flow has three steps. `src/hud/index.ts` reads stdin and `hud.json`, resolves the enabled component ids, and gathers only the data those components need (git, transcript, ledger counts, Codex quota) in parallel. Then it builds a `GatherContext`. `render.ts` then runs every enabled component in parallel and joins the results by line group. The `devflow hud` command (`src/cli/commands/hud.ts`) edits `hud.json` and the `statusLine` entry in `settings.json`. It never renders.

## Components and config

`HUD_COMPONENTS` in `config.ts` is the default list, in display order. The test `HUD_COMPONENTS has 15 components` in `tests/hud-render.test.ts` pins its length. A second test pins `codexQuota` right after `usageQuota`.

Two components are outside the default list:

- `weekForecast` is opt-in. `resolveComponents` appends it only when the HUD is on and `forecast` is `true`. Run `devflow hud --forecast` or `--no-forecast` to change it.
- `sessionDuration` is in the type, the map and the tests, but no config path enables it. `resolveComponents` never returns it.

`detail` is saved by `devflow hud --detail` and shown by `--status`. No file in `src/hud` reads it today.

`LINE_GROUPS` in `render.ts` sets the layout. The first line holds directory and git parts. The second is the capacity line: `contextUsage`, `usageQuota`, `weekForecast`, `codexQuota`, `todoProgress`. The third holds `model`, `configCounts` and `sessionCost`. `curationCounts` and `versionBadge` each get their own line. A component whose text contains a newline gets its own line, and the single-line parts before it flush first. Parts join with a dim dot separator.

## Week forecast

`weekForecast` shows `→ N% by reset` and, when the quota runs out before the reset, `, runs out in <time>`. It sits between `7d` and the Codex quota on the capacity line.

- `parseWeekPoint` accepts a value from 0 to 100 and a `resets_at` in epoch seconds that is in the future and within `MAX_RESET_AHEAD_MS`. A reset in milliseconds fails this check.
- `weekForecastFrom` returns `null` until `BURN_FREE_FRACTION` of the week has passed. The burn rate is used percent per elapsed hour. The test `starts the forecast at exactly 5 hours and 144 seconds elapsed` in `tests/hud-components.test.ts` pins the start.
- `forecastPercentText` shows `>999%` above 999.
- The installed HUD cannot import the tokenmeter package, and a devflow-only user has no stored Claude data. So the formula is a copy, and the contract test is the only link between the copy and the package.
- The guard test also checks the import list of `week-forecast.ts` and that `index.ts` has no `forecast` text. The component adds no gather step.

When the tokenmeter dependency pin changes, run `tests/tokenmeter-contract.test.ts` first. If it fails, update `weekForecastFrom` to match the new formula. Do not change the contract test to match the copy.

## Codex quota

`gatherTokenmeterUsage` in `src/hud/tokenmeter.ts` is the only Codex source. It reads the cache first. On a miss it reads the binary path from install state, runs `node <bin> hud` with `execFile` and `shell: false`, and parses the output against `schema: tokenmeter.v1`. Windows are matched by length in minutes (300 and 10080). Other lengths are skipped without discarding the supported windows. A bad shape gives `null`, and the component then hides.

The cache TTL depends on the age of the reading, so a reading near the stale limit refreshes more often. `codexQuota` shows `reset` for a window whose reset time has passed, adds `data Nm old` for old data, and shows a red `limited` mark when Codex reports a reached limit and a window has not reset.

The installed layout has `core/tokenmeter-bin-state.js` but not `core/tokenmeter-bin.js`. The HUD reads state only. It never installs or resolves the package. `tests/hud-installed-layout.test.ts` pins this layout.

## hud.json and the init saves

`loadConfig` returns defaults when the file is missing or not valid JSON. It copies only the three known fields, so unknown fields are lost on the next save. This is the same pitfall as any read-modify-write layer over a user-edited file: the declared type decides what survives.

Two places in `init.ts` save the config: the `--hud-only` path and the full init path. Both load the config and spread it, then set only `enabled`. The test group `init preserves the HUD forecast choice` in `tests/init-machine-switch-e2e.test.ts` pins that `detail` and `forecast` survive both. `init` seeds from prior install state, so a re-run keeps user choices. Only `--reset` returns to defaults.

## devflow hud command

- `--status` prints the config and the `statusLine` state. It returns before any write, even with other flags.
- `--detail` and `--forecast` (and their `--no-` forms) are saved in one write before `--enable` or `--disable` runs.
- `--enable` always checks `settings.json` and adds the `statusLine` when it is missing, so a drifted install self-heals. It asks before it replaces a statusLine that is not devflow's, and skips in a non-interactive shell.
- `--disable` always tries to remove a devflow `statusLine`, even when `hud.json` already says off. It then syncs the `hud` feature in the manifest.
- `addHudStatusLine` upgrades the legacy `statusline.sh` to `hud.sh`. It leaves another tool's `statusLine` unchanged.

## Anti-Patterns

**KB-AP-1, KB-AP-2.** The hud.json writers never own more than their field. Add a new field in three places together: the `HudConfig` interface, the `loadConfig` builder (with a strict check) and the `--status` output. Add a test that saves and reloads the field. Check both `init.ts` saves.

**KB-AP-3, KB-AP-5.** `tests/guards/hud-usage-source.test.ts` scans `src/hud` and the Codex docs. It rejects network modules, credential file names, a PATH lookup of tokenmeter, retired reader names, local paths and unscoped install commands. It also checks that the documented `app_server off` command carries the exact dependency pin. A new HUD file is in the scan at once.

**KB-AP-4.** Use `ctx.stdin.rate_limits.seven_day` in the forecast. The test group `week forecast on the capacity line` feeds invalid stdin while a valid gathered quota is present. It requires the same bytes as the off case.

**KB-AP-6.** `childEnv` in `tokenmeter.ts` builds the env from `ENV_KEYS` and a PATH reduced to absolute directories that the user or root owns and others cannot write. An allowlist fails loudly when a variable is missing. A denylist leaks every key you did not think of.

**KB-AP-7.** Add a render test for the new component with the `LINE_GROUPS` row. A test that calls the component alone does not show the missing row.

**KB-AP-8.** The transcript schema has no public spec. A fixture with a wrong type string passes and hides the defect. Sample a real session file first.

## Gotchas

**KB-INV-1.** `composeScripts` copies the import closure of `dist/hud/index.js` into the scripts folder. A new import from outside that closure works in the repo and fails after install. Run `tests/hud-installed-layout.test.ts`, which runs the real entry point from a composed folder.

**KB-INV-4, KB-AP-9.** `main` clears the timer after the line prints. A live timer would hold node for the rest of the budget and delay every render. The installed-layout test measures the render time against the two-second budget.

**KB-INV-6.** `index.ts` computes `usage` only when `usageQuota` is on, and clamps it. The forecast does not depend on that.

**KB-INV-8.** A malformed `hud.json` gives defaults, so the HUD stays on. A value such as `"forecast": "true"` (a string) is off.

**KB-INV-11.** A path that only contains a `devflow` segment, or the bare `~/.claude/statusline.sh` from the Claude Code docs, belongs to the user. Backslashes read as slashes. A command that is not a string is the user's.

**Debug.** Set `DEVFLOW_HUD_DEBUG` to a file path to dump the raw stdin JSON.

## Key Files

- `src/hud/index.ts`: entry point, stdin read, gather step, overall timeout.
- `src/hud/render.ts`: `COMPONENT_MAP`, `LINE_GROUPS`, parallel render, failure isolation.
- `src/hud/config.ts`: `HUD_COMPONENTS`, `loadConfig`, `saveConfig`, `resolveComponents`.
- `src/hud/types.ts`: `ComponentId`, `HudConfig`, `GatherContext`, stdin shape.
- `src/hud/components/week-forecast.ts`: opt-in forecast, `parseWeekPoint`, `weekForecastFrom`.
- `src/hud/components/codex-quota.ts` and `usage-quota.ts`: quota lines; `renderQuotaWindow` and `formatCountdown` are shared.
- `src/hud/tokenmeter.ts`: Codex quota reader, env allowlist, cache.
- `src/hud/transcript.ts`: transcript parser for todos, tools and agents.
- `src/cli/commands/hud.ts`: `devflow hud`, statusLine ownership, add and remove.
- `src/cli/commands/init.ts`: the two `hud.json` saves.
- `tests/tokenmeter-contract.test.ts`: forecast contract with the pinned tokenmeter.
- `tests/guards/hud-usage-source.test.ts`: source and docs guard.
- `tests/hud-installed-layout.test.ts`: HUD run from a composed install.
- `tests/hud-render.test.ts`, `tests/hud-components.test.ts`, `tests/hud.test.ts`: render, component and command tests.

## Related

- `.devflow/features/test-harness/KNOWLEDGE.md`: guard conventions and temp-HOME helpers that the HUD tests use.
- `README.md`, `docs/cli-reference.md`, `docs/reference/file-organization.md`: user text for the forecast and `hud.json`.
- `src/core/cache.ts`, `src/core/tokenmeter-bin-state.ts`: cache and install state that the Codex reader uses.
