/**
 * Unit tests for config.ts — config loading, validation, and the
 * parent-after-child shadowing warning.
 *
 * Run with:  node --loader ./test/loader.mjs --test test/config.test.ts
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadConfig } from "../src/config.js";

/** Captures console.warn calls into an array; returns a restore function. */
function captureWarnings(): { warnings: string[]; restore: () => void } {
	const warnings: string[] = [];
	const orig = console.warn;
	console.warn = (msg?: unknown, ...rest: unknown[]) => {
		warnings.push(String(msg));
	};
	return {
		warnings,
		restore: () => {
			console.warn = orig;
		},
	};
}

/**
 * Write a dir-providers.json config into a temp directory and point
 * PI_CODING_AGENT_DIR at it.  Returns the temp dir for cleanup.
 */
function writeTmpConfig(config: unknown): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dp-test-"));
	fs.mkdirSync(path.join(dir, "ar-llm"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, "ar-llm", "dir-providers.json"),
		JSON.stringify(config, null, 2),
		"utf-8",
	);
	process.env.PI_CODING_AGENT_DIR = dir;
	return dir;
}

describe("loadConfig — shadowing warning", () => {
	let captured: ReturnType<typeof captureWarnings>;
	let tmpDir: string;

	afterEach(() => {
		captured.restore();
		delete process.env.PI_CODING_AGENT_DIR;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("warns when a generic rule's dir is a parent of an earlier specific rule's dir", () => {
		captured = captureWarnings();
		tmpDir = writeTmpConfig({
			rules: [
				{ dirs: ["~/git/managing-construction"], allowedProviders: ["github-copilot"] },
				{ dirs: ["~/git"], allowedProviders: ["openrouter"] },
			],
		});

		const config = loadConfig();
		assert.ok(config, "config should load successfully");
		assert.ok(
			captured.warnings.some(
				(w) =>
					w.includes("is a parent of") &&
					w.includes("Rule 1") &&
					w.includes("Reorder so broad rules precede narrow ones"),
			),
			`expected shadowing warning, got: ${captured.warnings.join("\n")}`,
		);
	});

	it("does NOT warn when rules are correctly ordered (generic first, specific last)", () => {
		captured = captureWarnings();
		tmpDir = writeTmpConfig({
			rules: [
				{ dirs: ["~/git"], allowedProviders: ["openrouter"] },
				{ dirs: ["~/git/managing-construction"], allowedProviders: ["github-copilot"] },
			],
		});

		const config = loadConfig();
		assert.ok(config, "config should load successfully");
		const shadowing = captured.warnings.filter((w) => w.includes("is a parent of"));
		assert.equal(shadowing.length, 0, `unexpected shadowing warning: ${shadowing.join("\n")}`);
		// The profile should resolve to github-copilot for the managing-construction dir.
		// (We can only assert on loadConfig output here since resolveProfile is tested separately.)
	});

	it("does NOT warn when rules have no overlap", () => {
		captured = captureWarnings();
		tmpDir = writeTmpConfig({
			rules: [
				{ dirs: ["~/git"], allowedProviders: ["openrouter"] },
				{ dirs: ["~/work"], allowedProviders: ["anthropic"] },
			],
		});

		loadConfig();
		const shadowing = captured.warnings.filter((w) => w.includes("is a parent of"));
		assert.equal(shadowing.length, 0);
	});

	it("does NOT warn when the later rule only has providers (merged, not replaced)", () => {
		captured = captureWarnings();
		tmpDir = writeTmpConfig({
			rules: [
				{ dirs: ["~/git/managing-construction"], allowedProviders: ["github-copilot"] },
				{ dirs: ["~/git"], providers: { openrouter: { baseUrl: "https://example.com" } } },
			],
		});

		loadConfig();
		const shadowing = captured.warnings.filter((w) => w.includes("is a parent of"));
		assert.equal(shadowing.length, 0, `providers-only rules should not trigger shadowing: ${shadowing.join("\n")}`);
	});
});

describe("loadConfig — null config disables extension", () => {
	let tmpDir: string;

	afterEach(() => {
		delete process.env.PI_CODING_AGENT_DIR;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns null when the config file does not exist", () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dp-test-"));
		fs.mkdirSync(path.join(tmpDir, "ar-llm"), { recursive: true });
		process.env.PI_CODING_AGENT_DIR = tmpDir;

		// Silence the stderr error message for this test.
		const origError = console.error;
		console.error = () => {};
		const result = loadConfig();
		console.error = origError;

		assert.equal(result, null);
	});
});
