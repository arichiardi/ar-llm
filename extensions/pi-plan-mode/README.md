# @ar-llm/pi-plan-mode

[![MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)

Pi extension that adds a read-only plan mode for safe code exploration. Restricts tools, tracks numbered plan steps with `/plan` and `/todos`, and shows progress in a widget.

## Install

```bash
pi install 'npm:@ar-llm/pi-plan-mode'
```

Or try without installing:

```bash
pi -e 'npm:@ar-llm/pi-plan-mode'
```

## Usage

### Toggle Plan Mode

- **Command**: `/plan` - Toggle plan mode on/off
- **Shortcut**: `Ctrl+Alt+P` - Toggle plan mode on/off
- **Flag**: `--plan` - Start in plan mode

### Commands

- `/plan` - Toggle plan mode (read-only exploration)
- `/todos` - Show current plan todo list

## How It Works

Plan mode provides a safe, read-only environment for code exploration and planning:

1. **Tool Restrictions**: Only the configured read-only tools are available (default: `read`, `bash`, `grep`, `find`, `ls`, `questionnaire`)
2. **Command Allowlist**: Bash commands are restricted to a configurable allowlist of safe, read-only commands
3. **Plan Extraction**: Detects numbered plans under a configurable header (default: `Plan:`)
4. **Progress Tracking**: Track completion with `[DONE:n]` markers (e.g., `[DONE:1]` marks step 1 complete)
5. **UI Widgets**: Shows a progress widget and status bar during execution

### Workflow

1. Enable plan mode with `/plan` or `Ctrl+Alt+P`
2. Ask the agent to explore and create a plan
3. Agent generates a numbered plan under the configured header
4. You are asked what to do next:
   - **Execute the plan (track progress)** - when steps were detected; full tool access is restored and progress is tracked
   - **Create the plan** - when no steps were detected; the agent is asked to produce an extractable plan and try again
   - **Stay in plan mode** - keep exploring without executing
   - **Refine the plan** - edit the plan before execution
5. During execution, mark steps complete with `[DONE:n]` tags
6. Widget shows progress (e.g., "📋 2/5")

## Configuration

Create a config file at `~/.config/pi/agent/ar-llm/plan-mode.json` to customize behavior. Every section is optional and deep-merged over the built-in defaults. A complete sample, equal to the built-in defaults, lives in the repository as [`plan-mode.example.json`](./plan-mode.example.json). Copy it and edit the sections you want.

### Example Configuration

```json
{
  "commands": {
    "safePatterns": [
      "/^\\s*cat\\b/",
      "/^\\s*grep\\b/",
      "/^\\s*find\\b/",
      "/^\\s*ls\\b/",
      "/^\\s*git\\s+(status|log|diff)/i"
    ],
    "destructivePatterns": [
      "/\\brm\\b/i",
      "/\\bgit\\s+(add|commit|push)/i"
    ]
  },
  "tools": {
    "planModeTools": ["read", "bash", "grep", "find", "ls"],
    "normalModeTools": ["read", "bash", "edit", "write"]
  },
  "planFormat": {
    "planHeaderPattern": "/\\*{0,2}Plan:\\*{0,2}\\s*\\n/i",
    "stepNumberPattern": "/^\\s*(\\d+)[.)]\\s+\\*{0,2}([^*\\n]+)/gm",
    "doneMarkerPattern": "/\\[DONE:(\\d+)\\]/gi",
    "maxStepLength": 50,
    "cleanStepText": true,
    "hints": {
      "planHeader": "Plan:",
      "stepPrefix": "1."
    }
  },
  "prompts": {
    "planModeContext": "[PLAN MODE ACTIVE]\nYou are in plan mode - read-only...\nTools: {tools}\nCreate a plan under a \"{planHeader}\" header",
    "executionContext": "[EXECUTING PLAN]\nRemaining steps:\n{todoList}\nUse [DONE:n] to mark complete",
    "planCreationPrompt": "Your response had no extractable plan. Respond under a \"{planHeader}\" header with a numbered list, e.g. {stepPrefix} First step"
  },
  "ui": {
    "showStatusBar": true,
    "showProgressWidget": true,
    "statusBarFormat": "📋 {completed}/{total}",
    "notifications": {
      "planModeEnabled": "Plan mode enabled. Tools: {tools}",
      "planModeDisabled": "Plan mode disabled. Full access restored.",
      "noTodos": "No todos. Create a plan first with /plan",
      "planNotDetected": "No plan steps detected - the model did not use the expected plan format."
    },
    "choices": {
      "executeWithTodos": "Execute the plan (track progress)",
      "createPlan": "Create the plan",
      "stayInPlanMode": "Stay in plan mode",
      "refinePlan": "Refine the plan"
    }
  }
}
```

### Config Fields

#### `commands`

Command allowlist configuration.

| Field | Type | Description |
|-------|------|-------------|
| `safePatterns` | `string[]` | Regex patterns for commands allowed in plan mode. A command must match at least one pattern. |
| `destructivePatterns` | `string[]` | Regex patterns for commands blocked in plan mode. A command matching any pattern is blocked. |

**Pattern format**: patterns are strings in the `/source/flags` form, e.g. `"/^\\s*cat\\b/"` or `"/^\\s*git\\s+status/i"`. The flags after the closing slash are honoured.

#### `tools`

Tool restriction configuration.

| Field | Type | Description |
|-------|------|-------------|
| `planModeTools` | `string[]` | Tools available in plan mode (read-only). Default: `["read", "bash", "grep", "find", "ls", "questionnaire"]` |
| `normalModeTools` | `string[]` | Tools available in normal mode (full access). Default: `["read", "bash", "edit", "write"]` |

#### `planFormat`

The plan format contract: regex patterns for parsing, plus the words used in prompts.

| Field | Type | Description |
|-------|------|-------------|
| `planHeaderPattern` | `string` | Regex to detect the plan header. Default: `"/\\*{0,2}Plan:\\*{0,2}\\s*\\n/i"` |
| `stepNumberPattern` | `string` | Regex for numbered steps. Default: `"/^\\s*(\\d+)[.)]\\s+\\*{0,2}([^*\\n]+)/gm"` |
| `doneMarkerPattern` | `string` | Regex for `[DONE:n]` markers. Default: `"/\\[DONE:(\\d+)\\]/gi"` |
| `maxStepLength` | `number` | Maximum step text length before truncation. Default: `50` |
| `cleanStepText` | `boolean` | Remove markdown formatting from step text. Default: `true` |
| `hints.planHeader` | `string` | Header the model is told to use. Must match `planHeaderPattern`. Default: `"Plan:"` |
| `hints.stepPrefix` | `string` | First-step prefix shown as an example. Must match `stepNumberPattern`. Default: `"1."` |

Unlike the pattern fields above, `hints` are plain strings (no regex) injected into the prompt templates. They must describe the same format the patterns parse. If you change the vocabulary (for example to `Action Items:` and `1)`), change both the pattern and the matching hint.

#### `prompts`

Prompt template configuration. Templates support `{planHeader}`, `{stepPrefix}` and `{maxStepLength}` (from `planFormat`) plus the call-specific placeholders listed below; unknown placeholders are left untouched.

| Field | Type | Description |
|-------|------|-------------|
| `planModeContext` | `string` | Injected when plan mode starts. Placeholder: `{tools}`. |
| `executionContext` | `string` | Injected while executing a plan. Placeholder: `{todoList}`. |
| `planCreationPrompt` | `string` | Sent when no plan steps could be extracted. |

#### `ui`

UI configuration.

| Field | Type | Description |
|-------|------|-------------|
| `showStatusBar` | `boolean` | Show the plan-mode indicator in the status bar. Default: `true` |
| `showProgressWidget` | `boolean` | Show the todo-list widget during execution. Default: `true` |
| `statusBarFormat` | `string` | Status bar format. Placeholders: `{completed}`, `{total}`, `{mode}`. Default: `"📋 {completed}/{total}"` |
| `notifications.planModeEnabled` | `string` | Notification when plan mode is enabled. Placeholder: `{tools}`. |
| `notifications.planModeDisabled` | `string` | Notification when plan mode is disabled. |
| `notifications.noTodos` | `string` | Shown by `/todos` when there are no todos. |
| `notifications.planNotDetected` | `string` | Shown when the last message had no extractable plan. |
| `choices.executeWithTodos` | `string` | Selection label for executing a detected plan. |
| `choices.createPlan` | `string` | Selection label for asking the model to produce a plan. |
| `choices.stayInPlanMode` | `string` | Selection label for staying in plan mode. |
| `choices.refinePlan` | `string` | Selection label for refining the plan. |

### Resolution Order

Configuration is resolved in this order (later overrides earlier):

1. **Built-in defaults** - Safe, conservative defaults
2. **Config file settings** - Your preferences in `plan-mode.json`

## License

[MIT](./LICENSE) — derived from [earendil-works/pi](https://github.com/earendil-works/pi), copyright Mario Zechner.