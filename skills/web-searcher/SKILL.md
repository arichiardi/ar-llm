---
name: web-searcher
description: Search the web, read page content, and navigate through links. Use for any task that needs live web content — searching, fetching pages, following links, multi-page browsing, filling forms.
---

# Web Research (Search + Crawl + Browse)

Three backends, two endpoints, all called via HTTP POST with JSON-RPC 2.0:

| Task | Tool | Endpoint |
|------|------|----------|
| Find URLs | `search` (SearXNG metasearch) | `$MCP_SEARCH_URL` (SearXN+Crawl MCP) |
| Read content of known URLs | `crawl` (Crawl4AI extraction) | `$MCP_SEARCH_URL` (SearXN+Crawl MCP) |
| Move through pages, click, fill forms | `textweb_*` (text-grid browser) | `$MCP_TEXTWEB_URL` (TextWeb MCP) |

Responses are **plain JSON** — no SSE, no session initialization. Authenticate every call with `-H "Authorization: Bearer $MCP_API_TOKEN"`.

Extract text with jq: `curl -s "$MCP_SEARCH_URL" ... | jq -r '.result.content[].text'`

## Choosing between crawl and TextWeb — read this first

This is the most common mistake: using `crawl` when you actually need to navigate, or using TextWeb when you only need content.

- **`crawl`** = one-shot content extraction. You already have the URL and you want its text as clean markdown. Static pages, docs, articles, GitHub pages.
- **TextWeb** = interactive navigation. You need to move from page to page: click a link, follow pagination, expand collapsed content, fill a form, submit a search inside a site.

Decision rule:

1. You have a URL and want to read it → `crawl`.
2. The content you want is **behind a link you must click** (next page, category page, "read more", deep into a site) → TextWeb: `textweb_navigate` to the entry page, then `textweb_click` the link.
3. A `crawl` failed (JS-heavy or bot-protected site, e.g. StackOverflow, USPS tools) but the request itself succeeded → retry the page in TextWeb before giving up.
4. Multiple known URLs, no navigation → one batched `crawl` call.

**Do not use `crawl` to navigate.** Crawling a link target you found on another page is fine only when you already know the exact URL. If reaching the content requires following the page's navigation, use TextWeb.

## search: aggregate your queries (CRITICAL)

The upstream engines (DuckDuckGo, Google, Startpage) rate-limit hard. After **2–3 individual searches** they return CAPTCHAs or "access denied" errors, and later searches return nothing.

1. Plan before you search. Write one query that covers everything you need.
2. Combine related lookups into a single query. Example: search `"zip codes 30024 30040 30145"` once, not three times.
3. Budget: 2–3 `search` calls maximum per task.
4. Use `time_range` / categories instead of rephrasing queries when you only need recent results.
5. If a search returns CAPTCHA or empty results, do not retry the same query. Switch angle, or `crawl` / TextWeb-navigate a URL you already know.

## crawl: raise the timeout, batch the URLs

The server default per-URL `timeout` is 15 seconds. That is too short. **Always pass `"timeout": 45` or higher.**

1. Batch URLs — `crawl` accepts a list. Crawl all candidate pages in one call, not one call per page.
2. `output_format`: the correct parameter name is `output_format` (not `format` or `outputFormat`). Values: `"markdown"` (default) or `"json"` (metadata + statistics).
3. `remove_links: true` when a page is link-heavy and the links are not useful.
4. No post-processing: parse the result directly in your LLM context. Do not pipe output through `sed`, `grep`, or extra `jq` beyond extracting `.result.content[].text`.
5. If you get `"Unknown tool"` errors, double-check the tool name (`crawl`, `crawl_site`, `search`).

### crawl_site: use with care

**⚠️ `crawl_site` is extremely resource-intensive** — it crawls entire websites recursively and consumes significant CPU, memory, and bandwidth on the MCP server. Always ask the user for explicit confirmation before using it. Prefer `crawl` with specific URLs, or TextWeb for walking a site page by page.

## TextWeb: interactive navigation

TextWeb renders pages as **character grids** — no vision model needed. Interactive elements are annotated with `[ref]` numbers you act on:

| Element | Appears as | Action |
|---------|-----------|--------|
| Link | `[3]Click me` | `textweb_click(3)` |
| Button | `[5 Submit]` | `textweb_click(5)` |
| Text input | `[7:placeholder___]` | `textweb_type(7, "text")` |
| Checkbox | `[9:X] Label` | `textweb_click(9)` to toggle |
| Radio | `[11:●] Option` | `textweb_click(11)` |
| Dropdown | `[13:▼ Selected]` | `textweb_select(13, "value")` |
| File input | `[15:📎 Choose file]` | `textweb_upload(15, "/path/file")` |

Every response contains the grid (spatial layout preserved) plus an **Interactive elements index** at the bottom — scan that index to find a ref by label instead of parsing the grid.

Tools: `textweb_navigate(url)`, `textweb_click(ref)`, `textweb_type(ref, text)`, `textweb_select(ref, value)`, `textweb_scroll(direction)`, `textweb_press(key)`, `textweb_snapshot()` (re-render after dynamic content), `textweb_wait_for(selector, timeout_ms)`, `textweb_assert_field(ref, expected, comparator)` (guard before submit).

Notes:
- After `textweb_click` on a link you get the destination page's grid automatically — no extra navigate call.
- Use `timeout` on every curl (30s for navigate, 15s for actions) to avoid hanging on slow pages.
- Pass `session_id` to keep parallel workflows isolated.
- For advanced usage (multi-step flow recipes, storage state for auth reuse, isolated sessions, retries), see the **`textweb-browser`** skill.

## GitHub content

**Prefer `gh` for GitHub URLs** (repos, issues, PRs, gists, files):

```bash
gh issue view 123 --repo owner/repo
gh pr view 456 --repo owner/repo
gh api repos/owner/repo/contents/path/to/file
gh gist view <gist-id>
```

Only fall back to `crawl`/TextWeb for GitHub content `gh` cannot serve (GitHub Pages sites, raw markdown previews).

## Workflow

1. Run `date` when the question depends on "now", "latest", or "current".
2. `search` once with an aggregated query (see budget above).
3. Pick the 2–4 most authoritative URLs from the results.
4. If you only need their content: one batched `crawl` call with `"timeout": 45`.
5. If you need to move through a site (pagination, sub-pages, forms): `textweb_navigate` the entry URL, then click through using refs.
6. Answer from the retrieved content. Cite the source URL for every claim. If a page could not be retrieved, say so — never guess its content.

## curl reference

All calls are a single POST. Adjust `timeout`, tool name, and arguments as needed.

```bash
# Search
timeout 60 curl -s "$MCP_SEARCH_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  --data-raw '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search","arguments":{"query":"your aggregated query"}}}'

# Crawl (batch, raised timeout)
timeout 60 curl -s "$MCP_SEARCH_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  --data-raw '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"crawl","arguments":{"urls":["https://a.com","https://b.com"],"timeout":45}}}'

# Crawl site (expensive — confirm with user first)
timeout 180 curl -s "$MCP_SEARCH_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  --data-raw '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"crawl_site","arguments":{"url":"https://example.com","max_depth":2,"max_pages":10,"timeout":120}}}'

# TextWeb navigate
timeout 30 curl -s "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  --data-raw '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"textweb_navigate","arguments":{"url":"https://example.com"}}}'

# TextWeb click ref 9
timeout 15 curl -s "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  --data-raw '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"textweb_click","arguments":{"ref":9}}}'

# TextWeb type into ref 7
timeout 15 curl -s "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  --data-raw '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"textweb_type","arguments":{"ref":7,"text":"hello world"}}}'
```

If `MCP_SEARCH_URL`, `MCP_TEXTWEB_URL`, or `MCP_API_TOKEN` are unset, the calls will fail — ask the user to export them first.
