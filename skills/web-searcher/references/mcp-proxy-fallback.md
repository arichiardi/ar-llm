# MCP proxy fallback for web-searcher

Use this file only when the host exposes no native `search`, `crawl`, or
`textweb_*` tool. If a native tool is available, call it directly instead.

The URLs, bearer token, and JSON-RPC envelope below are specific to this
MCP proxy. Change them if you point the skill at another proxy.

All calls are a single HTTP POST with JSON-RPC 2.0. Responses are plain
JSON: no SSE and no session initialization.

Authenticate every call with this header:

    -H "Authorization: Bearer $MCP_API_TOKEN"

Endpoints:

| Server | URL | Tools |
|--------|-----|-------|
| SearXN+Crawl MCP | `$MCP_SEARCH_URL` | `search`, `crawl`, `crawl_site` |
| TextWeb MCP | `$MCP_TEXTWEB_URL` | `textweb_*` |

Extract text from a result with jq:

    curl -s "$MCP_SEARCH_URL" ... | jq -r '.result.content[].text'

Set `timeout` on every curl: 30s for navigate and `wait_for`, 15s for
actions. This avoids hanging on slow pages.

## Reference commands

Adjust `timeout`, tool name, and arguments as needed.

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

If `MCP_SEARCH_URL`, `MCP_TEXTWEB_URL`, or `MCP_API_TOKEN` are unset, the
calls fail. Ask the user to export them first.
