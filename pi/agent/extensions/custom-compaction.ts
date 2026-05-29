/**
 * Custom Compaction Extension
 *
 * Original source: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/custom-compaction.ts
 * Modified by Andrea Richiardi
 *
 * This is free and unencumbered software released into the public domain.
 *
 * Anyone is free to copy, modify, publish, use, compile, sell, or
 * distribute this software, either in source code form or as a compiled
 * binary, for any purpose, commercial or non-commercial, and by any
 * means.
 *
 * In jurisdictions that recognize copyright laws, the author or authors
 * of this software dedicate any and all copyright interest in the
 * software to the public domain. We make this dedication for the benefit
 * of the public at large and to the detriment of our heirs and
 * successors. We intend this dedication to be an overt act of
 * relinquishment in favor of the public domain.
 *
 * The software is provided "as is", without warranty of any kind.
 * See <https://unlicense.org> for details.
 */

/**
 * Replaces the default compaction behavior with a full summary of the entire context.
 * Instead of keeping the last 20k tokens of conversation turns, this extension:
 * 1. Summarizes ALL messages (messagesToSummarize + turnPrefixMessages)
 * 2. Discards all old turns completely, keeping only the summary
 *
 * This example also demonstrates using a different model for summarization,
 * which can be cheaper/faster than the main conversation model.
 *
 * Usage:
 *   pi --extension examples/extensions/custom-compaction.ts
 */

import * as fs from "fs";
import { complete } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

// ============================================================
// Configuration
// ============================================================

/** Compaction model provider and model ID — change these to use a different summarization model. */
const COMPACTION_PROVIDER = "github-copilot";
const COMPACTION_MODEL = "gpt-5.4-mini";

/** Set to false to disable debug logging to /tmp/custom-compaction-debug.log */
const DEBUG = false;
const DEBUG_LOG = "/tmp/custom-compaction-debug.log";
function log(msg: string) {
  if (DEBUG) {
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
  }
}

export default function (pi: ExtensionAPI) {
	pi.on("session_before_compact", async (event, ctx) => {
		ctx.ui.notify("Custom compaction extension triggered", "info");
        log("session_before_compact triggered");

		const { preparation, branchEntries: _, signal } = event;
		const { messagesToSummarize, turnPrefixMessages, tokensBefore, firstKeptEntryId, previousSummary } = preparation;
        log(`messagesToSummarize: ${messagesToSummarize.length}, turnPrefixMessages: ${turnPrefixMessages.length}, tokensBefore: ${tokensBefore}`);
        log(`firstKeptEntryId: ${JSON.stringify(firstKeptEntryId)}, previousSummary length: ${previousSummary?.length ?? 'none'}`);

		const model = ctx.modelRegistry.find(COMPACTION_PROVIDER, COMPACTION_MODEL);
		if (!model) {
			log(`Model not found: ${COMPACTION_PROVIDER}/${COMPACTION_MODEL}`);
			ctx.ui.notify(`Could not find Gemini Flash model, using default compaction`, "warning");
			return;
		}
        log(`Found model: ${model.provider}/${model.id}`);

		// Resolve request auth for the summarization model
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) {
			log(`Auth failed: ${auth.error}`);
			ctx.ui.notify(`Compaction auth failed: ${auth.error}`, "warning");
			return;
		}
		if (!auth.apiKey) {
			log(`No API key for ${model.provider}`);
			ctx.ui.notify(`No API key for ${model.provider}, using default compaction`, "warning");
			return;
		}
        log(`Auth OK, apiKey present: ${!!auth.apiKey}, headers: ${JSON.stringify(Object.keys(auth.headers || {}))}`);

		// Combine all messages for full summary
		const allMessages = [...messagesToSummarize, ...turnPrefixMessages];

		ctx.ui.notify(
			`Custom compaction: summarizing ${allMessages.length} messages (${tokensBefore.toLocaleString()} tokens) with ${model.id}...`,
			"info",
		);

		// Convert messages to readable text format
		const conversationText = serializeConversation(convertToLlm(allMessages));

		// Include previous summary context if available
		const previousContext = previousSummary ? `\n\nPrevious session summary for context:\n${previousSummary}` : "";

		// Build messages that ask for a comprehensive summary
		const summaryMessages = [
			{
				role: "user" as const,
				content: [
					{
						type: "text" as const,
						text: `You are a conversation summarizer. Create a comprehensive summary of this conversation that captures:${previousContext}

1. The main goals and objectives discussed
2. Key decisions made and most importantly their rationale
3. Important code changes, file modifications, or technical details
4. Current state of any ongoing work
5. Any blockers, issues, or open questions
6. Next steps that were planned or suggested

Be thorough but concise. The summary will replace the ENTIRE conversation history, so include all information needed to continue the work effectively.

Format the summary as structured markdown with clear sections.

<conversation>
${conversationText}
</conversation>`,
					},
				],
				timestamp: Date.now(),
			},
		];

		try {
			// Pass signal to honor abort requests (e.g., user cancels compaction)
			const response = await complete(
				model,
				{ messages: summaryMessages },
				{
					apiKey: auth.apiKey,
					headers: auth.headers,
					maxTokens: 8192,
					signal,
				},
			);
			// Check for API-level errors (model not found, auth issues, etc.)
			if ((response as any).stopReason === "error" || (response as any).errorMessage) {
				const errMsg = (response as any).errorMessage ?? "Unknown error";
				log(`Model returned error: ${errMsg}`);
				ctx.ui.notify(`Compaction model error: ${errMsg}, using default compaction`, "warning");
				return;
			}

			// Debug: inspect raw response structure
			log(`Response keys: ${JSON.stringify(Object.keys(response))}`);
			log(`Full response JSON: ${JSON.stringify(response, null, 2).substring(0, 5000)}`);
			if (response.content) {
				log(`Content array length: ${response.content.length}`);
				response.content.forEach((c: any, i: number) => {
					log(`  content[${i}]: type=${c.type}, keys=${JSON.stringify(Object.keys(c))}, textLen=${c.text?.length ?? 'N/A'}`);
				});
			} else {
				log(`response.content is ${response.content}`);
			}

			const summary = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n");

			log(`Summary length: ${summary.length}, trimmed length: ${summary.trim().length}`);
			log(`Summary preview: ${summary.substring(0, 500)}`);

			if (!summary.trim()) {
				if (!signal.aborted) ctx.ui.notify("Compaction summary was empty, using default compaction", "warning");
				return;
			}

			log(`Returning compaction: summaryLen=${summary.length}, firstKeptEntryId=${JSON.stringify(firstKeptEntryId)}, tokensBefore=${tokensBefore}`);

			// Return compaction content - SessionManager adds id/parentId
			// Use firstKeptEntryId from preparation to keep recent messages
			return {
				compaction: {
					summary,
					firstKeptEntryId,
					tokensBefore,
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Compaction failed: ${message}`, "error");
			// Fall back to default compaction on error
			return;
		}
	});
}
