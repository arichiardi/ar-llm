# chat-templates

Jinja chat templates for llama.cpp servers. Source of truth for these files.

Deployed to `/var/lib/llm/chat-templates/` on the LLM host (`albatros`),
which is symlinked to `/opt/llm/chat-templates/`. Each llama.cpp server
config selects a template with `LLAMA_ARG_CHAT_TEMPLATE_FILE`.

## Templates

| File | Model | Notes |
|------|-------|-------|
| `lfm2.5-moe.jinja` | Liquid LFM2.5 MoE | Stock; generation prompt forces `<think>`. |
| `lfm2.5-moe-nothink.jinja` | Liquid LFM2.5 MoE | No-thinking variant. Generation prompt prefills an empty `<think>\n</think>` block so the model answers directly. |
| `qwen3-nothinking.jinja` | Qwen3 | No-thinking via empty `<think>\n\n</think>\n\n` prefill. |
| `GLM-4.5-Air-ik.jinja` | GLM-4.5-Air | ik_llama build. |
| `gpt-oss-120b.jinja` | gpt-oss-120b | OpenAI gpt-oss. |

## Attribution

The Qwen "fixed" chat templates are by **froggeric** (https://github.com/froggeric).
They are **not** vendored in this repo. The deployed copies live on the LLM host at
`/var/lib/llm/chat-templates/qwen-fixed-froggeric-v19.jinja` and
`qwen-fixed-froggeric-v22.4.jinja`, each carrying a header comment and a
`template_version` set line that credit froggeric. Each file is used directly
from that deploy path; nothing is checked in here.
