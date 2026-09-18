#!/usr/bin/env bash
# Structural stage: metadata + structural flags for a batch of photos.
# Read-only; writes a TSV report. Never gates the vision stage — it is a
# cheap first look at the batch.
#
# Usage:
#   flags.sh DIR [--out flags.tsv] [--hash]
#
# Without --out the report goes to ./.pics-vision-triage/flags-<dir-name>.tsv
# (created in the current working directory).
#
# Output TSV columns: path \t date \t w \t h \t size \t make \t flags
# (date = EXIF DateTimeOriginal, falling back to the file name)
# Flags (comma-joined, empty when clean):
#   NO_MAKE        no EXIF camera Make (screenshots/imports usually)
#   ERR            identify could not open it
#   DUP            same md5 as another file (only when --hash given)
#
# NOTE: no DIM / DATE_MISMATCH flags on purpose — this collection crops
# photos by hand (dimensions vary legitimately) and filenames often carry
# no date at all (EXIF is the source of truth).
set -euo pipefail

DIR="" OUT="" DO_HASH=0
while (($#)); do case $1 in
  --out)      OUT=$2; shift 2 ;;
  --hash)     DO_HASH=1; shift ;;
  *)          [[ $DIR == "" ]] && DIR=$1 || { echo "unexpected arg: $1" >&2; exit 2; }; shift ;;
esac; done
[[ -d $DIR ]] || { echo "usage: flags.sh DIR [--out flags.tsv] [--hash]" >&2; exit 2; }
if [[ -z $OUT ]]; then
  OUT=".pics-vision-triage/structural-flags.tsv"
fi
mkdir -p "$(dirname "$OUT")"

TMPDIR_W=$(mktemp -d)
trap 'rm -rf "$TMPDIR_W"' EXIT
printf 'path\tdate\tw\th\tsize\tmake\tflags\n' > "$OUT"

fname_datetime() { # basename -> "YYYY-MM-DD[ HH:MM:SS]" from known patterns, else ""
  local n=$1 d="" t="" rest h m s
  if [[ $n =~ ^(20[0-9]{2})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ]]; then
    d="${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]}"; rest=${n:10}
  elif [[ $n =~ (^|[^0-9])(20[0-9]{2})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])([^0-9]|$) ]]; then
    d="${BASH_REMATCH[2]}-${BASH_REMATCH[3]}-${BASH_REMATCH[4]}"; rest=${n##*"$d"}
  elif [[ $n =~ (^|[^0-9])(20[0-9]{2})(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])([^0-9]|$) ]]; then
    d="${BASH_REMATCH[2]}-${BASH_REMATCH[3]}-${BASH_REMATCH[4]}"; rest=${n##*"${BASH_REMATCH[2]}${BASH_REMATCH[3]}${BASH_REMATCH[4]}"}
  else
    return 0
  fi
  if [[ $rest =~ ^[^0-9]*(([01][0-9]|2[0-3])[-:.]?([0-5][0-9])[-:.]?([0-5][0-9])([^0-9]|$)) ]]; then
    h=${BASH_REMATCH[2]}; m=${BASH_REMATCH[3]}; s=${BASH_REMATCH[4]}
    t=$(printf '%02d:%02d:%02d' $((10#$h)) $((10#$m)) $((10#$s)))
  fi
  if [[ -n $t ]]; then printf '%s %s\n' "$d" "$t"; else printf '%s\n' "$d"; fi
  return 0
}
HASHLIST="$TMPDIR_W/hashes.tsv"
: > "$HASHLIST"

count=0 flagged=0
while IFS= read -r -d '' f; do
  abs=$(realpath -- "$f")
  w=0 h=0 make="" exif_dt="" flags=""
  # %[exif:...] -> value or "" (never errors); warnings go to stderr
  if line=$(identify -format '%w %h [%[exif:Make]] [%[exif:DateTimeOriginal]]' "$f" 2>/dev/null) \
     && [[ $line =~ ^[0-9]+\ [0-9]+\ \[(.*)\]\ \[(.*)\]$ ]]; then
    w=${line%% *}; rest=${line#* }; h=${rest%% *} make=${BASH_REMATCH[1]}
    exif_dt=${BASH_REMATCH[2]}
  else
    flags="ERR,"
  fi
  # EXIF "2025:08:01 10:20:23" -> "2025-08-01 10:20:23"; 0000:00:00 = absent
  if [[ $exif_dt =~ ^(20[0-9]{2}):([0-9]{2}):([0-9]{2})\ ([0-9]{2}):([0-9]{2}):([0-9]{2})$ ]]; then
    date="${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]} ${BASH_REMATCH[4]}:${BASH_REMATCH[5]}:${BASH_REMATCH[6]}"
  else
    date=$(fname_datetime "${abs##*/}")
  fi
  if [[ -z $make ]]; then flags+="NO_MAKE,"; fi
  if [[ -n $flags ]]; then flagged=$((flagged+1)); fi
  count=$((count+1))
  if (( DO_HASH )); then
    printf '%s\t%s\n' "$(md5sum "$abs" | cut -d' ' -f1)" "$abs" >> "$HASHLIST"
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$abs" "$date" "$w" "$h" "$(stat -c%s "$abs")" "$make" "${flags%,}" >> "$OUT"
    if (( count % 500 == 0 )); then
      echo "  $count done" >&2
    fi
done < <(find "$DIR" -type f \
    \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' -o -iname '*.tiff' -o -iname '*.bmp' \) \
    -print0 | sort -z)

if (( DO_HASH )); then
  # second pass: append DUP to every path whose md5 occurs more than once
  cut -f1 "$HASHLIST" | sort | uniq -d > "$TMPDIR_W/dupes"
  if [[ -s $TMPDIR_W/dupes ]]; then
    awk -F'\t' -v OFS='\t' '
      FNR==1 { fileno++ }
      fileno==1 { dup[$1]=1; next }
      fileno==2 { ph[$2]=$1; next }
      { if (ph[$1] in dup) $7 = ($7 == "" ? "DUP" : $7 ",DUP"); print }
    ' "$TMPDIR_W/dupes" "$HASHLIST" "$OUT" > "$TMPDIR_W/out2" && mv "$TMPDIR_W/out2" "$OUT"
  fi
fi

flagged=$(awk -F'\t' 'NR>1 && $7!=""' "$OUT" | wc -l)
count=$(awk 'END{print NR-1}' "$OUT")

# Consolidated report: file name only (no directory), plus an (empty)
# description column that the vision stage fills in. The structural TSV
# stays as the raw audit log.
RPT="$(dirname "$OUT")/report.tsv"
{
  printf 'file\tdate\tw\th\tsize\tmake\tflags\tdescription\n'
  tail -n +2 "$OUT" | while IFS=$'\t' read -r p dt w h sz mk fl; do
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t\n' "${p##*/}" "$dt" "$w" "$h" "$sz" "$mk" "$fl"
  done
} > "$RPT"
echo "done: $flagged/$count flagged -> $OUT (report: $RPT)" >&2
