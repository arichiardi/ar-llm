# @ar-llm/pi-skill-request-params

[![Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](./LICENSE)

Pi extension that injects per-skill, per-model, and per-provider request parameters (temperature, top_p, thinking, etc.) into every provider payload before the request fires.

## Install

```bash
pi install 'npm:@ar-llm/pi-skill-request-params'
```

Or try without installing:

```bash
pi -e 'npm:@ar-llm/pi-skill-request-params'
```

## Config

Create `<agent-dir>/ar-llm/skill-request-params.json`.

```json
{
  "providers": {
    "lm-studio": {
      "default": { "temperature": 0.6 },
      "skills": {
        "clojure-coder": { "params": { "temperature": 0.1, "top_k": 40 } }
      }
    }
  }
}
```

Resolution order (lowest → highest priority):

1. `providers.<provider>.default`
2. `providers.<provider>.models.<modelId>.default`
3. `providers.<provider>.skills.<skillName>`
4. `providers.<provider>.models.<modelId>.skills.<skillName>`

## License

[The Unlicense](./LICENSE) — public domain, original work.
