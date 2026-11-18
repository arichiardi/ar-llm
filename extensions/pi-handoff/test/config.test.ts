/**
 * Unit tests for handoff config loading, provider resolution, and option building.
 *
 * Run with:  node --import ./test/register.mjs --test test/config.test.ts
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, resolveProviderConfig, buildCallOptions, type HandoffConfig } from "../src/handoff.js";

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
				"stream-options": { thinkingEnabled: true },
				"request-params": { chat_template_kwargs: { enable_thinking: false } },
				compat: { supportsStore: false },
			},
			empty: {},
		},
	};

	it("selects the entry for the session provider", () => {
		const resolved = resolveProviderConfig(config, "pelagic-ai");
		assert.equal(resolved?.provider, "pelagic-ai");
		assert.equal(resolved?.model, "google/gemma4-moe");
		assert.deepEqual(resolved?.streamOptions, { thinkingEnabled: true });
		assert.deepEqual(resolved?.requestParams, { chat_template_kwargs: { enable_thinking: false } });
		assert.deepEqual(resolved?.compat, { supportsStore: false });
	});

	it("returns null for an unconfigured provider", () => {
		assert.equal(resolveProviderConfig(config, "openrouter"), null);
	});

	it("returns null when the entry has no model", () => {
		assert.equal(resolveProviderConfig(config, "empty"), null);
	});

	it("defaults stream-options, request-params, and compat to empty objects", () => {
		const resolved = resolveProviderConfig({ providers: { p: { model: "m" } } }, "p");
		assert.deepEqual(resolved?.streamOptions, {});
		assert.deepEqual(resolved?.requestParams, {});
		assert.deepEqual(resolved?.compat, {});
	});
});

describe("buildCallOptions", () => {
	const base = { signal: new AbortController().signal, sessionId: "sess-1" };

	it("defaults thinking off with no provider config", () => {
		const options = buildCallOptions(null, base);
		assert.equal(options.thinkingEnabled, false);
		assert.equal(options.cacheRetention, "none");
		assert.equal(options.signal, base.signal);
		assert.equal(options.sessionId, "sess-1");
		assert.equal(options.samplingParams, undefined);
	});

	it("merges stream-options and lets the config turn thinking on", () => {
		const resolved = resolveProviderConfig(
			{ providers: { p: { model: "m", "stream-options": { thinkingEnabled: true, temperature: 0.2 } } } },
			"p",
		);
		const options = buildCallOptions(resolved, base);
		assert.equal(options.thinkingEnabled, true);
		assert.equal(options.temperature, 0.2);
	});

	it("forwards request-params as samplingParams", () => {
		const resolved = resolveProviderConfig(
			{ providers: { p: { model: "m", "request-params": { top_p: 0.9, chat_template_kwargs: { enable_thinking: false } } } } },
			"p",
		);
		assert.deepEqual(buildCallOptions(resolved, base).samplingParams, {
			top_p: 0.9,
			chat_template_kwargs: { enable_thinking: false },
		});
	});

	it("keeps signal and sessionId from the caller", () => {
		const resolved = resolveProviderConfig(
			{ providers: { p: { model: "m", "stream-options": { signal: "nope", sessionId: "nope" } } } },
			"p",
		);
		const options = buildCallOptions(resolved, base);
		assert.equal(options.signal, base.signal);
		assert.equal(options.sessionId, "sess-1");
	});
});
