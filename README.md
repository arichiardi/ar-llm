# Pi Extensions for the Pi Coding Agent

[![npm scope](https://img.shields.io/badge/npm-%40arichiardi-blue)](https://www.npmjs.com/~arichiardi) [![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](./LICENSE) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./extensions/pi-handoff/LICENSE)

Personal [Pi](https://pi.dev) extension packages for the Pi coding agent. Each package is independently installable under the `@ar-llm` npm scope.

## Extensions

| Package | Description |
| --- | --- |
| [`@ar-llm/pi-custom-compaction`](./extensions/pi-custom-compaction/README.md) | LLM-powered session compaction with configurable model and request params |
| [`@ar-llm/pi-skill-request-params`](./extensions/pi-skill-request-params/README.md) | Per-skill, per-model, per-provider request parameter injection |
| [`@ar-llm/pi-handoff`](./extensions/pi-handoff/README.md) | Context handoff to new focused sessions via `/handoff` |
| [`@ar-llm/pi-notify`](./extensions/pi-notify/README.md) | Terminal notifications when the agent is done and waiting for input |
| [`@ar-llm/pi-plan-mode`](./extensions/pi-plan-mode/README.md) | Read-only plan mode with step tracking and constrained tool execution |

See each package's README for install instructions and details.

## Local development

Try a package locally from the repo root:

```bash
pi -e ./extensions/pi-custom-compaction
pi -e ./extensions/pi-skill-request-params
pi -e ./extensions/pi-handoff
pi -e ./extensions/pi-notify
pi -e ./extensions/pi-plan-mode
```

For build commands, adding new extensions, and publishing instructions see [AGENTS.md](./AGENTS.md).

## Repository structure

```
extensions/
├── pi-custom-compaction/    # LLM-powered session compaction
├── pi-handoff/              # Context handoff to new sessions
├── pi-notify/               # Terminal notifications on agent idle
├── pi-plan-mode/            # Read-only plan-and-execute mode
└── pi-skill-request-params/ # Per-skill provider request params
pi/                          # Pi agent configuration files
prompts/                     # Custom prompt templates
skills/                      # Custom skills
```

Each extension package contains its own `package.json`, `README.md`, `LICENSE`, `tsconfig.json`, and TypeScript source under `src/`.

## License

- [`pi-custom-compaction`](./extensions/pi-custom-compaction): [The Unlicense](./extensions/pi-custom-compaction/LICENSE) — substantially rewritten from [earendil-works/pi](https://github.com/earendil-works/pi) (see [NOTICE](./extensions/pi-custom-compaction/NOTICE))
- [`pi-skill-request-params`](./extensions/pi-skill-request-params): [The Unlicense](./extensions/pi-skill-request-params/LICENSE) — original work, public domain
- [`pi-handoff`](./extensions/pi-handoff), [`pi-notify`](./extensions/pi-notify), [`pi-plan-mode`](./extensions/pi-plan-mode): [MIT](./extensions/pi-handoff/LICENSE) — derived from [earendil-works/pi](https://github.com/earendil-works/pi), copyright Mario Zechner
