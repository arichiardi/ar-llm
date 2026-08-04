/**
 * Pure directory/profile matching logic for pi-dir-providers.
 *
 * This file must stay side-effect free and pi-independent so it can be
 * unit-tested without a pi runtime.
 */

import * as path from "node:path";

/** Provider override fields, passed through to pi.registerProvider(). */
export interface ProviderOverride {
	baseUrl?: string;
	headers?: Record<string, string>;
	[key: string]: unknown;
}

/** A single config rule. Directories are normalized absolute paths. */
export interface Rule {
	/** Subtree-match directories (cwd equals dir or is under it). */
	dirs: string[];
	/** When set, replaces the effective allowed-provider set. */
	allowedProviders?: string[];
	/** "provider/model-id" applied to fresh sessions. */
	defaultModel?: string;
	/** Per-provider overrides (models.json override semantics). */
	providers?: Record<string, ProviderOverride>;
}

/** Effective profile after applying all matching rules in order. */
export interface Profile {
	/** undefined means unrestricted. */
	allowedProviders?: string[];
	defaultModel?: string;
	providerOverrides: Record<string, ProviderOverride>;
	/** Indices of matched rules, in application order. */
	matchedRules: number[];
}

/** Expand a leading `~` and strip trailing slashes. */
export function normalizeDir(dir: string, homedir: string): string {
	let expanded = dir;
	if (expanded === "~") expanded = homedir;
	else if (expanded.startsWith("~/")) expanded = path.join(homedir, expanded.slice(2));
	while (expanded.length > 1 && expanded.endsWith("/")) expanded = expanded.slice(0, -1);
	return expanded;
}

/** True when cwd equals dir or is inside dir. */
export function dirMatches(cwd: string, dir: string): boolean {
	return cwd === dir || cwd.startsWith(dir + path.sep);
}

/**
 * Resolve the effective profile for a cwd.
 *
 * Rules apply in array order (generic to specific): a later matching rule
 * replaces `allowedProviders`/`defaultModel` and merges `providers` per id.
 */
export function resolveProfile(cwd: string, rules: Rule[]): Profile {
	const profile: Profile = { providerOverrides: {}, matchedRules: [] };
	rules.forEach((rule, index) => {
		if (!rule.dirs.some((dir) => dirMatches(cwd, dir))) return;
		profile.matchedRules.push(index);
		if (rule.allowedProviders) profile.allowedProviders = [...rule.allowedProviders];
		if (rule.defaultModel) profile.defaultModel = rule.defaultModel;
		if (rule.providers) {
			for (const [id, override] of Object.entries(rule.providers)) {
				profile.providerOverrides[id] = { ...profile.providerOverrides[id], ...override };
			}
		}
	});
	return profile;
}

/** Parse "provider/model-id"; model ids may contain further slashes. */
export function parseModelRef(ref: string): { provider: string; modelId: string } | undefined {
	const slash = ref.indexOf("/");
	if (slash <= 0 || slash === ref.length - 1) return undefined;
	return { provider: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
}
