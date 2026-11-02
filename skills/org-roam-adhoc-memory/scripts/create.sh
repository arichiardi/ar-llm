#!/usr/bin/env bash
# Create a new org-roam note
# Usage: create.sh TITLE CONTENT [--file PATH] [--refs REF1 REF2 ...]
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TITLE="${1:?Usage: create.sh TITLE CONTENT [--file PATH] [--refs REF...]}"
CONTENT="${2:?Content is required}"
FILE="nil"
REFS="nil"
shift 2
while [ $# -gt 0 ]; do
  case "$1" in
    --file) FILE="\"$2\""; shift ;;
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
"$SCRIPT_DIR/query.sh" "(org-roam-pi-create \"$TITLE\" \"$CONTENT\" $FILE $REFS)"
