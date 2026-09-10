# MCP proxy fallback for textweb-browser

Use this file only when the host exposes no native `textweb_*` tool. If a
native tool is available, call it directly instead.

The URLs, bearer token, and JSON-RPC envelope below are specific to this
MCP proxy. Change them if you point the skill at another proxy.

Endpoint: `$MCP_TEXTWEB_URL`, JSON-RPC over HTTP POST. Authenticate every
call with:

    -H "Authorization: Bearer $MCP_API_TOKEN"

Each request is self-contained: no session initialization.

Set `timeout` on every curl: 30s for `textweb_navigate` and
`textweb_wait_for`, 15s for actions. This avoids hanging on slow pages.

## Reference commands

Adjust `timeout`, tool name, and arguments as needed.

```bash
# Fill, then click with retries
timeout 30 curl -s "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  --data-raw '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"textweb_click","arguments":{"ref":42,"session_id":"apply-acme","retries":3,"retry_delay_ms":400}}}'

# Guard the step transition
timeout 30 curl -s "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  --data-raw '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"textweb_wait_for","arguments":{"selector":"#step-2.active","timeout_ms":8000,"session_id":"apply-acme"}}}'

# Validate before submit
timeout 15 curl -s "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  --data-raw '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"textweb_assert_field","arguments":{"ref":77,"expected":"San Francisco","comparator":"includes","session_id":"apply-acme"}}}'

# Save after authenticating
timeout 15 curl -s "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  --data-raw '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"textweb_storage_save","arguments":{"path":"/tmp/textweb-state.json"}}}'

# Load at the start of a new session
timeout 15 curl -s "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  --data-raw '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"textweb_storage_load","arguments":{"path":"/tmp/textweb-state.json"}}}'

# Isolated session
timeout 30 curl -s "$MCP_TEXTWEB_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_API_TOKEN" \
  --data-raw '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"textweb_navigate","arguments":{"url":"https://example.com","session_id":"task-a"}}}'
```

If `MCP_TEXTWEB_URL` or `MCP_API_TOKEN` is unset, the calls fail. Ask the
user to export them first.
