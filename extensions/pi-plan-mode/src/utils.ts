/**
 * Pure utility functions for plan mode.
 * Extracted for testability.
 *
 * Original source: https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/plan-mode
 * Modified by Andrea Richiardi
 *
 * MIT License
 *
 * Copyright (c) 2025 Mario Zechner
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import type { CommandConfig, PlanExtractionConfig } from "./types.js";

/**
 * Check if a command is safe (allowed in plan mode)
 */
export function isSafeCommand(command: string, config: CommandConfig): boolean {
	const safeRegexes = config.safePatterns.map((p) => new RegExp(p.slice(1, -1)));
	const destructiveRegexes = config.destructivePatterns.map((p) => new RegExp(p.slice(1, -1)));

	const isDestructive = destructiveRegexes.some((p) => p.test(command));
	const isSafe = safeRegexes.some((p) => p.test(command));

	return !isDestructive && isSafe;
}

export interface TodoItem {
	step: number;
	text: string;
	completed: boolean;
}

/**
 * Clean step text by removing markdown formatting and normalizing
 */
export function cleanStepText(text: string, config: PlanExtractionConfig): string {
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
export function extractTodoItems(message: string, config: PlanExtractionConfig): TodoItem[] {
	const items: TodoItem[] = [];

	const headerPattern = new RegExp(config.planHeaderPattern.slice(1, -1), "i");
	const headerMatch = message.match(headerPattern);
	if (!headerMatch) return items;

	const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
	const stepNumberRegex = new RegExp(config.stepNumberPattern.slice(1, -1), "gm");

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
export function extractDoneSteps(message: string, config: PlanExtractionConfig): number[] {
	const steps: number[] = [];
	const doneMarkerRegex = new RegExp(config.doneMarkerPattern.slice(1, -1), "gi");

	for (const match of message.matchAll(doneMarkerRegex)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.push(step);
	}
	return steps;
}

/**
 * Mark steps as completed based on [DONE:n] markers in text
 */
export function markCompletedSteps(text: string, items: TodoItem[], config: PlanExtractionConfig): number {
	const doneSteps = extractDoneSteps(text, config);
	for (const step of doneSteps) {
		const item = items.find((t) => t.step === step);
		if (item) item.completed = true;
	}
	return doneSteps.length;
}
