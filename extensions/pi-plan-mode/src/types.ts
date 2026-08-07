/**
 * Plan Mode Configuration Types
 *
 * Configuration schema for plan-mode extension.
 * Supports provider-aware configuration similar to pi-custom-compaction.
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
 * Plan extraction configuration
 */
export interface PlanExtractionConfig {
  /**
   * Regex pattern to detect the "Plan:" header section
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
}

/**
 * Prompt configuration
 */
export interface PromptConfig {
  /**
   * System prompt for plan mode context
   */
  planModeContext: string;
  /**
   * System prompt for execution mode context
   */
  executionContext: string;
}

/**
 * Global plan-mode configuration
 */
export interface PlanModeConfig {
  /**
   * Command allowlists
   */
  commands?: CommandConfig;
  /**
   * Tool restrictions
   */
  tools?: ToolConfig;
  /**
   * Plan extraction settings
   */
  extraction?: PlanExtractionConfig;
  /**
   * System prompts
   */
  prompts?: PromptConfig;
}
