---
name: searxncrawl-local
description: Fetch and read web page content from a local SearXN+Crawl MCP endpoint. The server uses Crawl4AI under the hood and provides crawling, site crawling, and search tools.
---

# Web Page Crawling (SearXN+Crawl MCP)

Fetch full text content of web pages using the local SearXN+Crawl MCP server. The endpoint is stored in the `MCP_SEARCH_URL` environment variable and communicates over **Server-Sent Events (SSE)** with session management.

Under the hood it uses **Crawl4AI** for extraction. Some JavaScript-heavy or bot-protected sites (e.g. StackOverflow, USPS tools) may return crawl errors — try simpler static pages when possible.

## Usage Guidelines

- **No post-processing**: Parse the result directly in your LLM context. Do not pipe output through `jq`, `sed`, or `grep`.
- **No session management**: The server returns plain JSON — no SSE, no session ID required.
- **Always set `timeout`**: The default per-URL timeout is only 15 seconds, which is often too short. Always pass **at least 45 seconds** (`"timeout": 45`) to avoid spurious errors.
- **Use `output_format`**: The correct parameter name is `output_format` (not `format` or `outputFormat`). Values: `"markdown"` (default) or `"json"`.
- **Verify tool names**: If you get `"Unknown tool"` errors, double-check the name (`crawl`, `crawl_site`, `search`).
- **URL encoding**: Use `jq -Rs @uri` for safe URL-encoding when needed.
- **Bot protection**: Sites with heavy JavaScript rendering or bot protection may return crawl errors even though the request succeeds.

## ⚠️ CRITICAL: SEARCH IS HIGHLY LIMITED — AGGREGATE QUERIES

The `search` tool is severely rate-limited by upstream engines (DuckDuckGo, Google, Startpage). After just **2–3 individual searches**, all engines return CAPTCHAs or "access denied" errors, rendering subsequent searches useless.

**Always aggregate multiple lookups into a single search query whenever possible.** For example:
- Instead of searching `"zip code 30024"`, then `"zip code 30040"`, etc., combine them into one query: `"zip codes 30024 30040 30145"`
- When validating multiple items, include as many as possible in one search call
- Minimize the total number of `search` tool calls per session

This is extremely important — failing to aggregate will result in most searches returning empty results due to rate limiting.

## Available Tools

| Tool | Description |
|------|-------------|
| `crawl` | Crawl one or more URLs and return clean markdown content |
| `crawl_site` | Crawl an entire website with depth/page limits |
| `search` | Search the web using the SearXNG metasearch engine

Output formats for crawl tools:
- **markdown** (default): Clean concatenated markdown
- **json**: Full details including metadata and references

## Workflow

All tool calls are a single POST to `$MCP_SEARCH_URL`. No session initialization needed — the server returns plain JSON directly.

#### Crawl a URL

```bash
timeout 60 curl -s "$MCP_SEARCH_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  --data-raw '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"crawl","arguments":{"urls":["https://example.com"],"timeout":45}}}'
```

#### Crawl Multiple URLs

```bash
timeout 60 curl -s "$MCP_SEARCH_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  --data-raw '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"crawl","arguments":{"urls":["https://a.com","https://b.com"],"timeout":45}}}'
```

#### Crawl with JSON output

```bash
timeout 60 curl -s "$MCP_SEARCH_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  --data-raw '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"crawl","arguments":{"urls":["https://example.com"],"timeout":45,"output_format":"json"}}}'
```

#### Search the Web

```bash
timeout 60 curl -s "$MCP_SEARCH_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  --data-raw '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search","arguments":{"query":"your search query"}}}'
```

#### Crawl an Entire Site

**⚠️ WARNING: `crawl_site` is extremely resource-intensive.** It crawls entire websites recursively and can consume significant CPU, memory, and network bandwidth on the MCP server. **Always ask the user for explicit confirmation before using this tool.** Prefer `crawl` with specific URLs whenever possible.

```bash
timeout 180 curl -s "$MCP_SEARCH_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  --data-raw '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"crawl_site","arguments":{"url":"https://example.com","max_depth":2,"max_pages":10,"timeout":120}}}'
```


