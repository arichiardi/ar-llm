#!/usr/bin/env bash
# org-roam-adhoc-memory core query helper
# Usage: query.sh 'ELISP-EXPRESSION'
# Returns clean JSON on stdout, errors as JSON on stderr + exit 1.
#
# Debugging: set ORG_ROAM_PI_MEMORY_DEBUG=true to log all activity.
# The default log path is $TMPDIR/org-roam-pi-memory-debug.log.
set -uo pipefail

AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.config/pi/agent}"
EXT_DIR="$AGENT_DIR/extensions/org-roam-memory"
CONFIG_FILE="$AGENT_DIR/org-roam-memory/config.json"
DEFAULT_DEBUG_LOG_BASE="${TMPDIR:-/tmp}"
DEFAULT_DEBUG_LOG_BASE="${DEFAULT_DEBUG_LOG_BASE%/}"
DEFAULT_DEBUG_LOG="$DEFAULT_DEBUG_LOG_BASE/org-roam-pi-memory-debug.log"
EMACSCLIENT="${EMACSCLIENT:-emacsclient}"

# Read the debug log path from config.json; fall back to the OS temp dir
DEBUG_LOG=""
if [ -f "$CONFIG_FILE" ]; then
  DEBUG_LOG=$(jq -r '.debug["log-file"] // empty' "$CONFIG_FILE" 2>/dev/null)
fi
[ -n "$DEBUG_LOG" ] || DEBUG_LOG="$DEFAULT_DEBUG_LOG"
# Expand ~ in path
DEBUG_LOG="${DEBUG_LOG/#\~/$HOME}"

BOOTSTRAP="(progn
  (add-to-list 'load-path \"$EXT_DIR\")
  (require 'org)
  (load (expand-file-name \"org-roam-pi-memory\" (car load-path)) nil t)
  (org-roam-pi-apply-config \"$CONFIG_FILE\"))"

_debug() {
  if [ "${ORG_ROAM_PI_MEMORY_DEBUG:-false}" = "true" ]; then
    echo "[$(date -u +%FT%TZ)] $*" >> "$DEBUG_LOG"
  fi
}

if [ $# -lt 1 ]; then
  echo '{"error":"Usage: query.sh '\''ELISP-EXPRESSION'\''"}' >&2
  exit 1
fi

ELISP_EXPR="$1"
_debug "INPUT: $ELISP_EXPR"

TMPDIR_QUERY=$(mktemp -d)
STDOUT_FILE="$TMPDIR_QUERY/stdout"
STDERR_FILE="$TMPDIR_QUERY/stderr"
trap "rm -rf '$TMPDIR_QUERY'" EXIT

"$EMACSCLIENT" --eval "(progn $BOOTSTRAP (condition-case err (princ (progn $ELISP_EXPR)) (error (princ (format \"*ERROR* %s\" (error-message-string err))))))" \
  >"$STDOUT_FILE" 2>"$STDERR_FILE" || true

RAW=$(cat "$STDOUT_FILE")
STDERR_RAW=$(cat "$STDERR_FILE")

_debug "EMACS STDOUT: $RAW"
[ -n "$STDERR_RAW" ] && _debug "EMACS STDERR: $STDERR_RAW"

# Elisp-level error
if [[ "$RAW" == *ERROR* ]]; then
  MSG="${RAW##*\*ERROR\* }"
  _debug "ELISP ERROR: $MSG"
  echo "{\"error\":\"$MSG\"}" >&2
  exit 1
fi

# Strip outer quotes and unescape inner quotes (emacs wraps JSON in quotes)
CLEAN=$(echo "$RAW" | head -1 | sed 's/^"//;s/"$//' | sed 's/\\"/"/g')

# Empty output
if [ -z "$(echo "$CLEAN" | tr -d '[:space:]')" ]; then
  ERR=$(head -1 "$STDERR_FILE" | tr -d '\n')
  if [ -n "$ERR" ]; then
    _debug "EMPTY OUTPUT, STDERR: $ERR"
    echo "{\"error\":\"$ERR\"}" >&2
  else
    _debug "EMPTY OUTPUT, NO STDERR"
    echo '{"error":"Empty response from emacs"}' >&2
  fi
  exit 1
fi

# Validate JSON-like output
if [[ "$CLEAN" != "{"* && "$CLEAN" != "["* ]]; then
  _debug "INVALID JSON: $CLEAN"
  echo "{\"error\":\"Invalid output: $(echo "$CLEAN" | cut -c1-80)\"}" >&2
  exit 1
fi

_debug "OUTPUT OK (${#CLEAN} chars)"
echo "$CLEAN"
