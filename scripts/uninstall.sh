#!/usr/bin/env bash
# dsh-chat-preset uninstaller for Linux / macOS / Git Bash.
#
# Removes the "Chat" agent preset row from the target profile patch and deletes
# the code-tutor skill copies this installer created. Your own edits elsewhere in
# the profile patch are left untouched.
#
# Usage:
#   ./scripts/uninstall.sh [--profile NAME] [--dsh-home PATH] [--keep-global-skill]
#
#   --profile NAME       DSH profile the preset was installed into (default: desktop)
#   --dsh-home PATH      DSH home directory (default: $DSH_HOME, else ~/.dsh)
#   --keep-global-skill  Leave $DSH_HOME/skills/code-tutor in place
#   -h, --help           Show this help

set -euo pipefail

PROFILE="${DSH_PROFILE:-desktop}"
DSH_HOME_ARG=""
KEEP_GLOBAL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:?--profile needs a value}"; shift 2 ;;
    --dsh-home) DSH_HOME_ARG="${2:?--dsh-home needs a value}"; shift 2 ;;
    --keep-global-skill) KEEP_GLOBAL=1; shift ;;
    -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

PATCH_FILE="${DSH_HOME}/profiles/${PROFILE}/cordis.patch.yml"
PRESET_SKILL_DIR="${DSH_HOME}/presets/chat/skills/code-tutor"
PRESET_SKILLS_ROOT="${DSH_HOME}/presets/chat/skills"
PRESET_ROOT="${DSH_HOME}/presets/chat"
GLOBAL_SKILL_DIR="${DSH_HOME}/skills/code-tutor"

BEGIN_MARK="# >>> dsh-chat-preset (managed block - do not edit by hand) >>>"
END_MARK="# <<< dsh-chat-preset <<<"

echo "DSH home : ${DSH_HOME}"
echo "Profile  : ${PROFILE}"

# ---- 1. the preset row ---------------------------------------------------
if [ -f "${PATCH_FILE}" ]; then
  TMP_FILE="$(mktemp)"
  trap 'rm -f "${TMP_FILE}"' EXIT
  awk -v begin="${BEGIN_MARK}" -v end="${END_MARK}" '
    $0 == begin { skipping = 1; next }
    $0 == end   { skipping = 0; next }
    skipping != 1 { print }
  ' "${PATCH_FILE}" > "${TMP_FILE}"
  # Installing the block adds one leading blank line; drop a trailing blank run
  # so an install/uninstall cycle leaves the file exactly as it was found.
  awk '
    { lines[NR] = $0 }
    END {
      last = NR
      while (last > 0 && lines[last] ~ /^[[:space:]]*$/) last--
      for (i = 1; i <= last; i++) print lines[i]
    }
  ' "${TMP_FILE}" > "${TMP_FILE}.trimmed"
  cp -f "${TMP_FILE}.trimmed" "${PATCH_FILE}"
  rm -f "${TMP_FILE}.trimmed"
  echo "preset   <- removed managed block from ${PATCH_FILE}"
else
  echo "preset   -- ${PATCH_FILE} not found, nothing to remove"
fi

# ---- 2. the skill --------------------------------------------------------
if [ -d "${PRESET_SKILL_DIR}" ]; then
  rm -rf "${PRESET_SKILL_DIR}"
  echo "skill    <- removed ${PRESET_SKILL_DIR}"
fi
# Clean up the empty chat-preset skill tree, but never $DSH_HOME/skills itself.
if [ -d "${PRESET_SKILLS_ROOT}" ] && ! compgen -G "${PRESET_SKILLS_ROOT}/*" > /dev/null 2>&1; then
  rmdir "${PRESET_SKILLS_ROOT}" || true
fi
if [ -d "${PRESET_ROOT}" ] && ! compgen -G "${PRESET_ROOT}/*" > /dev/null 2>&1; then
  rmdir "${PRESET_ROOT}" || true
fi

if [ "${KEEP_GLOBAL}" -eq 0 ] && [ -d "${GLOBAL_SKILL_DIR}" ]; then
  rm -rf "${GLOBAL_SKILL_DIR}"
  echo "skill    <- removed ${GLOBAL_SKILL_DIR}"
fi

echo
echo "Uninstalled. Restart DeepSeek Harness for the roster change to take effect."
