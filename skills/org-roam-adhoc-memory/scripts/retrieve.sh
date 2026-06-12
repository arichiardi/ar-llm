#!/usr/bin/env bash
# Retrieve full content of an org-roam node
# Usage: retrieve.sh --id UUID  OR  retrieve.sh --title "Title"
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ $# -lt 2 ]; then
  echo '{"error":"Usage: retrieve.sh --id UUID | --title TITLE"}' >&2
  exit 1
fi
case "$1" in
  --id)    "$SCRIPT_DIR/query.sh" "(org-roam-pi-retrieve \"$2\" nil)" ;;
  --title) "$SCRIPT_DIR/query.sh" "(org-roam-pi-retrieve nil \"$2\")" ;;
  *)       echo '{"error":"Unknown flag: '$1'. Use --id or --title"}' >&2; exit 1 ;;
esac
