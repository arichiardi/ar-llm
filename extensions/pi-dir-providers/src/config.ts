/**
 * Config loading and validation for pi-dir-providers.
 *
 * Config lives at <agentDir>/ar-llm/dir-providers.json, following the same
 * convention as pi-custom-compaction. Structural problems disable the
 * extension (fail open); per-rule problems warn and skip the offending part.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { normalizeDir, parseModelRef, type ProviderOverride, type Rule } from "./match.js";

export interface DirProvidersConfig {
	rules: Rule[];
}

const PREFIX = "[dir-providers]";

export function resolveConfigDir(): string {
	return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".config", "pi", "agent");
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.trim().length > 0);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadConfig(): DirProvidersConfig | null {
	const dir = resolveConfigDir();
	const filePath = path.join(dir, "ar-llm", "dir-providers.json");

	if (!fs.existsSync(filePath)) {
		console.error(
			`${PREFIX} Config file not found at ${filePath}.\n` +
				`Dir-based provider scoping is disabled. Create the file to enable it.`,
		);
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch (err) {
		console.error(
			`${PREFIX} Invalid JSON in ${filePath}: ${err instanceof Error ? err.message : String(err)}.\n` +
				`Dir-based provider scoping is disabled.`,
		);
		return null;
	}

	if (!isPlainObject(parsed) || !Array.isArray(parsed.rules)) {
		console.error(
			`${PREFIX} Config must be an object with a "rules" array in ${filePath}.\n` +
				`Dir-based provider scoping is disabled.`,
		);
		return null;
	}

	const rules: Rule[] = [];
	// Normalized dir -> index of the rule that first declared it.
	const seenDirs = new Map<string, number>();

	for (const [index, rawRule] of parsed.rules.entries()) {
		if (!isPlainObject(rawRule)) {
			console.warn(`${PREFIX} Rule ${index} is not an object; skipping rule.`);
			continue;
		}

		if (!isStringArray(rawRule.dirs)) {
			console.warn(`${PREFIX} Rule ${index} has no valid "dirs" array of non-empty strings; skipping rule.`);
			continue;
		}

		const hasEffect =
			rawRule.allowedProviders !== undefined || rawRule.defaultModel !== undefined || rawRule.providers !== undefined;
		if (!hasEffect) {
			console.warn(
				`${PREFIX} Rule ${index} has no "allowedProviders", "defaultModel", or "providers"; skipping rule.`,
			);
			continue;
		}

		// --- dirs ---
		const dirs: string[] = [];
		for (const rawDir of rawRule.dirs) {
			const normalized = normalizeDir(rawDir, os.homedir());
			if (!path.isAbsolute(normalized)) {
				console.warn(`${PREFIX} Rule ${index}: dir "${rawDir}" is not absolute after expansion; skipping dir.`);
				continue;
			}
			// Resolve symlinks (e.g. /tmp -> /private/tmp on macOS) so matching
			// against the physical process.cwd() works.
			let resolved = normalized;
			try {
				resolved = fs.realpathSync(normalized);
			} catch {
				console.warn(`${PREFIX} Rule ${index}: dir "${normalized}" does not exist.`);
			}
			if (dirs.includes(resolved)) {
				console.warn(`${PREFIX} Rule ${index}: duplicate dir "${resolved}" within rule; ignoring duplicate.`);
				continue;
			}
			const owner = seenDirs.get(resolved);
			if (owner !== undefined) {
				console.warn(
					`${PREFIX} Rule ${index}: dir "${resolved}" is also declared in rule ${owner}; ` +
						`both rules apply in order, which is usually a mistake.`,
				);
			}
			seenDirs.set(resolved, index);
			dirs.push(resolved);
		}
		if (dirs.length === 0) {
			console.warn(`${PREFIX} Rule ${index} has no usable dirs; skipping rule.`);
			continue;
		}

		// --- allowedProviders ---
		let allowedProviders: string[] | undefined;
		if (rawRule.allowedProviders !== undefined) {
			if (isStringArray(rawRule.allowedProviders)) {
				allowedProviders = [...new Set(rawRule.allowedProviders)];
			} else {
				console.warn(`${PREFIX} Rule ${index}: "allowedProviders" must be an array of non-empty strings; ignoring it.`);
			}
		}

		// --- defaultModel ---
		let defaultModel: string | undefined;
		if (rawRule.defaultModel !== undefined) {
			if (typeof rawRule.defaultModel !== "string" || !parseModelRef(rawRule.defaultModel)) {
				console.warn(`${PREFIX} Rule ${index}: "defaultModel" must be a "provider/model-id" string; ignoring it.`);
			} else {
				defaultModel = rawRule.defaultModel;
				const { provider } = parseModelRef(defaultModel)!;
				if (allowedProviders && !allowedProviders.includes(provider)) {
					console.warn(
						`${PREFIX} Rule ${index}: defaultModel provider "${provider}" is not in this rule's allowedProviders.`,
					);
				}
			}
		}

		// --- providers ---
		let providers: Record<string, ProviderOverride> | undefined;
		if (rawRule.providers !== undefined) {
			if (!isPlainObject(rawRule.providers)) {
				console.warn(`${PREFIX} Rule ${index}: "providers" must be an object keyed by provider id; ignoring it.`);
			} else {
				const cleaned: Record<string, ProviderOverride> = {};
				for (const [id, override] of Object.entries(rawRule.providers)) {
					if (!isPlainObject(override)) {
						console.warn(`${PREFIX} Rule ${index}: providers["${id}"] must be an object; ignoring it.`);
						continue;
					}
					cleaned[id] = override as ProviderOverride;
				}
				if (Object.keys(cleaned).length > 0) providers = cleaned;
			}
		}

		if (allowedProviders === undefined && defaultModel === undefined && providers === undefined) {
			console.warn(`${PREFIX} Rule ${index} has no valid effect left after validation; skipping rule.`);
			continue;
		}

		rules.push({ dirs, allowedProviders, defaultModel, providers });
	}

	return { rules };
}
