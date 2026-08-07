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
- **Flag**: `--flag=plan` - Start in plan mode

### Commands

- `/plan` - Toggle plan mode (read-only exploration)
- `/todos` - Show current plan todo list

## How It Works

Plan mode provides a safe, read-only environment for code exploration and planning:

1. **Tool Restrictions**: Only read-only tools are available (`read`, `bash`, `grep`, `find`, `ls`, `questionnaire`)
2. **Command Allowlist**: Bash commands are restricted to a configurable allowlist of safe, read-only commands
3. **Plan Extraction**: Automatically detects numbered plans under "Plan:" headers
4. **Progress Tracking**: Track completion with `[DONE:n]` markers (e.g., `[DONE:1]` marks step 1 complete)
5. **UI Widgets**: Shows progress widget and status bar during execution

### Workflow

1. Enable plan mode with `/plan` or `Ctrl+Alt+P`
2. Ask the agent to explore and create a plan
3. Agent generates a numbered plan under a "Plan:" header
4. Choose to:
   - **Execute the plan** - Full tool access restored, progress tracked
   - **Stay in plan mode** - Continue refining the plan
   - **Refine the plan** - Edit the plan before execution
5. During execution, mark steps complete with `[DONE:n]` tags
6. Widget shows progress (e.g., "📋 2/5")

## Configuration

Create a config file at `~/.config/pi/agent/ar-llm/plan-mode.json` to customize behavior.

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
  "extraction": {
    "planHeaderPattern": "/\\*{0,2}Plan:\\*{0,2}\\s*\\n/i",
    "stepNumberPattern": "/^\\s*(\\d+)[.)]\\s+\\*{0,2}([^*\\n]+)/gm",
    "doneMarkerPattern": "/\\[DONE:(\\d+)\\]/gi",
    "maxStepLength": 50,
    "cleanStepText": true
  },
  "prompts": {
    "planModeContext": "[PLAN MODE ACTIVE]\nYou are in plan mode - read-only...\nTools: {tools}",
    "executionContext": "[EXECUTING PLAN]\nRemaining steps:\n{todoList}\nUse [DONE:n] to mark complete"
  }
}
```

### Config Fields

#### `commands` (optional)

Command allowlist configuration.

| Field | Type | Description |
|-------|------|-------------|
| `safePatterns` | `string[]` | Regex patterns (as strings) for commands allowed in plan mode. Commands must match at least one pattern. |
| `destructivePatterns` | `string[]` | Regex patterns (as strings) for commands blocked in plan mode. Commands matching any pattern are blocked. |

**Pattern Format**: Patterns must be strings with regex delimiters, e.g., `"/^\\s*cat\\b/"` (not `/^\s*cat\b/`).

#### `tools` (optional)

Tool restriction configuration.

| Field | Type | Description |
|-------|------|-------------|
| `planModeTools` | `string[]` | Tools available in plan mode (read-only). Default: `["read", "bash", "grep", "find", "ls", "questionnaire"]` |
| `normalModeTools` | `string[]` | Tools available in normal mode (full access). Default: `["read", "bash", "edit", "write"]` |

#### `extraction` (optional)

Plan extraction and parsing configuration.

| Field | Type | Description |
|-------|------|-------------|
| `planHeaderPattern` | `string` | Regex pattern to detect "Plan:" header. Default: `"/\\*{0,2}Plan:\\*{0,2}\\s*\\n/i"` |
| `stepNumberPattern` | `string` | Regex pattern for numbered steps. Default: `/^\s*(\d+)[.)]\s+\*{0,2}([^\*\n]+)/gm` |
| `doneMarkerPattern` | `string` | Regex pattern for `[DONE:n]` markers. Default: `"/\\[DONE:(\\d+)\\]/gi"` |
| `maxStepLength` | `number` | Maximum step text length before truncation. Default: `50` |
| `cleanStepText` | `boolean` | Remove markdown formatting from step text. Default: `true` |

#### `prompts` (optional)

System prompt configuration.

| Field | Type | Description |
|-------|------|-------------|
| `planModeContext` | `string` | System prompt for plan mode. Use `{tools}` to insert allowed tools list. |
| `executionContext` | `string` | System prompt for execution mode. Use `{todoList}` to insert remaining steps. |

#### `providers` (optional)

Provider-specific overrides. Each key is a session provider name (e.g., `"openrouter"`, `"github-copilot"`).

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | `boolean` | Set to `false` to disable plan mode for this provider. Default: `true` |
| `commands` | `object` | Override command allowlists for this provider. |
| `tools` | `object` | Override tool restrictions for this provider. |

### Resolution Order

Configuration is resolved in this order (later overrides earlier):

1. **Built-in defaults** - Safe, conservative defaults
2. **Config file settings** - Your preferences in `plan-mode.json`

## License

[MIT](./LICENSE) — derived from [earendil-works/pi](https://github.com/earendil-works/pi), copyright Mario Zechner.
