/**
 * Unit tests for config loading and parameter resolution.
 *
 * Run with:  node --import ./test/register.mjs --test test/config.test.ts
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig } from "../src/custom-compaction.js";

const PROVIDER = "test-provider";

const tmpDirs: string[] = [];
let restoreConsole: (() => void) | null = null;

/** Writes a config into a temp agent dir and points PI_CODING_AGENT_DIR at it. */
function writeTmpConfig(config: unknown): void {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-test-"));
	fs.mkdirSync(path.join(dir, "ar-llm"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, "ar-llm", "custom-compaction.json"),
		JSON.stringify(config, null, 2),
		"utf-8",
	);
	process.env.PI_CODING_AGENT_DIR = dir;
	tmpDirs.push(dir);
}

/** Captures console.error output so expected warnings do not pollute the run. */
function captureErrors(): string[] {
	const errors: string[] = [];
	const original = console.error;
	console.error = (msg?: unknown) => {
		errors.push(String(msg));
	};
	restoreConsole = () => {
		console.error = original;
	};
	return errors;
}

afterEach(() => {
	restoreConsole?.();
	restoreConsole = null;
	delete process.env.PI_CODING_AGENT_DIR;
	while (tmpDirs.length > 0) {
		fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
	}
});

describe("loadConfig", () => {
	it("resolves the model, stream-options, and request-params", () => {
		writeTmpConfig({
			providers: {
				[PROVIDER]: {
					model: "some-model",
					"stream-options": { maxTokens: 4096 },
					"request-params": { top_p: 0.9 },
				},
			},
		});

		const config = loadConfig(PROVIDER);

		assert.ok(config);
		assert.equal(config.compactionProvider, PROVIDER);
		assert.equal(config.compactionModelId, "some-model");
		assert.deepEqual(config.streamOptions, { maxTokens: 4096 });
		assert.deepEqual(config.requestParams, { top_p: 0.9 });
	});

	it("returns empty param objects when the provider sets none", () => {
		writeTmpConfig({ providers: { [PROVIDER]: { model: "some-model" } } });

		const config = loadConfig(PROVIDER);

		assert.ok(config);
		assert.deepEqual(config.streamOptions, {});
		assert.deepEqual(config.requestParams, {});
	});

	it("returns null when the config file is missing", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-test-"));
		tmpDirs.push(dir);
		process.env.PI_CODING_AGENT_DIR = dir;
		captureErrors();

		assert.equal(loadConfig(PROVIDER), null);
	});

	it("returns null for an unknown provider", () => {
		const errors = captureErrors();
		writeTmpConfig({ providers: { other: { model: "some-model" } } });

		assert.equal(loadConfig(PROVIDER), null);
		assert.match(errors.join("\n"), /No config for provider "test-provider"/);
	});

	it("returns null when the provider is disabled", () => {
		writeTmpConfig({
			providers: { [PROVIDER]: { enabled: false, model: "some-model" } },
		});

		assert.equal(loadConfig(PROVIDER), null);
	});

	it("returns null when the provider sets no model", () => {
		const errors = captureErrors();
		writeTmpConfig({ providers: { [PROVIDER]: {} } });

		assert.equal(loadConfig(PROVIDER), null);
		assert.match(errors.join("\n"), /missing "model"/);
	});

	describe("temperature alias", () => {
		it("copies request-params.temperature into stream-options", () => {
			writeTmpConfig({
				providers: {
					[PROVIDER]: {
						model: "some-model",
						"request-params": { temperature: 0.6 },
					},
				},
			});

			const config = loadConfig(PROVIDER);

			assert.ok(config);
			assert.equal(config.streamOptions.temperature, 0.6);
			// The raw key stays, so OpenAI-compatible adapters get it in the body.
			assert.equal(config.requestParams.temperature, 0.6);
		});

		it("lets request-params.temperature win over stream-options.temperature", () => {
			writeTmpConfig({
				providers: {
					[PROVIDER]: {
						model: "some-model",
						"stream-options": { temperature: 0.1 },
						"request-params": { temperature: 0.9 },
					},
				},
			});

			const config = loadConfig(PROVIDER);

			assert.ok(config);
			assert.equal(config.streamOptions.temperature, 0.9);
		});

		it("keeps stream-options.temperature when request-params omits it", () => {
			writeTmpConfig({
				providers: {
					[PROVIDER]: {
						model: "some-model",
						"stream-options": { temperature: 0.1 },
						"request-params": { top_p: 0.9 },
					},
				},
			});

			const config = loadConfig(PROVIDER);

			assert.ok(config);
			assert.deepEqual(config.streamOptions, { temperature: 0.1 });
		});

		it("accepts temperature 0", () => {
			writeTmpConfig({
				providers: {
					[PROVIDER]: {
						model: "some-model",
						"stream-options": { temperature: 0.9 },
						"request-params": { temperature: 0 },
					},
				},
			});

			const config = loadConfig(PROVIDER);

			assert.ok(config);
			assert.equal(config.streamOptions.temperature, 0);
		});
	});

	describe("prompt resolution", () => {
		const providerPrompt = {
			system: "provider system",
			user: "provider user",
			includePreviousSummary: false,
		};
		const defaultPrompt = {
			system: "default system",
			user: "default user",
			includePreviousSummary: true,
		};

		it("prefers the provider prompt", () => {
			writeTmpConfig({
				"default-prompts": defaultPrompt,
				providers: { [PROVIDER]: { model: "m", prompt: providerPrompt } },
			});

			const config = loadConfig(PROVIDER);

			assert.ok(config);
			assert.deepEqual(config.prompt, providerPrompt);
		});

		it("falls back to default-prompts", () => {
			writeTmpConfig({
				"default-prompts": defaultPrompt,
				providers: { [PROVIDER]: { model: "m" } },
			});

			const config = loadConfig(PROVIDER);

			assert.ok(config);
			assert.deepEqual(config.prompt, defaultPrompt);
		});

		it("falls back to the built-in prompt", () => {
			writeTmpConfig({ providers: { [PROVIDER]: { model: "m" } } });

			const config = loadConfig(PROVIDER);

			assert.ok(config);
			assert.match(config.prompt.system, /conversation summarizer/);
		});
	});

	describe("legacy config shapes", () => {
		it("drops the nested request-params.providers shape", () => {
			const errors = captureErrors();
			writeTmpConfig({
				providers: {
					[PROVIDER]: {
						model: "m",
						"request-params": {
							providers: { [PROVIDER]: { default: { top_p: 0.9 } } },
						},
					},
				},
			});

			const config = loadConfig(PROVIDER);

			assert.ok(config);
			assert.deepEqual(config.requestParams, {});
			assert.match(errors.join("\n"), /request-params\.providers.*no longer supported/);
		});

		it("lifts maxTokens out of request-params", () => {
			const errors = captureErrors();
			writeTmpConfig({
				providers: {
					[PROVIDER]: {
						model: "m",
						"request-params": { maxTokens: 32758, top_p: 0.9 },
					},
				},
			});

			const config = loadConfig(PROVIDER);

			assert.ok(config);
			assert.deepEqual(config.streamOptions, { maxTokens: 32758 });
			assert.deepEqual(config.requestParams, { top_p: 0.9 });
			assert.match(errors.join("\n"), /"maxTokens" is a pi parameter/);
		});

		it("warns about the old defaultPrompt key and uses the built-in prompt", () => {
			const errors = captureErrors();
			writeTmpConfig({
				defaultPrompt: { system: "old", user: "old", includePreviousSummary: true },
				providers: { [PROVIDER]: { model: "m" } },
			});

			const config = loadConfig(PROVIDER);

			assert.ok(config);
			assert.match(errors.join("\n"), /"defaultPrompt".*Rename it to "default-prompts"/);
			assert.match(config.prompt.system, /conversation summarizer/);
		});
	});
});
