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
import * as os from "node:os";
import * as path from "node:path";
import { getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type DirProvidersConfig, loadConfig } from "./config.js";
import { parseModelRef, resolveProfile } from "./match.js";

const PREFIX = "[dir-providers]";

// Verbose startup diagnostics. Off by default to keep startup quiet; the
// equivalent info is surfaced in the TUI instead. Set PI_DIR_PROVIDERS_DEBUG=1
// to write diagnostics to $TMPDIR/ar-llm/dir-providers.log (never stderr,
// matching the pi-custom-compaction extension).
const DEBUG = process.env.PI_DIR_PROVIDERS_DEBUG === "1" || process.env.PI_DIR_PROVIDERS_DEBUG === "true";
const AR_LLM_TMP = path.join(os.tmpdir(), "ar-llm");
const DEBUG_LOG = path.join(AR_LLM_TMP, "dir-providers.log");

function log(msg: string) {
	if (!DEBUG) return;
	fs.mkdirSync(AR_LLM_TMP, { recursive: true });
	fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
}

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
// Disable marker file
// ============================================================

/** Check for .pi-dir-providers-disable in cwd or any parent directory. */
function hasDisableMarker(cwd: string): boolean {
	const marker = ".pi-dir-providers-disable";
	let dir = cwd;
	while (dir !== path.parse(dir).root) {
		if (fs.existsSync(path.join(dir, marker))) return true;
		dir = path.dirname(dir);
	}
	return false;
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
	// starts, where they are invisible).  In debug mode, mirror them to the
	// debug log file (`PI_DIR_PROVIDERS_DEBUG=1`); nothing goes to stderr.
	console.warn = (msg?: unknown) => {
		CONFIG_WARNINGS.push(String(msg));
		if (DEBUG) log(String(msg));
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
	const disabledByMarker = hasDisableMarker(process.cwd());

	if (disabledByMarker && DEBUG) {
		log(`${PREFIX} Disabled by marker file in ${process.cwd()}`);
	}

	if (active && !disabledByMarker) {
		const known = enumerateKnownProviders();

		for (const id of profile.allowedProviders ?? []) {
			if (!known.has(id)) {
				const msg = `${PREFIX} Unknown provider "${id}" in allowedProviders; check for typos.`;
				CONFIG_WARNINGS.push(msg);
				if (DEBUG) log(msg);
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
					const msg = `${PREFIX} Failed to hide provider "${id}": ${err instanceof Error ? err.message : String(err)}`;
					CONFIG_WARNINGS.push(msg);
					if (DEBUG) log(msg);
				}
			}
		}

		// Apply provider overrides (baseUrl/headers/...) from matching rules.
		for (const [id, override] of Object.entries(profile.providerOverrides)) {
			try {
				pi.registerProvider(id, override);
			} catch (err) {
				const msg = `${PREFIX} Failed to apply override for provider "${id}": ${err instanceof Error ? err.message : String(err)}`;
				CONFIG_WARNINGS.push(msg);
				if (DEBUG) log(msg);
			}
		}

		if (DEBUG) {
			log(
				`${PREFIX} Active in ${process.cwd()}: rules ${profile.matchedRules.join(", ")}, ` +
					`allowed [${(profile.allowedProviders ?? []).join(", ") || "unrestricted"}]` +
					(profile.allowedProviders ? `, hid ${hiddenCount} providers` : "") +
					(profile.defaultModel ? `, default ${profile.defaultModel}` : ""),
			);
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		// Surface config-loading warnings in the TUI. They are captured (not
		// printed to stderr) at startup, where they would be invisible once the
		// TUI takes over; `PI_DIR_PROVIDERS_DEBUG=1` also writes them to the debug
		// log file. Surface them regardless of whether the current
		// directory matches a rule, so config typos are never silently dropped.
		if (CONFIG_WARNINGS.length > 0) {
			ctx.ui.notify(`${PREFIX} Config warnings:\n${CONFIG_WARNINGS.join("\n")}`, "warning");
		}

		if (!active || disabledByMarker) return;

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
			if (hasDisableMarker(ctx.cwd)) {
				ctx.ui.notify("dir-providers: disabled by .pi-dir-providers-disable marker file", "info");
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
