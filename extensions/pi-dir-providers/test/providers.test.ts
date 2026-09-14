/**
 * Unit tests for providers.ts — known-provider enumeration.
 *
 * Covers the regression where a provider defined only in pi's dynamic
 * models-store.json (e.g. "llama.cpp") was reported as unknown.
 *
 * Run with:  node --import ./test/register.mjs --test test/providers.test.ts
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { enumerateKnownProviders } from "../src/providers.js";

const BUILTINS = ["openrouter", "github-copilot", "anthropic"];

/** Create a temp agent dir, optionally seeded with provider config files. */
function makeAgentDir(files: Record<string, unknown> = {}): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dp-providers-"));
	for (const [name, content] of Object.entries(files)) {
		fs.writeFileSync(path.join(dir, name), JSON.stringify(content, null, 2), "utf-8");
	}
	return dir;
}

describe("enumerateKnownProviders", () => {
	let tmpDir: string | undefined;

	afterEach(() => {
		if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = undefined;
	});

	it("includes builtin provider ids", () => {
		tmpDir = makeAgentDir();
		const known = enumerateKnownProviders(BUILTINS, tmpDir);
		for (const id of BUILTINS) assert.ok(known.has(id), `expected builtin ${id}`);
	});

	it("includes provider ids declared only in dynamic models-store.json", () => {
		tmpDir = makeAgentDir({
			"models-store.json": {
				"llama.cpp": { models: [] },
				openrouter: { models: [], checkedAt: "2026-01-01T00:00:00.000Z" },
			},
		});
		const known = enumerateKnownProviders(BUILTINS, tmpDir);
		assert.ok(known.has("llama.cpp"), "llama.cpp from models-store.json must be known");
		assert.ok(known.has("openrouter"));
	});

	it("includes provider ids declared in models.json overrides", () => {
		tmpDir = makeAgentDir({ "models.json": { providers: { "alba-local": { baseUrl: "http://localhost" } } } });
		const known = enumerateKnownProviders(BUILTINS, tmpDir);
		assert.ok(known.has("alba-local"));
	});

	it("merges providers from both files with builtins", () => {
		tmpDir = makeAgentDir({
			"models.json": { providers: { "alba-local": {} } },
			"models-store.json": { "llama.cpp": { models: [] } },
		});
		const known = enumerateKnownProviders(BUILTINS, tmpDir);
		assert.deepEqual(
			[...known].sort(),
			["alba-local", "anthropic", "github-copilot", "llama.cpp", "openrouter"].sort(),
		);
	});

	it("ignores missing files and malformed JSON", () => {
		tmpDir = makeAgentDir();
		fs.writeFileSync(path.join(tmpDir, "models-store.json"), "{ not json", "utf-8");
		const known = enumerateKnownProviders(BUILTINS, tmpDir);
		assert.deepEqual([...known].sort(), [...BUILTINS].sort());
	});

	it("ignores malformed documents without dropping builtins", () => {
		tmpDir = makeAgentDir({
			"models.json": { providers: "nope" },
			"models-store.json": [1, 2, 3],
		});
		const known = enumerateKnownProviders(BUILTINS, tmpDir);
		assert.deepEqual([...known].sort(), [...BUILTINS].sort());
	});
});
