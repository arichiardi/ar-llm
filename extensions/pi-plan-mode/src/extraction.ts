/**
 * Plan extraction: pull numbered plan steps and [DONE:n] completion markers
 * out of assistant messages, using the configured plan format patterns.
 *
 * Original source: https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/plan-mode
 * Modified by Andrea Richiardi
 *
 * MIT License - Copyright (c) 2025 Mario Zechner
 */

import { toRegExp } from "./regex.js";
import type { PlanFormatConfig } from "./types.js";

export interface TodoItem {
	step: number;
	text: string;
	completed: boolean;
}

/**
 * Clean step text by removing markdown formatting and normalizing
 */
export function cleanStepText(text: string, config: PlanFormatConfig): string {
	if (!config.cleanStepText) return text;

	let cleaned = text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1") // Remove bold/italic
		.replace(/`([^`]+)`/g, "$1") // Remove code
		.replace(
			/^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
			"",
		)
		.replace(/\s+/g, " ")
		.trim();

	if (cleaned.length > 0) {
		cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
	}
	if (cleaned.length > config.maxStepLength) {
		cleaned = `${cleaned.slice(0, config.maxStepLength - 3)}...`;
	}
	return cleaned;
}

/**
 * Extract todo items from a plan message
 */
export function extractTodoItems(message: string, config: PlanFormatConfig): TodoItem[] {
	const items: TodoItem[] = [];

	const headerPattern = toRegExp(config.planHeaderPattern);
	const headerMatch = message.match(headerPattern);
	if (!headerMatch) return items;

	const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
	const stepNumberRegex = toRegExp(config.stepNumberPattern, "g");

	for (const match of planSection.matchAll(stepNumberRegex)) {
		const text = match[2]
			.trim()
			.replace(/\*{1,2}$/g, "")
			.trim();
		if (text.length > 5 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
			const cleaned = cleanStepText(text, config);
			if (cleaned.length > 3) {
				items.push({ step: items.length + 1, text: cleaned, completed: false });
			}
		}
	}
	return items;
}

/**
 * Extract completed step numbers from a message
 */
export function extractDoneSteps(message: string, config: PlanFormatConfig): number[] {
	const steps: number[] = [];
	const doneMarkerRegex = toRegExp(config.doneMarkerPattern, "g");

	for (const match of message.matchAll(doneMarkerRegex)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.push(step);
	}
	return steps;
}

/**
 * Mark steps as completed based on [DONE:n] markers in text
 */
export function markCompletedSteps(text: string, items: TodoItem[], config: PlanFormatConfig): number {
	const doneSteps = extractDoneSteps(text, config);
	for (const step of doneSteps) {
		const item = items.find((t) => t.step === step);
		if (item) item.completed = true;
	}
	return doneSteps.length;
}