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
 * Provider-aware configuration:
 * Each session provider can specify its own compaction model, request params,
 * and prompts. If a provider has "enabled": false, compaction is skipped and Pi falls back to default compaction.
 *
 * Usage:
 *   pi --extension examples/extensions/custom-compaction.ts
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { complete } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";

// ============================================================
// Configuration types
// ============================================================

interface RequestParamsConfig {
  providers: Record<string, {
    [key: string]: unknown;
    models?: Record<string, Record<string, unknown>>;
  }>;
}

interface PromptConfig {
  system: string;
  user: string;
  includePreviousSummary: boolean;
}

interface ProviderConfig {
  enabled?: boolean;
  model?: string;
  "request-params"?: RequestParamsConfig;
  prompt?: PromptConfig;
}

interface CompactionConfig {
  defaultPrompt?: PromptConfig;
  providers: Record<string, ProviderConfig>;
}

// ============================================================
// Built-in defaults
// ============================================================

const DEFAULT_PROMPT: PromptConfig = {
  system: "You are a conversation summarizer. Create a comprehensive summary that captures all information needed to continue the work effectively.",
  user: `Summarize this conversation with clear sections covering:\n\n1. Main goals and objectives discussed\n2. Key decisions made and their rationale\n3. Important code changes, file modifications, or technical details\n4. Current state of any ongoing work\n5. Any blockers, issues, or open questions\n6. Next steps that were planned or suggested\n\nBe thorough but concise. This summary will replace the ENTIRE conversation history.\n\nFormat as structured markdown with clear sections.{previous_summary}\n<conversation>\n{conversation}\n</conversation>`,
  includePreviousSummary: true,
};

// ============================================================
// Config loading
// ============================================================

function resolveConfigDir(): string {
  return process.env.PI_CODING_AGENT_DIR
    || path.join(os.homedir(), ".config", "pi", "agent");
}

/**
 * Resolves the effective config for a given session provider.
 * Returns null if no config exists for this provider, or if compaction
 * is explicitly disabled.
 */
function loadConfig(sessionProvider: string): {
  compactionProvider: string;
  compactionModelId: string;
  requestParams: Record<string, unknown>;
  prompt: PromptConfig;
} | null {
  const dir = resolveConfigDir();
  const filePath = path.join(dir, "ar-llm", "custom-compaction.json");

  if (!fs.existsSync(filePath)) {
    console.error(
      `[custom-compaction] Config file not found at ${filePath}.\n` +
      `Custom compaction will be skipped. Create the file to enable it.`
    );
    return null;
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed: CompactionConfig = JSON.parse(raw);

  if (!parsed.providers) {
    console.error(
      `[custom-compaction] Config missing "providers" object in ${filePath}.\n` +
      `Custom compaction will be skipped.`
    );
    return null;
  }

  const providerConfig = parsed.providers[sessionProvider];
  if (!providerConfig) {
    console.error(
      `[custom-compaction] No config for provider "${sessionProvider}" in ${filePath}.\n` +
      `Custom compaction will be skipped.`
    );
    return null;
  }

  if (providerConfig.enabled === false) {
    log(`Provider "${sessionProvider}" has custom compaction disabled (enabled: false).`);
    return null;
  }

  if (!providerConfig.model) {
    console.error(
      `[custom-compaction] Provider "${sessionProvider}" missing "model" in ${filePath}.\n` +
      `Custom compaction will be skipped.`
    );
    return null;
  }

  // The compaction model is looked up within the session's provider catalog
  const compactionModel = { provider: sessionProvider, id: providerConfig.model };

  // Resolve request params
  const requestParams = resolveRequestParamsForProvider(providerConfig);

  // Resolve prompt: provider-specific prompt overrides defaultPrompt, which
  // overrides built-in defaults
  const prompt = providerConfig.prompt ?? parsed.defaultPrompt ?? DEFAULT_PROMPT;

  return {
    compactionProvider: compactionModel.provider,
    compactionModelId: compactionModel.id,
    requestParams,
    prompt,
  };
}

function resolveRequestParamsForProvider(providerConfig: ProviderConfig): Record<string, unknown> {
  const rpCfg = providerConfig["request-params"];
  if (!rpCfg || !providerConfig.model) return {};

  const providerCfg = rpCfg.providers?.[providerConfig.model];
  if (!providerCfg) return {};

  // Extract non-"models" keys as provider-level params
  const { models, ...providerParams } = providerCfg;
  const modelParams = providerCfg.models?.[providerConfig.model] ?? {};
  return Object.assign({}, providerParams, modelParams);
}

// ============================================================
// Debug logging
// ============================================================

const DEBUG = false;
const AR_LLM_TMP = path.join(os.tmpdir(), "ar-llm");
const DEBUG_LOG = path.join(AR_LLM_TMP, "custom-compaction.log");

function log(msg: string) {
  if (!DEBUG) return;
  fs.mkdirSync(AR_LLM_TMP, { recursive: true });
  fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_before_compact", async (event, ctx) => {
    // Determine session provider from ctx.model
    if (!ctx.model) {
      log("No model in context, skipping custom compaction.");
      return;
    }

    const sessionProvider = ctx.model.provider as string;
    const resolvedConfig = loadConfig(sessionProvider);

    // No config for this provider — skip custom compaction, let pi use default compaction
    if (!resolvedConfig) {
      return;
    }

		ctx.ui.notify("Custom compaction extension triggered", "info");
    log("session_before_compact triggered");

		const { preparation, branchEntries: _, signal } = event;
		const { messagesToSummarize, turnPrefixMessages, tokensBefore, firstKeptEntryId, previousSummary } = preparation;
    log(`messagesToSummarize: ${messagesToSummarize.length}, turnPrefixMessages: ${turnPrefixMessages.length}, tokensBefore: ${tokensBefore}`);
    log(`firstKeptEntryId: ${JSON.stringify(firstKeptEntryId)}, previousSummary length: ${previousSummary?.length ?? 'none'}`);

		const model = ctx.modelRegistry.find(resolvedConfig.compactionProvider, resolvedConfig.compactionModelId);
		if (!model) {
			log(`Model not found: ${resolvedConfig.compactionProvider}/${resolvedConfig.compactionModelId}`);
			ctx.ui.notify(`Could not find compaction model ${resolvedConfig.compactionProvider}/${resolvedConfig.compactionModelId}, using default compaction`, "warning");
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

		// Build prompt from config template
		let previousContext = "";
		if (resolvedConfig.prompt.includePreviousSummary && previousSummary) {
			previousContext = `\n\nPrevious session summary for context:\n${previousSummary}`;
		}
		const userPrompt = resolvedConfig.prompt.user
			.replace("{previous_summary}", previousContext)
			.replace("{conversation}", conversationText);

		// Build messages that ask for a comprehensive summary
		const summaryMessages = [
			{
				role: "user" as const,
				content: [
					{
						type: "text" as const,
						text: `${resolvedConfig.prompt.system}\n\n${userPrompt}`,
					},
				],
				timestamp: Date.now(),
			},
		];

		try {
			// Pass signal to honor abort requests (e.g., user cancels compaction)
			const effectiveParams = {
				...resolvedConfig.requestParams,
				apiKey: auth.apiKey,
				headers: auth.headers,
				maxTokens: 8192,
				signal,
			};

			const response = await complete(
				model,
				{ messages: summaryMessages },
				effectiveParams,
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
