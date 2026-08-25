/**
 * ANSI color helpers — no dependencies, precompiled escape sequences.
 *
 * Neutral home for terminal-primitive helpers shared across CLI layers
 * (src/cli/tui/, src/cli/flags-view/, src/cli/agents-view/) and the HUD
 * feature module (src/hud/). Re-exported verbatim from src/hud/colors.ts
 * so all existing HUD call sites remain untouched.
 *
 * applies ADR-013: src/core/ = agent-neutral logic; ANSI primitives have no
 * feature coupling and belong here, not in a feature module.
 * applies PF-017 corollary: one shared definition over per-consumer copies.
 */

const ESC = '\x1b[';
const RESET = `${ESC}0m`;

export function bold(s: string): string {
  return `${ESC}1m${s}${RESET}`;
}
export function dim(s: string): string {
  return `${ESC}2m${s}${RESET}`;
}
export function red(s: string): string {
  return `${ESC}31m${s}${RESET}`;
}
export function green(s: string): string {
  return `${ESC}32m${s}${RESET}`;
}
export function yellow(s: string): string {
  return `${ESC}33m${s}${RESET}`;
}
export function blue(s: string): string {
  return `${ESC}34m${s}${RESET}`;
}
export function magenta(s: string): string {
  return `${ESC}35m${s}${RESET}`;
}
export function cyan(s: string): string {
  return `${ESC}36m${s}${RESET}`;
}
export function gray(s: string): string {
  return `${ESC}90m${s}${RESET}`;
}
export function white(s: string): string {
  return `${ESC}37m${s}${RESET}`;
}
export function orange(s: string): string {
  return `${ESC}38;5;208m${s}${RESET}`;
}
export function brightRed(s: string): string {
  return `${ESC}91m${s}${RESET}`;
}
export function boldRed(s: string): string {
  return `${ESC}1;31m${s}${RESET}`;
}
export function bgGreen(s: string): string {
  return `${ESC}42m${s}${RESET}`;
}
export function bgYellow(s: string): string {
  return `${ESC}43m${s}${RESET}`;
}
export function bgRed(s: string): string {
  return `${ESC}41m${s}${RESET}`;
}
export function inverse(s: string): string {
  return `${ESC}7m${s}${RESET}`;
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// S2 — Terminal-escape and control-character sanitization (HIGH, pre-existing defect).
//
// The prior pattern (/\x1b\[[0-9;]*m/g) matched only SGR sequences (colour).
// The broadened ANSI_PATTERN also covers:
//   CSI sequences  — \x1b[ ... with intermediate bytes, any final byte
//   OSC sequences  — \x1b] ... terminated by BEL (\x07) or ST (\x1b\\)
//   Two-byte C1    — \x1b followed by any single character in the C1 range
// CTRL_PATTERN removes non-printable C0 control chars that are not TAB (\x09)
// or standard newlines (\x0a, \x0d).  Together they prevent agent names
// embedded in model IDs from injecting escape sequences into --list output.

const ANSI_PATTERN =
  /\x1b(?:\[[0-9;?]*[ -\/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

const CTRL_PATTERN = /[\x00-\x08\x0b-\x1f\x7f]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_PATTERN, '').replace(CTRL_PATTERN, '');
}
