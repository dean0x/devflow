---
feature: external-model-routing-hook
name: External Model Routing — ensure-proxy Hook & Relay Spawn Environment
description: "Use when editing the ensure-proxy hook, relay spawn env, binPath re-resolution or scrubChildEnv. Keywords: ensure-proxy, SessionStart, env -i, proxy.pid."
category: component-patterns
directories: [src/assets/scripts/hooks/ensure-proxy, src/core/proxy-log.ts]
created: 2026-10-10
updated: 2026-10-10
---

# External Model Routing — ensure-proxy Hook & Relay Spawn Environment

## Rules

- **KB-AP-1** Never add proxy-state I/O before the `UserPromptSubmit` exit in `ensure-proxy`: the event is detected from stdin and the hook exits 0 at once, so every prompt stays cheap (the `json_field_file` subprocess reads were most of the hook's wall time on jq-less hosts).
- **KB-AP-2** Never let `NODE_OPTIONS` into the relay environment: it permits arbitrary code execution through `--require`/`--import`. The allowlist is explicit.
- **KB-AP-3** Never change one relay env allowlist without the other: the hook's `_RELAY_ENV` and `scrubChildEnv()` in `proxy-log.ts` must stay in sync, or one spawn path silently breaks corporate-TLS users.
- **KB-AP-4** Never pass an empty `NODE_EXTRA_CA_CERTS`: an empty path causes TLS errors, so the hook appends it only when non-empty and `scrubChildEnv()` omits it when unset.
- **KB-AP-5** Never rotate `proxy.log` while a relay is running (model discovery included): a rename under the relay's open append fd orphans that fd. Rotation is pre-spawn only (`rotateProxyLogIfLarge`).
- **KB-AP-6** Never match the health body by substring: parse it with `json_field "name"`. The old `"name":"subswitch"` substring match was key-order-dependent.
- **KB-AP-7** Never put the routing runtime's package name in a hook `additionalContext` message or any other user-visible string.
- **KB-AP-8** Never write a re-resolved `binPath` back to `proxy.json` from the hook: the healed path is session-local; the next `devflow proxy --enable` persists it.
- **KB-AP-9** Never spawn the relay `binPath` directly: npm does not guarantee executable bits, so the hook runs `node "$PROXY_BIN" serve`.
- **KB-AP-10** Never warn when `curl` is absent: the hook assumes the relay is ours and exits 0, because `devflow proxy --status` is the authoritative identity check and a spurious warning is worse.
- **KB-INV-1** The hook always exits 0 and holds no fd across exit; every failure branch is a log line and, where it helps the user, a `json_session_output` warning.
- **KB-INV-2** It is registered on both `SessionStart` and `UserPromptSubmit`, is not git-gated, and is never project-scoped: state lives at `$HOME/.devflow`.
- **KB-INV-3** The port is digit-validated, falling back to the default, before it reaches `/dev/tcp` or any string.
- **KB-INV-4** Every loop is bounded: the binPath walk (`_WALK_GUARD`), the spawn wait (wider than the CLI's `RELAY_SPAWN_MAX_PROBES` loop yet inside the platform hook timeout), and the log size guard.
- **KB-INV-5** The spawn lock (`.proxy-spawn.lock`) is held across spawn and wait, so concurrent sessions never double-spawn.
- **KB-INV-6** `proxy.log` is mode 0600 in a 0700 directory; rotation temp files are created under `umask 077` so the replacement inode is born 0600.
- **KB-INV-7** binPath re-resolution is best-effort: when both strategies fail, the original "relay binary not found" warning is emitted and the hook still exits 0.

## Overview

`src/assets/scripts/hooks/ensure-proxy` starts the relay on session start when `proxy.json` says external model routing is enabled, and warns the session (through `additionalContext`) when it cannot. The CLI's `devflow proxy --enable` is the other spawn site (`spawnRelayAndWaitForPort`); `devflow init` never spawns, so the first session's hook starts the relay after an init that enabled routing. Lifecycle, preflight and settings handling are in `.devflow/features/external-model-routing/KNOWLEDGE.md`.

The hook is registered on **both** `SessionStart` and `UserPromptSubmit` with a 15-second timeout, by `addProxyHooks` (command `run-hook ensure-proxy`). One bash script serves both events. It sources `hook-bootstrap` and `json-parse`, and exits 0 first thing when `DEVFLOW_BG_UPDATER=1`, because background worker sessions (`claude -p` for memory and learning) fire hooks too. When `json-parse` fails to source it prints a named stderr diagnostic (`ensure-proxy: failed to source json-parse`) and exits 0; when `_JSON_AVAILABLE=false` it exits 0 before any later `json_field` use.

## Event Contract

The event is detected from the stdin JSON:

```bash
HOOK_EVENT="SessionStart"
case "$INPUT" in
  *'"prompt"'*) HOOK_EVENT="UserPromptSubmit" ;;
esac
```

The quoted `"prompt"` key cannot come from a session UUID or a cwd path, so the match does not misfire.

| Event | State | Behavior |
|-------|-------|----------|
| UserPromptSubmit | any | **immediate exit 0 before any proxy-state read**; silent (SessionStart handles all state) |
| SessionStart | no `proxy.json`, or `enabled` not true | exit 0 |
| SessionStart | port UP, identity correct | exit 0, no output |
| SessionStart | port UP, identity wrong | exit 0 + `json_session_output` warning ("port occupied by another application") |
| SessionStart | port UP, curl absent | assume ours, exit 0 (the CLI `--status` is the authoritative identity check) |
| SessionStart | port DOWN, bin or config missing after re-resolution fails; or node missing | exit 0 + warning ("relay binary not found", "routing config not found", "Node.js not found") |
| SessionStart | port DOWN, prerequisites ok | acquire spawn lock, `nohup` spawn, write `proxy.pid`, wait, exit 0 (+ warning when the relay never comes up) |
| SessionStart | port DOWN, lock busy | sleep, re-probe: up means exit 0, else a note that the relay is starting in another session |

State comes from `proxy.json` through `json_field_file`, with the machine root fixed at `$HOME/.devflow`. `binPath` and `configPath` are read only in the SessionStart-down branch, so the common enabled-and-up path pays no extra reads. Debug tracing of the cwd (`json_field "cwd"`) runs only under `DEVFLOW_HOOK_DEBUG=1`.

## Port and Identity

- **TCP probe**: a bash `/dev/tcp` connect in a subshell (Bash 3.2-safe; no `nc`). The port was digit-validated first (KB-INV-3).
- **Identity check**: guarded by `command -v curl`; `GET /__subswitch/health` with a short `--max-time`, then `json_field "name"` is compared with the internal package name. `json_field` is always available at that call site because the hook already exited when `_JSON_AVAILABLE=false`. A mismatch logs "possible squatting" and warns the session.
- **Branding**: the package name is acceptable in this script's code, log lines and spawn arguments, never in `additionalContext` text (KB-AP-7).

## binPath Re-resolution (D-FIX4)

When the persisted `binPath` is empty or no longer a file (npx cache GC, a devflow upgrade), the hook tries two strategies before warning:

- **Strategy (a)**: from the resolved `devflow` CLI (`realpath`/`readlink -f`), a bounded walk (`_WALK_GUARD`, a handful of `dirname` steps) to the nearest `node_modules/subswitch/package.json`. The `bin` field is read with `node -p`, with the path passed through an env var to avoid quoting problems; the walk stops at the first such directory whether or not it yielded a bin.
- **Strategy (b)**: `command -v subswitch`, for globally installed CLIs.

The healed path serves this session only (KB-AP-8, KB-INV-7). After the bin check the hook also requires `node` on PATH and an existing `configPath`; each missing prerequisite is its own warning.

## Spawn and Environment

The hook takes the spawn lock with `learning_lock_acquire` (stale-break by the lock helper), spawns `nohup env -i "${_RELAY_ENV[@]}" node "$PROXY_BIN" serve` with stdout and stderr to `proxy.log`, then writes `proxy.pid` best-effort. The pid write mirrors the CLI enable path: `devflow proxy --status` reads the file to show a process line for hook-started relays, and a stale pid from a relay that never came up is harmless because `--status` liveness-checks it (`process.kill(pid, 0)`). The spawn wait polls for the port in 0.1 s steps, up to roughly eight seconds. The CLI's loop is shorter on purpose: the hook fires inside the 15-second platform timeout and needs a wider cold-start window (first session after a reboot), while the CLI user waits interactively.

**`env -i` allowlist (SEC-2).** The relay starts from an empty environment plus the `_RELAY_ENV` array: `PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, `SUBSWITCH_CONFIG`, and, only when non-empty, `NODE_EXTRA_CA_CERTS` (so corporate-TLS deployments can supply a CA bundle). `NODE_OPTIONS` is excluded (KB-AP-2). The TypeScript spawn path mirrors it:

- `scrubChildEnv()` in `proxy-log.ts` returns only the base variables present in `process.env` (`PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, `NODE_EXTRA_CA_CERTS`; plus `SystemRoot`, `APPDATA`, `USERPROFILE`, `ComSpec` on win32). Absent variables are omitted rather than set to undefined.
- Call sites add their process-specific variables on top: `SUBSWITCH_CONFIG` for the relay spawn and the doctor spawn; model discovery adds `NO_COLOR` and an `XDG_CONFIG_HOME` redirect (see the agent-config knowledge base).
- The runtime's reads on the paths devflow invokes (serve, doctor, models) are `ANTHROPIC_API_KEY`, `FORCE_COLOR`, `NO_COLOR`, `SUBSWITCH_CONFIG` and `XDG_CONFIG_HOME`; an allowlist is the correct shape because the rest of the inherited environment is noise or risk. `HOME` stays because the runtime resolves `~` paths through `homedir()`.
- A drift-guard test in `tests/proxy-log.test.ts` asserts the hook contains the conditional `NODE_EXTRA_CA_CERTS` append, so a one-sided change is caught (KB-AP-3, KB-AP-4).

## Log Handling

- The hook creates `~/.devflow/logs` at 0700 (best-effort `chmod` on a pre-existing wider directory) and `proxy.log` at 0600.
- **Size guard**: `_LOG_MAX_BYTES` triggers truncation to the last `_LOG_TAIL_BYTES`, named variables matching the `hook-log-init` guard pattern. `hook-log-init` itself cannot be shared because it requires a per-project cwd and path; the hook uses the machine-wide log. The file-existence check is required because a failed `wc -c <file` redirect is reported by bash itself, before `wc` starts, bypassing `2>/dev/null`. The tail goes to a temp file under `umask 077` and is moved over the log (KB-INV-6).
- `openProxyLog` (TypeScript) creates the parent at 0700 and the file at 0600 with a best-effort `chmod` for a pre-existing wider file, never failing the enable on a chmod error.
- `rotateProxyLogIfLarge` runs once, before the CLI spawns (KB-AP-5). Discovery writes to `proxy.log` while the relay is up and caps each message (`LOG_WRITE_CAP`).

## Tests

`tests/shell-hooks.test.ts` covers the spawn path with a stub relay that reads `SUBSWITCH_CONFIG` and binds the port, asserting a silent exit (0, no stdout or stderr), a live pid in `proxy.pid`, and a released spawn lock. The failure branch (the full wait) is intentionally not unit-tested because of its duration. Stub relays that tests spawn must be reaped on the failure path too (see the lifecycle knowledge base).

## Key Files

- `src/assets/scripts/hooks/ensure-proxy` — the hook; binPath re-resolution, `proxy.pid`, UserPromptSubmit fast exit, `env -i` allowlist
- `src/core/proxy-log.ts` — `scrubChildEnv()`, `openProxyLog()`, `rotateProxyLogIfLarge()`
- `tests/shell-hooks.test.ts` — hook spawn-path test with a stub relay
- `tests/proxy-log.test.ts` — env allowlist drift guard

## Related

- `.devflow/features/external-model-routing/KNOWLEDGE.md` — the hub: enable/disable lifecycle, preflight, settings teardown and the hook registration helpers
- `.devflow/features/external-model-routing-agent-config/KNOWLEDGE.md` — model discovery, which spawns the runtime with `scrubChildEnv()` plus a redirected `XDG_CONFIG_HOME`
- `src/cli/commands/proxy.ts` — `spawnRelayAndWaitForPort`, `addProxyHooks`, `removeProxyHooks`
