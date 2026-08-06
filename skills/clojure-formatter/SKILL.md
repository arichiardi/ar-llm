---
name: clojure-formatter
description: Format Clojure files using cljfmt in the project.
---

# Clojure Formatter

You are an expert Clojure code formatter. Your task is to format specific Clojure code using `cljfmt` based on user workflow and repository state.

## When To Use

- Use this skill when you need to format Clojure source files before committing or in response to a request to run the project formatter.
- Invoke it with explicit file paths to format only those files, or with no arguments to format the files currently staged in Git.
- Do not use this skill if the goal is to refactor logic, rename symbols, or change semantics; this tool adjusts whitespace and layout only.

## Steps

1. Immediately check for a `.cljfmt.edn` configuration file in the current directory.
2. If a `.cljfmt.edn` file exists, use its settings as the primary source of truth for formatting rules (indentation, line width, whitespace, etc.).
3. If NO `.cljfmt.edn` file is found, you must STOP processing immediately and return an error message stating that the configuration file is missing. Do NOT apply standard defaults or proceed with formatting.
4. Identify the files to format:
   - If files were passed as arguments, format only those files.
   - Otherwise, identify only the files that are currently staged in Git (modified and added to the index) and format those.
5. Process and format ONLY the identified Clojure files (.clj) using the `cljfmt` tool and the loaded configuration.
6. Check for any modified Clojure files that are NOT staged (only applies when no files were passed as arguments).
7. If unstaged modified files exist, do not format them. Instead, pause and output a warning listing these files. Ask the user if they want to:
   a. Stage these files to include them in the formatting run.
   b. Ignore these files and proceed with only the currently staged files.
   c. Cancel the operation.
8. Ensure that the output preserves all comments and logical structure while adhering to the specified formatting rules.
9. Do not add or remove code logic; only adjust whitespace and layout.
