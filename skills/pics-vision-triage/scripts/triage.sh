#!/usr/bin/env bash
# Vision stage: vision-LLM triage of photos via an OpenAI-compatible server
# (llama.cpp llama-server with --mmproj). Read-only; writes JSONL audit logs.
# Sees the WHOLE list/directory — not just what the structural stage flagged.
#
# Subcommands:
#   single  one short description per image (whole batches)
#   sheet   numbered contact sheets (4x4 default), one description per cell
#
# Purpose: semantic descriptions so the user can EYEBALL the batch for
# misfiles (a jacket in a vacation month, a document in a family album).
# Screenshot/import detection is the structural stage's job (NO_MAKE).
#
# Usage:
#   triage.sh single --url http://localhost:8080/v1 [--model <id>] \
#       --list flagged.txt [--out report.jsonl] [--concurrency 2] [--timeout 300]
#   triage.sh sheet  --url ... [--model <id>] --list list.txt \
#       [--out sheets.jsonl] [--cols 4 --rows 4]
#
# Without --out the report goes to ./.pics-vision-triage/<sub>-<list-name>.jsonl
# (created in the current working directory).
#
# Dependencies: bash, curl, jq, magick/montage (ImageMagick 7), base64, flock.
#
# Server/model defaults come from config.sh next to this script
# (SKILL_PICS_VISION_TRIAGE_URL, SKILL_PICS_VISION_TRIAGE_VISION_MODEL);
# --url/--model flags override them.
set -euo pipefail

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
load_prompt() { cat "$SCRIPT_DIR/prompts/$1"; }

# Prompts live in prompts/*.md (not embedded in this script)
CAPTION="$(load_prompt caption.md)"
SHEET_PROMPT="$(load_prompt sheet.md)"

FONT=${TRIAGE_FONT:-/usr/share/fonts/TTF/DejaVuSans-Bold.ttf}
MAX_SIDE=1280

# config.sh next to this script sets URLs, models and tokens
[[ -f "${BASH_SOURCE[0]%/*}/config.sh" ]] && source "${BASH_SOURCE[0]%/*}/config.sh"

URL=${SKILL_PICS_VISION_TRIAGE_URL:-http://localhost:8080/v1}
MODEL=${SKILL_PICS_VISION_TRIAGE_VISION_MODEL:-${SKILL_PICS_VISION_TRIAGE_MODEL:-""}} LIST="" OUT=""
TIMEOUT=300 CONC=${SKILL_PICS_VISION_TRIAGE_CONCURRENCY:-1} COLS=4 ROWS=4 TMPD=""

trap '[[ -n $TMPD ]] && rm -rf "$TMPD"' EXIT
die() { echo "error: $*" >&2; exit 1; }

b64_jpeg() { # path -> base64 of downscaled JPEG
  magick "$1" -resize ${MAX_SIDE}x${MAX_SIDE} -quality 88 -format jpg - 2>/dev/null | base64 -w0
}

get_model() { # url model
  if [[ -n $2 ]]; then printf '%s\n' "$2"; return 0; fi
  local auth=()
  if [[ -n ${SKILL_PICS_VISION_TRIAGE_TOKEN:-} ]]; then
    auth+=(-H "Authorization: Bearer ${SKILL_PICS_VISION_TRIAGE_TOKEN}")
  fi
  local m
  m=$(curl -sf "${auth[@]}" "$1/models" | jq -r '.data[0].id // empty')
  [[ -n $m ]] || return 1
  printf '%s\n' "$m"
}

sampling() { # sampling knobs from env -> JSON object ({} when all unset)
  jq -cn \
    --arg t  "${SKILL_PICS_VISION_TRIAGE_TEMPERATURE:-}" \
    --arg mp "${SKILL_PICS_VISION_TRIAGE_MIN_P:-}" \
    --arg tk "${SKILL_PICS_VISION_TRIAGE_TOP_K:-}" \
    --arg tp "${SKILL_PICS_VISION_TRIAGE_TOP_P:-}" \
    --arg rp "${SKILL_PICS_VISION_TRIAGE_REPETITION_PENALTY:-}" \
    --arg mt "${SKILL_PICS_VISION_TRIAGE_MAX_TOKENS:-}" \
    'def n($s): if $s == "" then null else ($s | tonumber) end;
     {temperature: n($t), min_p: n($mp), top_k: n($tk), top_p: n($tp),
      repetition_penalty: n($rp), max_tokens: n($mt)}
     | with_entries(select(.value != null))'
}

chat_file() { # url model prompt b64file timeout -> raw reply; 3 attempts, backoff
  # The image payload is NEVER passed on argv: a real photo's base64 easily
  # exceeds Linux's 128KB per-argument limit. b64file holds the base64;
  # jq --rawfile reads it, curl --data @file sends it.
  local url=$1 model=$2 prompt=$3 b64f=$4 timeout=${5:-300}
  local reply pf="$4.payload.json" wait=2 i
  local auth=(-H 'Content-Type: application/json')
  if [[ -n ${SKILL_PICS_VISION_TRIAGE_TOKEN:-} ]]; then
    auth+=(-H "Authorization: Bearer ${SKILL_PICS_VISION_TRIAGE_TOKEN}")
  fi
  jq -cn --arg model "$model" --arg prompt "$prompt" --rawfile b64 "$b64f" \
         --argjson sampling "$(sampling)" \
    '({model:$model, temperature:0, max_tokens:512,
      messages:[{role:"user", content:[
        {type:"text", text:$prompt},
        {type:"image_url", image_url:{url:("data:image/jpeg;base64,"+$b64)}}]}]})
     * $sampling' > "$pf"
  for i in 1 2 3; do
    if reply=$(curl -s --max-time "$timeout" -X POST "$url/chat/completions" \
           "${auth[@]}" --data @"$pf") \
       && jq -e '(.choices[0].message.content // "") | length > 0' <<<"$reply" >/dev/null 2>&1; then
      jq -r '.choices[0].message.content // empty' <<<"$reply"
      return 0
    fi
    (( i == 3 )) && return 1
    echo "  retry in ${wait}s (attempt $i failed)" >&2
    sleep "$wait"; wait=$((wait*2))
  done
  return 1
}



cells_json_from() { # model reply -> {"1":"desc","2":"desc",...}
  # one description per line, "N: description" (number, then separator)
  awk '/^[[:space:]]*[0-9]+/ {
         n = $0; sub(/[^0-9].*$/, "", n)
         d = $0; sub(/^[[:space:]]*[0-9]+[):. \t-]*/, "", d); sub(/[[:space:]]+$/, "", d)
         print n "\t" d }' <<<"$1" \
    | jq -Rcn '[inputs | select(length > 0) | split("\t")
                | {key: (.[0]|tostring), value: ((.[1:] | join("\t")) // "")}] | from_entries'
}

load_list() { # listfile-or-dir -> one ABSOLUTE path per line (report join key)
  if [[ -d $1 ]]; then
    find "$1" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \
      -o -iname '*.webp' -o -iname '*.bmp' \) -print0 | sort -z | xargs -0 -r realpath --
  else
    grep -vE '^[[:space:]]*(#|$)' "$1" | xargs -d '\n' -r realpath -m --
  fi
}

write_report() { # descriptions-jsonl -> <same dir>/report.tsv (union with structural TSV)
  # Absolute paths are the join key; the report shows file names only.
  local jsonl=$1 dir struct tmp p d
  dir=$(dirname "$jsonl")
  struct="$dir/structural-flags.tsv"
  tmp=$(mktemp)
  jq -r 'if .file then [.file, .description, (.face // ""), (.blank // ""), (.blurry // ""), (.text_or_screen // "")] | @tsv
         else .cells[] | [.file, .description, "", "", "", ""] | @tsv end' "$jsonl" > "$tmp"
  local -A meta=() desc=() tfm=() bbm=() blm=() tsm=() seen=()
  local order=() dt w h sz mk fl tf bb bl ts
  if [[ -f $struct ]]; then
    while IFS=$'\t' read -r p dt w h sz mk fl; do
      [[ $p == path ]] && continue
      meta[$p]="$dt"$'\t'"$w"$'\t'"$h"$'\t'"$sz"$'\t'"$mk"$'\t'"$fl"
      order+=("$p"); seen[$p]=1
    done < "$struct"
  else
    echo "  note: no structural-flags.tsv next to $jsonl; report.tsv lacks metadata columns" >&2
  fi
  while IFS=$'\t' read -r p d tf bb bl ts; do
    desc[$p]=$d; tfm[$p]=$tf; bbm[$p]=$bb; blm[$p]=$bl; tsm[$p]=$ts
    if [[ -z ${seen[$p]:-} ]]; then order+=("$p"); seen[$p]=1; fi
  done < "$tmp"
  if [[ ${#meta[@]} -gt 0 ]]; then
    {
      printf 'file\tdate\tw\th\tsize\tmake\tflags\tdescription\tface\tblank\tblurry\ttext_or_screen\n'
      for p in "${order[@]}"; do
        m="${meta[$p]:-}"
        [[ -z $m ]] && m=$'\t\t\t\t\t'   # 6 empty fields when no structural row
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "${p##*/}" "$m" "${desc[$p]:-}" "${tfm[$p]:-}" "${bbm[$p]:-}" "${blm[$p]:-}" "${tsm[$p]:-}"
      done
    } > "$dir/report.tsv"
  else
    {
      printf 'file\tdescription\tface\tblank\tblurry\ttext_or_screen\n'
      for p in "${order[@]}"; do printf '%s\t%s\t%s\t%s\t%s\t%s\n' "${p##*/}" "${desc[$p]:-}" "${tfm[$p]:-}" "${bbm[$p]:-}" "${blm[$p]:-}" "${tsm[$p]:-}"; done
    } > "$dir/report.tsv"
  fi
  rm -f "$tmp"
  echo "report -> $dir/report.tsv" >&2
}

parse_args() { # $1 = subcommand
  local sub=$1; shift
  while (($#)); do case $1 in
    --url)         URL=$2; shift 2 ;;
    --model)       MODEL=$2; shift 2 ;;
    --list)        LIST=$2; shift 2 ;;
    --out)         OUT=$2; shift 2 ;;
    --timeout)     TIMEOUT=$2; shift 2 ;;
    --concurrency) CONC=$2; shift 2 ;;
    --cols)        COLS=$2; shift 2 ;;
    --rows)        ROWS=$2; shift 2 ;;
    *) die "unknown option for '$sub': $1" ;;
  esac; done
  [[ -n $LIST ]] || die "--list is required"
  [[ -e $LIST ]] || die "no such list/dir: $LIST"
  [[ -n $MODEL ]] || die "no vision model: set SKILL_PICS_VISION_TRIAGE_VISION_MODEL (or pass --model) to an id from $URL/models"
  if [[ -z $OUT ]]; then
    case $sub in
      single) OUT=".pics-vision-triage/single-image-descriptions.jsonl" ;;
      sheet)  OUT=".pics-vision-triage/contact-sheet-descriptions.jsonl" ;;
    esac
  fi
}

# ---------------------------------------------------------------- single ---
cmd_single() {
  local model
  model=$(get_model "$URL" "$MODEL") || die "could not determine model from $URL (server up? right port?); pass --model"
  echo "list: $LIST  model: $model  server: $URL  concurrency: $CONC" >&2
  mkdir -p "$(dirname "$OUT")"; : > "$OUT"

  worker() { # path -> one JSONL record appended to $OUT
    local f=$1 reply="" desc="" b64f rec tf="" bb="" bl="" ts="" jline
    b64f=$(mktemp) || return 1
    if b64_jpeg "$f" > "$b64f" && [[ -s $b64f ]]; then
      if reply=$(chat_file "$URL" "$model" "$CAPTION" "$b64f" "$TIMEOUT"); then
        desc=$(head -n1 <<<"$reply" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
        [[ -n $desc ]] || desc="(empty reply)"
        # tags: first line of the reply that starts with '{'
        jline=$(grep '^[[:space:]]*{' <<<"$reply" | head -n1) || true
        if [[ -n $jline ]]; then
          tf=$(jq -r '.face // empty' <<<"$jline" 2>/dev/null) || tf=""
          bb=$(jq -r '.blank // empty' <<<"$jline" 2>/dev/null) || bb=""
          bl=$(jq -r '.blurry // empty' <<<"$jline" 2>/dev/null) || bl=""
          ts=$(jq -r '.text_or_screen // empty' <<<"$jline" 2>/dev/null) || ts=""
          [[ -n $tf || -n $bb || -n $bl || -n $ts ]] || echo "note: tags unparseable for ${f##*/}" >&2
        fi
      else
        desc="ERR: server error after retries"
      fi
    else
      desc="ERR: could not decode image"
    fi
    rec=$(jq -cn --arg f "$f" --arg d "$desc" --arg raw "$reply" \
              --arg tf "$tf" --arg bb "$bb" --arg bl "$bl" --arg ts "$ts" \
          '{file:$f, description:$d, face:$tf, blank:$bb, blurry:$bl, text_or_screen:$ts, raw:$raw}')
    ( flock 9; printf '%s\n' "$rec" >> "$OUT" ) 9>>"$OUT.lock"
    rm -f "$b64f" "$b64f.payload.json"
  }

  export -f worker b64_jpeg chat_file get_model sampling
  export URL model CAPTION TIMEOUT OUT MAX_SIDE

  load_list "$LIST" | xargs -d '\n' -P "$CONC" -I{} bash -c 'worker "$@"' _ {}
  rm -f "$OUT.lock"
  echo "done -> $OUT" >&2
  write_report "$OUT"
}

# ----------------------------------------------------------------- sheet ---
cmd_sheet() {
  local model i n sheet reply raw b64f cells_json jargs
  model=$(get_model "$URL" "$MODEL") || die "could not determine model from $URL (server up? right port?); pass --model"
  echo "list: $LIST  model: $model  server: $URL  sheet: ${COLS}x${ROWS}" >&2
  mkdir -p "$(dirname "$OUT")"; : > "$OUT"
  TMPD=$(mktemp -d)
  local cellw=360 cellh=270 ncells=$((COLS*ROWS)) sheetno=0
  local files=()
  mapfile -t files < <(load_list "$LIST")
  ((${#files[@]})) || die "no images in $LIST"

  for ((i=0; i<${#files[@]}; i+=ncells)); do
    local chunk=("${files[@]:i:ncells}")
    rm -f "$TMPD"/cell-*.jpg
    for n in "${!chunk[@]}"; do
      magick "${chunk[$n]}" -resize ${cellw}x${cellh} \
        -background black -gravity southeast -extent ${cellw}x${cellh} \
        -font "$FONT" -pointsize 22 -fill white -gravity northwest -annotate +6+6 \
        "$((n+1))" "$TMPD/cell-$(printf '%03d' "$n").jpg" 2>/dev/null \
        || echo "  warning: could not thumbnail ${chunk[$n]}" >&2
    done
    sheet="$TMPD/sheet-$sheetno.jpg"
    b64f="$TMPD/sheet-$sheetno.b64"
    if ! montage "$TMPD"/cell-*.jpg -tile ${COLS}x${ROWS} -geometry +0+0 \
         -background black "$sheet" 2>/dev/null; then
      echo "  warning: montage failed for sheet $sheetno" >&2
      sheetno=$((sheetno+1)); continue
    fi
    if base64 -w0 "$sheet" > "$b64f" \
       && reply=$(chat_file "$URL" "$model" "$SHEET_PROMPT" "$b64f" "$TIMEOUT"); then
      raw=$reply
    else
      raw="ERR: no reply from server"
    fi
    cells_json=$(cells_json_from "$raw")
    local saved="${OUT}.sheet-$(printf '%03d' "$sheetno").jpg"
    cp "$sheet" "$saved"
    jargs=()
    for n in "${!chunk[@]}"; do jargs+=("$((n+1)):${chunk[$n]}"); done
    jq -cn --argjson cells "$cells_json" --arg sp "$saved" --arg raw "$raw" \
      --args '{ cells: ( $ARGS.positional
                  | map(split(":") | {key: (.[0]|tostring),
                                      value: {file: .[1],
                                              description: ($cells[(.[0])] // "")}})
                  | from_entries ),
               sheet: $sp, raw: $raw }' "${jargs[@]}" >> "$OUT"
    echo "  [$((i+${#chunk[@]}))/${#files[@]}] sheet $sheetno" >&2
    sheetno=$((sheetno+1))
  done
  rm -rf "$TMPD"; TMPD=""
  echo "done -> $OUT" >&2
  write_report "$OUT"
}

# ------------------------------------------------------------------ main ---
[[ $# -ge 1 ]] || die "usage: triage.sh {single|sheet} --url ... --list ... --out ..."
sub=$1; shift
case $sub in
  single) parse_args "$sub" "$@"; cmd_single ;;
  sheet)  parse_args "$sub" "$@"; cmd_sheet ;;
  *) die "unknown subcommand: $sub (expected 'single' or 'sheet')" ;;
esac
