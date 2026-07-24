#!/bin/sh
# install.sh — POSIX sh bootstrap for OpsForge installer (§8).
# Detects Node, then delegates to install.mjs. Git Bash compatible. No bashisms.
set -e

# Find node
if command -v node >/dev/null 2>&1; then
  NODE=node
elif command -v nodejs >/dev/null 2>&1; then
  NODE=nodejs
else
  echo "error: Node.js not found. Install Node 22+ from https://nodejs.org/" >&2
  exit 1
fi

# Resolve script directory (POSIX-compliant)
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

# Delegate to install.mjs
exec "$NODE" "$SCRIPT_DIR/install.mjs" "$@"
