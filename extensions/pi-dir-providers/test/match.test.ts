/**
 * Unit tests for match.ts — pure directory/profile matching logic.
 *
 * Run with:  node --loader ./test/loader.mjs --test test/match.test.ts
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { dirMatches, normalizeDir, parseModelRef, resolveProfile } from "../src/match.js";

describe("normalizeDir", () => {
	const HOME = "/home/user";

	it("expands a bare ~ to the home directory", () => {
		assert.equal(normalizeDir("~", HOME), "/home/user");
	});

	it("expands ~/foo to home/foo", () => {
		assert.equal(normalizeDir("~/foo", HOME), "/home/user/foo");
	});

	it("strips trailing slashes", () => {
		assert.equal(normalizeDir("~/foo/", HOME), "/home/user/foo");
		assert.equal(normalizeDir("~/foo//", HOME), "/home/user/foo");
	});

	it("leaves absolute paths unchanged", () => {
		assert.equal(normalizeDir("/absolute/path", HOME), "/absolute/path");
	});
});

describe("dirMatches", () => {
	it("matches an exact directory", () => {
		assert.equal(dirMatches("/a/b", "/a/b"), true);
	});

	it("matches a subdirectory", () => {
		assert.equal(dirMatches("/a/b/c", "/a/b"), true);
	});

	it("does not match a sibling", () => {
		assert.equal(dirMatches("/a/c", "/a/b"), false);
	});

	it("does not match a partial path component", () => {
		assert.equal(dirMatches("/a/bc", "/a/b"), false);
	});
});

describe("parseModelRef", () => {
	it("splits provider/model-id", () => {
		assert.deepEqual(parseModelRef("github-copilot/claude-sonnet-4-5"), {
			provider: "github-copilot",
			modelId: "claude-sonnet-4-5",
		});
	});

	it("handles model ids with slashes", () => {
		assert.deepEqual(parseModelRef("anthropic/claude-3/opus"), {
			provider: "anthropic",
			modelId: "claude-3/opus",
		});
	});

	it("returns undefined for a missing slash", () => {
		assert.equal(parseModelRef("noprovider"), undefined);
	});

	it("returns undefined for a trailing slash", () => {
		assert.equal(parseModelRef("provider/"), undefined);
	});

	it("returns undefined for a leading slash", () => {
		assert.equal(parseModelRef("/model"), undefined);
	});
});

describe("resolveProfile", () => {
	it("returns an empty profile when no rules match", () => {
		const profile = resolveProfile("/other/dir", [{ dirs: ["/a/b"], allowedProviders: ["x"] }]);
		assert.equal(profile.matchedRules.length, 0);
		assert.equal(profile.allowedProviders, undefined);
		assert.deepEqual(profile.providerOverrides, {});
	});

	it("applies a single matching rule", () => {
		const profile = resolveProfile("/a/b/c", [{ dirs: ["/a/b"], allowedProviders: ["x"] }]);
		assert.deepEqual(profile.matchedRules, [0]);
		assert.deepEqual(profile.allowedProviders, ["x"]);
	});

	it("last matching rule wins for allowedProviders (last override)", () => {
		// This is the core behavior: rules are applied in array order and
		// later matching rules replace earlier allowedProviders.
		const rules = [
			{ dirs: ["/git/managing-construction"], allowedProviders: ["github-copilot"] },
			{ dirs: ["/git"], allowedProviders: ["openrouter"] },
		];
		const profile = resolveProfile("/git/managing-construction/gossamer", rules);
		// Both rules match; the last (generic /git) wins -> openrouter.
		assert.deepEqual(profile.allowedProviders, ["openrouter"]);
	});

	it("correct ordering (generic first, specific last) yields specific provider", () => {
		const rules = [
			{ dirs: ["/git"], allowedProviders: ["openrouter"] },
			{ dirs: ["/git/managing-construction"], allowedProviders: ["github-copilot"] },
		];
		const profile = resolveProfile("/git/managing-construction/gossamer", rules);
		assert.deepEqual(profile.allowedProviders, ["github-copilot"]);
	});

	it("defaultModel is replaced by the last matching rule", () => {
		const rules = [
			{ dirs: ["/git"], allowedProviders: ["a"], defaultModel: "a/model1" },
			{ dirs: ["/git/sub"], allowedProviders: ["b"], defaultModel: "b/model2" },
		];
		const profile = resolveProfile("/git/sub/c", rules);
		assert.equal(profile.defaultModel, "b/model2");
	});

	it("providers overrides are merged across matching rules", () => {
		const rules = [
			{ dirs: ["/git"], allowedProviders: ["a"], providers: { a: { baseUrl: "https://a.com" } } },
			{ dirs: ["/git/sub"], providers: { a: { headers: { "X-Custom": "yes" } } } },
		];
		const profile = resolveProfile("/git/sub/c", rules);
		assert.deepEqual(profile.providerOverrides.a, {
			baseUrl: "https://a.com",
			headers: { "X-Custom": "yes" },
		});
	});

	it("matchedRules records indices in application order", () => {
		const rules = [
			{ dirs: ["/git"], allowedProviders: ["a"] },
			{ dirs: ["/git/sub"], allowedProviders: ["b"] },
		];
		const profile = resolveProfile("/git/sub/c", rules);
		assert.deepEqual(profile.matchedRules, [0, 1]);
	});
});
