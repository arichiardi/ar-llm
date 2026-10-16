---
name: clojure-implement
description: Implement and verify a Clojure feature in a running nREPL. Use when adding or changing Clojure code and you want REPL-driven development with clj-nrepl-eval, then paren repair with clj-paren-repair.
compatibility: Requires clj-nrepl-eval and clj-paren-repair on PATH, plus a running nREPL server.
---

# Implement with Clojure

Implement a Clojure feature and verify it in a running nREPL. Follow the
`clojure-coder` skill for tone and style; this skill covers the executable
workflow.

## Explore

Explore the code before you change it. The goal of this step is learning, not
output. Ask the user if the task needs deep exploration. Skip it when the
context is already known. Honor every request for deep exploration. Do not
compress it into a final answer.

1. Find the target namespaces. Search with the shell to keep context small.
2. Read the entry point. Follow the call chain to the boundary of each part.
3. Locate the business logic. Expect it in pure functions, not in handlers.
4. Select one input from the user request. Pass it through each pure function.
5. Print the function name, the input, and the output for every step.
6. Confirm each step in the REPL before you move to the next one.

When the user asks for the data flow, show the call chain in order. Include the
function name, the input, and the output for every hop. If the chain is long,
trace it in steps. Stop after 3 to 5 steps, then ask the user a question or ask
the user to resume.

Foster learning. Name the pattern you find. State why the code uses it. Stop at
each surprising result and explain it.

## Workflow

1. Discover nREPL servers and ask the user to select a port.

   ```shell
   clj-nrepl-eval --discover-ports
   ```

2. Health-check the connection before any real work.

   ```shell
   clj-nrepl-eval -p <PORT> --timeout 2000 "(println \"agents\")"
   ```

   STOP and ask the user if this fails.

3. Require the namespace under test with `:reload`.

   ```shell
   clj-nrepl-eval -p <PORT> "(require '[my.ns :as ns] :reload)"
   ```

4. Develop in the REPL. Evaluate small forms to confirm each step before you
   edit a file.
5. Edit files. Write the namespace declaration first, then add and test one
   function at a time.
6. Verify. Re-require with `:reload` and re-evaluate after every edit.
7. Add or update tests in `test/`, then run them.

## Rules

- Prefer heredoc via stdin to avoid shell escaping.

  ```shell
  clj-nrepl-eval -p <PORT> <<'EOF'
  (ns/my-fn 42)
  EOF
  ```

- Command-line arguments take precedence over stdin.
- Sessions persist across invocations: vars, namespaces, and loaded libraries
  remain until the nREPL server restarts.
- `--reset-session` clears only the nREPL session state (dynamic vars, `*e`,
  `*1`), not `def`'d vars or loaded namespaces. Reset and evaluate in one call.

  ```shell
  clj-nrepl-eval -p <PORT> --reset-session "(def x 1)"
  ```

- The default timeout is 2 minutes. Raise it for long operations.
- Never run blocking commands.
- Keep edits small. Long functions and deep nesting raise the risk of
  unbalanced delimiters.

## Parenthesis repair

Do NOT repair delimiters by hand. Run:

```shell
clj-paren-repair <files>
```

The tool repairs missing or mismatched parentheses, then formats with cljfmt.
If it fails, report to the user. Split long functions and deep nesting into
smaller focused functions to reduce the risk.
