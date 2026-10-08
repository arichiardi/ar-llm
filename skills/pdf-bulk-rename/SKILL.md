---
name: pdf-bulk-rename
description: |
  Bulk rename PDFs in a folder (e.g. ~/Downloads) to
  <YYYY-MM-DD>_<label>.pdf. Multi-page PDFs are split into pages first,
  and each page is named with its own date. Reads the PDF text with
  pdftotext, guesses the document subject, collects candidate dates with
  their context, and only renames after the user confirms the label, the
  dates, and the full rename mapping. Use when the user asks to rename,
  tidy, or organize downloaded PDFs.
---

# PDF Bulk Rename

Rename PDFs in a folder to:

```
<YYYY-MM-DD>_<label>.pdf
```

Multi-page PDFs are split into pages first; each page becomes one file.

Each page is named with **its own date** and the shared label. Example:

```
2026-03-23_company.pdf
2026-04-06_company.pdf
2026-04-20_company.pdf
```

A `-<n>` suffix is used ONLY when two pages resolve to the same date
(duplicate). The suffix scheme is confirmed with the user at that point.

The agent MUST NOT rename anything until the user has explicitly confirmed
three things, in this order: (1) the label, (2) the dates, (3) the full
rename mapping.

## Workflow

### Step 0 — Locate the PDFs

1. Default directory is `~/Downloads`. Use the directory the user names
   instead.
2. List the PDFs in the directory:
   ```bash
   ls <dir>/*.pdf
   ```
3. If the user named a file (or a set of files), use that. Otherwise show
   the list and ask which PDFs to process. Do not guess.
4. Files whose names carry a page index (e.g. `page1.pdf`,
   `report-2.pdf`) are pages of one document: sort them numerically by
   index (use `ls -v` or sort on the number, not lexicographically).
   All other files are standalone documents.

### Step 0a — Split multi-page PDFs

1. Check the page count of every selected PDF:
   ```bash
   pdfinfo <file> | grep Pages
   ```
2. Single-page PDFs need no split; use the file as-is.
3. Multi-page PDFs are split into a fresh temp directory so a read-only
   source directory is never touched. `TMPDIR` is the standard temp-dir
   env var; it falls back to `/tmp` when unset:
   ```bash
   tmpdir=$(mktemp -d "${TMPDIR:-/tmp}/pdf-bulk-rename.XXXXXX")
   pdfseparate <dir>/<source>.pdf "$tmpdir"/page%d.pdf
   ```
   With several multi-page PDFs, use one temp subdirectory per document
   so the pages do not mix.
4. Verify the split produced exactly as many files as the page count.
5. Keep the original `<source>.pdf`. Do not ask, do not delete it.
6. The split pages join the batch as individual files. After step 5, tell
   the user the result path and ask whether to move the files elsewhere.

### Step 1 — Read the content and guess the subject

1. Extract text from each page:
   ```bash
   pdftotext <dir>/page<N>.pdf -
   ```
   `pdftotext` converts the PDF's text layer to plain text on stdout so the
   agent can read it. For long documents, reading the first 2-3 pages is
   usually enough to identify the subject. Read more only when needed.
2. Guess the subject (pay slip, invoice, bank statement, contract, letter,
   etc.) and report it to the user in one sentence, citing the evidence
   (company name, document title).
   If the pages cover different subjects (e.g. different pay periods,
   different companies), say so per page.
3. If the PDFs are scanned images with no text layer, say so and ask the
   user for the label and date(s) directly. Do not guess.

### Step 2 — Ask the user for the label

- Ask the user to confirm the label with a yes/no question. Propose one
  label (a short lowercase word or phrase, e.g. `acme`, `invoice`,
  `lease`) based on your subject guess and ask:
  ```
  Use `acme` as the label? (yes, or type a different one)
  ```
  A `yes` confirms the suggestion. Any other text is the new label.
  - When the document names a company (pay slips, invoices, statements),
    prefer the company name as the label over a generic type word.
    E.g. a pay slip from Acme Corp: `acme`, not `payroll`. Company labels
    are more distinguishable when searching for files later.
- The label must be a single path-safe token: lowercase, hyphens allowed,
  no spaces, no slashes.
- One label covers the whole batch. If pages are clearly different
  document types, mention it and ask whether one label still fits.

### Step 3 — Collect candidate dates. NEVER PRESELECT A DATE YOURSELF

1. Scan the extracted text of EACH page for all dates. Common formats in
   US/CA/UK documents: `MM/DD/YYYY`, `DD.MM.YYYY`, `YYYY-MM-DD`,
   `D Month YYYY`, `Month D, YYYY`.
2. For EACH distinct date found on a page, record the surrounding context:
   the field label or sentence it appears in (e.g. "Pay Period Begin",
   "Date of Birth", "Invoice Date", "Issued", "Due").
   If a date appears with a time, show the full raw value (date + time),
   but note that the filename will use the date only, no time.
3. Present the candidates to the user as a markdown table with ONE ROW
   PER PAGE. MAXIMUM 10 DATA ROWS IN ANY TABLE YOU SHOW THE USER, no
   matter the layout. If the table has more than 10 data rows, show the
   first 10 and nothing else: state how many rows were omitted and offer
   to write all the dates to a file (e.g. `<dir>/dates.txt`) if the user
   wants to check them. Do not show the omitted rows in any other form
   (no second table, no summary list of the rest).
   For each date field, explain what it most likely means based on the
   subject guess from step 1.
   - If the pages share the same date fields, use the fields as columns
     and ask which field (or which per-page value) to use:
     ```
     | Page | Pay Period Begin | Pay Period End | Check Date |
     |------|------------------|----------------|------------|
     | 1    | 2026-03-23       | 2026-04-05     | 2026-04-10 |
     | 2    | 2026-04-06       | 2026-04-19     | 2026-04-24 |
     | ...  | (first 10 rows only)                        |

     Fields: Pay Period Begin = pay period start, Pay Period End = pay
     period end, Check Date = pay day.
     Which field should be used for each page?
     ```
   - If the date fields differ between pages, use one row per page + date
     (a `Field` column). The 10-row limit above applies to this layout
     too.
5. **CRITICAL COMPLETENESS CHECK** — mandatory before presenting the
   table. A dropped date means a wrong filename, and the user cannot
   pick a date they never see. Re-read the extracted text of each page
   and look for every token that looks like a date (any format: numbers
   with slashes or dashes, month names with a year, times that carry a
   date). Do not use regexes. Every date you find must be present in
   your candidate list or explicitly excluded with a reason (e.g. not a
   full date, part of a phone number). If you find a date missing from
   the list, add it before presenting the table.
4. Rules:
   - Do not pick a date for the user, even if one seems obvious.
   - If two dates share a format and context is ambiguous, state the
     ambiguity and ask a clarifying question.
   - If no date is found in the text of a page, ask the user to provide
     one.
   - If the same date appears in multiple fields on a page, list it once.
   - If every page has the same relevant date, present it once and confirm
     it once for all pages.

### Step 4 — Propose the rename mapping and confirm

1. Build the full mapping using each page's confirmed date, as a markdown
   table. This table is the FINAL result: it must contain ALL rows, no
   omissions, no matter how long it is. The 10-row limit from step 3
   applies to candidate lists only, not to the mapping:
   ```
   | Source    | Target                 |
   |-----------|------------------------|
   | page1.pdf | 2026-03-23_company.pdf |
   | page2.pdf | 2026-04-06_company.pdf |
   | page3.pdf | 2026-04-20_company.pdf |
   ```
2. **Duplicates.** If two or more pages resolve to the same
   `<date>_<label>` target, you must disambiguate. Present the duplicates
   to the user and propose the default scheme: append `-<n>` where n is
   the original page index:
   ```
   Pages 1 and 3 both date to 2026-03-23. Proposed:

   | Source    | Target                    |
   |-----------|---------------------------|
   | page1.pdf | 2026-03-23_company.pdf    |
   | page3.pdf | 2026-03-23_company-3.pdf  |
   ```
   Offer the alternative: give one of the pages a different label
   (e.g. `2026-03-23_company-early.pdf`). Wait for the user's choice.
   Never pick a suffix scheme silently.
3. Check for collisions with EXISTING files BEFORE proposing:
   ```bash
   ls <dir>/<YYYY-MM-DD>_<label>*.pdf 2>/dev/null
   ```
   If any target name already exists, report it and stop. Ask the user how
   to proceed (change the label, change the date, or abort). Do not
   overwrite.
4. Show the full mapping to the user and ask a yes/no question:
   ```
   Apply this mapping? (yes, or tell me what to change)
   ```
   If the answer names a directory (e.g. `store in ~/tmp`), treat it as
   the destination: update the mapping targets to that directory, show
   the updated mapping, and confirm once more before executing.

### Step 5 — Execute the rename

Only after explicit confirmation:

```bash
mv <dir>/page1.pdf <dir>/2026-03-23_company.pdf
mv <dir>/page2.pdf <dir>/2026-04-06_company.pdf
# ... one mv per file
```

1. Run one `mv` per file, no force flags.
2. After renaming, verify with `ls <dir>/*_<label>*.pdf` and show the
   result to the user.
3. If any `mv` fails, report the exact error and stop. Do not continue
   with the remaining files silently.
   - If the error is `Read-only file system`, ask the user for a writable
     destination directory. Rebuild and confirm the mapping, then `cp` (not
     `mv`) each file to its new name there. Tell the user the originals
     stay in the read-only directory.

## Hard rules

- Present lists to the user (date candidates, rename mapping) as markdown
  tables. Do not use ad-hoc aligned text layouts.
- Maximum 10 data rows in EXPLORATORY tables (date candidates). For
  more, show the first 10, state the omitted count, and offer a file.
  The final rename mapping table is always complete: all rows, no
  omissions.
- Report every tool error to the user AS IS, with the exact output.
  Do not investigate, diagnose, retry, or work around it. Stop and wait
  for the user. This applies to every command in this skill.
  - If the error is a missing command (`command not found`), add the note:
    "Make sure you have the required tools installed: `pdftotext`,
    `pdfseparate`, `pdfinfo` (all from the `poppler-utils` package)."
- Never rename without three explicit user confirmations: label, dates,
  mapping.
- **CRITICAL:** every date found in the documents must appear in the
  candidate table, or be excluded with a stated reason. Always run the
  step 3 completeness check before presenting. A date the user never
  sees cannot be chosen.
- Never preselect a date. Always present all candidates with context.
- Filenames use the date only (`YYYY-MM-DD`), never a time, even if the
  document shows date + time.
- A `-<n>` suffix is used only for duplicate dates, and only after the
  user confirms the suffix scheme.
- Never overwrite an existing file. Check targets first.
- Never delete a file (including the original after a split) without an
  explicit user answer.
- Keep the page order in the mapping identical to the source page numbers.
- Files go ONLY to the destination the user confirmed. Never move or
  copy files to any other directory (including back to the original
  directory) without the user asking for it explicitly.
