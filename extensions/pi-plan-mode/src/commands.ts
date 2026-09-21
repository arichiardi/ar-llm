/**
 * Command safety: decide whether a bash command is allowed in plan mode.
 *
 * Original source: https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/plan-mode
 * Modified by Andrea Richiardi
 *
 * MIT License - Copyright (c) 2025 Mario Zechner
 */

import { toRegExp } from "./regex.ts";
import type { CommandConfig } from "./types.ts";

/**
 * Check if a command is safe (allowed in plan mode)
 */
export function isSafeCommand(command: string, config: CommandConfig): boolean {
	const safeRegexes = config.safePatterns.map((p) => toRegExp(p));
	const destructiveRegexes = config.destructivePatterns.map((p) => toRegExp(p));

	const isDestructive = destructiveRegexes.some((p) => p.test(command));
	const isSafe = safeRegexes.some((p) => p.test(command));

	return !isDestructive && isSafe;
}