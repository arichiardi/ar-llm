/**
 * Prompt template rendering.
 *
 * Templates are plain strings with {placeholder} tokens; values come from the
 * plan format config plus per-call dynamic values.
 *
 * Original source: https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/plan-mode
 * Modified by Andrea Richiardi
 *
 * MIT License - Copyright (c) 2025 Mario Zechner
 */

import type { PlanFormatConfig } from "./types.js";

/**
 * Render a prompt template by substituting {placeholder} tokens.
 *
 * Plain string substitution only: unknown placeholders are left untouched so
 * a typo in a template is visible rather than silently blanked.
 */
export function renderPromptTemplate(template: string, values: Record<string, string>): string {
	return template.replace(/\{(\w+)\}/g, (match, key: string) =>
		Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match,
	);
}

/**
 * The values shared by every prompt template, derived from the plan format
 * config. Callers merge in their own dynamic values ({tools}, {todoList}).
 */
export function planFormatPromptValues(config: PlanFormatConfig): Record<string, string> {
	return {
		planHeader: config.hints.planHeader,
		stepPrefix: config.hints.stepPrefix,
		maxStepLength: String(config.maxStepLength),
	};
}