#!/usr/bin/env bash
# org-roam-adhoc-memory core query helper
# Usage: query.sh 'ELISP-EXPRESSION'
# Returns clean JSON on stdout, errors as JSON on stderr + exit 1.
#
# Debugging: set ORG_ROAM_PI_MEMORY_DEBUG=true to log all activity.
# The default log path is $TMPDIR/org-roam-adhoc-memory-debug.log.
set -uo pipefail

AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.config/pi/agent}"
EXT_DIR="$AGENT_DIR/extensions/org-roam-adhoc-memory"
CONFIG_FILE="$AGENT_DIR/ar-llm/org-roam-adhoc-memory.json"
DEFAULT_DEBUG_LOG_BASE="${TMPDIR:-/tmp}"
DEFAULT_DEBUG_LOG_BASE="${DEFAULT_DEBUG_LOG_BASE%/}"
DEFAULT_DEBUG_LOG="$DEFAULT_DEBUG_LOG_BASE/org-roam-adhoc-memory-debug.log"
EMACSCLIENT="${EMACSCLIENT:-emacsclient}"

# Read the debug log path from the config file; fall back to the OS temp dir
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
  (load (expand-file-name \"org-roam-adhoc-memory\" (car load-path)) nil t)
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
RESULT_FILE="$TMPDIR_QUERY/result"
trap "rm -rf '$TMPDIR_QUERY'" EXIT

# Emacs writes the raw JSON to RESULT_FILE. This avoids emacsclient wrapping the
# value in a Lisp string, which corrupts content that contains quotes.
"$EMACSCLIENT" --eval "(progn $BOOTSTRAP (condition-case err (with-temp-file \"$RESULT_FILE\" (insert (progn $ELISP_EXPR))) (error (with-temp-file \"$RESULT_FILE\" (insert (concat \"*ERROR* \" (error-message-string err)))))))" \
  >"$STDOUT_FILE" 2>"$STDERR_FILE" || true

CLEAN=$(cat "$RESULT_FILE" 2>/dev/null)
STDERR_RAW=$(cat "$STDERR_FILE")

_debug "EMACS RESULT: $CLEAN"
[ -n "$STDERR_RAW" ] && _debug "EMACS STDERR: $STDERR_RAW"

# Elisp-level error
if [[ "$CLEAN" == "*ERROR*"* ]]; then
  MSG="${CLEAN#\*ERROR\* }"
  _debug "ELISP ERROR: $MSG"
  jq -n --arg e "$MSG" '{error:$e}' >&2
  exit 1
fi

# Empty output
if [ -z "$(echo "$CLEAN" | tr -d '[:space:]')" ]; then
  ERR=$(head -1 "$STDERR_FILE" | tr -d '\n')
  if [ -n "$ERR" ]; then
    _debug "EMPTY OUTPUT, STDERR: $ERR"
    jq -n --arg e "$ERR" '{error:$e}' >&2
  else
    _debug "EMPTY OUTPUT, NO STDERR"
    echo '{"error":"Empty response from emacs"}' >&2
  fi
  exit 1
fi

# Validate JSON-like output
if [[ "$CLEAN" != "{"* && "$CLEAN" != "["* ]]; then
  _debug "INVALID JSON: $CLEAN"
  jq -n --arg e "$(echo "$CLEAN" | cut -c1-80)" '{error:("Invalid output: " + $e)}' >&2
  exit 1
fi

_debug "OUTPUT OK (${#CLEAN} chars)"
echo "$CLEAN"
