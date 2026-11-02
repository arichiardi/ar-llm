#!/usr/bin/env bash
# Insert a child heading under an existing heading in a node file
# Usage: add-child.sh TARGET PARENT_TITLE CHILD_TITLE CONTENT [--refs REF...]
#
# TARGET is a node ID or a node file path (relative to the roam directory).
# PARENT_TITLE is the exact headline title to nest under. Use "" for top level.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${1:?Usage: add-child.sh TARGET PARENT_TITLE CHILD_TITLE CONTENT [--refs REF...]}"
PARENT="${2-}"
CHILD_TITLE="${3:?Child headline title is required}"
CONTENT="${4:?Content is required}"
REFS="nil"
shift 4
while [ $# -gt 0 ]; do
  case "$1" in
    --refs)
      REFS="'("
      shift
      while [ $# -gt 0 ] && [ "${1:0:2}" != "--" ]; do
        REFS="$REFS \"$1\""
        shift
      done
      REFS="$REFS )"
      ;;
    *) shift ;;
  esac
done
"$SCRIPT_DIR/query.sh" "(org-roam-pi-add-child \"$TARGET\" \"$PARENT\" \"$CHILD_TITLE\" \"$CONTENT\" $REFS)"
