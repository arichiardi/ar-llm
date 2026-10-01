#!/usr/bin/env bash
# Append a journal entry to the org-roam note for a date
# Usage: append-journal.sh TITLE CONTENT [--date YYYY-MM-DD]
#
# TITLE becomes the entry heading. CONTENT becomes the body. Use "-" for
# list items in CONTENT; lines that start with "*" are rejected.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TITLE="${1:?Usage: append-journal.sh TITLE CONTENT [--date YYYY-MM-DD]}"
CONTENT="${2:?Content is required}"
DATE="nil"
shift 2
while [ $# -gt 0 ]; do
  case "$1" in
    --date) DATE="\"$2\""; shift ;;
    *) shift ;;
  esac
done
"$SCRIPT_DIR/query.sh" "(org-roam-pi-append-journal \"$TITLE\" \"$CONTENT\" $DATE)"
