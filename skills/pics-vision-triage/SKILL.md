---
name: pics-vision-triage
description: |
  Audit a batch of photos for images that do not belong: a structural stage
  flags non-camera files (no EXIF Make = screenshot/import), a local
  OpenAI-compatible vision LLM (llama.cpp with an mmproj model) writes one
  short semantic description per image, and a larger vision-capable LLM
  review stage flags photos that do not fit the event their date places them
  in plus face-quality issues (closed eyes, adult/kid not looking, cropped
  face, motion blur), so the user can eyeball for misfiles and keepers.
  Use when the user asks to screen, audit, or get a per-image description of
  a folder of pictures.
---

# Pics Vision Triage

Pipeline to audit a photo collection for images that do not belong:

- **structural stage** — free, EXIF-based: flags screenshots/imports
  (`NO_MAKE`), duplicates, unreadable files;
- **vision stage** — a local vision LLM (llama.cpp `llama-server --mmproj`,
  OpenAI-compatible API) writes one short semantic description per image so
  the user can eyeball the batch for misfiles (a jacket in a vacation month,
  a stranger in a family album);
- **review stage** — a larger, vision-capable LLM runs two sub-passes on
  `report.tsv`: **misfiles** (text) reads the dated descriptions in
  chronological chunks, segments them into events, and flags photos that do
  not fit the event their date places them in (object close-ups, documents,
  screens, shots from a different occasion), plus a deterministic date-outlier
  check; **faces** (image) looks at each `face=yes` photo and flags
  face-quality issues. Results: the `context_flag` column plus five
  face-quality columns in `report.tsv`.

The vision stage does NOT try to classify screenshots vs photos — the
structural stage owns that, and small VLMs are unreliable at it.

**Read-only, except for the markers.** The pipeline only reads images and
writes reports, then `mark.sh` creates `<name>_TRIAGE.<ext>` images next to
suspects — additions only, removed with `mark.sh --clean`. **Always run
`mark.sh` at the end of the pipeline** (it is fast); there is no need to ask
first. Never move or delete originals — present the markers (or the suspect
list) to the user for a visual pass.

## Setup (one-time, for humans)

**The agent runs no pre-flight checks.** It launches the stages one by one —
`flags.sh` → `triage.sh` → `review.sh` → `mark.sh` — and reacts to what comes
back. If a stage fails (HTTP/connection error, model id not offered, etc.) it
reads the error and tells the user the inference server is likely down or
misconfigured. It does not `curl /v1/models` or `source config.sh` first.

Config lives in `scripts/config.sh` (env vars, sourced by the scripts).

Dependencies: `curl`, `jq`, `base64`, ImageMagick 7 (`magick`, `montage`,
`identify`), `flock` — all standard on Arch. The vision stage and the review
`faces` pass need a *vision* model (served with `--mmproj`); text-only models
cannot do those (`review.sh --no-faces` needs only text). Model prompts are
Markdown files in `scripts/prompts/` (`caption.md`, `sheet.md`, `faces.md`,
`misfiles.md`, `misfiles-merge.md`) — edit them there, not in the `.sh` files.

## Pipeline

Three stages. The structural stage is a free, seconds-fast first look; the
vision stage sees **every** image in the list/directory — the structural
stage never gates it. The review stage's misfiles sub-pass reads only
`report.tsv` (file, date, description); its faces sub-pass reads the `face`
column and the images. Both need the two previous stages to have run.

All reports go to `./.pics-vision-triage/` in the current working directory
(e.g. run from `2025-08/`); `--out` overrides any of them.

### Structural stage (free, seconds)

```bash
cd 2025-08
bash scripts/flags.sh .
# add --hash to md5-dedupe (slow, only when dupes are suspected)
```

Writes `.pics-vision-triage/structural-flags.tsv`:
`path \t date \t w \t h \t size \t make \t flags`, one row per image
(absolute paths — the join key for the report). `date` is EXIF
`DateTimeOriginal`, falling back to the file name; both may be empty.
It also creates the consolidated `report.tsv` with the same rows (file
name only, no directory) plus empty `description`, `face`, `blank`,
`blurry` and `text_or_screen` columns, which the vision stage fills in.

Flags: `NO_MAKE` (no EXIF camera Make — typical of screenshots/imports),
`DUP` (identical md5, with `--hash`), `ERR` (unreadable). NO_MAKE rows are
the cheap structural shortcut: read them from the TSV before/while the
vision stage runs. No dimension or filename-date flags: this collection
crops photos by hand and filenames often carry no date at all (EXIF is the
source of truth).

### Vision stage — per-image descriptions (all images)

```bash
cd 2025-08
bash scripts/triage.sh single --list .
# -> .pics-vision-triage/single-image-descriptions.jsonl
```

Every image in the list (or directory) gets one short description line
(who/what/where, max ~15 words) plus four yes/no tags, so the batch can be
clustered for deletion review as well as read:

| tag | question |
|-----|----------|
| `face` | is at least one human face (head) visible? hands/bodies alone = no |
| `blank` | is the frame essentially empty (black, white, lens covered)? |
| `blurry` | is the photo grossly out of focus? |
| `text_or_screen` | is the main subject written text or a screen (sign, plaque, label, menu, receipt, poster, TV/computer screen)? |

Caveat measured on the local 3B model: `blank` is unreliable — a pure black
frame is reported as `blank: no` ("no image provided"). Blank frames are
trivially separable by pixel statistics (`-format '%[fx:standard_deviation]'`
= 0 vs ~0.2 for real photos), so a structural check is the better home for
that signal. `face`, `blurry` and `text_or_screen` were stable and correct
across repeated runs (24/24 fields identical over 3 runs on a 6-image set).

The JSONL `{file, description, face, blank, blurry, text_or_screen, raw}` is
the raw audit log; the deliverable is the consolidated **`report.tsv`** in the
same directory — `file date w h size make flags description face blank blurry
text_or_screen`, one row per image (union of both stages, absolute paths).

Read `report.tsv` in filename (i.e. date) order and spot the odd one out
yourself; the full description list stays in the file (see Final report).
Filter `face=no` or `text_or_screen=yes` for the delete-review
buckets (markers are not created for these tags — `mark.sh` markers
`context_flag`, `NO_MAKE`/`ERR`, and the four face-quality flags; see below).

### Vision stage — contact-sheet mode (optional bulk pass)

For a fast pass over a large set, build numbered 4×4 grids and ask for one
description per cell (~4–8× fewer LLM calls, coarser detail):

```bash
cd 2025-08
bash scripts/triage.sh sheet --list . --cols 4 --rows 4
# -> .pics-vision-triage/contact-sheet-descriptions.jsonl
```

Sheets are written to `<out>.sheet-NNN.jpg` so the user can re-check any
ambiguous sheet visually.

### Review stage — misfiles + face quality (vision-capable LLM)

```bash
cd 2025-08
bash scripts/review.sh
# -> context_flag + eyes_closed/adult_not_looking/kids_not_looking/
#    face_cropped/motion_blur columns in .pics-vision-triage/report.tsv
# -> .pics-vision-triage/review-analysis.jsonl (audit: per-chunk events,
#    per-chunk outlier candidates, merge verdicts, per-face flags, raw replies)

bash scripts/review.sh --no-faces   # misfiles only (no image calls)
```

Two sub-passes on the same larger, vision-capable model:

**misfiles (text).** The dated, described rows of `report.tsv` are split
into consecutive chronological chunks (default 60); each chunk gets one
text call that (1) segments the photos into events and (2) lists outlier
candidates; a final merge call sees all chunks' events plus the candidates
and makes the CONFIRM/DROP decision. Recall is biased high (over-list
rather than miss — the user eyeballs the short suspect list), near-duplicate
bursts and coherent sub-events (a museum day inside a vacation) are
instructed not to be flagged. Independently of the LLM, any photo whose date
is more than 60 days from the directory's median date is flagged as a date
outlier (a 2019 shot in a 2025-08 dir can otherwise be normalized into its
own plausible "event" by the model). Fills `context_flag`.

**faces (image).** For each row the vision stage tagged `face=yes`, one
per-image call asks for five yes/no face-quality flags (report columns
14–18):

| column | question |
|--------|----------|
| `eyes_closed` | a person's eyes are closed or clearly mid-blink |
| `adult_not_looking` | an adult (a child does not count) is not looking toward the camera |
| `kids_not_looking` | a child (an adult does not count) is not looking toward the camera |
| `face_cropped` | a person's face is cut off by the frame edge |
| `motion_blur` | a person is blurred by camera/subject motion |

The adult/kid split lets the common child case be measured separately from
the rarer, more actionable adult case; `mark.sh` marks the other four but
**not** `kids_not_looking`.

The review model is a reasoning model (`SKILL_PICS_VISION_TRIAGE_CONTEXT_MODEL`): the
script sends `chat_template_kwargs: {"enable_thinking": false}` because
otherwise the model spends its whole token budget on `reasoning_content`
and returns an empty answer. `review.sh` validates that the chosen model
is actually offered by the server and falls back to the vision model.

Takes ~40s for a 100-photo month at concurrency 2 (misfiles); the faces
sub-pass adds one image call per `face=yes` photo. Final `report.tsv`
columns: `file date w h size make flags description face blank blurry
text_or_screen context_flag eyes_closed adult_not_looking kids_not_looking
face_cropped motion_blur`.

### Markers — image files next to the suspects (always run)

```bash
cd 2025-05
bash scripts/mark.sh           # create/refresh markers
bash scripts/mark.sh --clean   # remove all *_TRIAGE.{jpg,png} again
```

For every row with a `context_flag`, `NO_MAKE`/`ERR`, or any marked face
flag (`eyes_closed`, `adult_not_looking`, `face_cropped`, `motion_blur`),
renders `<name>_TRIAGE.<ext>` next to the photo: a downscaled copy with a red
border, a TRIAGE stamp and the reason on a bar at the bottom, so it opens
in any viewer and sorts right after the original. `kids_not_looking` is
**not** marked (too common to be actionable). Markers are pure
derivations of `report.tsv` (re-running re-creates them; originals are
never touched). **Remove them (`--clean`) before running
`pics-split-by-month`** or any tool that treats `*.jpg` as content.

## Operational notes

- **Throttle**: set `SKILL_PICS_VISION_TRIAGE_CONCURRENCY` to the
  llama-server's `--parallel` — going higher just queues on the server (no
  speedup, only extra CPU from the per-image downscale); `--concurrency`
  overrides per run. The script retries with backoff on 5xx/timeouts. Empty-content replies are treated as failures (a reasoning
  model that burns its budget on `reasoning_content` returns empty
  `content` — do not "fix" the jq check to accept that).
- **Review stage cost**: misfiles is one text call per 60 descriptions plus
  one merge call (~a minute per 100-photo month with a large model); faces
  adds one image call per `face=yes` photo (typically ~60–75% of a family
  month). Re-runs rewrite `report.tsv` in place (idempotent columns 13–18)
  and the audit JSONL from scratch.
- **Base64 payload**: images are downscaled to max side 1280px before
  encoding to keep payloads and prefill small.
- **Throughput**: the vision stage sees every image. Measured locally:
  ~1.3s/image at concurrency 2 on a small vision model, so a ~100-photo month takes
  ~2–3 minutes and a ~6000-photo collection a few hours. Re-runs are cheap
  and the JSONL is append-safe per run (each run rewrites its own file).
- **Fonts**: contact-sheet cell numbers are drawn with
  `$TRIAGE_FONT` (default `/usr/share/fonts/TTF/DejaVuSans-Bold.ttf`); override
  if that path is absent.
- **Caveat**: TSV/JSONL paths and cell maps assume filenames contain no
  colons or newlines.
- **Videos**: mp4/mov are out of scope for the image stages. If the user
  wants them, extract a mid-frame first (e.g. `ffmpeg -ss <t/2> -i f.mp4
  -frames:v 1 out.png`) and feed those through the same pipeline.

## Final report

Summarize for the user. **Never dump per-image lists in the reply, for any
stage** — the full lists live in `report.tsv` / `structural-flags.tsv` and
the on-disk markers, and they can run to hundreds of lines. The reply
reports counts and short highlight/suspect lists only; if a category is
long, give the count and point at the TSV (column or file) and the markers
instead of printing it.

Summarize for the user:
1. Structural stage: how many `NO_MAKE`/`DUP`/`ERR` rows (screenshots and
   imports live here). If the list is long, name only the few most likely
   imports; the complete list is `structural-flags.tsv`.
2. Vision stage: how many images were described, then list only the rows
   whose description mentions a screen, printout, document, or label
   (`text_or_screen=yes`) and anything that looks semantically out of place
   for the folder. The full description list stays in `report.tsv`
   (column 8, filename order).
3. Review stage: the rows with a non-empty `context_flag`, in date order
   (`name [date] — reason`) — if more than ~20, give the count and the
   shortest meaningful subset. These are the top suspects for misfiles; the
   list is biased toward over-flagging, so it is meant to be eyeballed
   (the markers) rather than printed in full. Then the face-quality flags
   (`eyes_closed`/`adult_not_looking`/`face_cropped`/`motion_blur`), same
   cap; report `kids_not_looking` as a count only (it is observational,
   not a marker).
4. Point at the JSONL files (and contact sheets, if used) for the raw audit
   trail, including `review-analysis.jsonl` (events per chunk, merge
   verdicts, per-face flags, raw model replies).
5. Ask what to do with confirmed misfiles (e.g. move to a quarantine dir) —
   do not move anything without explicit approval.
