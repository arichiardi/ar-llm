/**
 * Provider enumeration for pi-dir-providers.
 *
 * Kept free of pi imports and side effects so it can be unit-tested against a
 * temporary agent dir. The caller supplies the builtin provider ids (from
 * pi-ai) and the agent dir path; this module reads the JSON files pi uses for
 * user provider configuration.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { providerIdsFromModelsConfig, providerIdsFromModelsStore } from "./match.js";

/** Read and parse a JSON file; returns undefined when missing or invalid. */
export function readJsonFile(filePath: string): unknown {
	try {
		if (!fs.existsSync(filePath)) return undefined;
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch {
		return undefined;
	}
}

/**
 * Builtin provider ids plus provider ids declared in pi's user config:
 * models.json (provider overrides) and models-store.json (dynamic/custom
 * catalogs, written by pi >= 0.85).
 */
export function enumerateKnownProviders(builtins: Iterable<string>, agentDir: string): Set<string> {
	const known = new Set<string>(builtins);
	for (const id of providerIdsFromModelsConfig(readJsonFile(path.join(agentDir, "models.json")))) {
		known.add(id);
	}
	for (const id of providerIdsFromModelsStore(readJsonFile(path.join(agentDir, "models-store.json")))) {
		known.add(id);
	}
	return known;
}
