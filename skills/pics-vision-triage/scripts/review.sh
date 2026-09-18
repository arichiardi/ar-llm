#!/usr/bin/env bash
# Review stage: the big-model (27B, vision-capable) pass over report.tsv.
# Two sub-passes, both on the same model:
#
#   misfiles  (text): split the vision stage's descriptions into chronological
#     chunks, ask the model to (1) segment each chunk into events and (2) list
#     photos that do not fit the event their date places them in. A merge call
#     makes the final CONFIRM/DROP decision. Fills `context_flag`.
#
#   faces     (image): for each photo the vision stage tagged face=yes, one
#     per-image call asking for face-quality issues. Fills five columns:
#     eyes_closed, adult_not_looking, kids_not_looking, face_cropped,
#     motion_blur. (kids_not_looking is NOT marked by mark.sh.)
#
# Output:
#   - fills report.tsv columns: context_flag, eyes_closed, adult_not_looking,
#     kids_not_looking, face_cropped, motion_blur
#   - audit log next to the report: review-analysis.jsonl
#     (per chunk: {stage: chunk, events, outliers, raw}; {stage: merge, ...};
#      per face photo: {stage: face, file, flags, raw})
#
# Usage (run from the month directory):
#   review.sh [--report .pics-vision-triage/report.tsv]
#             [--url <url>] [--model <id>]
#             [--chunk 60] [--concurrency 2] [--timeout 300] [--no-faces]
#
# Dependencies: bash, curl, jq, magick (ImageMagick 7, faces only), base64.
#
# Server/model defaults come from config.sh next to this script
# (SKILL_PICS_VISION_TRIAGE_CONTEXT_URL/_CONTEXT_MODEL; the model is required
# - review.sh refuses to run without it, and also if the server does not offer
# it).
set -euo pipefail

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
load_prompt() { cat "$SCRIPT_DIR/prompts/$1"; }

# Prompts live in prompts/*.md (not embedded in this script)
CHUNK_PROMPT="$(load_prompt misfiles.md)"
MERGE_PROMPT="$(load_prompt misfiles-merge.md)"
FACES_PROMPT="$(load_prompt faces.md)"

# config.sh next to this script sets URLs, models and tokens
[[ -f "${BASH_SOURCE[0]%/*}/config.sh" ]] && source "${BASH_SOURCE[0]%/*}/config.sh"

URL=${SKILL_PICS_VISION_TRIAGE_URL:-http://localhost:8080/v1}
CONV_URL=${SKILL_PICS_VISION_TRIAGE_CONTEXT_URL:-$URL}
MODEL=${SKILL_PICS_VISION_TRIAGE_CONTEXT_MODEL:-}
REPORT=".pics-vision-triage/report.tsv"
CHUNK=60 CONC=${SKILL_PICS_VISION_TRIAGE_CONCURRENCY:-1} TIMEOUT=300 NOTHINK=1 FACES=1
MAX_SIDE=${SKILL_PICS_VISION_TRIAGE_FACE_SIDE:-1024} TMPD=""

trap '[[ -n $TMPD ]] && rm -rf "$TMPD"' EXIT
die() { echo "error: $*" >&2; exit 1; }

while (($#)); do case $1 in
  --report)      REPORT=$2; shift 2 ;;
  --url)         CONV_URL=$2; shift 2 ;;
  --model)       MODEL=$2; shift 2 ;;
  --chunk)       CHUNK=$2; shift 2 ;;
  --concurrency) CONC=$2; shift 2 ;;
  --timeout)     TIMEOUT=$2; shift 2 ;;
  --no-faces)    FACES=0; shift ;;
  *) die "unknown option: $1" ;;
esac; done
[[ -n $MODEL ]] || die "no context model: set SKILL_PICS_VISION_TRIAGE_CONTEXT_MODEL (or pass --model) to an id from $CONV_URL/models"
[[ -f $REPORT ]] || die "no such report: $REPORT (run the structural + vision stages first)"

sampling() { # shared sampling knobs from env -> JSON object ({} when unset)
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

chat_text() { # url model prompt max-tokens timeout -> raw reply; 3 attempts, backoff
  local url=$1 model=$2 prompt=$3 maxtok=$4 timeout=${5:-300}
  local reply pf wait=2 i
  # the context server may live on another box with a token of its own;
  # empty CONTEXT_TOKEN falls back to the vision token (default: none)
  local token=${SKILL_PICS_VISION_TRIAGE_CONTEXT_TOKEN:-${SKILL_PICS_VISION_TRIAGE_TOKEN:-}}
  local auth=(-H 'Content-Type: application/json')
  if [[ -n $token ]]; then
    auth+=(-H "Authorization: Bearer $token")
  fi
  pf=$(mktemp)
  # NOTHINK=1: reasoning models otherwise spend the whole
  # max_tokens budget on reasoning_content and return empty content.
  jq -cn --arg model "$model" --arg prompt "$prompt" --argjson mt "$maxtok" \
         --argjson nothink "$NOTHINK" --argjson sampling "$(sampling)" \
    '({model:$model, temperature:0, max_tokens:$mt,
      messages:[{role:"user", content:$prompt}]})
     * (if $nothink then {chat_template_kwargs:{enable_thinking:false}} else {} end)
     * $sampling' > "$pf"
  for i in 1 2 3; do
    if reply=$(curl -s --max-time "$timeout" -X POST "$url/chat/completions" \
           "${auth[@]}" --data @"$pf") \
       && jq -e '(.choices[0].message.content // "") | length > 0' <<<"$reply" >/dev/null 2>&1; then
      jq -r '.choices[0].message.content // empty' <<<"$reply"
      rm -f "$pf"; return 0
    fi
    (( i == 3 )) && { rm -f "$pf"; return 1; }
    echo "  retry in ${wait}s (attempt $i failed)" >&2
    sleep "$wait"; wait=$((wait*2))
  done
  rm -f "$pf"; return 1
}

# faces image helpers (only used when the faces sub-pass runs)
face_b64() { # src out - downscale + base64 to a file (never on argv)
  magick "$1" -resize ${MAX_SIDE}x${MAX_SIDE} -quality 88 -format jpg - 2>/dev/null \
    | base64 -w0 > "$2"
}

chat_img() { # url model prompt b64file max-tokens timeout -> raw reply; 3 attempts
  local url=$1 model=$2 prompt=$3 b64f=$4 maxtok=${5:-256} timeout=${6:-300}
  local reply pf="$4.payload.json" wait=2 i
  local token=${SKILL_PICS_VISION_TRIAGE_CONTEXT_TOKEN:-${SKILL_PICS_VISION_TRIAGE_TOKEN:-}}
  local auth=(-H 'Content-Type: application/json')
  [[ -n $token ]] && auth+=(-H "Authorization: Bearer $token")
  jq -cn --arg model "$model" --arg prompt "$prompt" --rawfile b64 "$b64f" \
         --argjson mt "$maxtok" --argjson nothink "$NOTHINK" --argjson sampling "$(sampling)" \
    '({model:$model, temperature:0, max_tokens:$mt,
      messages:[{role:"user", content:[
        {type:"text", text:$prompt},
        {type:"image_url", image_url:{url:("data:image/jpeg;base64,"+$b64)}}]}]})
     * (if $nothink then {chat_template_kwargs:{enable_thinking:false}} else {} end)
     * $sampling' > "$pf"
  for i in 1 2 3; do
    if reply=$(curl -s --max-time "$timeout" -X POST "$url/chat/completions" \
           "${auth[@]}" --data @"$pf") \
       && jq -e '(.choices[0].message.content // "") | length > 0' <<<"$reply" >/dev/null 2>&1; then
      jq -r '.choices[0].message.content // empty' <<<"$reply"
      rm -f "$pf"; return 0
    fi
    (( i == 3 )) && { rm -f "$pf"; return 1; }
    echo "  retry in ${wait}s (attempt $i failed)" >&2
    sleep "$wait"; wait=$((wait*2))
  done
  rm -f "$pf"; return 1
}

# ------------------------------------------------------- flag normalization ---
# Models are inconsistent: some return "yes"/"no" strings, others true/false
# booleans. Normalize any of {yes,true,1} -> yes, everything else -> no.
flag_yn() { # raw value -> yes|no (trims surrounding whitespace)
  local v=${1,,}
  v=${v#"${v%%[![:space:]]*}"}; v=${v%"${v##*[![:space:]]}"}
  case "$v" in
    yes|true|1) printf 'yes' ;;
    *)          printf 'no'  ;;
  esac
}

# ------------------------------------------------------- model resolution ---
resolve_model() { # url preferred-model -> model id (fails if not offered)
  local url=$1 preferred=$2 ids m
  local auth=()
  if [[ -n ${SKILL_PICS_VISION_TRIAGE_TOKEN:-} ]]; then
    auth+=(-H "Authorization: Bearer ${SKILL_PICS_VISION_TRIAGE_TOKEN}")
  fi
  ids=$(curl -sf --max-time 10 "${auth[@]}" "$url/models" | jq -r '.data[].id') || die "could not reach $url/models (server up?)"
  [[ -n $ids ]] || die "no models on $url"
  # match case-insensitively but return the id exactly as advertised
  m=$(grep -iFx "$preferred" <<<"$ids" 2>/dev/null | head -n1) || true
  if [[ -z $m ]]; then
    echo "note: model '$preferred' not offered by $url (available: $(paste -sd, <<<"$ids"))" >&2
    return 1
  fi
  printf '%s\n' "$m"
}

# ------------------------------------------------------------- input prep ---
AUDIT="$(dirname "$REPORT")/review-analysis.jsonl"
TMPD=$(mktemp -d)
SORTED="$TMPD/sorted.tsv"

# file \t date \t description, date-sorted (undated last, then by file name)
awk -F'\t' 'NR > 1 && NF >= 8 && $8 != "" {
  key = ($2 == "") ? "9999-99-99 99:99:99" : $2
  printf "%s\t%s\t%s\t%s\n", key, $1, $2, $8
}' "$REPORT" | sort -t$'\t' -k1,1 -k2,2 | cut -f2- > "$SORTED"

TOTAL=$(wc -l < "$SORTED")
(( TOTAL > 0 )) || die "no described rows in $REPORT (run the vision stage first)"

# known file set for validating model output
declare -A KNOWN=()
while IFS=$'\t' read -r f _ _; do KNOWN[$f]=1; done < "$SORTED"

# chronological chunks: $TMPD/chunk-NNN.txt (listed in $TMPD/chunks.txt)
i=0; no=0
: > "$TMPD/chunks.txt"
# awk + \x1f (unit separator, not IFS whitespace): bash read with IFS=tab
# collapses empty middle columns and would shift fields on undated rows
while IFS=$'\x1f' read -r f dt desc; do
  cf="$TMPD/chunk-$(printf '%03d' "$no").txt"
  if [[ ! -f $cf ]]; then : > "$cf"; echo "$cf" >> "$TMPD/chunks.txt"; fi
  printf '%s\t%s\t%s\n' "$dt" "$f" "$desc" >> "$cf"
  i=$((i+1))
  if (( i % CHUNK == 0 )); then no=$((no+1)); fi
done < <(awk -F'\t' '{printf "%s\x1f%s\x1f%s\n", $1, $2, $3}' "$SORTED")
NOCHUNKS=$(wc -l < "$TMPD/chunks.txt")

C_MODEL=$(resolve_model "$CONV_URL" "$MODEL") || die "context model not available on $CONV_URL - check SKILL_PICS_VISION_TRIAGE_CONTEXT_MODEL"
echo "report: $REPORT  rows: $TOTAL  chunks: $NOCHUNKS (size $CHUNK)  concurrency: $CONC" >&2
echo "model: $C_MODEL  server: $CONV_URL" >&2

# --------------------------------------------------------------- chunk call ---
# chunk_worker CHUNKFILE -> CHUNKFILE.json (one audit record)
chunk_worker() { # $1 = chunk file
  local cf=$1 n reply prompt lines events_json outliers_json ok first last cb
  cb=$(basename "$cf")
  n=$(wc -l < "$cf")
  lines=$(sed 's/\t/  /g' "$cf")
  prompt="${CHUNK_PROMPT//<lines>/$lines}"
  if reply=$(chat_text "$CONV_URL" "$C_MODEL" "$prompt" 2048 "$TIMEOUT"); then
    ok=1
    events_json=$( { grep -E '^[[:space:]]*EVENT[[:space:]]' <<<"$reply" || true; } \
      | sed -E 's/^[[:space:]]*EVENT[[:space:]]+//' \
      | jq -Rcn '[inputs | select(length > 0)]')
    outliers_json=$( { grep -E '^[[:space:]]*OUTLIER[[:space:]]' <<<"$reply" || true; } \
      | sed -E 's/^[[:space:]]*OUTLIER[[:space:]]+//' \
      | jq -Rn '[inputs | select(length > 0)
          | {file: (split(":")[0] | gsub("^[[:space:]]+";"") | gsub("[[:space:]]+$";"")),
             reason: (if index(":") then (split(":")[1:] | join(":") | gsub("^[[:space:]]+";"")) else "" end)}]')
  else
    reply="ERR: server error after retries"; ok=0
    events_json="[]"; outliers_json="[]"
  fi
  first=$(head -n1 "$cf" | cut -f1); last=$(tail -n1 "$cf" | cut -f1)
  jq -cn --arg cb "$cb" --argjson n "$n" --arg first "$first" --arg last "$last" \
         --argjson ok "$ok" --argjson events "$events_json" \
         --argjson outliers "$outliers_json" --arg raw "$reply" \
    '{stage:"chunk", chunk:$cb, images:$n, date_range:[$first,$last],
      ok:$ok, events:$events, outliers:$outliers, raw:$raw}' > "${cf}.json"
}

export -f chunk_worker chat_text sampling
export CONV_URL TIMEOUT CHUNK_PROMPT C_MODEL NOTHINK

: > "$AUDIT"
if (( NOCHUNKS > 1 )); then
  xargs -d '\n' -P "$CONC" -I{} bash -c 'chunk_worker "$1"' _ {} \
    < "$TMPD/chunks.txt"
else
  while IFS= read -r cf; do chunk_worker "$cf"; done < "$TMPD/chunks.txt"
fi
# chunk audit records, in order
while IFS= read -r cf; do cat "${cf}.json" >> "$AUDIT"; done < "$TMPD/chunks.txt"

# validate: keep only candidates whose file is a real file of this report
CAND="$TMPD/candidates.tsv"    # file \t reason \t chunk
: > "$CAND"
cn=0
while IFS= read -r cf; do
  cn=$((cn+1))
  while IFS=$'\t' read -r f r; do
    if [[ -n ${KNOWN[$f]:-} ]]; then
      printf '%s\t%s\t%s\n' "$f" "$r" "$cn" >> "$CAND"
    elif [[ -n $f ]]; then
      echo "  note: dropping unparseable outlier entry: $f" >&2
    fi
  done < <(jq -r '.outliers[] | [.file, .reason] | @tsv' "${cf}.json")
done < "$TMPD/chunks.txt"
NCAND=$(wc -l < "$CAND")
echo "candidates from chunks: $NCAND" >&2

# ----------------------------------------------------------------- merge ---
declare -A FINAL=() VERDICTED=()
if (( NCAND > 0 )); then
  events_block=""
  cn=0
  while IFS= read -r cf; do
    cn=$((cn+1))
    events_block+="Chunk $cn ($(jq -r '.date_range[0]' "${cf}.json") .. $(jq -r '.date_range[1]' "${cf}.json"))"
    while IFS= read -r ev; do events_block+=$'\n'"  $ev"; done < <(jq -r '.events[]' "${cf}.json")
    events_block+=$'\n'
  done < "$TMPD/chunks.txt"
  cand_block=$(awk -F'\t' '{printf "  - %s - %s (chunk %s)\n", $1, $2, $3}' "$CAND")
  mprompt="${MERGE_PROMPT//<events>/$events_block}"
  mprompt="${mprompt//<candidates>/$cand_block}"
  mreply=$(chat_text "$CONV_URL" "$C_MODEL" "$mprompt" 1024 "$TIMEOUT") || die "merge call failed; per-chunk audit is in $AUDIT"
  confirmed=$( { grep -E '^[[:space:]]*CONFIRM[[:space:]]' <<<"$mreply" || true; } | sed -E 's/^[[:space:]]*CONFIRM[[:space:]]+//' )
  dropped=$( { grep -E '^[[:space:]]*DROP[[:space:]]' <<<"$mreply" || true; } | sed -E 's/^[[:space:]]*DROP[[:space:]]+//' )
  while IFS= read -r line; do
    if [[ -z $line ]]; then continue; fi
    f=${line%%:*}; r=${line#*:}; r=${r# }
    if [[ $r == "$line" ]]; then r=""; fi
    if [[ -n ${KNOWN[$f]:-} ]]; then FINAL[$f]=$r; VERDICTED[$f]=1; fi
  done <<<"$confirmed"
  while IFS= read -r line; do
    if [[ -z $line ]]; then continue; fi
    f=${line%%:*}
    if [[ -n ${KNOWN[$f]:-} ]]; then VERDICTED[$f]=1; fi
  done <<<"$dropped"
  confirmed_json=$(jq -Rcn '[inputs | select(length > 0)]' <<<"$confirmed")
  dropped_json=$(jq -Rcn '[inputs | select(length > 0)]' <<<"$dropped")
  jq -cn --argjson candidates "$NCAND" --argjson confirmed "$confirmed_json" \
         --argjson dropped "$dropped_json" --arg raw "$mreply" \
    '{stage:"merge", candidates:$candidates, confirmed:$confirmed, dropped:$dropped, raw:$raw}' >> "$AUDIT"
  # candidates the model forgot to answer for: keep flagged (fail loud)
  while IFS=$'\x1f' read -r f r c; do
    if [[ -z ${VERDICTED[$f]:-} ]]; then
      echo "  note: merge gave no verdict for $f; keeping as flagged" >&2
      FINAL[$f]=$r
    fi
  done < <(awk -F'\t' '{printf "%s\x1f%s\x1f%s\n", $1, $2, $3}' "$CAND")
fi

# ------------------------------------------------- date-drift flag (deterministic) ---
# A misfiled photo (2019 shot in a 2025-08 dir) sorts into its own chunk and
# the model may normalize it into a plausible "event". Check dates directly:
# flag anything more than 60 days away from the directory's median date.
DATED_EPOCHS=$(cut -f2 "$SORTED" | grep -E '^[0-9]{4}-' | while IFS= read -r dt; do date -ud "$dt" +%s; done | sort -n)
if [[ -n $DATED_EPOCHS ]]; then
  n=$(wc -l <<<"$DATED_EPOCHS")
  med=$(sed -n "$(( (n + 1) / 2 ))p" <<<"$DATED_EPOCHS")
  while IFS=$'\t' read -r f dt _; do
    if [[ $dt =~ ^[0-9]{4}- ]] && [[ -z ${FINAL[$f]:-} ]]; then
      ep=$(date -ud "$dt" +%s)
      off=$(( ep - med )); (( off < 0 )) && off=$(( -off ))
      if (( off > 60 * 86400 )); then
        FINAL[$f]="date far from the rest of this directory ($dt vs median $(date -ud "@$med" +%Y-%m-%d))"
      fi
    fi
  done < "$SORTED"
fi

# ------------------------------------------------------- faces sub-pass ---
# For each photo the vision stage tagged face=yes, one per-image call on the
# model asking for face-quality issues. Fills report columns 14-18. Skipped
# with --no-faces.
ROOT="$(cd "$(dirname "$REPORT")/.." && pwd)"   # month dir (report in .pics-vision-triage/)
FACE_TSV="$TMPD/faces.tsv"                      # file \t ec \t anl \t knl \t fc \t mb
: > "$FACE_TSV"
if (( FACES == 1 )); then
  FACE_LIST="$TMPD/face-list.txt"               # absolute path per face=yes row
  : > "$FACE_LIST"
  awk -F'\t' 'NR > 1 && NF >= 9 && tolower($9) == "yes" { print $1 }' "$REPORT" | \
  while IFS= read -r bn; do
    if [[ -f "$ROOT/$bn" ]]; then printf '%s\n' "$ROOT/$bn" >> "$FACE_LIST"
    else echo "  note: face=yes but no file $ROOT/$bn" >&2; fi
  done
  NFACE=$(wc -l < "$FACE_LIST")
  echo "faces: $NFACE photo(s) (face=yes) on $C_MODEL" >&2

  face_worker() { # absolute photo path
    local f=$1 bn b64f reply jline ec anl knl fc mb
    bn=${f##*/}; b64f="$TMPD/f-$bn.b64"
    ec=anl=knl=fc=mb=""
    if ! face_b64 "$f" "$b64f" || [[ ! -s $b64f ]]; then
      reply="ERR: could not decode image"
    elif reply=$(chat_img "$CONV_URL" "$C_MODEL" "$FACES_PROMPT" "$b64f" 256 "$TIMEOUT"); then
      jline=$(grep '^[[:space:]]*{' <<<"$reply" | head -n1) || true
      if [[ -n $jline ]]; then    # no JSON -> leave all empty (not marked), not "no"
        ec=$(  flag_yn "$(jq -r '.eyes_closed // empty'       <<<"$jline" 2>/dev/null)")
        anl=$( flag_yn "$(jq -r '.adult_not_looking // empty' <<<"$jline" 2>/dev/null)")
        knl=$( flag_yn "$(jq -r '.kids_not_looking // empty'  <<<"$jline" 2>/dev/null)")
        fc=$(  flag_yn "$(jq -r '.face_cropped // empty'      <<<"$jline" 2>/dev/null)")
        mb=$(  flag_yn "$(jq -r '.motion_blur // empty'       <<<"$jline" 2>/dev/null)")
      fi
    else
      reply="ERR: server error after retries"
    fi
    rm -f "$b64f" "$b64f.payload.json"
    ( flock 9; printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$bn" "$ec" "$anl" "$knl" "$fc" "$mb" >> "$FACE_TSV" ) 9>>"$FACE_TSV.lock"
    jq -cn --arg file "$bn" --arg ec "$ec" --arg anl "$anl" --arg knl "$knl" \
           --arg fc "$fc" --arg mb "$mb" --arg raw "$reply" \
      '{stage:"face", file:$file, eyes_closed:$ec, adult_not_looking:$anl,
        kids_not_looking:$knl, face_cropped:$fc, motion_blur:$mb, raw:$raw}' \
      > "$TMPD/f-$bn.json"
  }
  export -f face_worker flag_yn face_b64 chat_img sampling
  export CONV_URL C_MODEL FACES_PROMPT NOTHINK MAX_SIDE TMPD FACE_TSV TIMEOUT

  xargs -d '\n' -P "$CONC" -I{} bash -c 'face_worker "$1"' _ {} < "$FACE_LIST"
  rm -f "$FACE_TSV.lock"
  while IFS= read -r f; do [[ -f "$TMPD/f-${f##*/}.json" ]] && cat "$TMPD/f-${f##*/}.json" >> "$AUDIT"; done < "$FACE_LIST"
fi

# --------------------------------------------------------- report update ---
# Combine the misfiles reason (col 13) and the five face flags (cols 14-18)
# into report.tsv. Handles 12-col (add all), 13-col, or 18-col (overwrite) rows.
FLAGS="$TMPD/flags.tsv"
: > "$FLAGS"
for f in "${!FINAL[@]}"; do printf '%s\t%s\n' "$f" "${FINAL[$f]}" >> "$FLAGS"; done
awk -F'\t' -v OFS='\t' -v flagsf="$FLAGS" -v facef="$FACE_TSV" '
  FILENAME == flagsf { flag[$1] = $2; next }
  FILENAME == facef  { ec[$1]=$2; anl[$1]=$3; knl[$1]=$4; fc[$1]=$5; mb[$1]=$6; next }
  FNR == 1 {
    if (NF < 13) $13 = "context_flag"
    if (NF < 14) $14 = "eyes_closed"
    if (NF < 15) $15 = "adult_not_looking"
    if (NF < 16) $16 = "kids_not_looking"
    if (NF < 17) $17 = "face_cropped"
    if (NF < 18) $18 = "motion_blur"
    print; next
  }
  {
    $13 = ($1 in flag ? flag[$1] : "")
    $14 = ($1 in ec  ? ec[$1]  : "")
    $15 = ($1 in anl ? anl[$1] : "")
    $16 = ($1 in knl ? knl[$1] : "")
    $17 = ($1 in fc  ? fc[$1]  : "")
    $18 = ($1 in mb  ? mb[$1]  : "")
    print
  }
' "$FLAGS" "$FACE_TSV" "$REPORT" > "$TMPD/report.tsv"
mv "$TMPD/report.tsv" "$REPORT"

NFACERUN=$(awk -F'\t' 'NR > 1 && ($14 != "" || $15 != "" || $16 != "" || $17 != "" || $18 != "")' "$REPORT" | wc -l)
NFACEYES=$(awk -F'\t' 'NR > 1 && (tolower($14)=="yes" || tolower($15)=="yes" || tolower($17)=="yes" || tolower($18)=="yes")' "$REPORT" | wc -l)
echo "misfiles flagged: ${#FINAL[@]}/$TOTAL  face issues: $NFACEYES  faces analyzed: $NFACERUN  -> $REPORT" >&2
echo "columns: context_flag + eyes_closed adult_not_looking kids_not_looking face_cropped motion_blur" >&2
echo "audit:  $AUDIT" >&2
