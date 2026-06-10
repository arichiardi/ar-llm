---
name: textweb-browser
description: Browse the web using TextWeb, a text-grid browser for AI agents. Renders pages as structured character grids instead of screenshots — no vision model needed. Supports navigation, clicking, typing, scrolling, and form interaction via an MCP server called over HTTP with curl.
---

# TextWeb Browser

You have access to a text-based web browser via the TextWeb MCP server. Pages are rendered as structured character grids instead of screenshots — no vision model required.

The MCP endpoint is stored in the **`MCP_TEXTWEB_URL`** environment variable (streamable HTTP, JSON-RPC over plain HTTP POST).

## Usage Guidelines

- **No post-processing**: Parse the result directly in your LLM context. Do not pipe output through `jq`, `sed`, `grep`, or any other tool. Responses are plain JSON.
- **No session initialization needed**: Each request is self-contained. Just POST JSON-RPC to `$MCP_TEXTWEB_URL`.
- **Always use `timeout`**: Prevent hanging on slow or JS-heavy pages.
- **Session isolation**: Pass a `session_id` to keep parallel workflows isolated from each other.

## How It Works

Pages are rendered as a character grid with spatial layout preserved. Interactive elements get `[ref]` number annotations you can act on directly.

## Reading the Grid

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

## Response Format

Every `textweb_navigate` (and most other tool) response contains two sections:

1. **Grid** — the rendered page as a character grid with `[ref]` annotations, URL, title, and ref count header:
   ```
   URL: https://news.ycombinator.com/
   Title: Hacker News
   Refs: 169

   [0]Hacker News [1]new | [2]past | ...
    1. [9]OpenAI Submits S-1 Draft to SEC
       142 points by [10]hackerBanana ...
   ```

2. **Interactive elements index** — a flat list mapping every ref to its type and text:
   ```
   Interactive elements:
   [0] link: Hacker News
   [1] link: new
   [9] link: OpenAI Submits S-1 Draft to SEC
   [168] input: (no text)
   ```

Use the grid for spatial context and the elements index for quickly finding a ref by label.

## Tips

- The grid preserves spatial layout — elements near each other on screen are near each other in text
- After clicking a link or submitting a form, you get the new page's grid automatically
- Use `textweb_snapshot` if you need to re-read the page after waiting for dynamic content
- For multi-step forms, fill all fields then click the Next/Submit button
- Scroll down if you don't see what you're looking for — the initial view shows only the viewport
- To find a ref quickly, scan the **Interactive elements** index at the bottom of the response rather than parsing the grid

All tools accept an optional `session_id` (default: `"default"`) for isolated parallel workflows.

## Workflow

All requests are a single `POST` to `$MCP_TEXTWEB_URL` with a JSON-RPC body.

### Example: Read the first story on Hacker News

**Step 1** — Navigate to HN and identify the first story's ref from the grid or elements index:

```bash
timeout 30 curl -s "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"textweb_navigate","arguments":{"url":"https://news.ycombinator.com"}}}'
```

The grid shows `[9]OpenAI Submits S-1 Draft to SEC` as item 1. The elements index confirms `[9] link: OpenAI Submits S-1 Draft to SEC`.

**Step 2** — Click ref 9 to open the article:

```bash
timeout 30 curl -s "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"textweb_click","arguments":{"ref":9}}}'
```

The response delivers the full article page — URL, title, rendered body text, and a new elements index for the destination page. No separate navigate call needed after a click.

---

### Navigate to a URL

```bash
timeout 30 curl -sN "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  --data-raw '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"textweb_navigate","arguments":{"url":"https://example.com"}}}'
```

### Click an Element

```bash
timeout 15 curl -sN "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  --data-raw '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"textweb_click","arguments":{"ref":3}}}'
```

### Type into a Field

```bash
timeout 15 curl -sN "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  --data-raw '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"textweb_type","arguments":{"ref":7,"text":"hello world"}}}'
```

### Select a Dropdown Option

```bash
timeout 15 curl -sN "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  --data-raw '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"textweb_select","arguments":{"ref":13,"value":"Option A"}}}'
```

### Scroll the Page

```bash
timeout 15 curl -sN "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  --data-raw '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"textweb_scroll","arguments":{"direction":"down"}}}'
```

### Re-render the Current Page

```bash
timeout 15 curl -sN "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  --data-raw '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"textweb_snapshot","arguments":{}}}'
```

### Press a Key

```bash
timeout 15 curl -sN "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  --data-raw '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"textweb_press","arguments":{"key":"Enter"}}}'
```

### Wait for Dynamic Content

```bash
timeout 30 curl -sN "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  --data-raw '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"textweb_wait_for","arguments":{"selector":".step-2.active","timeout_ms":5000}}}'
```

### Save / Load Session Storage (for auth reuse)

```bash
# Save
timeout 15 curl -sN "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  --data-raw '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"textweb_storage_save","arguments":{"path":"/tmp/textweb-state.json"}}}'

# Load
timeout 15 curl -sN "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  --data-raw '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"textweb_storage_load","arguments":{"path":"/tmp/textweb-state.json"}}}'
```

### Isolated Parallel Sessions

Pass `session_id` to keep concurrent workflows from interfering:

```bash
timeout 30 curl -sN "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  --data-raw '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"textweb_navigate","arguments":{"url":"https://example.com","session_id":"task-a"}}}'
```

## Semantic Output

TextWeb supports a `--output semantic` CLI mode that emits structured JSON with element hierarchies, types, ARIA roles, CSS selectors, and DOM paths. **This is not currently exposed through the MCP server** — the MCP always returns the grid format. For MCP workflows, use the Interactive elements index at the bottom of each response as your structured element reference.
