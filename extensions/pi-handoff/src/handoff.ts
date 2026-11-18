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
 *
 * Config file (optional): ~/.config/pi/agent/ar-llm/handoff.json
 * Selects the model that summarizes the handoff, keyed by the active session
 * provider. Each provider typically points at a cheaper model than the active
 * session model. A provider with no entry falls back to the active session
 * model.
 *
 * Example:
 *   {
 *     "providers": {
 *       "github-copilot": {
 *         "model": "claude-haiku-4-5",
 *         "compat": { "forceAdaptiveThinking": false }
 *       },
 *       "llama.cpp": {
 *         "model": "Qwen3.8-27B",
 *         "compat": {
 *           "supportsStore": false,
 *           "supportsDeveloperRole": false,
 *           "supportsReasoningEffort": false,
 *           "supportsUsageInStreaming": true,
 *           "supportsStrictMode": false,
 *           "maxTokensField": "max_tokens"
 *         }
 *       }
 *     },
 *     "system-prompt": "Custom summarization prompt..."
 *   }
 *
 * Compatibility flags depend on the model's API. forceAdaptiveThinking only
 * applies to Anthropic Messages-compatible models.
 *
 * Debug logging: set PI_HANDOFF_DEBUG=1 to log to $TMPDIR/ar-llm/pi-handoff.log
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { uuidv7 } from "@earendil-works/pi-ai";
import type { Message } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { BorderedLoader, convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

// ============================================================
// Configuration types
// ============================================================

/** Config for a single provider, keyed by the active session provider. */
export interface ProviderConfig {
	/** Model id to use for handoff summarization within this provider. */
	model?: string;
	/** Compatibility overrides applied to the selected model. */
	compat?: Record<string, unknown>;
}

export interface HandoffConfig {
	/** Per-provider handoff settings, keyed by session provider. */
	providers?: Record<string, ProviderConfig>;
	/** Override the system prompt used for summarization. */
	"system-prompt"?: string;
}

// ============================================================
// Config loading
// ============================================================

function resolveConfigDir(): string {
	return process.env.PI_CODING_AGENT_DIR
		|| path.join(os.homedir(), ".config", "pi", "agent");
}

export function loadConfig(): HandoffConfig | null {
	const dir = resolveConfigDir();
	const filePath = path.join(dir, "ar-llm", "handoff.json");

	if (!fs.existsSync(filePath)) {
		return null;
	}

	const raw = fs.readFileSync(filePath, "utf-8");
	const parsed = JSON.parse(raw) as HandoffConfig & { provider?: unknown };
	if (parsed.provider && !parsed.providers) {
		log('legacy "provider" config shape ignored; rename it to "providers" and add a "model" field');
	}
	return parsed;
}

/** The handoff model resolved for one session provider. */
export interface ResolvedProviderConfig {
	provider: string;
	model: string;
	compat: Record<string, unknown>;
}

/**
 * Resolve the handoff config for the active session provider. Returns null when
 * the config has no entry for that provider, in which case the caller falls
 * back to the active session model.
 */
export function resolveProviderConfig(
	config: HandoffConfig | null,
	sessionProvider: string,
): ResolvedProviderConfig | null {
	const entry = config?.providers?.[sessionProvider];
	if (!entry?.model) {
		return null;
	}
	return {
		provider: sessionProvider,
		model: entry.model,
		compat: entry.compat ?? {},
	};
}

// ============================================================
// Debug logging
// ============================================================

const DEBUG = process.env.PI_HANDOFF_DEBUG === "1" || process.env.PI_HANDOFF_DEBUG === "true";
const AR_LLM_TMP = path.join(os.tmpdir(), "ar-llm");
const DEBUG_LOG = path.join(AR_LLM_TMP, "pi-handoff.log");

function log(msg: string) {
	if (!DEBUG) return;
	fs.mkdirSync(AR_LLM_TMP, { recursive: true });
	fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
}

// ============================================================
// Loaded config
// ============================================================

let CONFIG: HandoffConfig | null = null;
try {
	CONFIG = loadConfig();
} catch (err: any) {
	// Log to file only, not console (console output appears in terminal even during TUI)
	log(`Failed to load config: ${err.message}`);
}

// ============================================================
// Default system prompt
// ============================================================

const DEFAULT_SYSTEM_PROMPT = `You are a context transfer assistant. Given a conversation history and the user's goal for a new thread, generate a focused prompt that:

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

const SYSTEM_PROMPT = CONFIG?.["system-prompt"] ?? DEFAULT_SYSTEM_PROMPT;

// ============================================================
// Session entry helpers
// ============================================================

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

// ============================================================
// Extension entry point
// ============================================================

export default function (pi: ExtensionAPI) {
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

			// Resolve the summarizer for the active session provider. Config is
			// optional: when the provider has an entry, use its model (typically a
			// cheaper one); otherwise fall back to the active session model.
			const resolved = resolveProviderConfig(CONFIG, ctx.model.provider);

			let handoffModel = ctx.model;
			if (resolved) {
				const configured = ctx.modelRegistry.find(resolved.provider, resolved.model);
				if (configured) {
					handoffModel = configured;
				} else {
					// Model not found (removed/unregistered or name changed).
					// Silently fall back to active session model instead of blocking.
					log(`Configured handoff model ${resolved.provider}/${resolved.model} not found; using active session model`);
				}
			}
			const compatOverride = resolved?.compat ?? {};
			log(
				`handoff model: ${handoffModel.provider}/${handoffModel.id} (${resolved ? "configured" : "active session model"}), compatOverride: ${JSON.stringify(compatOverride)}`,
			);

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
			const loaderMsg = handoffModel.id !== ctx.model.id
				? `Generating handoff prompt (via ${handoffModel.name})...`
				: `Generating handoff prompt...`;

			const result = await ctx.ui.custom<string | null | Error>((tui, theme, _kb, done) => {
				const loader = new BorderedLoader(tui, theme, loaderMsg);
				loader.onAbort = () => done(null);

				const doGenerate = async () => {
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

					// Use modelRegistry's internal runtime.complete() so that custom
					// providers (e.g. github-copilot) are properly routed. The compat
					// complete() only knows about builtin providers and returns
					// stopReason=error for any custom provider.
					//
					// IMPORTANT: do NOT pre-resolve auth and pass apiKey/headers here.
					// runtime.complete() resolves auth internally via prepareRequest(),
					// which also applies the subscription-aware baseUrl (e.g. business vs
					// individual github-copilot endpoints). Passing an explicit apiKey
					// short-circuits that and causes 421 Misdirected Request on
					// business/enterprise Copilot subscriptions.
					log(`complete() call starting, model: ${handoffModel.id} provider: ${handoffModel.provider}`);
					const runtime = (ctx.modelRegistry as any).runtime;
					// Apply per-model compat override from config, if any.
					const handoffModelForCall = {
						...handoffModel,
						compat: {
							...(handoffModel as any).compat,
							...compatOverride,
						},
					};
					const response = await runtime.complete(
						handoffModelForCall,
						{ systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
						{
							signal: loader.signal,
							cacheRetention: "none",
							sessionId: uuidv7(),
							// Disable thinking: handoff summarization is a simple text task
							// and adaptive/budget thinking causes errors on providers that
							// don't support it (e.g. github-copilot).
							thinkingEnabled: false,
						},
					);

					log(`complete() done: stopReason=${response.stopReason}, contentParts=${response.content.length}`);
					log(`content types: ${response.content.map((c: any) => c.type).join(", ")}`);

					if (response.stopReason === "error") {
						const errDetail =
							(response as any).error ??
							(response as any).errorMessage ??
							(response as any).message ??
							JSON.stringify(response);
						throw new Error(`Provider returned error: ${errDetail}`);
					}

					if (response.stopReason === "aborted") {
						return null;
					}

					const text = response.content
						.filter((c: any): c is { type: "text"; text: string } => c.type === "text")
						.map((c: any) => c.text)
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
			log(`opening editor with ${result.length} chars`);
			let editedPrompt: string;
			try {
				editedPrompt = await ctx.ui.editor("Edit handoff prompt", result);
				log(`editor returned ${editedPrompt.length} chars`);
			} catch (err: any) {
				log(`editor error: ${err.message}`);
				log(`editor stack: ${err.stack}`);
				ctx.ui.notify(`Handoff editor failed: ${err.message}`, "error");
				return;
			}

			if (editedPrompt === undefined) {
				log(`editor cancelled`);
				ctx.ui.notify("Cancelled", "info");
				return;
			}

			log(`creating new session`);

			// Suppress console.warn/console.error during newSession(). pi's core code
			// emits "Warning:" messages to stderr during session creation (resource
			// loading, model resolution) which appear in the TUI as transient noise.
			const origWarn = console.warn;
			const origError = console.error;
			console.warn = (...args: unknown[]) => log(`suppressed warn: ${args.join(" ")}`);
			console.error = (...args: unknown[]) => log(`suppressed error: ${args.join(" ")}`);

			try {
				// Create new session with parent tracking. Use the replacement-session
				// context for post-switch UI work; the original ctx is stale after a
				// successful session replacement.
				const newSessionResult = await ctx.newSession({
					parentSession: currentSessionFile,
					withSession: async (replacementCtx) => {
						log(`withSession callback starting`);
						try {
							replacementCtx.ui.notify("Handoff ready.", "info");
                            // Directly queue the message to bypass the onInputCallback race
                            // that can require two Enter presses (old agent.run() hasn't
                            // completed yet, so onInputCallback isn't set and text goes to
                            // pendingUserInputs).
                            await replacementCtx.sendUserMessage(editedPrompt);
							log(`withSession callback complete`);
						} catch (err: any) {
							log(`withSession error: ${err.message}`);
							log(`withSession stack: ${err.stack}`);
							throw err;
						}
					},
				});

				if (newSessionResult.cancelled) {
					log(`new session cancelled`);
					ctx.ui.notify("New session cancelled", "info");
				} else {
					log(`new session created successfully`);
				}
			} catch (err: any) {
				log(`newSession error: ${err.message}`);
				log(`newSession stack: ${err.stack}`);
				ctx.ui.notify(`Handoff session creation failed: ${err.message}`, "error");
				return;
			} finally {
				console.warn = origWarn;
				console.error = origError;
			}
		},
	});
}
