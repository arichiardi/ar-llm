---
name: textweb-browser
description: Advanced text-grid browser - navigate long web forms that span multiple pages (job applications, online checkouts, sign-ups), wait for dynamic content, check field values before submit, save and reuse login state, run parallel browser sessions. For basic search and page browsing use the web-searcher skill.
compatibility: Prefers native MCP tools; fallback needs a shell with curl, MCP_TEXTWEB_URL, and MCP_API_TOKEN.
---

# TextWeb Browser — Advanced Reference

## Tool access

Two transports reach the TextWeb MCP server.

1. Preferred: call the `textweb_*` tools directly when the host exposes them.
2. Fallback: when no such tool is available, use the recipes in
   [references/mcp-proxy-fallback.md](references/mcp-proxy-fallback.md).

If neither transport works, stop and ask the user to set `MCP_TEXTWEB_URL`
and `MCP_API_TOKEN`.

The rest of this file is transport-neutral. It names tools, not calls.

TextWeb renders pages with headless Chromium (full JS execution) into **character grids** with `[ref]` annotations — the tool of choice for bot-protected, SPA, or dynamic pages that defeat static crawls.

Grid element notation and the basic `navigate`/`click`/`type` calls: see the **web-searcher** skill. This skill covers everything beyond the basics.

## Full Tool List

| Tool | Purpose |
|------|---------|
| `textweb_navigate(url)` | Open a page → returns grid |
| `textweb_click(ref)` | Click. Supports `retries` and `retry_delay_ms` for flaky elements |
| `textweb_type(ref, text)` | Type into input |
| `textweb_select(ref, value)` | Choose dropdown option |
| `textweb_scroll(direction)` | `up` / `down` / `top` |
| `textweb_press(key)` | `Enter`, `Tab`, etc. |
| `textweb_snapshot()` | Re-render after dynamic content |
| `textweb_wait_for(selector, timeout_ms)` | Wait for an async UI transition (CSS selector) |
| `textweb_assert_field(ref, expected, comparator)` | Guard before submit. Comparators: `equals`, `includes` |
| `textweb_upload(ref, path)` | File input |
| `textweb_storage_save(path)` | Persist auth/session state to a file |
| `textweb_storage_load(path)` | Restore auth/session state from a file |
| `textweb_session_list` | Inspect active sessions |
| `textweb_session_close` | Close one session or all |

Every tool accepts an optional `session_id` (default: `"default"`).

## Response Format

Every `textweb_navigate` (and most other) response has two sections:

1. **Grid** — the rendered page, spatial layout preserved, with URL/title/ref-count header:
   ```
   URL: https://news.ycombinator.com/
   Title: Hacker News
   Refs: 169

   [0]Hacker News [1]new | [2]past | ...
    1. [9]OpenAI Submits S-1 Draft to SEC
       142 points by [10]hackerBanana ...
   ```
2. **Interactive elements index** — flat list mapping each ref to type and text:
   ```
   Interactive elements:
   [0] link: Hacker News
   [9] link: OpenAI Submits S-1 Draft to SEC
   [168] input: (no text)
   ```

Scan the **elements index** to find a ref by label; use the grid for spatial context.

## Multi-Step Flow Recipe (job applications, checkouts, wizards)

For any flow with multiple steps, use ONE stable `session_id` for the whole flow and guard each transition:

1. `textweb_navigate` the entry page with `session_id: "flow-name"`
2. Fill fields (`textweb_type` / `textweb_select`), pass `session_id` on every call
3. Click Continue/Next with `retries` and `retry_delay_ms` for flaky elements
4. `textweb_wait_for` the next step's selector (guards the transition)
5. Before the final submit, `textweb_assert_field` to validate what will be sent
6. `textweb_storage_save` at the end if you may resume later

For the HTTP wire format of each call, see
[references/mcp-proxy-fallback.md](references/mcp-proxy-fallback.md).

## Auth State Reuse (SSO / protected pages)

Save the browser's storage state once (after logging in), reuse it in later sessions:

1. After authenticating, call `textweb_storage_save(path)`.
2. At the start of a new session, call `textweb_storage_load(path)`.

For the HTTP wire format, see
[references/mcp-proxy-fallback.md](references/mcp-proxy-fallback.md).

## Parallel Isolated Sessions

Pass a distinct `session_id` per workflow so concurrent browsing does not interfere:

    textweb_navigate("https://example.com", session_id="task-a")

Use `textweb_session_list` to inspect active sessions and `textweb_session_close` to clean up.

## Notes

- After `textweb_click` on a link the destination grid arrives automatically — no extra `navigate`.
- Structured/semantic JSON output (`--output semantic`) is a CLI feature and is **not exposed via the MCP server** — MCP always returns the grid format. Use the Interactive elements index as the structured reference.
