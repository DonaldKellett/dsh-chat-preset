#!/usr/bin/env bash
# dsh-chat-preset verifier for Linux / macOS / Git Bash on Windows.
#
# Thin wrapper around scripts/verify.mjs. It locates a usable Node.js, including
# the one bundled with the DeepSeek Harness desktop app, and hands over.
#
# Usage:
#   ./scripts/verify.sh [--profile NAME] [--dsh-home PATH]
#
# Environment:
#   DSH_BUNDLED_NODE  Explicit path to a Node.js executable. Checked first.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if command -v node >/dev/null 2>&1; then
  exec node "${SCRIPT_DIR}/verify.mjs" "$@"
fi

# Candidate Node.js locations, including the DeepSeek Harness desktop app's
# bundled runtime on Linux, macOS, and Windows (Git Bash reports /c/...).
candidates=()
if [ -n "${DSH_BUNDLED_NODE:-}" ]; then
  candidates+=("${DSH_BUNDLED_NODE}")
fi
for base in "${LOCALAPPDATA:-}" "${ProgramFiles:-}" "/c/Program Files" "/c/Program Files (x86)"; do
  [ -n "${base}" ] || continue
  candidates+=(
    "${base}/Programs/DeepSeek Harness/resources/runtime/primary-runtime/dependencies/node/bin/node.exe"
    "${base}/DeepSeek Harness/resources/runtime/primary-runtime/dependencies/node/bin/node.exe"
  )
done
candidates+=(
  "${HOME}/.dsh/runtime/node/bin/node"
  "/opt/DeepSeek Harness/resources/runtime/primary-runtime/dependencies/node/bin/node"
  "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node"
)

for candidate in "${candidates[@]}"; do
  if [ -n "${candidate}" ] && [ -x "${candidate}" ]; then
    exec "${candidate}" "${SCRIPT_DIR}/verify.mjs" "$@"
  fi
done

echo "error: no Node.js found. Install Node.js 22+, or set DSH_BUNDLED_NODE to the bundled node binary." >&2
exit 1
