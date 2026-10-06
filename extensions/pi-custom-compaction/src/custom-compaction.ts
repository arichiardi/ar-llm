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
 * Chunking:
 * When the compaction model is smaller than the conversation, a provider can
 * opt into map-reduce summarization with a "chunking" block. The extension
 * splits the transcript into batches, summarizes each batch, then merges the
 * partial summaries. Absent the block, the single-shot behavior is unchanged.
 *
 * Uses ctx.modelRegistry.runtime.complete() (the coding-agent's internal
 * ModelRuntime) instead of the deprecated @earendil-works/pi-ai/compat
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
import { uuidv7, type Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import { computeChunkBudget, estimateTextTokens, splitPieces } from "./chunking.js";

// ============================================================
// Configuration types
// ============================================================

interface PromptConfig {
  system: string;
  user: string;
  includePreviousSummary: boolean;
}

interface ProviderConfig {
  enabled?: boolean;
  model?: string;
  /**
   * Maximum tokens the model may generate for the summary. The preferred name
   * for the response ceiling. It overrides the deprecated
   * `stream-options.maxTokens`.
   */
  "max-output-tokens"?: number;
  /**
   * pi `StreamOptions` fields, merged over the built-in defaults:
   * `maxTokens`, `temperature`, `cacheRetention`, `thinkingEnabled`, ...
   *
   * The name matches what `runtime.complete(model, context, options)` takes:
   * `ModelsApiStreamOptions<TApi>`, which extends `StreamOptions`.
   */
  "stream-options"?: Record<string, unknown>;
  /**
   * Raw provider request-body parameters, forwarded as `StreamOptions.samplingParams`:
   * `top_p`, `top_k`, `min_p`, `repetition_penalty`, `chat_template_kwargs`, ...
   *
   * pi merges these into the request body after the named fields, so they win.
   * Only OpenAI-compatible adapters read them (completions, responses, Azure responses).
   *
   * `temperature` is also accepted here, even though it is a pi parameter.
   * The extension copies it into `streamOptions`, so every API honours it.
   */
  "request-params"?: Record<string, unknown>;
  prompt?: PromptConfig;
  /**
   * Map-reduce summarization for compaction models whose context is smaller
   * than the conversation. Absent means single-shot summarization.
   */
  chunking?: ChunkingConfig;
}

interface ChunkingConfig {
  /** The model's true usable context per request. Overrides the model metadata. */
  "context-window": number;
  /** Headroom for estimator error. Default 512. */
  "safety-tokens"?: number;
  /** Messages repeated from the tail of one chunk at the start of the next. Default 0. */
  "overlap-messages"?: number;
  /** Maximum reduce layers before the extension falls back. Default 4. */
  "max-depth"?: number;
  /** Prompt for the merge step. Falls back to a built-in merge prompt. */
  "chunking-prompt"?: PromptConfig;
}

interface ResolvedChunking {
  contextWindow: number;
  safetyTokens: number;
  overlapMessages: number;
  maxDepth: number;
  chunkingPrompt: PromptConfig;
}

interface CompactionConfig {
  "default-prompts"?: PromptConfig;
  providers: Record<string, ProviderConfig>;
}

export interface ResolvedConfig {
  compactionProvider: string;
  compactionModelId: string;
  streamOptions: Record<string, unknown>;
  requestParams: Record<string, unknown>;
  prompt: PromptConfig;
  chunking: ResolvedChunking | null;
}

// ============================================================
// Built-in defaults
// ============================================================

/** Default response ceiling for the summarization call. */
const DEFAULT_MAX_TOKENS = 8192;

const DEFAULT_PROMPT: PromptConfig = {
  system: "You are a conversation summarizer. Create a comprehensive summary that captures all information needed to continue the work effectively.",
  user: `Summarize this conversation with clear sections covering:\n\n1. Main goals and objectives discussed\n2. Key decisions made and their rationale\n3. Important code changes, file modifications, or technical details\n4. Current state of any ongoing work\n5. Any blockers, issues, or open questions\n6. Next steps that were planned or suggested\n\nBe thorough but concise. This summary will replace the ENTIRE conversation history.\n\nFormat as structured markdown with clear sections.{previous_summary}\n<conversation>\n{conversation}\n</conversation>`,
  includePreviousSummary: true,
};

const DEFAULT_CHUNKING_PROMPT: PromptConfig = {
  system: "You are a conversation summarizer. You receive partial summaries of a single long conversation. Merge them into one coherent summary.",
  user: `Merge these partial summaries into a single structured summary. Remove duplication, keep every important detail, and preserve ordering.\n{previous_summary}<partial-summaries>\n{conversation}\n</partial-summaries>`,
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
export function loadConfig(sessionProvider: string): ResolvedConfig | null {
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

  if ("defaultPrompt" in parsed) {
    console.error(
      `[custom-compaction] "defaultPrompt" in ${filePath} is no longer supported. ` +
      `Rename it to "default-prompts".`
    );
  }

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

  const legacyWarning = detectLegacyRequestParams(providerConfig);
  if (legacyWarning) {
    console.error(`[custom-compaction] Provider "${sessionProvider}" in ${filePath}: ${legacyWarning}`);
  }

  // The compaction model is looked up within the session's provider catalog
  const compactionModel = { provider: sessionProvider, id: providerConfig.model };

  const requestParams = { ...(providerConfig["request-params"] ?? {}) };
  const streamOptions = { ...(providerConfig["stream-options"] ?? {}) };

  // v0.4.x tolerance: drop the obsolete provider wrapper and lift maxTokens
  // into the stream options. The extension logs a warning for both.
  // Forwarding them would send junk keys into the provider request body.
  delete requestParams.providers;
  if (requestParams.maxTokens !== undefined) {
    streamOptions.maxTokens = requestParams.maxTokens;
    delete requestParams.maxTokens;
  }

  // "request-params.temperature" is an accepted alias for the pi option
  // "temperature". Adapters that ignore samplingParams (Anthropic, Google)
  // would otherwise drop it. The raw key stays in request-params, so
  // OpenAI-compatible adapters receive the same value in the body.
  // request-params wins over stream-options, matching pi's samplingParams rule.
  if (requestParams.temperature !== undefined) {
    streamOptions.temperature = requestParams.temperature;
  }

  // "max-output-tokens" is the preferred name for the summary ceiling. It
  // overrides the deprecated "stream-options.maxTokens", and the legacy
  // "request-params.maxTokens", which the block above lifted into streamOptions.
  const maxOutputTokens = providerConfig["max-output-tokens"];
  if (maxOutputTokens !== undefined) {
    if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) {
      console.error(
        `[custom-compaction] Provider "${sessionProvider}" has invalid "max-output-tokens" ` +
        `(${String(maxOutputTokens)}). Expected a positive integer. It was ignored.`
      );
    } else {
      if (streamOptions.maxTokens !== undefined) {
        console.error(
          `[custom-compaction] Provider "${sessionProvider}" sets both "max-output-tokens" ` +
          `and "stream-options.maxTokens". "max-output-tokens" wins.`
        );
      }
      streamOptions.maxTokens = maxOutputTokens;
    }
  } else if (streamOptions.maxTokens !== undefined) {
    console.error(
      `[custom-compaction] Provider "${sessionProvider}": "stream-options.maxTokens" is ` +
      `deprecated. Rename it to "max-output-tokens".`
    );
  }

  // Resolve prompt: provider-specific prompt overrides default-prompts, which
  // overrides built-in defaults
  const prompt = providerConfig.prompt ?? parsed["default-prompts"] ?? DEFAULT_PROMPT;

  const chunking = resolveChunking(sessionProvider, providerConfig);

  return {
    compactionProvider: compactionModel.provider,
    compactionModelId: compactionModel.id,
    streamOptions,
    requestParams,
    prompt,
    chunking,
  };
}

/**
 * Resolves the optional chunking config. Returns null when chunking is off or
 * misconfigured, so the caller keeps the single-shot behavior.
 */
function resolveChunking(
  sessionProvider: string,
  providerConfig: ProviderConfig,
): ResolvedChunking | null {
  const raw = providerConfig.chunking;
  if (!raw) return null;

  const contextWindow = raw["context-window"];
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) {
    console.error(
      `[custom-compaction] Provider "${sessionProvider}": "chunking.context-window" must be ` +
      `a positive integer. Chunking was disabled.`
    );
    return null;
  }

  const safetyTokens = raw["safety-tokens"] ?? 512;
  const overlapMessages = raw["overlap-messages"] ?? 0;
  const maxDepth = raw["max-depth"] ?? 4;

  for (const [field, value] of [
    ["safety-tokens", safetyTokens],
    ["overlap-messages", overlapMessages],
    ["max-depth", maxDepth],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      console.error(
        `[custom-compaction] Provider "${sessionProvider}": "chunking.${field}" must be a ` +
        `non-negative integer. Chunking was disabled.`
      );
      return null;
    }
  }

  const configuredPrompt = raw["chunking-prompt"];
  const chunkingPrompt =
    configuredPrompt && typeof configuredPrompt.system === "string" && typeof configuredPrompt.user === "string"
      ? configuredPrompt
      : DEFAULT_CHUNKING_PROMPT;
  if (configuredPrompt && chunkingPrompt === DEFAULT_CHUNKING_PROMPT) {
    console.error(
      `[custom-compaction] Provider "${sessionProvider}": "chunking.chunking-prompt" needs string ` +
      `"system" and "user" fields. The built-in prompt was used.`
    );
  }

  return {
    contextWindow,
    safetyTokens,
    overlapMessages,
    maxDepth,
    chunkingPrompt,
  };
}

/**
 * Detects config shapes from v0.4.x and earlier.
 *
 * Returns a human-readable message, or null when the config is up to date.
 */
function detectLegacyRequestParams(
  providerConfig: ProviderConfig,
): string | null {
  const requestParams = providerConfig["request-params"];
  if (!requestParams) return null;

  if (typeof requestParams.providers === "object" && requestParams.providers !== null) {
    return '"request-params.providers" is no longer supported and was ignored. ' +
      'Put the request parameters directly under "request-params".';
  }

  if ("maxTokens" in requestParams) {
    return '"maxTokens" is a pi parameter, not a request parameter. ' +
      'The extension moved it to "stream-options".';
  }

  return null;
}

// ============================================================
// Prompt and budget helpers
// ============================================================

/** Fills the prompt template, adding the previous summary when configured. */
function buildUserPrompt(
  prompt: PromptConfig,
  conversation: string,
  previousSummary: string | undefined,
): string {
  let previousContext = "";
  if (prompt.includePreviousSummary && previousSummary) {
    previousContext = `\n\nPrevious session summary for context:\n${previousSummary}`;
  }
  return prompt.user
    .replace("{previous_summary}", previousContext)
    .replace("{conversation}", conversation);
}

/** Tokens consumed by the prompt scaffolding, excluding the conversation. */
function promptOverheadTokens(prompt: PromptConfig): number {
  return estimateTextTokens(prompt.system) + estimateTextTokens(buildUserPrompt(prompt, "", undefined));
}

/**
 * Resolves the response ceiling, ignoring an impossible value. A response
 * ceiling at or above the chunking context window leaves no room to read the
 * conversation, so the built-in default wins.
 */
function resolveResponseTokens(config: ResolvedConfig, modelId: string): number {
  const configured = config.streamOptions.maxTokens;
  const responseTokens =
    typeof configured === "number" && Number.isSafeInteger(configured) && configured > 0
      ? configured
      : DEFAULT_MAX_TOKENS;

  const chunking = config.chunking;
  if (chunking && responseTokens >= chunking.contextWindow) {
    log(
      `${modelId}: max-output-tokens ${responseTokens} leaves no room in context-window ` +
      `${chunking.contextWindow}; using ${DEFAULT_MAX_TOKENS}.`
    );
    return DEFAULT_MAX_TOKENS;
  }
  return responseTokens;
}

/** Sums two provider usages, keeping the optional splits. Mirrors pi's combineUsage. */
function combineUsages(first: Usage, second: Usage): Usage {
  return {
    input: first.input + second.input,
    output: first.output + second.output,
    cacheRead: first.cacheRead + second.cacheRead,
    cacheWrite: first.cacheWrite + second.cacheWrite,
    ...(first.cacheWrite1h !== undefined || second.cacheWrite1h !== undefined
      ? { cacheWrite1h: (first.cacheWrite1h ?? 0) + (second.cacheWrite1h ?? 0) }
      : {}),
    ...(first.reasoning !== undefined || second.reasoning !== undefined
      ? { reasoning: (first.reasoning ?? 0) + (second.reasoning ?? 0) }
      : {}),
    totalTokens: first.totalTokens + second.totalTokens,
    cost: {
      input: first.cost.input + second.cost.input,
      output: first.cost.output + second.cost.output,
      cacheRead: first.cost.cacheRead + second.cost.cacheRead,
      cacheWrite: first.cost.cacheWrite + second.cost.cacheWrite,
      total: first.cost.total + second.cost.total,
    },
  };
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

type CallResult =
  | { ok: true; text: string; usage: Usage }
  | { ok: false; reason: "error" | "aborted" | "empty"; message?: string };

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

		const { preparation, signal } = event;
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
    log(`stream-options (defaults resolved): ${JSON.stringify(resolvedConfig.streamOptions)}`);
    log(`request-params (samplingParams): ${JSON.stringify(resolvedConfig.requestParams)}`);

		// Combine all messages for full summary, then serialize one piece per
		// message so chunking can split at message boundaries.
		const allMessages = [...messagesToSummarize, ...turnPrefixMessages];
		const pieces = convertToLlm(allMessages)
			.map((message) => serializeConversation([message]))
			.filter((text) => text.length > 0);
		const conversationText = pieces.join("\n\n");

		ctx.ui.notify(
			`Custom compaction: summarizing ${allMessages.length} messages (${tokensBefore.toLocaleString()} tokens) with ${model.id}...`,
			"info",
		);

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
		const responseTokens = resolveResponseTokens(resolvedConfig, model.id);
		const chunking = resolvedConfig.chunking;

		let totalUsage: Usage | undefined;
		const addUsage = (usage: Usage | undefined) => {
			if (!usage) return;
			totalUsage = totalUsage === undefined ? usage : combineUsages(totalUsage, usage);
		};

		const callModel = async (systemPrompt: string, userPrompt: string): Promise<CallResult> => {
			log(`Calling runtime.complete() with model: ${model.provider}/${model.id}`);
			const response = await runtime.complete(
				model,
				{
					systemPrompt,
					messages: [
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
					],
				},
				{
					// Built-in defaults, overridable via "stream-options".
					cacheRetention: "none",
					// Disable thinking: compaction summarization is a simple text task
					// and adaptive/budget thinking causes errors on providers that
					// don't support it (e.g. github-copilot).
					thinkingEnabled: false,
					...resolvedConfig.streamOptions,
					// Fixed internals, never overridable.
					maxTokens: responseTokens,
					signal,
					sessionId: uuidv7(),
					// Raw provider request-body parameters.
					samplingParams: resolvedConfig.requestParams,
				},
			);

			log(`runtime.complete() done: stopReason=${response.stopReason}, contentParts=${response.content?.length ?? 'N/A'}`);

			if (response.stopReason === "error") {
				const errMsg = response.errorMessage ?? response.error ?? "Unknown error";
				return { ok: false, reason: "error", message: errMsg };
			}

			if (response.stopReason === "aborted") {
				return { ok: false, reason: "aborted" };
			}

			const summary = response.content
				.filter((c: any): c is { type: "text"; text: string } => c.type === "text")
				.map((c: any) => c.text)
				.join("\n");

			if (!summary.trim()) {
				return { ok: false, reason: "empty" };
			}

			return { ok: true, text: summary, usage: response.usage };
		};

		const fail = (result: Extract<CallResult, { ok: false }>): undefined => {
			if (result.reason === "aborted") {
				log("Compaction was aborted");
				return;
			}
			if (result.reason === "empty") {
				if (!signal.aborted) ctx.ui.notify("Compaction summary was empty, using default compaction", "warning");
				return;
			}
			log(`Model returned error: ${result.message}`);
			ctx.ui.notify(`Compaction model error: ${result.message}, using default compaction`, "warning");
			return;
		};

		const finalize = (result: CallResult) => {
			if (!result.ok) return fail(result);
			addUsage(result.usage);
			log(`Summary length: ${result.text.length}, trimmed: ${result.text.trim().length}`);
			log(`Summary preview: ${result.text.substring(0, 500)}`);
			log(`Returning compaction: summaryLen=${result.text.length}, firstKeptEntryId=${JSON.stringify(firstKeptEntryId)}, tokensBefore=${tokensBefore}`);
			return {
				compaction: {
					summary: result.text,
					firstKeptEntryId,
					tokensBefore,
					usage: totalUsage,
				},
			};
		};

		try {
			const mapBudget = chunking
				? computeChunkBudget({
						contextWindow: chunking.contextWindow,
						responseTokens,
						overheadTokens: promptOverheadTokens(resolvedConfig.prompt),
						safetyTokens: chunking.safetyTokens,
					})
				: Number.POSITIVE_INFINITY;

			if (chunking && mapBudget <= 0) {
				log(`Chunked compaction: budget ${mapBudget} <= 0, falling back.`);
				ctx.ui.notify(
					`Compaction chunking budget is not positive, using default compaction`,
					"warning",
				);
				return;
			}

			// Single-shot when there is no chunking config, or the transcript plus
			// the previous summary fit the budget.
			const previousSummaryTokens = previousSummary ? estimateTextTokens(previousSummary) : 0;
			const singleBudget = chunking ? mapBudget - previousSummaryTokens : Number.POSITIVE_INFINITY;
			if (!chunking || estimateTextTokens(conversationText) <= singleBudget) {
				log(`Single-shot compaction: conversationTokens=${estimateTextTokens(conversationText)}, budget=${singleBudget}`);
				const userPrompt = buildUserPrompt(resolvedConfig.prompt, conversationText, previousSummary);
				return finalize(await callModel(resolvedConfig.prompt.system, userPrompt));
			}

			// Map phase: one summary per chunk that fits the model.
			const mapTexts = splitPieces(pieces, mapBudget, chunking.overlapMessages);
			log(`Chunked compaction: ${mapTexts.length} map chunks, budget ${mapBudget}`);
			ctx.ui.notify(
				`Custom compaction: transcript exceeds ${model.id} context, summarizing in ${mapTexts.length} chunks...`,
				"info",
			);

			let partials: string[] = [];
			for (const text of mapTexts) {
				if (signal.aborted) return;
				const result = await callModel(
					resolvedConfig.prompt.system,
					buildUserPrompt(resolvedConfig.prompt, text, undefined),
				);
				if (!result.ok) return fail(result);
				addUsage(result.usage);
				partials.push(result.text);
			}

			// Reduce phase: pack partial summaries until one remains.
			const reduceBudget = computeChunkBudget({
				contextWindow: chunking.contextWindow,
				responseTokens,
				overheadTokens: promptOverheadTokens(chunking.chunkingPrompt),
				safetyTokens: chunking.safetyTokens,
			});
			if (reduceBudget <= 0) {
				log(`Chunked compaction: reduce budget ${reduceBudget} <= 0, falling back.`);
				ctx.ui.notify("Compaction reduce budget is not positive, using default compaction", "warning");
				return;
			}

			let depth = 0;
			while (partials.length > 1) {
				if (depth >= chunking.maxDepth) {
					log(`Chunked compaction: max-depth ${chunking.maxDepth} reached with ${partials.length} partials, falling back.`);
					ctx.ui.notify("Compaction chunking exceeded max-depth, using default compaction", "warning");
					return;
				}
				depth += 1;
				const batches = splitPieces(partials, reduceBudget, 0);
				const next: string[] = [];
				for (const batch of batches) {
					if (signal.aborted) return;
					const result = await callModel(
						chunking.chunkingPrompt.system,
						buildUserPrompt(chunking.chunkingPrompt, batch, undefined),
					);
					if (!result.ok) return fail(result);
					addUsage(result.usage);
					next.push(result.text);
				}
				partials = next;
			}

			// Final merge with the previous summary, when it fits.
			let summary = partials[0];
			if (chunking.chunkingPrompt.includePreviousSummary && previousSummary) {
				if (reduceBudget - previousSummaryTokens > estimateTextTokens(summary)) {
					const result = await callModel(
						chunking.chunkingPrompt.system,
						buildUserPrompt(chunking.chunkingPrompt, summary, previousSummary),
					);
					if (!result.ok) return fail(result);
					addUsage(result.usage);
					summary = result.text;
				} else {
					log("Chunked compaction: previous summary does not fit the final merge, dropped.");
				}
			}

			log(`Returning chunked compaction: summaryLen=${summary.length}, depth=${depth}`);
			return {
				compaction: {
					summary,
					firstKeptEntryId,
					tokensBefore,
					usage: totalUsage,
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
