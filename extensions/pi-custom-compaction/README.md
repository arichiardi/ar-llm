# @ar-llm/pi-custom-compaction

[![npm](https://img.shields.io/npm/v/@ar-llm/pi-custom-compaction)](https://www.npmjs.com/package/@ar-llm/pi-custom-compaction) [![Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](./LICENSE)

Pi extension that replaces default compaction with a full LLM-generated summary. Supports **provider-aware configuration** so different session providers can use different compaction models, request params, and prompts. It can also **chunk** the transcript with map-reduce summarization, so a small-context model can compact a long conversation.

Uses `ctx.modelRegistry.runtime.complete()` (the coding-agent's internal ModelRuntime) instead of the deprecated `@earendil-works/pi-ai/compat` `complete()`, so that custom providers (e.g. github-copilot) are properly routed and auth is resolved internally.

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

## Debug Logging

Set the `PI_CUSTOM_COMPACTION_DEBUG` environment variable to `1` or `true` to enable debug logging:

```bash
export PI_CUSTOM_COMPACTION_DEBUG=1
```

Debug output is written to `$TMPDIR/ar-llm/custom-compaction.log`.

## Configuration

Create the config file at `~/.config/pi/agent/ar-llm/custom-compaction.json`:

```json
{
  "default-prompts": {
    "system": "You are a conversation summarizer. Create a comprehensive summary that captures all information needed to continue the work effectively.",
    "user": "Summarize this conversation with clear sections covering:\n\n1. Main goals and objectives discussed\n2. Key decisions made and their rationale\n3. Important code changes, file modifications, or technical details\n4. Current state of any ongoing work\n5. Any blockers, issues, or open questions\n6. Next steps that were planned or suggested\n\nBe thorough but concise. This summary will replace the ENTIRE conversation history.\n\nFormat as structured markdown with clear sections.{previous_summary}\n<conversation>\n{conversation}\n</conversation>",
    "includePreviousSummary": true
  },
  "providers": {
    "openrouter": {
      "model": "google/gemma-4-26b-a4b-it:free"
    },
    "github-copilot": {
      "model": "claude-sonnet-4.6"
    },
    "alba-local": {
      "model": "Qwen3.6-27B",
      "max-output-tokens": 4096,
      "stream-options": {
        "temperature": 0.6
      },
      "request-params": {
        "chat_template_kwargs": {
          "enable_thinking": false
        }
      }
    },
    "llama.cpp": {
      "model": "LFM2.5-VL-3B",
      "max-output-tokens": 4096,
      "stream-options": {
        "temperature": 0.5
      },
      "request-params": {
        "chat_template_kwargs": {
          "enable_thinking": false
        }
      },
      "chunking": {
        "context-window": 32768,
        "safety-tokens": 512,
        "overlap-messages": 0,
        "max-depth": 4
      }
    },
    "anthropic": {
      "model": "claude-sonnet-4.6",
      "enabled": false
    }
  }
}
```

### Config Fields

**`default-prompts`** (optional): Shared prompt template used by all providers unless overridden. If omitted, built-in defaults are used.

**`providers`** (required): Map of session provider names to their compaction configuration.

#### Provider Config

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | `boolean` | Set to `false` to silently skip compaction for this provider. |
| `model` | `string` | Model ID to use for compaction (looked up within the session's provider catalog). Required unless `enabled: false`. |
| `max-output-tokens` | `number` | Response ceiling for the summary. Preferred over `stream-options.maxTokens`. |
| `chunking` | `object` | Enable map-reduce summarization. See [Chunking](#chunking). |
| `stream-options` | `object` | pi `StreamOptions` fields. Merged over the built-in defaults. |
| `request-params` | `object` | Raw provider request-body parameters. Forwarded as `StreamOptions.samplingParams`. |
| `prompt` | `object` | Provider-specific prompt that overrides `default-prompts`. |

#### stream-options vs request-params

pi separates two kinds of parameters. The config mirrors that split.

**`stream-options`** holds pi's own `StreamOptions` fields. Use camelCase names.
pi renames the fields for each provider. For example, pi sends `maxTokens` as
`max_tokens` or `max_completion_tokens`.

Built-in defaults, overridable from `stream-options`:

| Field | Default | Description |
|-------|---------|-------------|
| `maxTokens` | `8192` | Deprecated alias for `max-output-tokens`. Use the provider-level field. |
| `temperature` | provider default | Sampling temperature. Also accepted in `request-params`. |
| `cacheRetention` | `"none"` | Prompt cache retention. |
| `thinkingEnabled` | `false` | Thinking blocks. Only some APIs read this field. |

`signal` and `sessionId` are set by the extension. The config cannot change them.

**`request-params`** holds raw provider request-body parameters: `top_p`,
`top_k`, `min_p`, `repetition_penalty`, `chat_template_kwargs`, and similar.
The extension passes the object unchanged as `StreamOptions.samplingParams`.
pi merges these keys into the request body after the named fields, so they win.

> Only OpenAI-compatible adapters read `samplingParams` (completions, responses,
> Azure responses). Other APIs ignore them.

`temperature` is a pi parameter, but the extension accepts it in
`request-params` too. It copies the value into the pi parameters, so Anthropic
and Google honour it as well. When both keys are set, `request-params` wins.

> `maxTokens` is a pi parameter. It does not belong in `request-params`.

### Chunking

A compaction model with a small context cannot read a large transcript in one
request. The `chunking` block turns on map-reduce summarization:

1. **Map.** Split the transcript at message boundaries into batches that fit the
   model, then summarize each batch.
2. **Reduce.** Merge the partial summaries, in layers if needed, until one
   summary remains.
3. **Final merge.** Merge the result with `previousSummary`, when it fits.

Absent the block, the extension keeps the single-shot behavior. When the block
is present but the transcript already fits, it still uses one call.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `context-window` | `number` | required | The model's true usable context per request. Overrides the model metadata, which can lie. |
| `safety-tokens` | `number` | `512` | Headroom for estimator error. |
| `overlap-messages` | `number` | `0` | Messages repeated from the tail of one chunk at the start of the next. |
| `max-depth` | `number` | `4` | Maximum reduce layers before the extension falls back. |
| `chunking-prompt` | `object` | built-in | Prompt for the merge step. Same shape as `prompt`. |

The response ceiling and the prompt scaffolding are subtracted from
`context-window` before the extension splits. A single message larger than the
budget is truncated head-and-tail. A `max-output-tokens` value at or above
`context-window` is ignored, with the built-in default used instead.

### Behavior

1. Loads `default-prompts` (or uses built-in defaults)
2. Gets the active session's provider from `ctx.model.provider`
3. Looks up `providers.<sessionProvider>` in config
4. If `enabled: false` → skips compaction silently
5. Uses provider's `model`, inheriting `default-prompts` unless overridden
6. Merges `stream-options` over the built-in `StreamOptions` defaults and passes `request-params` as `samplingParams`
7. If no config exists for the session provider → skips (no fallback)

### Migrating from 0.4.x

The nested `request-params.providers.<name>` shape is no longer supported. Put
the parameters directly under `request-params`. The extension ignores the old
wrapper and logs a message.

`maxTokens` is a pi parameter, not a request parameter. The extension moves a
legacy `request-params.maxTokens` value into `stream-options` and logs a message.

`stream-options.maxTokens` is deprecated. Rename it to the provider-level
`max-output-tokens`. Both still work, but the extension logs a warning.

Rename the top-level `defaultPrompt` to `default-prompts`. The old key is
ignored and the extension logs a message.

## License

[The Unlicense](./LICENSE) — public domain. Substantially rewritten from [earendil-works/pi](https://github.com/earendil-works/pi) (see [NOTICE](./NOTICE)).
