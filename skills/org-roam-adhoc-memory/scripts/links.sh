#!/usr/bin/env bash
# Show links/backlinks for an org-roam node
# Usage: links.sh --id UUID [outgoing|incoming|both]
#        links.sh --title "Title" [outgoing|incoming|both]
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ $# -lt 2 ]; then
  echo '{"error":"Usage: links.sh --id UUID | --title TITLE [direction]"}' >&2
  exit 1
fi
DIR="${3:-both}"
case "$1" in
  --id)    "$SCRIPT_DIR/query.sh" "(org-roam-pi-links \"$2\" nil \"$DIR\")" ;;
  --title) "$SCRIPT_DIR/query.sh" "(org-roam-pi-links nil \"$2\" \"$DIR\")" ;;
  *)       echo '{"error":"Unknown flag: '$1'. Use --id or --title"}' >&2; exit 1 ;;
esac
