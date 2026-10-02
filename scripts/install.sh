#!/usr/bin/env bash
# dsh-chat-preset installer for Linux / macOS / Git Bash.
#
# Installs the "Chat" agent preset and the code-tutor skill into a DeepSeek
# Harness (DSH) home. Idempotent: re-running replaces the previous install.
#
# Usage:
#   ./scripts/install.sh [--profile NAME] [--dsh-home PATH] [--no-global-skill]
#
#   --profile NAME     DSH profile to install the preset into (default: desktop)
#   --dsh-home PATH    DSH home directory (default: $DSH_HOME, else ~/.dsh)
#   --no-global-skill  Do not also expose code-tutor to every other preset
#   -h, --help         Show this help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PROFILE="${DSH_PROFILE:-desktop}"
DSH_HOME_ARG=""
GLOBAL_SKILL=1

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:?--profile needs a value}"; shift 2 ;;
    --dsh-home) DSH_HOME_ARG="${2:?--dsh-home needs a value}"; shift 2 ;;
    --no-global-skill) GLOBAL_SKILL=0; shift ;;
    -h|--help) sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "error: unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Resolve the harness home: an explicit --dsh-home wins, then $DSH_HOME, then
# the shipped default. A blank environment value is treated as unset.
home_override="${DSH_HOME_ARG}"
if [ -z "${home_override}" ]; then
  home_override="${DSH_HOME:-}"
fi
if [ -z "${home_override}" ]; then
  home_override="${HOME}/.dsh"
fi
readonly DSH_HOME="${home_override}"

PRESET_SRC="${REPO_ROOT}/preset/chat.patch.yml"
SKILL_SRC="${REPO_ROOT}/skills/code-tutor/SKILL.md"
PROFILE_DIR="${DSH_HOME}/profiles/${PROFILE}"
PATCH_FILE="${PROFILE_DIR}/cordis.patch.yml"
PRESET_SKILL_DIR="${DSH_HOME}/presets/chat/skills/code-tutor"
GLOBAL_SKILL_DIR="${DSH_HOME}/skills/code-tutor"

BEGIN_MARK="# >>> dsh-chat-preset (managed block - do not edit by hand) >>>"
END_MARK="# <<< dsh-chat-preset <<<"

for f in "${PRESET_SRC}" "${SKILL_SRC}"; do
  [ -f "$f" ] || { echo "error: missing repository file: $f" >&2; exit 1; }
done

echo "DSH home : ${DSH_HOME}"
echo "Profile  : ${PROFILE}"

# ---- 1. the code-tutor skill --------------------------------------------
mkdir -p "${PRESET_SKILL_DIR}"
cp -f "${SKILL_SRC}" "${PRESET_SKILL_DIR}/SKILL.md"
echo "skill    -> ${PRESET_SKILL_DIR}/SKILL.md"

if [ "${GLOBAL_SKILL}" -eq 1 ]; then
  mkdir -p "${GLOBAL_SKILL_DIR}"
  cp -f "${SKILL_SRC}" "${GLOBAL_SKILL_DIR}/SKILL.md"
  echo "skill    -> ${GLOBAL_SKILL_DIR}/SKILL.md  (usable by other presets)"
fi

# ---- 2. the preset row in the profile patch ------------------------------
mkdir -p "${PROFILE_DIR}"
if [ ! -f "${PATCH_FILE}" ]; then
  printf '# Your patch layer for this dsh profile, applied after every bundle layer.\n' > "${PATCH_FILE}"
fi

TMP_FILE="$(mktemp)"
trap 'rm -f "${TMP_FILE}" "${TMP_FILE}.new"' EXIT
# Remove every previously managed block, plus the trailing blank lines it left.
awk -v begin="${BEGIN_MARK}" -v end="${END_MARK}" '
  $0 == begin { skipping = 1; next }
  $0 == end   { skipping = 0; next }
  skipping != 1 { print }
' "${PATCH_FILE}" > "${TMP_FILE}"

awk '
  { lines[NR] = $0 }
  END {
    last = NR
    while (last > 0 && lines[last] ~ /^[[:space:]]*$/) last--
    for (i = 1; i <= last; i++) print lines[i]
  }
' "${TMP_FILE}" > "${TMP_FILE}.new"

# Append the current block.
{
  printf '\n%s\n' "${BEGIN_MARK}"
  cat "${PRESET_SRC}"
  printf '%s\n' "${END_MARK}"
} >> "${TMP_FILE}.new"

cp -f "${TMP_FILE}.new" "${PATCH_FILE}"
echo "preset   -> ${PATCH_FILE}"

echo
echo "Installed. Restart DeepSeek Harness and pick the \"Chat\" preset for a new"
echo "session (Settings -> Agent presets, or the preset picker in the composer)."
echo "Verify the install with: bash ./scripts/verify.sh"
