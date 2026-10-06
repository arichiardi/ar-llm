/**
 * Unit tests for the pure chunking helpers.
 *
 * Run with:  node --import ./test/register.mjs --test test/chunking.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	computeChunkBudget,
	estimateTextTokens,
	splitPieces,
	truncateHeadTail,
} from "../src/chunking.js";

describe("estimateTextTokens", () => {
	it("counts empty text as zero tokens", () => {
		assert.equal(estimateTextTokens(""), 0);
	});

	it("rounds up to the next token", () => {
		assert.equal(estimateTextTokens("aaaa"), 1);
		assert.equal(estimateTextTokens("aaaaa"), 2);
	});
});

describe("computeChunkBudget", () => {
	it("subtracts response, overhead, and safety from the context window", () => {
		assert.equal(
			computeChunkBudget({
				contextWindow: 32768,
				responseTokens: 4096,
				overheadTokens: 1000,
				safetyTokens: 512,
			}),
			27160,
		);
	});

	it("can go negative when the configuration cannot fit any input", () => {
		assert.ok(
			computeChunkBudget({
				contextWindow: 32768,
				responseTokens: 32768,
				overheadTokens: 0,
				safetyTokens: 0,
			}) <= 0,
		);
	});
});

describe("truncateHeadTail", () => {
	it("returns short text unchanged", () => {
		assert.equal(truncateHeadTail("short", 100), "short");
	});

	it("keeps the head and the tail and elides the middle", () => {
		const text = "H".repeat(400) + "M".repeat(400) + "T".repeat(400);
		const result = truncateHeadTail(text, 50);

		assert.match(result, /characters omitted/);
		assert.ok(result.startsWith("HHH"));
		assert.ok(result.endsWith("TTT"));
		assert.ok(result.length < text.length);
	});
});

describe("splitPieces", () => {
	it("returns no chunks for no pieces", () => {
		assert.deepEqual(splitPieces([], 10), []);
	});

	it("keeps every piece in one chunk when they fit", () => {
		const chunks = splitPieces(["aaaa", "bbbb"], 10);
		assert.deepEqual(chunks, ["aaaa\n\nbbbb"]);
	});

	it("splits at message boundaries", () => {
		const chunks = splitPieces(["aaaa", "bbbb", "cccc"], 2);
		assert.deepEqual(chunks, ["aaaa\n\nbbbb", "cccc"]);
	});

	it("truncates a single oversized message head and tail", () => {
		const huge = "H".repeat(400) + "T".repeat(400);
		const chunks = splitPieces([huge], 50);

		assert.equal(chunks.length, 1);
		assert.match(chunks[0], /characters omitted/);
		assert.ok(chunks[0].startsWith("HH"));
		assert.ok(chunks[0].endsWith("TT"));
	});

	it("repeats the previous tail when overlap is set", () => {
		const chunks = splitPieces(["aaaa", "bbbb", "cccc"], 2, 1);
		assert.equal(chunks.length, 2);
		assert.ok(chunks[1].startsWith("bbbb"));
	});

	it("always makes progress when overlap covers the whole chunk", () => {
		const chunks = splitPieces(["aaaa", "bbbb"], 1, 5);
		assert.equal(chunks.length, 2);
		assert.ok(chunks.every((chunk) => chunk.length > 0));
	});
});
