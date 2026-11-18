/**
 * Unit tests for handoff config loading and provider resolution.
 *
 * Run with:  node --import ./test/register.mjs --test test/config.test.ts
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, resolveProviderConfig, type HandoffConfig } from "../src/handoff.js";

const tmpDirs: string[] = [];

/** Writes a config into a temp agent dir and points PI_CODING_AGENT_DIR at it. */
function writeTmpConfig(config: unknown): void {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-test-"));
	fs.mkdirSync(path.join(dir, "ar-llm"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, "ar-llm", "handoff.json"),
		JSON.stringify(config, null, 2),
		"utf-8",
	);
	process.env.PI_CODING_AGENT_DIR = dir;
	tmpDirs.push(dir);
}

afterEach(() => {
	delete process.env.PI_CODING_AGENT_DIR;
	while (tmpDirs.length > 0) {
		fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
	}
});

describe("loadConfig", () => {
	it("returns null when the config file is absent", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-none-"));
		process.env.PI_CODING_AGENT_DIR = dir;
		tmpDirs.push(dir);
		assert.equal(loadConfig(), null);
	});

	it("parses the providers config", () => {
		writeTmpConfig({ providers: { "pelagic-ai": { model: "google/gemma4-moe" } } });
		const config = loadConfig();
		assert.equal(config?.providers?.["pelagic-ai"]?.model, "google/gemma4-moe");
	});
});

describe("resolveProviderConfig", () => {
	const config: HandoffConfig = {
		providers: {
			"pelagic-ai": {
				model: "google/gemma4-moe",
				compat: { supportsStore: false },
			},
			empty: {},
		},
	};

	it("selects the entry for the session provider", () => {
		const resolved = resolveProviderConfig(config, "pelagic-ai");
		assert.equal(resolved?.provider, "pelagic-ai");
		assert.equal(resolved?.model, "google/gemma4-moe");
		assert.deepEqual(resolved?.compat, { supportsStore: false });
	});

	it("returns null for an unconfigured provider", () => {
		assert.equal(resolveProviderConfig(config, "openrouter"), null);
	});

	it("returns null when the entry has no model", () => {
		assert.equal(resolveProviderConfig(config, "empty"), null);
	});

	it("defaults compat to an empty object", () => {
		assert.deepEqual(resolveProviderConfig({ providers: { p: { model: "m" } } }, "p")?.compat, {});
	});
});