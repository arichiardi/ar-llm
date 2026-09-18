#!/usr/bin/env bash
# mark.sh — for each suspect in report.tsv, render an image marker next to the
# photo: <name>_TRIAGE.<ext>.
# Marked: context_flag ($13), NO_MAKE/ERR in flags ($7), and the face-quality
# flags eyes_closed/adult_not_looking/face_cropped/motion_blur ($14,$15,$17,$18).
# NOT marked: kids_not_looking ($16) - it is too common to be actionable.
#
# The marker is a downscaled copy of the photo with a red border, a TRIAGE
# stamp and the reason on a bar at the bottom, so it opens in any viewer
# and sorts right after the original. Markers are pure derivations of
# report.tsv: --clean removes them, re-running re-creates them. The original
# files are never touched.
#
# NOTE: remove markers (--clean) before running pics-split-by-month or any
# tool that treats *.jpg as content, or they get copied along.
#
# Usage (from a month dir):
#   bash mark.sh            # create/refresh markers
#   bash mark.sh --clean    # remove all *_TRIAGE.* markers
set -euo pipefail
# config.sh next to this script (font default could live here)
OUT=.pics-vision-triage/report.tsv
FONT=${TRIAGE_FONT:-/usr/share/fonts/TTF/DejaVuSans-Bold.ttf}

if [[ ${1:-} == "--clean" ]]; then
  n=$(find . -name '*_TRIAGE.jpg' -o -name '*_TRIAGE.png' | wc -l)
  find . \( -name '*_TRIAGE.jpg' -o -name '*_TRIAGE.png' \) -delete
  echo "removed $n marker(s)"
  exit 0
fi

[[ -f $OUT ]] || { echo "no $OUT here - run flags.sh/triage.sh/review.sh first" >&2; exit 1; }
[[ -f $FONT ]] || { echo "font not found: $FONT (set TRIAGE_FONT)" >&2; exit 1; }

# awk extracts (file, reason): bash `read` with IFS=tab collapses EMPTY
# middle columns (tab is an IFS whitespace char), which would shift fields.
made=0 skipped=0
while IFS=$'\t' read -r f reason; do
  [[ -f $f ]] || { echo "note: no file $f" >&2; skipped=$((skipped+1)); continue; }
  ext=${f##*.}
  case ${ext,,} in jpg|jpeg|png) mex=$ext ;; *) mex=jpg ;; esac
  out="${f%.*}_TRIAGE.$mex"
  r=${reason:0:120}
  if (( ${#r} > 60 )); then
    l1=${r:0:59}; l2=...${r:59:59}; bar=112
    ann=(-annotate +12+60 "$l1" -annotate +12+8 "$l2")
  else
    l1=$r; bar=56
    ann=(-annotate +12+14 "$l1")
  fi
  magick "$f" -auto-orient -resize '900x900>' \
    -bordercolor '#cc0000' -border 8 \
    -font "$FONT" -pointsize 44 -fill '#e02020' -stroke white -strokewidth 2 \
    -gravity northwest -annotate +14+10 'TRIAGE' \
    -background '#141414' -splice 0x"$bar" \
    -stroke none -pointsize 22 -fill white \
    -gravity south "${ann[@]}" \
    -quality 85 "$out"
  made=$((made+1))
done < <(awk -F'\t' 'NR > 1 {
    f = $1; flags = $7; ctx = $13
    reason = (ctx != "") ? ctx : ""
    # face-quality flags ($14-18); kids_not_looking ($16) is NOT marked
    face = ""
    if (tolower($14) == "yes") face = face " eyes_closed"
    if (tolower($15) == "yes") face = face " adult_not_looking"
    if (tolower($17) == "yes") face = face " face_cropped"
    if (tolower($18) == "yes") face = face " motion_blur"
    sub(/^ /, "", face)
    if (face != "") reason = (reason != "") ? reason "; " face : face
    if (flags ~ /NO_MAKE|ERR/) reason = (reason != "") ? reason "; no camera Make in EXIF (screenshot/import?)" : "no camera Make in EXIF (screenshot/import?)"
    if (reason != "") print f "\t" reason
  }' "$OUT")
echo "markers: $made made, $skipped skipped (file missing) - pattern: *_TRIAGE.{jpg,png}"
echo "cleanup later: bash $0 --clean"
