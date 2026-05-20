---
name: web-searcher
description: Combined web search and browsing tool. Uses SearXNG for initial queries and metadata, then leverages TextWeb for interactive navigation, form filling, and content retrieval. Fully sandbox-compatible.
---

# Web Search & Browsing

This skill provides a complete workflow for discovering and interacting with web content. It chains **SearXNG** (fast, private search) with **TextWeb** (interactive, text-based browser automation).

## 🔍 Step 1: Web Search (SearXNG)
Search the web using the local SearXNG instance. The endpoint is configured via the `SEARXNG_URL` environment variable.

### Usage
```bash
curl -s "$SEARXNG_URL/search?q=$(printf '%s' "YOUR QUERY" | jq -Rs @uri)&format=json&categories=general"
```

### Categories
Replace `general` with: `it`, `science`, `news`, `images`, `videos`, `music`, `files`.

### Response Format
- Returns JSON with a top-level `results` array.
- Each item includes: `title`, `url`, `content` (snippet), and optionally `engine`/`score`.
- Parse the JSON directly in your LLM context; no post-processing is needed.
- Some engines might fail, but the other results are still valid and should be considered.
- ⚠️ **Mandatory**: SearXNG only returns metadata and short content snippets. If you need the full page content or deeper information, **YOU MUST pass the `url` to TextWeb**.
- If `SEARXNG_URL` is unset, the command will fail. Ask the user to export it first.

## 🌐 Step 2: Interactive Browsing (TextWeb)
Use the `textweb_*` tools to navigate, read, and interact with web pages. Pages are rendered as structured character grids instead of screenshots.

### Available Commands
- `textweb_navigate(url)` — Opens a page and returns a text grid
- `textweb_click(ref)` — Clicks element `[ref]`  
- `textweb_type(ref, text)` — Types into input `[ref]`
- `textweb_select(ref, value)` — Selects dropdown option
- `textweb_scroll(direction)` — Scrolls up/down/top
- `textweb_snapshot()` — Re-renders current page
- `textweb_press(key)` — Presses a key (Enter, Tab, etc.)
- `textweb_upload(ref, path)` — Uploads a file to input

### Reading the Grid
Interactive elements are marked with reference numbers in brackets `[ref]`:

| Element | Appears as | Action |
|---------|-----------|--------|
| Link | `[3]Click me` | `textweb_click(3)` |
| Button | `[5 Submit]` | `textweb_click(5)` |
| Text input | `[7:placeholder___]` | `textweb_type(7, "text")` |
| Checkbox | `[9:X] Label` / `[9: ] Label` | `textweb_click(9)` to toggle |
| Radio | `[11:●] Option` / `[11:○] Option` | `textweb_click(11)` |
| Dropdown | `[13:▼ Selected]` | `textweb_select(13, "value")` |
| File input | `[15:📎 Choose file]` | `textweb_upload(15, "/path/to/file")` |
| Heading | `═══ TITLE ═══` | (not interactive) |

### Browsing Tips
- The grid preserves spatial layout — elements near each other on screen are near each other in text
- After clicking a link or submitting a form, you get the new page's grid automatically
- Use `textweb_snapshot()` if you need to re-read the page after waiting for dynamic content
- For multi-step forms, fill fields then click the Next/Submit button
- Scroll down if you don't see what you're looking for — the initial view shows only the viewport

## 🔗 Workflow Integration
1. **Search**: Run SearXNG to find relevant URLs.
2. **Navigate**: Pass promising `url` values to `textweb_navigate()`.
3. **Interact/Extract**: Read the grid, fill forms, click elements, or extract text directly from the rendered output.
4. **Fallback**: If `SEARXNG_URL` is unset or TextWeb tools fail, inform the user and suggest manual verification or alternative CLI tools.

## 🛡️ Constraints
- Runs in a restricted sandbox. Do not debug OS-level constraints (permissions, missing binaries, network paths).
- Never run long/interactive commands without explicit approval.
- Treat TextWeb output as structured text grids, not raw HTML.
- If a search returns no results or fails, try alternative categories or simplify the query before falling back.
