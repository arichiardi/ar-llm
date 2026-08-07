/**
 * Plan Mode Configuration Loader
 *
 * Loads and resolves plan-mode configuration from:
 * 1. Built-in defaults
 * 2. Global config file (~/.config/pi/agent/ar-llm/plan-mode.json)
 * 3. Provider-specific overrides
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { PlanModeConfig, ProviderConfig } from "./types.js";

// ============================================================
// Built-in defaults
// ============================================================

const DEFAULT_SAFE_PATTERNS = [
  "/^\\s*cat\\b/",
  "/^\\s*head\\b/",
  "/^\\s*tail\\b/",
  "/^\\s*less\\b/",
  "/^\\s*more\\b/",
  "/^\\s*grep\\b/",
  "/^\\s*find\\b/",
  "/^\\s*ls\\b/",
  "/^\\s*pwd\\b/",
  "/^\\s*echo\\b/",
  "/^\\s*printf\\b/",
  "/^\\s*wc\\b/",
  "/^\\s*sort\\b/",
  "/^\\s*uniq\\b/",
  "/^\\s*diff\\b/",
  "/^\\s*file\\b/",
  "/^\\s*stat\\b/",
  "/^\\s*du\\b/",
  "/^\\s*df\\b/",
  "/^\\s*tree\\b/",
  "/^\\s*which\\b/",
  "/^\\s*whereis\\b/",
  "/^\\s*type\\b/",
  "/^\\s*env\\b/",
  "/^\\s*printenv\\b/",
  "/^\\s*uname\\b/",
  "/^\\s*whoami\\b/",
  "/^\\s*id\\b/",
  "/^\\s*date\\b/",
  "/^\\s*cal\\b/",
  "/^\\s*uptime\\b/",
  "/^\\s*ps\\b/",
  "/^\\s*top\\b/",
  "/^\\s*htop\\b/",
  "/^\\s*free\\b/",
  "/^\\s*git\\s+(status|log|diff|show|branch|remote|config\\s+--get)/i",
  "/^\\s*git\\s+ls-/i",
  "/^\\s*npm\\s+(list|ls|view|info|search|outdated|audit)/i",
  "/^\\s*yarn\\s+(list|info|why|audit)/i",
  "/^\\s*node\\s+--version/i",
  "/^\\s*python\\s+--version/i",
  "/^\\s*curl\\s/i",
  "/^\\s*wget\\s+-O\\s*-/i",
  "/^\\s*jq\\b/",
  "/^\\s*sed\\s+-n/i",
  "/^\\s*awk\\b/",
  "/^\\s*rg\\b/",
  "/^\\s*fd\\b/",
  "/^\\s*bat\\b/",
  "/^\\s*eza\\b/",
];

const DEFAULT_DESTRUCTIVE_PATTERNS = [
  "/\\brm\\b/i",
  "/\\brmdir\\b/i",
  "/\\bmv\\b/i",
  "/\\bcp\\b/i",
  "/\\bmkdir\\b/i",
  "/\\btouch\\b/i",
  "/\\bchmod\\b/i",
  "/\\bchown\\b/i",
  "/\\bchgrp\\b/i",
  "/\\bln\\b/i",
  "/\\btee\\b/i",
  "/\\btruncate\\b/i",
  "/\\bdd\\b/i",
  "/\\bshred\\b/i",
  "/(^|[^<])>(?!>)/",
  "/>>/",
  "/\\bnpm\\s+(install|uninstall|update|ci|link|publish)/i",
  "/\\byarn\\s+(add|remove|install|publish)/i",
  "/\\bpnpm\\s+(add|remove|install|publish)/i",
  "/\\bpip\\s+(install|uninstall)/i",
  "/\\bapt(-get)?\\s+(install|remove|purge|update|upgrade)/i",
  "/\\bbrew\\s+(install|uninstall|upgrade)/i",
  "/\\bgit\\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i",
  "/\\bsudo\\b/i",
  "/\\bsu\\b/i",
  "/\\bkill\\b/i",
  "/\\bpkill\\b/i",
  "/\\bkillall\\b/i",
  "/\\breboot\\b/i",
  "/\\bshutdown\\b/i",
  "/\\bsystemctl\\s+(start|stop|restart|enable|disable)/i",
  "/\\bservice\\s+\\S+\\s+(start|stop|restart)/i",
  "/\\b(vim?|nano|emacs|code|subl)\\b/i",
];

const DEFAULT_PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire"];
const DEFAULT_NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];

const DEFAULT_PLAN_HEADER_PATTERN = "/\\*{0,2}Plan:\\*{0,2}\\s*\\n/i";
const DEFAULT_STEP_NUMBER_PATTERN = "/^\\s*(\\d+)[.)]\\s+\\*{0,2}([^*\\n]+)/gm";
const DEFAULT_DONE_MARKER_PATTERN = "/\\[DONE:(\\d+)\\]/gi";

const DEFAULT_MAX_STEP_LENGTH = 50;
const DEFAULT_CLEAN_STEP_TEXT = true;

const DEFAULT_PLAN_MODE_CONTEXT = `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Restrictions:
- You can only use: {tools}
- You CANNOT use: edit, write (file modifications are disabled)
- Bash is restricted to an allowlist of read-only commands

Ask clarifying questions using the questionnaire tool.
Use brave-search skill via bash for web research.

Create a detailed numbered plan under a "Plan:" header:

Plan:
1. First step description
2. Second step description
...

Do NOT attempt to make changes - just describe what you would do.`;

const DEFAULT_EXECUTION_CONTEXT = `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
{todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.`;

const DEFAULT_CONFIG: PlanModeConfig = {
  commands: {
    safePatterns: DEFAULT_SAFE_PATTERNS,
    destructivePatterns: DEFAULT_DESTRUCTIVE_PATTERNS,
  },
  tools: {
    planModeTools: DEFAULT_PLAN_MODE_TOOLS,
    normalModeTools: DEFAULT_NORMAL_MODE_TOOLS,
  },
  extraction: {
    planHeaderPattern: DEFAULT_PLAN_HEADER_PATTERN,
    stepNumberPattern: DEFAULT_STEP_NUMBER_PATTERN,
    doneMarkerPattern: DEFAULT_DONE_MARKER_PATTERN,
    maxStepLength: DEFAULT_MAX_STEP_LENGTH,
    cleanStepText: DEFAULT_CLEAN_STEP_TEXT,
  },
  prompts: {
    planModeContext: DEFAULT_PLAN_MODE_CONTEXT,
    executionContext: DEFAULT_EXECUTION_CONTEXT,
  },
};

// ============================================================
// Config loading
// ============================================================

function resolveConfigDir(): string {
  return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".config", "pi", "agent");
}

function loadConfigFile(): PlanModeConfig | null {
  const dir = resolveConfigDir();
  const filePath = path.join(dir, "ar-llm", "plan-mode.json");

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

/**
 * Deep merge two objects, with right side taking precedence
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (sourceValue === undefined) continue;

    if (
      sourceValue &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(targetValue as Record<string, unknown>, sourceValue as Record<string, unknown>) as T[keyof T];
    } else {
      result[key] = sourceValue;
    }
  }

  return result;
}

/**
 * Resolve effective configuration
 */
export function resolveConfig(): PlanModeConfig {
  const fileConfig = loadConfigFile();

  // Start with defaults
  let config: PlanModeConfig = { ...DEFAULT_CONFIG };

  // Apply config file settings
  if (fileConfig) {
    config = deepMerge(config, fileConfig);
  }

  return config;
}

/**
 * Check if plan mode is enabled (always enabled with simplified config)
 */
export function isProviderEnabled(): boolean {
  return true;
}

/**
 * Get the config file path (for documentation)
 */
export function getConfigFilePath(): string {
  const dir = resolveConfigDir();
  return path.join(dir, "ar-llm", "plan-mode.json");
}
