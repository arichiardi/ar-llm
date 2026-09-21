/**
 * Plan Mode Configuration Types
 *
 * Configuration schema for the plan-mode extension.
 * Every knob described here can be overridden in
 * ~/.config/pi/agent/ar-llm/plan-mode.json.
 */

/**
 * Command allowlist configuration
 */
export interface CommandConfig {
  /**
   * Regex patterns for safe read-only commands allowed in plan mode
   * Commands must match at least one pattern AND not match any destructive pattern
   */
  safePatterns: string[];
  /**
   * Regex patterns for destructive commands blocked in plan mode
   * Commands matching any pattern are blocked (unless explicitly safe)
   */
  destructivePatterns: string[];
}

/**
 * Tool configuration
 */
export interface ToolConfig {
  /**
   * Tools available in plan mode (read-only)
   */
  planModeTools: string[];
  /**
   * Tools available in normal mode (full access)
   */
  normalModeTools: string[];
}

/**
 * Human-readable half of the plan format contract.
 *
 * These are plain strings (no regex) injected into the prompt templates via
 * the {planHeader} and {stepPrefix} placeholders. They must describe the same
 * format the PlanFormatConfig patterns parse; keeping both in one section
 * makes that contract explicit.
 */
export interface PlanFormatHints {
  /**
   * Header the model should write its plan under
   * @default "Plan:"
   */
  planHeader: string;
  /**
   * Prefix for the first step, to show numbering style (e.g. "1.")
   * @default "1."
   */
  stepPrefix: string;
}

/**
 * Plan format configuration: how the model should write a plan (hints) and
 * how the extension reads it back (patterns).
 */
export interface PlanFormatConfig {
  /**
   * Regex pattern to detect the plan header section
   * @default /\*{0,2}Plan:\*{0,2}\s*\n/i
   */
  planHeaderPattern: string;
  /**
   * Regex pattern to match numbered steps (e.g., "1.", "2)", "3)")
   * @default /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm
   */
  stepNumberPattern: string;
  /**
   * Maximum step text length (truncates with "...")
   * @default 50
   */
  maxStepLength: number;
  /**
   * Whether to remove markdown formatting from step text
   * @default true
   */
  cleanStepText: boolean;
  /**
   * Regex pattern to detect completion markers [DONE:n]
   * @default /\[DONE:(\d+)\]/gi
   */
  doneMarkerPattern: string;
  /**
   * Human-readable words for the prompt templates
   */
  hints: PlanFormatHints;
}

/**
 * Prompt configuration
 */
export interface PromptConfig {
  /**
   * System prompt for plan mode context
   * Placeholders: {tools}, {planHeader}, {stepPrefix}, {maxStepLength}
   */
  planModeContext: string;
  /**
   * System prompt for execution mode context
   * Placeholders: {todoList}, {planHeader}, {stepPrefix}, {maxStepLength}
   */
  executionContext: string;
  /**
   * User prompt sent when no plan steps could be extracted, asking the model
   * to produce an extractable plan.
   * Placeholders: {planHeader}, {stepPrefix}, {maxStepLength}
   */
  planCreationPrompt: string;
}

/**
 * UI configuration
 */
export interface UIConfig {
  /**
   * Show the plan-mode indicator in the status bar
   * @default true
   */
  showStatusBar: boolean;
  /**
   * Show the progress widget with the todo list during execution
   * @default true
   */
  showProgressWidget: boolean;
  /**
   * Status bar format. Placeholders: {completed}, {total}, {mode}
   * @default "📋 {completed}/{total}"
   */
  statusBarFormat: string;
  /**
   * Notification messages
   */
  notifications: {
    /** Placeholder: {tools} */
    planModeEnabled: string;
    planModeDisabled: string;
    noTodos: string;
    /** Shown when the model's last message contained no extractable plan steps */
    planNotDetected: string;
  };
  /**
   * Labels for the "Plan mode - what next?" selection prompt
   */
  choices: {
    /** Shown when plan steps were extracted */
    executeWithTodos: string;
    /** Shown when no plan steps were extracted */
    createPlan: string;
    stayInPlanMode: string;
    refinePlan: string;
  };
}

/**
 * Global plan-mode configuration
 */
export interface PlanModeConfig {
  /**
   * Command allowlists
   */
  commands: CommandConfig;
  /**
   * Tool restrictions
   */
  tools: ToolConfig;
  /**
   * Plan format contract (patterns + prompt hints)
   */
  planFormat: PlanFormatConfig;
  /**
   * System prompts
   */
  prompts: PromptConfig;
  /**
   * UI settings
   */
  ui: UIConfig;
}