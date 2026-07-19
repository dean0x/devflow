#!/usr/bin/env bash
# Devflow HUD — configurable TypeScript status line
# Receives JSON via stdin from Claude Code, outputs ANSI-formatted HUD
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "${SCRIPT_DIR}/hud/index.js"
