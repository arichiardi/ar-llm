#!/usr/bin/env bash
# Create a new org-roam note
# Usage: create.sh TITLE CONTENT [--file PATH] [--tags TAG1 TAG2 ...]
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TITLE="${1:?Usage: create.sh TITLE CONTENT [--file PATH] [--tags TAG...]}"
CONTENT="${2:?Content is required}"
FILE="nil"
TAGS="nil"
shift 2
while [ $# -gt 0 ]; do
  case "$1" in
    --file) FILE="\"$2\""; shift ;;
    --tags)
      TAGS="("
      shift
      while [ $# -gt 0 ] && [ "${1:0:2}" != "--" ]; do
        TAGS="$TAGS \"$1\""
        shift
      done
      TAGS="$TAGS )"
      ;;
    *) shift ;;
  esac
done
"$SCRIPT_DIR/query.sh" "(org-roam-pi-create \"$TITLE\" \"$CONTENT\" $FILE $TAGS)"
