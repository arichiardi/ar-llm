/**
 * Handoff extension - transfer context to a new focused session
 *
 * Original source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/handoff.ts
 * Modified by Andrea Richiardi
 *
 * MIT License
 *
 * Copyright (c) 2025 Mario Zechner
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Instead of compacting (which is lossy), handoff extracts what matters
 * for your next task and creates a new session with a generated prompt.
 *
 * Usage:
 *   /handoff now implement this for teams as well
 *   /handoff execute phase one of the plan
 *   /handoff check other places that need this fix
 *
 * The generated prompt appears as a draft in the editor for review/editing.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { uuidv7 } from "@earendil-works/pi-ai";
import { complete, type Message } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { BorderedLoader, convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const SYSTEM_PROMPT = `You are a context transfer assistant. Given a conversation history and the user's goal for a new thread, generate a focused prompt that:

1. Summarizes relevant context from the conversation (decisions made, approaches taken, key findings)
2. Lists any relevant files that were discussed or modified
3. Clearly states the next task based on the user's goal
4. Is self-contained - the new thread should be able to proceed without the old conversation

Format your response as a prompt the user can send to start the new thread. Be concise but include all necessary context. Do not include any preamble like "Here's the prompt" - just output the prompt itself.

Example output format:
## Context
We've been working on X. Key decisions:
- Decision 1
- Decision 2

Files involved:
- path/to/file1.ts
- path/to/file2.ts

## Task
[Clear description of what to do next based on user's goal]`;

function entryToMessage(entry: SessionEntry): AgentMessage | undefined {
	if (entry.type === "message") {
		return entry.message;
	}
	if (entry.type === "compaction") {
		return {
			role: "compactionSummary",
			summary: entry.summary,
			tokensBefore: entry.tokensBefore,
			timestamp: new Date(entry.timestamp).getTime(),
		};
	}
	return undefined;
}

function getHandoffMessages(branch: SessionEntry[]): AgentMessage[] {
	let compactionIndex = -1;
	for (let i = branch.length - 1; i >= 0; i--) {
		if (branch[i].type === "compaction") {
			compactionIndex = i;
			break;
		}
	}
	if (compactionIndex < 0) {
		return branch.map(entryToMessage).filter((message) => message !== undefined);
	}

	const compaction = branch[compactionIndex];
	const firstKeptIndex =
		compaction.type === "compaction" ? branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId) : -1;
	const compactedBranch = [
		compaction,
		...(firstKeptIndex >= 0 ? branch.slice(firstKeptIndex, compactionIndex) : []),
		...branch.slice(compactionIndex + 1),
	];
	return compactedBranch.map(entryToMessage).filter((message) => message !== undefined);
}

export default function (pi: ExtensionAPI) {
	const DEBUG = true;
	const AR_LLM_TMP = path.join(os.tmpdir(), "ar-llm");
	const DEBUG_LOG = path.join(AR_LLM_TMP, "pi-handoff.log");
	function log(msg: string) {
		if (!DEBUG) return;
		fs.mkdirSync(AR_LLM_TMP, { recursive: true });
		fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
	}

	pi.registerCommand("handoff", {
		description: "Transfer context to a new focused session",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("handoff requires interactive mode", "error");
				return;
			}

			if (!ctx.model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			const goal = args.trim();
			if (!goal) {
				ctx.ui.notify("Usage: /handoff <goal for new thread>", "error");
				return;
			}

			log(`handoff invoked: goal="${goal}"`);
			log(`model: ${JSON.stringify(ctx.model)}`);

			// Gather conversation context from current branch. If the branch was compacted,
			// include the compaction summary plus entries from firstKeptEntryId onward.
			const messages = getHandoffMessages(ctx.sessionManager.getBranch());
			log(`messages gathered: ${messages.length}`);

			if (messages.length === 0) {
				ctx.ui.notify("No conversation to hand off", "error");
				return;
			}

			// Convert to LLM format and serialize
			const llmMessages = convertToLlm(messages);
			const conversationText = serializeConversation(llmMessages);
			log(`conversationText length: ${conversationText.length} chars`);
			const currentSessionFile = ctx.sessionManager.getSessionFile();

			// Generate the handoff prompt with loader UI.
			// Returns null on user abort, a string on success, or an Error on failure.
			const result = await ctx.ui.custom<string | null | Error>((tui, theme, _kb, done) => {
				const loader = new BorderedLoader(tui, theme, `Generating handoff prompt...`);
				loader.onAbort = () => done(null);

				const doGenerate = async () => {
					const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model!);
					log(`auth ok: ${auth.ok}, hasApiKey: ${auth.ok ? !!auth.apiKey : false}`);
					if (!auth.ok || !auth.apiKey) {
						throw new Error(auth.ok ? `No API key for ${ctx.model!.provider}` : auth.error);
					}

					const userMessage: Message = {
						role: "user",
						content: [
							{
								type: "text",
								text: `## Conversation History\n\n${conversationText}\n\n## User's Goal for New Thread\n\n${goal}`,
							},
						],
						timestamp: Date.now(),
					};

					log(`complete() call starting, model: ${JSON.stringify(ctx.model)}`);
					const response = await complete(
						ctx.model!,
						{ systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
						{
							apiKey: auth.apiKey,
							headers: auth.headers,
							env: auth.env,
							signal: loader.signal,
							cacheRetention: "none",
							sessionId: uuidv7(),
						},
					);

					log(`complete() done: stopReason=${response.stopReason}, contentParts=${response.content.length}`);
					log(`content types: ${response.content.map((c: any) => c.type).join(", ")}`);

					if (response.stopReason === "aborted") {
						return null;
					}

					const text = response.content
						.filter((c): c is { type: "text"; text: string } => c.type === "text")
						.map((c) => c.text)
						.join("\n");
					log(`extracted text length: ${text.length}`);
					return text;
				};

				doGenerate()
					.then(done)
					.catch((err: unknown) => {
						log(`generation error: ${err instanceof Error ? err.message : String(err)}`);
						// Pass the error out so it can be surfaced after the TUI closes,
						// rather than writing to console.error inside a live TUI render.
						done(err instanceof Error ? err : new Error(String(err)));
					});

				return loader;
			});

			if (result instanceof Error) {
				log(`surfacing error to user: ${result.message}`);
				ctx.ui.notify(`Handoff failed: ${result.message}`, "error");
				return;
			}

			if (result === null) {
				ctx.ui.notify("Cancelled", "info");
				return;
			}

			// Guard against empty model output before opening the editor.
			if (result.trim() === "") {
				log(`model returned empty output`);
				ctx.ui.notify("Model returned empty output — try again", "error");
				return;
			}

			// Let user edit the generated prompt
			const editedPrompt = await ctx.ui.editor("Edit handoff prompt", result);

			if (editedPrompt === undefined) {
				ctx.ui.notify("Cancelled", "info");
				return;
			}

			// Create new session with parent tracking. Use the replacement-session
			// context for post-switch UI work; the original ctx is stale after a
			// successful session replacement.
			const newSessionResult = await ctx.newSession({
				parentSession: currentSessionFile,
				withSession: async (replacementCtx) => {
					replacementCtx.ui.setEditorText(editedPrompt);
					replacementCtx.ui.notify("Handoff ready. Submit when ready.", "info");
				},
			});

			if (newSessionResult.cancelled) {
				ctx.ui.notify("New session cancelled", "info");
			}
		},
	});
}
