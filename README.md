# Pi Extensions for the Pi Coding Agent

[![npm scope](https://img.shields.io/badge/npm-%40arichiardi-blue)](https://www.npmjs.com/~arichiardi) [![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](./LICENSE) [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./extensions/pi-handoff/LICENSE)

Personal [Pi](https://pi.dev) extension packages for the Pi coding agent. Each package is independently installable under the `@arichiardi` npm scope.

## Extensions

| Package | What it adds | Install |
| --- | --- | --- |
| [`@arichiardi/pi-custom-compaction`](./extensions/pi-custom-compaction) | Replaces pi's default compaction with a full LLM-generated summary. Configurable model, per-provider/per-model request params, and custom prompt templates. | `pi install npm:@arichiardi/pi-custom-compaction` |
| [`@arichiardi/pi-skill-request-params`](./extensions/pi-skill-request-params) | Injects per-skill, per-model, and per-provider request parameters (temperature, top_p, thinking, etc.) into every provider payload before the request fires. | `pi install npm:@arichiardi/pi-skill-request-params` |
| [`@arichiardi/pi-handoff`](./extensions/pi-handoff) | Transfers context to a new focused session via `/handoff`. Extracts what matters and drafts a continuation prompt in the editor. | `pi install npm:@arichiardi/pi-handoff` |
| [`@arichiardi/pi-notify`](./extensions/pi-notify) | Sends a native terminal notification (OSC 777 / OSC 99 / Windows toast) when the agent finishes and is waiting for input. | `pi install npm:@arichiardi/pi-notify` |
| [`@arichiardi/pi-plan-mode`](./extensions/pi-plan-mode) | Read-only exploration mode for safe code analysis. Restricts tools, tracks numbered plan steps, and shows progress in a widget. | `pi install npm:@arichiardi/pi-plan-mode` |

## Quick start

Install a package from npm:

```bash
pi install npm:@arichiardi/pi-custom-compaction
```

Try an extension once without adding it permanently:

```bash
pi -e npm:@arichiardi/pi-custom-compaction
pi -e npm:@arichiardi/pi-skill-request-params
```

Use multiple extensions together:

```bash
pi -e npm:@arichiardi/pi-custom-compaction -e npm:@arichiardi/pi-skill-request-params -e npm:@arichiardi/pi-notify
```

## Use cases

### LLM-powered session compaction

Use [`@arichiardi/pi-custom-compaction`](./extensions/pi-custom-compaction) when you want pi's `/compact` to produce a comprehensive, structured summary instead of a simple truncation. Configure any model for summarization independently of your main conversation model, with per-provider and per-model request parameter overrides (temperature, token limits, thinking mode, etc.) and custom prompt templates.

### Per-skill provider tuning

Use [`@arichiardi/pi-skill-request-params`](./extensions/pi-skill-request-params) to inject different request parameters depending on which skill is active. Useful when different skills benefit from different temperature, top_p, or thinking settings — for example, a coding skill with low temperature and a brainstorming skill with higher temperature.

### Focused session handoff

Use [`@arichiardi/pi-handoff`](./extensions/pi-handoff) when a conversation has grown large and you want to continue a specific thread in a clean session. `/handoff` summarizes the relevant context and drafts a focused prompt ready to edit and send.

### Terminal notifications

Use [`@arichiardi/pi-notify`](./extensions/pi-notify) for long-running tasks where you've switched to another window. Sends a native desktop notification via OSC 777 (Ghostty, iTerm2, WezTerm), OSC 99 (Kitty), or Windows toast (WSL) when the agent is done and waiting for input.

### Read-only plan mode

Use [`@arichiardi/pi-plan-mode`](./extensions/pi-plan-mode) to safely explore a codebase before making changes. Restricts the agent to read-only tools, extracts a numbered plan from the response, and tracks step completion in a widget with `/plan` and `/todos` commands.

## Local development

Install dependencies from the repository root:

```bash
npm install
```

Run typechecks across all packages:

```bash
npm run typecheck
```

Try a package locally:

```bash
pi -e ./extensions/pi-custom-compaction
pi -e ./extensions/pi-skill-request-params
pi -e ./extensions/pi-handoff
pi -e ./extensions/pi-notify
pi -e ./extensions/pi-plan-mode
```

Preview npm package contents before publishing:

```bash
npm run pack:custom-compaction
npm run pack:skill-request-params
npm run pack:handoff
npm run pack:notify
npm run pack:plan-mode
```

First publish of a new scoped package:

```bash
npm publish --workspace @arichiardi/pi-custom-compaction --access public
```

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

Each extension package contains its own `package.json`, `LICENSE`, `tsconfig.json`, and TypeScript source under `src/`.

## License

- [`pi-custom-compaction`](./extensions/pi-custom-compaction): [The Unlicense](./extensions/pi-custom-compaction/LICENSE) — substantially rewritten from [earendil-works/pi](https://github.com/earendil-works/pi) (see [NOTICE](./extensions/pi-custom-compaction/NOTICE))
- [`pi-skill-request-params`](./extensions/pi-skill-request-params): [The Unlicense](./extensions/pi-skill-request-params/LICENSE) — original work, public domain
- [`pi-handoff`](./extensions/pi-handoff), [`pi-notify`](./extensions/pi-notify), [`pi-plan-mode`](./extensions/pi-plan-mode): [MIT](./extensions/pi-handoff/LICENSE) — derived from [earendil-works/pi](https://github.com/earendil-works/pi), copyright Mario Zechner
