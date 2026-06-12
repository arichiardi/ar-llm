#!/usr/bin/env bash
# Multi-hop BFS graph traversal from a seed node
# Usage: graph.sh --id UUID [MAX_HOPS]
#        graph.sh --title "Title" [MAX_HOPS]
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ $# -lt 2 ]; then
  echo '{"error":"Usage: graph.sh --id UUID | --title TITLE [max_hops]"}' >&2
  exit 1
fi
HOPS="${3:-2}"
case "$1" in
  --id)    "$SCRIPT_DIR/query.sh" "(org-roam-pi-graph \"$2\" nil $HOPS)" ;;
  --title) "$SCRIPT_DIR/query.sh" "(org-roam-pi-graph nil \"$2\" $HOPS)" ;;
  *)       echo '{"error":"Unknown flag: '$1'. Use --id or --title"}' >&2; exit 1 ;;
esac
