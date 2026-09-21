/**
 * Parse the "/source/flags" regex strings used throughout the config.
 *
 * Config JSON cannot hold RegExp literals, so patterns are stored as strings
 * in the conventional "/source/flags" form. This module converts them back
 * faithfully, preserving the flags that follow the closing slash.
 *
 * MIT License - Copyright (c) 2025 Mario Zechner
 * Modified by Andrea Richiardi
 */

export interface ParsedRegex {
	source: string;
	flags: string;
}

/**
 * Split a "/source/flags" string into its source and flags.
 * The closing slash is the LAST slash, so escaped slashes inside the source
 * (e.g. a\/b) are handled correctly.
 */
export function parseRegexPattern(pattern: string): ParsedRegex {
	const trimmed = pattern.trim();
	if (!trimmed.startsWith("/")) {
		throw new Error(`Invalid regex pattern (must start with "/"): ${pattern}`);
	}
	const lastSlash = trimmed.lastIndexOf("/");
	if (lastSlash === 0) {
		throw new Error(`Invalid regex pattern (missing closing "/"): ${pattern}`);
	}
	return {
		source: trimmed.slice(1, lastSlash),
		flags: trimmed.slice(lastSlash + 1),
	};
}

/**
 * Build a RegExp from a "/source/flags" string, merging in any extra flags
 * required by the caller (e.g. "g" for matchAll). Flags are de-duplicated.
 */
export function toRegExp(pattern: string, extraFlags = ""): RegExp {
	const { source, flags } = parseRegexPattern(pattern);
	const merged = [...new Set((flags + extraFlags).split(""))].join("");
	return new RegExp(source, merged);
}