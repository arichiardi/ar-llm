# @ar-llm/pi-custom-compaction

[![npm](https://img.shields.io/npm/v/@ar-llm/pi-custom-compaction)](https://www.npmjs.com/package/@ar-llm/pi-custom-compaction) [![Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](./LICENSE)

Pi extension that replaces default compaction with a full LLM-generated summary. Supports **provider-aware configuration** so different session providers can use different compaction models, request params, and prompts.

## Install

```bash
pi install 'npm:@ar-llm/pi-custom-compaction'
```

Or try without installing:

```bash
pi -e 'npm:@ar-llm/pi-custom-compaction'
```

## How It Works

Instead of keeping the last 20k tokens of conversation turns, this extension:
1. Summarizes **ALL** messages (`messagesToSummarize` + `turnPrefixMessages`)
2. Discards all old turns completely, keeping only the LLM-generated summary

The compaction model is selected based on the **active session's provider**. Each provider can configure its own compaction model, request params, and prompts.

## Configuration

Create the config file at `~/.config/pi/agent/ar-llm/custom-compaction.json`:

```json
{
  "defaultPrompt": {
    "system": "You are a conversation summarizer. Create a comprehensive summary that captures all information needed to continue the work effectively.",
    "user": "Summarize this conversation with clear sections covering:\n\n1. Main goals and objectives discussed\n2. Key decisions made and their rationale\n3. Important code changes, file modifications, or technical details\n4. Current state of any ongoing work\n5. Any blockers, issues, or open questions\n6. Next steps that were planned or suggested\n\nBe thorough but concise. This summary will replace the ENTIRE conversation history.\n\nFormat as structured markdown with clear sections.{previous_summary}\n<conversation>\n{conversation}\n</conversation>",
    "includePreviousSummary": true
  },
  "providers": {
    "github-copilot": {
      "model": "claude-haiku",
      "request-params": {
        "providers": {
          "openai-compatible": { "max_tokens": 4096 }
        }
      }
    },
    "openrouter": {
      "enabled": false
    },
    "anthropic": {
      "model": "claude-opus",
      "prompt": {
        "system": "You are an expert code summarizer...",
        "user": "Summarize the technical details of this conversation...",
        "includePreviousSummary": true
      }
    }
  }
}
```

### Config Fields

**`defaultPrompt`** (optional): Shared prompt template used by all providers unless overridden. If omitted or invalid, built-in defaults are used.

**`providers`** (required): Map of session provider names to their compaction configuration.

#### Provider Config

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | `boolean` | Set to `false` to silently skip compaction for this provider. |
| `model` | `string` | Model ID to use for compaction (looked up within the session's provider). Required unless `enabled: false`. |
| `request-params` | `object` | Per-provider/per-model request parameters. |
| `prompt` | `object` | Provider-specific prompt that overrides `defaultPrompt`. |

### Behavior

1. Loads `defaultPrompt` (or uses built-in defaults)
2. Gets the active session's provider from `ctx.model.provider`
3. Looks up `providers.<sessionProvider>` in config
4. If `enabled: false` → skips compaction silently
5. Uses provider's `model`, inheriting `defaultPrompt` unless overridden
6. If no config exists for the session provider → skips (no fallback)

## License

[The Unlicense](./LICENSE) — public domain. Substantially rewritten from [earendil-works/pi](https://github.com/earendil-works/pi) (see [NOTICE](./NOTICE)).
