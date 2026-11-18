import { constants, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { findFlag, holdsOwnEnvPayload, holdsUserEnvValue, isEnvBooleanFlag } from './flags.js';
import { readGateManifest } from './gate-level.js';
import { classifyProxyBaseUrl, DEFAULT_PROXY_PORT, readProxyState } from './proxy-state.js';
import type { ProxyEnvState, Result } from './proxy-state.js';

export const CODE_MODE_ENABLE_REFUSAL = 'Cannot enable Code Mode while the Devflow proxy is on. Run `devflow proxy --disable` first.';
export const PROXY_ENABLE_REFUSAL = 'Cannot enable the Devflow proxy while Code Mode is on. Run `devflow flags --disable code-mode` first.';
export const CODE_MODE_READ_FAILURE = 'Cannot make this change because Devflow could not check the Code Mode and proxy state.';
export const CODE_MODE_PROXY_BLOCKER = 'Code Mode does not start while the Devflow proxy is on. Run `devflow flags --disable code-mode` or `devflow proxy --disable`.';
export const CODE_MODE_TRAFFIC_BLOCKER = 'Code Mode does not start while disable-nonessential-traffic is on. Run `devflow flags --disable code-mode`.';
export const CODE_MODE_USER_VALUE_NOTE = 'Code Mode is off because your settings override the flag.';
export const CODE_MODE_RECORD_FALSE_NOTE = 'Your settings enable Code Mode, but the flag record is off. The next flag write removes the Code Mode setting.';
export const CODE_MODE_NEW_SESSIONS_SUFFIX = 'This change applies to new sessions only.';

const codeModeFlag = findFlag('code-mode');
const trafficFlag = findFlag('disable-nonessential-traffic');
const MAX_SETTINGS_BYTES = 1024 * 1024;

type RawRecord = Readonly<Record<string, unknown>>;

export interface CodeModeSignals {
  readonly env: RawRecord | undefined;
  readonly record: RawRecord | null;
  readonly proxyOn: boolean;
}

export interface CodeModeBlockerState {
  readonly codeModeOn: boolean;
  readonly proxyOn: boolean;
  readonly trafficOn: boolean;
}

export function isCodeModeOn(record: RawRecord | null, env: RawRecord | undefined): boolean {
  if (codeModeFlag && isEnvBooleanFlag(codeModeFlag)) {
    if (holdsOwnEnvPayload(codeModeFlag, env)) return true;
    if (holdsUserEnvValue(codeModeFlag, env)) return false;
  }
  return record?.['code-mode'] === true;
}

export function isTrafficOn(record: RawRecord | null, env: RawRecord | undefined): boolean {
  if (record?.['disable-nonessential-traffic'] === true) return true;
  if (!env || !trafficFlag || !isEnvBooleanFlag(trafficFlag)) return false;
  const key = trafficFlag.target.key;
  return Object.hasOwn(env, key) && env[key] !== '0' && env[key] !== 'false';
}

export function isProxyOn({ proxyJsonOn, manifestProxy, urlState }: {
  readonly proxyJsonOn: boolean;
  readonly manifestProxy: boolean;
  readonly urlState: ProxyEnvState;
}): boolean {
  return proxyJsonOn || manifestProxy || urlState === 'ours' || urlState === 'ours-other-port';
}

export function turnsOnCodeMode(beforeOn: boolean, requestedOn: boolean): boolean {
  return !beforeOn && requestedOn;
}

export function codeModeRefusal(before: Pick<CodeModeSignals, 'proxyOn'>, turnsOn: boolean): string | undefined {
  return turnsOn && before.proxyOn ? CODE_MODE_ENABLE_REFUSAL : undefined;
}

/** D-CODE-MODE-BLOCKERS: Report conflicts only while Code Mode is on. */
export function codeModeBlockers({ codeModeOn, proxyOn, trafficOn }: CodeModeBlockerState): string[] {
  if (!codeModeOn) return [];
  const lines: string[] = [];
  if (proxyOn) lines.push(CODE_MODE_PROXY_BLOCKER);
  if (trafficOn) lines.push(CODE_MODE_TRAFFIC_BLOCKER);
  return lines;
}

/** Warn once per blocker in the final state, even if the write did not add it. */
export function writeTimeWarnings(_before: CodeModeBlockerState, after: CodeModeBlockerState): string[] {
  return codeModeBlockers(after);
}

export function initCodeModeWarnings({ proxyEnabled, record, env }: {
  readonly proxyEnabled: boolean;
  readonly record: RawRecord | null;
  readonly env: RawRecord | undefined;
}): string[] {
  return codeModeBlockers({
    codeModeOn: isCodeModeOn(record, env),
    proxyOn: proxyEnabled,
    trafficOn: isTrafficOn(record, env),
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readSettingsEnv(settingsPath: string): Promise<RawRecord | undefined> {
  try {
    // O_NONBLOCK prevents a pipe at this path from blocking the open.
    const file = await fs.open(settingsPath, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_SETTINGS_BYTES) return undefined;
      const buffer = Buffer.alloc(stat.size + 1);
      const { bytesRead } = await file.read(buffer);
      if (bytesRead !== stat.size) return undefined;
      const settings: unknown = JSON.parse(buffer.toString('utf8', 0, bytesRead));
      if (!isPlainObject(settings)) return undefined;
      return isPlainObject(settings.env) ? settings.env : {};
    } finally {
      await file.close();
    }
  } catch (err) {
    return err instanceof Error && 'code' in err && err.code === 'ENOENT' ? {} : undefined;
  }
}

/**
 * D-CODE-MODE-SIGNALS: Read only local files. Never probe the relay or heal the manifest.
 * Count an unreadable proxy state file as on. Ignore an absent or corrupt manifest.
 * A null Devflow directory limits the check to the user settings env.
 */
export async function readCodeModeSignals(
  claudeDir: string,
  devflowDir: string | null,
): Promise<Result<CodeModeSignals, string>> {
  try {
    const env = await readSettingsEnv(join(claudeDir, 'settings.json'));
    const [proxy, manifest] = devflowDir === null
      ? [null, null]
      : await Promise.all([readProxyState(devflowDir), readGateManifest(devflowDir)]);
    const rawFeatures = manifest && 'raw' in manifest ? manifest.raw.features : null;
    const features = isPlainObject(rawFeatures) ? rawFeatures : null;
    const urlState = classifyProxyBaseUrl(env?.ANTHROPIC_BASE_URL, proxy?.ok ? proxy.value.port : DEFAULT_PROXY_PORT);
    return {
      ok: true,
      value: {
        env,
        record: isPlainObject(features?.flags) ? features.flags : null,
        proxyOn: isProxyOn({
          proxyJsonOn: proxy !== null && (!proxy.ok || proxy.value.enabled),
          manifestProxy: features?.proxy === true,
          urlState,
        }),
      },
    };
  } catch {
    return { ok: false, error: CODE_MODE_READ_FAILURE };
  }
}
