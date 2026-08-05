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
 * Uses ctx.modelRegistry.runtime.complete() (the coding-agent's internal
 * ModelRuntime) instead of the deprecated @earendel-works/pi-ai/compat
 * complete(), so that custom providers (e.g. github-copilot) are properly
 * routed and auth is resolved internally via prepareRequest().
 *
 * Debug: set PI_CUSTOM_COMPACTION_DEBUG=1 to log to $TMPDIR/ar-llm/custom-compaction.log
 *
 * Usage:
 *   pi --extension examples/extensions/custom-compaction.ts
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { uuidv7 } from "@earendel-works/pi-ai";
import type { ExtensionAPI } from "@earendel-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendel-works/pi-coding-agent";

// ============================================================
// Configuration types
// ============================================================

interface RequestParamsConfig {
  providers: Record<string, {
    [key: string]: unknown;
    default?: Record<string, unknown>;
    models?: Record<string, { default?: Record<string, unknown> }>;
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

  // Resolve request params — keyed by provider name (not model ID) to match
  // the config structure used by pi-skill-request-params and the README.
  const requestParams = resolveRequestParamsForProvider(sessionProvider, providerConfig);

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

/**
 * Resolve per-provider/per-model request params from the config.
 *
 * Config structure (mirrors pi-skill-request-params):
 *   request-params.providers.<providerName>
 *     ├── default:          { ... }      — provider-wide base params
 *     └── models.<modelId>
 *         └── default:      { ... }      — model-specific refinement
 *
 * Returns {} when no request-params are configured for this provider.
 */
function resolveRequestParamsForProvider(
  sessionProvider: string,
  providerConfig: ProviderConfig,
): Record<string, unknown> {
  const rpCfg = providerConfig["request-params"];
  if (!rpCfg) return {};

  const providerCfg = rpCfg.providers?.[sessionProvider];
  if (!providerCfg) return {};

  // Extract provider-level default params (non-models, non-default keys)
  const { models, default: modelDefault, ...flatParams } = providerCfg;
  // Extract model-specific default params
  const modelParams = models?.[providerConfig.model ?? ""]?.default ?? {};
  return Object.assign({}, flatParams, modelDefault, modelParams);
}

// ============================================================
// Debug logging
// ============================================================

const DEBUG = process.env.PI_CUSTOM_COMPACTION_DEBUG === "1" || process.env.PI_CUSTOM_COMPACTION_DEBUG === "true";
const AR_LLM_TMP = path.join(os.tmpdir(), "ar-llm");
const DEBUG_LOG = path.join(AR_LLM_TMP, "custom-compaction.log");

function log(msg: string) {
  if (!DEBUG) return;
  fs.mkdirSync(AR_LLM_TMP, { recursive: true });
  fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
}

// ============================================================
// Extension entry point
// ============================================================

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
    log(`Found model: ${model.provider}/${model.id}, api: ${model.api}, baseUrl: ${model.baseUrl}`);

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

		// Build messages for the LLM call
		const summaryMessages = [
			{
				role: "user" as const,
				content: [
					{
						type: "text" as const,
						text: userPrompt,
					},
				],
				timestamp: Date.now(),
			},
		];

		try {
			// Use ctx.modelRegistry.runtime (the coding-agent's internal ModelRuntime)
			// instead of the compat complete(), which only knows about builtin providers
			// and returns stopReason=error for any custom provider.
			//
			// IMPORTANT: do NOT pre-resolve auth and pass apiKey/headers here.
			// runtime.complete() resolves auth internally via prepareRequest(),
			// which also applies the subscription-aware baseUrl (e.g. business vs
			// individual github-copilot endpoints). Passing an explicit apiKey
			// short-circuits that and can cause 421 Misdirected Request on
			// business/enterprise subscriptions.
			const runtime = (ctx.modelRegistry as any).runtime;
			log(`Calling runtime.complete() with model: ${model.provider}/${model.id}`);

			const response = await runtime.complete(
				model,
				{
					systemPrompt: resolvedConfig.prompt.system,
					messages: summaryMessages,
				},
				{
					...resolvedConfig.requestParams,
					maxTokens: 8192,
					signal,
					cacheRetention: "none",
					sessionId: uuidv7(),
					// Disable thinking: compaction summarization is a simple text task
					// and adaptive/budget thinking causes errors on providers that
					// don't support it (e.g. github-copilot).
					thinkingEnabled: false,
				},
			);

			log(`runtime.complete() done: stopReason=${response.stopReason}, contentParts=${response.content?.length ?? 'N/A'}`);
			log(`content types: ${response.content?.map((c: any) => c.type).join(", ") ?? 'N/A'}`);

			// Check for API-level errors (model not found, auth issues, etc.)
			if (response.stopReason === "error") {
				const errMsg = response.errorMessage ?? response.error ?? "Unknown error";
				log(`Model returned error: ${errMsg}`);
				ctx.ui.notify(`Compaction model error: ${errMsg}, using default compaction`, "warning");
				return;
			}

			if (response.stopReason === "aborted") {
				log("Compaction was aborted");
				return;
			}

			const summary = response.content
				.filter((c: any): c is { type: "text"; text: string } => c.type === "text")
				.map((c: any) => c.text)
				.join("\n");

			log(`Summary length: ${summary.length}, trimmed: ${summary.trim().length}`);
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
					usage: response.usage,
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log(`Compaction error: ${message}`);
			ctx.ui.notify(`Compaction failed: ${message}`, "error");
			// Fall back to default compaction on error
			return;
		}
	});
}
