import { promises as fs } from 'fs';
import * as path from 'path';
import type { Shell } from './safe-delete.js';

const START_MARKER = '# >>> DevFlow safe-delete >>>';
const END_MARKER = '# <<< DevFlow safe-delete <<<';

/**
 * Generate the safe-delete shell function block with markers.
 * Returns null for unsupported shells.
 */
export function generateSafeDeleteBlock(
  shell: Shell,
  platform: NodeJS.Platform,
  trashCommand: string | null,
): string | null {
  if (shell === 'unknown') return null;

  if (shell === 'bash' || shell === 'zsh') {
    const cmd = trashCommand ?? 'trash';
    return [
      START_MARKER,
      `rm() {`,
      `  local files=()`,
      `  for arg in "$@"; do`,
      `    [[ "$arg" =~ ^- ]] || files+=("$arg")`,
      `  done`,
      `  if (( \${#files[@]} > 0 )); then`,
      `    ${cmd} "\${files[@]}"`,
      `  fi`,
      `}`,
      `command() {`,
      `  if [[ "$1" == "rm" ]]; then`,
      `    shift; rm "$@"`,
      `  else`,
      `    builtin command "$@"`,
      `  fi`,
      `}`,
      END_MARKER,
    ].join('\n');
  }

  if (shell === 'fish') {
    const cmd = trashCommand ?? 'trash';
    return [
      START_MARKER,
      `function rm --description "Safe delete via trash"`,
      `  set -l files`,
      `  for arg in $argv`,
      `    if not string match -q -- '-*' $arg`,
      `      set files $files $arg`,
      `    end`,
      `  end`,
      `  if test (count $files) -gt 0`,
      `    ${cmd} $files`,
      `  end`,
      `end`,
      END_MARKER,
    ].join('\n');
  }

  if (shell === 'powershell') {
    if (platform === 'win32') {
      return [
        START_MARKER,
        `if (Get-Alias rm -ErrorAction SilentlyContinue) {`,
        `  Remove-Alias rm -Force -Scope Global`,
        `}`,
        `function rm {`,
        `  $files = $args | Where-Object { $_ -notlike '-*' }`,
        `  if ($files) {`,
        `    Add-Type -AssemblyName Microsoft.VisualBasic`,
        `    foreach ($f in $files) {`,
        `      $p = Resolve-Path $f -ErrorAction SilentlyContinue`,
        `      if ($p) {`,
        `        if (Test-Path $p -PathType Container) {`,
        `          [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(`,
        `            $p, 'OnlyErrorDialogs', 'SendToRecycleBin')`,
        `        } else {`,
        `          [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(`,
        `            $p, 'OnlyErrorDialogs', 'SendToRecycleBin')`,
        `        }`,
        `      }`,
        `    }`,
        `  }`,
        `}`,
        END_MARKER,
      ].join('\n');
    }
    // macOS/Linux PowerShell
    const cmd = trashCommand ?? 'trash';
    return [
      START_MARKER,
      `if (Get-Alias rm -ErrorAction SilentlyContinue) {`,
      `  Remove-Alias rm -Force -Scope Global`,
      `}`,
      `function rm {`,
      `  $files = $args | Where-Object { $_ -notlike '-*' }`,
      `  if ($files) { & ${cmd} @files }`,
      `}`,
      END_MARKER,
    ].join('\n');
  }

  return null;
}

/**
 * Check if the safe-delete block is already installed in a profile file.
 */
export async function isAlreadyInstalled(profilePath: string): Promise<boolean> {
  try {
    const content = await fs.readFile(profilePath, 'utf-8');
    return content.includes(START_MARKER) && content.includes(END_MARKER);
  } catch {
    return false;
  }
}

/**
 * Append the safe-delete block to a profile file.
 * Creates parent directories and the file if they don't exist.
 */
export async function installToProfile(profilePath: string, block: string): Promise<void> {
  await fs.mkdir(path.dirname(profilePath), { recursive: true });

  let existing = '';
  try {
    existing = await fs.readFile(profilePath, 'utf-8');
  } catch {
    // File doesn't exist yet — will be created
  }

  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n\n' : '\n';
  const content = existing.length > 0 ? existing + separator + block + '\n' : block + '\n';
  await fs.writeFile(profilePath, content, 'utf-8');
}

/**
 * Remove the safe-delete block from a profile file.
 * Returns true if the block was found and removed, false otherwise.
 * For fish function files, deletes the file if it becomes empty.
 */
export async function removeFromProfile(profilePath: string): Promise<boolean> {
  let content: string;
  try {
    content = await fs.readFile(profilePath, 'utf-8');
  } catch {
    return false;
  }

  const startIdx = content.indexOf(START_MARKER);
  const endIdx = content.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1) return false;

  const before = content.slice(0, startIdx);
  const after = content.slice(endIdx + END_MARKER.length);

  // Clean up surrounding whitespace
  const cleaned = (before.trimEnd() + after.trimStart()).trim();

  if (cleaned.length === 0) {
    // File is empty after removal — delete it (fish function files)
    await fs.unlink(profilePath);
  } else {
    await fs.writeFile(profilePath, cleaned + '\n', 'utf-8');
  }

  return true;
}
