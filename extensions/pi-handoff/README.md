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
| `compat` | `object` | Compatibility overrides for the selected model. |

Compat flags depend on the model's API. `forceAdaptiveThinking` only applies to
Anthropic Messages-compatible models.

Debug logging: set `PI_HANDOFF_DEBUG=1` to log to `$TMPDIR/ar-llm/pi-handoff.log`.

## License

[MIT](./LICENSE) — derived from [earendil-works/pi](https://github.com/earendil-works/pi), copyright Mario Zechner.
