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
It selects which model summarizes the handoff (typically a cheaper model than
the active session model) and optionally overrides the system prompt and
per-model compat flags. With no config, the active session model is used.

```json
{
  "provider": {
    "github-copilot": {
      "claude-haiku-4-5": {
        "compat": { "forceAdaptiveThinking": false }
      }
    }
  },
  "system-prompt": "Custom summarization prompt..."
}
```

Compat flags depend on the model's API. `forceAdaptiveThinking` only applies to
Anthropic Messages-compatible models. llama.cpp serves the OpenAI completions
API, so its flags look like this:

```json
{
  "provider": {
    "llama.cpp": {
      "Qwen3.8-27B": {
        "compat": {
          "supportsStore": false,
          "supportsDeveloperRole": false,
          "supportsReasoningEffort": false,
          "supportsUsageInStreaming": true,
          "supportsStrictMode": false,
          "maxTokensField": "max_tokens"
        }
      }
    }
  }
}
```

Debug logging: set `PI_HANDOFF_DEBUG=1` to log to `$TMPDIR/ar-llm/pi-handoff.log`.

## License

[MIT](./LICENSE) — derived from [earendil-works/pi](https://github.com/earendil-works/pi), copyright Mario Zechner.
