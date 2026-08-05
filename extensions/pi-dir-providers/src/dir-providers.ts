/**
 * Dir Providers Extension
 *
 * Scopes the providers visible in /model based on the working directory.
 *
 * Config: <agentDir>/ar-llm/dir-providers.json (see README.md).
 *
 * How it works:
 * - At extension-factory time (before pi picks the initial model), providers
 *   not in the effective allowedProviders set are hidden by registering a
 *   `models: []` overlay on them. This uses pi's regular provider-composition
 *   path and is in-memory only: a new process or /reload restores everything.
 * - Provider overrides (baseUrl/headers/...) from matching rules are applied
 *   with the same semantics as models.json provider overrides.
 * - defaultModel is enforced at session_start for fresh sessions only, and
 *   skipped when --model/--provider was passed on the command line.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type DirProvidersConfig, loadConfig } from "./config.js";
import { parseModelRef, resolveProfile } from "./match.js";

const PREFIX = "[dir-providers]";

// ============================================================
// Provider enumeration
// ============================================================

/** Builtin provider ids plus provider ids declared in models.json. */
function enumerateKnownProviders(): Set<string> {
	const known = new Set<string>(getBuiltinProviders());
	try {
		// Use pi's own agent dir so we read the same models.json that pi reads.
		const modelsPath = path.join(getAgentDir(), "models.json");
		if (fs.existsSync(modelsPath)) {
			const parsed: unknown = JSON.parse(fs.readFileSync(modelsPath, "utf-8"));
			if (
				typeof parsed === "object" &&
				parsed !== null &&
				"providers" in parsed &&
				typeof (parsed as { providers?: unknown }).providers === "object" &&
				(parsed as { providers?: unknown }).providers !== null
			) {
				for (const id of Object.keys((parsed as { providers: Record<string, unknown> }).providers)) {
					known.add(id);
				}
			}
		}
	} catch {
		// models.json is optional; enumeration falls back to builtins.
	}
	return known;
}

function hasCliModelOverride(): boolean {
	return process.argv.includes("--model") || process.argv.includes("--provider");
}

// ============================================================
// Config loading (fail open, like pi-custom-compaction)
// ============================================================

let CONFIG: DirProvidersConfig | null = null;
const CONFIG_WARNINGS: string[] = [];
const origWarn = console.warn;
try {
	// Capture warnings emitted during config loading so they can be surfaced
	// in the TUI (they would otherwise only appear on stderr before the TUI
	// starts, where they are invisible).  We still forward to stderr for
	// headless / non-TUI runs.
	console.warn = (msg?: unknown, ...rest: unknown[]) => {
		CONFIG_WARNINGS.push(String(msg));
		origWarn(msg, ...rest);
	};
	CONFIG = loadConfig();
	console.warn = origWarn;
} catch (err) {
	console.warn = origWarn;
	console.error(err instanceof Error ? err.message : String(err));
	console.error(`${PREFIX} Extension disabled due to config error.`);
}

// ============================================================
// Extension
// ============================================================

export default function (pi: ExtensionAPI) {
	if (!CONFIG) return;

	const profile = resolveProfile(process.cwd(), CONFIG.rules);
	const active = profile.matchedRules.length > 0;

	if (active) {
		const known = enumerateKnownProviders();

		for (const id of profile.allowedProviders ?? []) {
			if (!known.has(id)) {
				console.warn(`${PREFIX} Unknown provider "${id}" in allowedProviders; check for typos.`);
			}
		}

		// Hide every provider outside the allowed set with an empty-models
		// overlay. Auth/login behavior of the hidden providers is preserved,
		// and the overlay disappears on /reload or process restart.
		let hiddenCount = 0;
		if (profile.allowedProviders) {
			const allowed = new Set(profile.allowedProviders);
			for (const id of known) {
				if (allowed.has(id)) continue;
				try {
					pi.registerProvider(id, { models: [] });
					hiddenCount++;
				} catch (err) {
					console.warn(`${PREFIX} Failed to hide provider "${id}": ${err instanceof Error ? err.message : String(err)}`);
				}
			}
		}

		// Apply provider overrides (baseUrl/headers/...) from matching rules.
		for (const [id, override] of Object.entries(profile.providerOverrides)) {
			try {
				pi.registerProvider(id, override);
			} catch (err) {
				console.warn(
					`${PREFIX} Failed to apply override for provider "${id}": ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}

		console.error(
			`${PREFIX} Active in ${process.cwd()}: rules ${profile.matchedRules.join(", ")}, ` +
				`allowed [${(profile.allowedProviders ?? []).join(", ") || "unrestricted"}]` +
				(profile.allowedProviders ? `, hid ${hiddenCount} providers` : "") +
				(profile.defaultModel ? `, default ${profile.defaultModel}` : ""),
		);
	}

	pi.on("session_start", async (_event, ctx) => {
		if (!active) return;

		// Surface config-loading warnings in the TUI.  They were also printed
		// to stderr at startup, but before the TUI begins — where they are
		// invisible.
		if (CONFIG_WARNINGS.length > 0) {
			ctx.ui.notify(`${PREFIX} Config warnings:\n${CONFIG_WARNINGS.join("\n")}`, "warning");
		}

		ctx.ui.setStatus(
			"dir-providers",
			profile.allowedProviders ? `providers: ${profile.allowedProviders.join(", ")}` : "providers: unrestricted",
		);

		// Enforce defaultModel only for fresh sessions without a CLI override.
		if (!profile.defaultModel) return;
		if (hasCliModelOverride()) return;
		if (ctx.sessionManager.getBranch().some((entry) => entry.type === "message")) return;

		const ref = parseModelRef(profile.defaultModel);
		if (!ref) return;

		const current = ctx.model;
		if (current && current.provider === ref.provider && current.id === ref.modelId) return;

		const model = ctx.modelRegistry.find(ref.provider, ref.modelId);
		if (!model) {
			ctx.ui.notify(`dir-providers: default model ${profile.defaultModel} not found`, "warning");
			return;
		}

		const ok = await pi.setModel(model);
		if (ok) {
			ctx.ui.notify(`dir-providers: using ${profile.defaultModel} for this directory`, "info");
		} else {
			ctx.ui.notify(`dir-providers: cannot switch to ${profile.defaultModel} (missing API key?)`, "warning");
		}
	});

	pi.registerCommand("dir-providers", {
		description: "Show the effective dir-providers profile for the current directory",
		handler: async (_args, ctx) => {
			const current = resolveProfile(ctx.cwd, CONFIG?.rules ?? []);
			if (current.matchedRules.length === 0) {
				ctx.ui.notify("dir-providers: no rules match this directory", "info");
				return;
			}
			const lines = [
				`dir-providers profile for ${ctx.cwd}`,
				`Matched rules: ${current.matchedRules.join(", ")}`,
				`Allowed providers: ${current.allowedProviders ? current.allowedProviders.join(", ") : "(unrestricted)"}`,
				`Default model: ${current.defaultModel ?? "(none)"}`,
				`Provider overrides: ${Object.keys(current.providerOverrides).join(", ") || "(none)"}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
