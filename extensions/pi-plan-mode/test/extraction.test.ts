/**
 * Unit tests for the pure plan-extraction functions.
 *
 * Run with: npm test (node --test, no test framework dependency).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanStepText, extractDoneSteps, extractTodoItems, markCompletedSteps } from "../src/extraction.ts";
import type { PlanFormatConfig } from "../src/types.ts";

function planFormat(overrides: Partial<PlanFormatConfig> = {}): PlanFormatConfig {
	return {
		planHeaderPattern: "/\\*{0,2}Plan:\\*{0,2}\\s*\\n/i",
		stepNumberPattern: "/^\\s*(\\d+)[.)]\\s+\\*{0,2}([^*\\n]+)/gm",
		doneMarkerPattern: "/\\[DONE:(\\d+)\\]/gi",
		maxStepLength: 50,
		cleanStepText: true,
		hints: { planHeader: "Plan:", stepPrefix: "1." },
		...overrides,
	};
}

test("extractTodoItems extracts numbered steps under the plan header", () => {
	const todos = extractTodoItems("Here:\n\nPlan:\n1. Read the config\n2. Write the field\n3. Run tests\n", planFormat());

	assert.equal(todos.length, 3);
	assert.deepEqual(
		todos.map((t) => t.step),
		[1, 2, 3],
	);
	assert.ok(todos.every((t) => t.completed === false));
});

test("extractTodoItems returns nothing without the plan header", () => {
	assert.deepEqual(extractTodoItems("Just prose, no plan here.", planFormat()), []);
});

test("extractTodoItems preserves pattern flags (regression)", () => {
	// Patterns are "/source/flags" strings; a lower-case header only matches
	// when the "i" flag survives parsing.
	const todos = extractTodoItems("plan:\n1. Lowercase header\n", planFormat());

	assert.equal(todos.length, 1);
});

test("extractTodoItems honours a custom format vocabulary", () => {
	const config = planFormat({
		planHeaderPattern: "/\\*{0,2}Action Items:\\*{0,2}\\s*\\n/i",
		stepNumberPattern: "/^\\s*(\\d+)\\)\\s+([^\\n]+)/gm",
		hints: { planHeader: "Action Items:", stepPrefix: "1)" },
	});

	const todos = extractTodoItems("Action Items:\n1) First thing\n2) Second thing\n", config);

	assert.deepEqual(
		todos.map((t) => t.text),
		["First thing", "Second thing"],
	);
});

test("cleanStepText strips markdown and truncates to maxStepLength", () => {
	assert.equal(cleanStepText("**Read** the `config` file", planFormat()), "Config file");

	const truncated = cleanStepText("a".repeat(80), planFormat());
	assert.equal(truncated.length, 50);
	assert.ok(truncated.endsWith("..."));
});

test("cleanStepText is a no-op when disabled", () => {
	const text = "**keep** me";
	assert.equal(cleanStepText(text, planFormat({ cleanStepText: false })), text);
});

test("extractDoneSteps reads [DONE:n] markers", () => {
	assert.deepEqual(extractDoneSteps("Did [DONE:2] and [DONE:5]", planFormat()), [2, 5]);
});

test("markCompletedSteps marks only matching steps", () => {
	const todos = extractTodoItems("Plan:\n1. One thing\n2. Two thing\n3. Three thing\n", planFormat());
	const count = markCompletedSteps("[DONE:2]", todos, planFormat());

	assert.equal(count, 1);
	assert.deepEqual(
		todos.map((t) => t.completed),
		[false, true, false],
	);
});