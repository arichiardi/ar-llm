# @ar-llm/pi-handoff

[![MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Pi extension that transfers context to a new focused session via `/handoff`. Extracts what matters and drafts a continuation prompt in the editor.

## Install

```bash
pi install 'npm:@ar-llm/pi-handoff'
```

Or try without installing:

```bash
pi -e 'npm:@ar-llm/pi-handoff'
```

## Config

Optional config file: `~/.config/pi/agent/ar-llm/handoff.json`.
It selects the model that summarizes the handoff, keyed by the active session
provider. Each provider points at a model, usually a cheaper one. With no entry
for the session provider, the active session model is used.

```json
{
  "providers": {
    "github-copilot": {
      "model": "claude-haiku-4-5",
      "compat": { "forceAdaptiveThinking": false }
    },
    "llama.cpp": {
      "model": "Qwen3.8-27B",
      "compat": {
        "supportsStore": false,
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false,
        "supportsUsageInStreaming": true,
        "supportsStrictMode": false,
        "maxTokensField": "max_tokens"
      }
    }
  },
  "system-prompt": "Custom summarization prompt..."
}
```

### Provider fields

| Field | Type | Description |
|-------|------|-------------|
| `model` | `string` | Model id for the summary within the session provider. Required for an entry to apply. |
| `stream-options` | `object` | pi `StreamOptions` fields, merged over the defaults. |
| `request-params` | `object` | Raw request-body keys, forwarded as `StreamOptions.samplingParams`. |
| `compat` | `object` | Compatibility overrides for the selected model. |

### Thinking

Thinking is off by default. Turn it on with the mechanism of the provider's
API, because servers differ. Use `request-params` for raw body keys and
`stream-options` for pi-native fields:

```json
{
  "providers": {
    "llama.cpp": {
      "model": "Qwen3.8-27B",
      "request-params": { "chat_template_kwargs": { "enable_thinking": true } }
    },
    "anthropic": {
      "model": "claude-haiku-4-5",
      "stream-options": { "thinkingEnabled": true }
    }
  }
}
```

`stream-options` holds pi `StreamOptions` fields such as `thinkingEnabled`,
`reasoningEffort`, or `temperature`. `request-params` holds keys pi does not
model, such as `chat_template_kwargs`, `reasoning_effort`, `top_p`, `top_k`,
or `min_p`.

Compat flags depend on the model's API. `forceAdaptiveThinking` only applies to
Anthropic Messages-compatible models.

Debug logging: set `PI_HANDOFF_DEBUG=1` to log to `$TMPDIR/ar-llm/pi-handoff.log`.

## License

[MIT](./LICENSE) — derived from [earendil-works/pi](https://github.com/earendil-works/pi), copyright Mario Zechner.
