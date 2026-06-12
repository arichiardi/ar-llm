/**
 * org-roam-memory — Ambient memory injection for pi
 *
 * Injects org-roam context into the system prompt before each agent turn:
 * - Entry node neighborhood (identity, relationships)
 * - Open TODO items
 * - Recent journal entries (decrypted via epa-file)
 * - Recent modifications
 *
 * On-demand operations (search, retrieve, links, graph, create, journal)
 * are handled by the org-roam-adhoc-memory skill via bash scripts.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ─── Debug Logging ────────────────────────────────────────────────────────
// Set ORG_ROAM_PI_MEMORY_DEBUG=true to log to configured debug file
// Also enabled automatically if config.json has debug section
let DEBUG_LOG = "/tmp/org-roam-pi-memory-debug.log";
let DEBUG = process.env.ORG_ROAM_PI_MEMORY_DEBUG === "true";

function dbg(msg: string) {
  if (DEBUG) {
    fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] [ts] ${msg}\n`);
  }
}

// ─── Config ────────────────────────────────────────────────────────────────

interface OrgRoamMemoryConfig {
  "prompt-file": string;
  "debug": { "log-file": string; "context-file": string };
}

const DEFAULT_CONFIG: OrgRoamMemoryConfig = {
  "prompt-file": "~/.pi/agent/org-roam-memory/prompt.md",
  "debug": {
    "log-file": "/tmp/org-roam-pi-memory-debug.log",
    "context-file": "/tmp/org-roam-pi-memory-context.log",
  },
};

function expandTilde(path: string): string {
  const home = process.env.HOME || homedir();
  return path.replace(/^~/, home);
}

function resolveConfigDir(): string {
  const base = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return join(base, "org-roam-memory");
}

function loadConfig(): OrgRoamMemoryConfig {
  const configPath = join(resolveConfigDir(), "config.json");
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    const debugCfg = parsed["debug"] || {};
    const logFile = expandTilde(debugCfg["log-file"] || DEFAULT_CONFIG["debug"]["log-file"]);
    const ctxFile = expandTilde(debugCfg["context-file"] || DEFAULT_CONFIG["debug"]["context-file"]);
    DEBUG_LOG = logFile;
    // Enable debug if env var is set OR config has debug section
    DEBUG = process.env.ORG_ROAM_PI_MEMORY_DEBUG === "true" || Object.keys(debugCfg).length > 0;
    dbg(`Config loaded from ${configPath}, debug=${logFile}, context=${ctxFile}`);
    return {
      "prompt-file": parsed["prompt-file"] || DEFAULT_CONFIG["prompt-file"],
      "debug": { "log-file": logFile, "context-file": ctxFile },
    };
  } catch (err) {
    dbg(`Config load failed: ${err}`);
    console.error(`org-roam-memory: Failed to load config: ${err}`);
    return { ...DEFAULT_CONFIG };
  }
}

// ─── Emacs/Elisp Query Layer ──────────────────────────────────────────────

function buildBootstrap(configJsonPath: string, cfg: OrgRoamMemoryConfig): string {
  const debugLog = cfg["debug"]["log-file"];
  const contextLog = cfg["debug"]["context-file"];
  return `(progn
  (add-to-list 'load-path "${__dirname}")
  (require 'org)
  (load (expand-file-name "org-roam-pi-memory" (car load-path)) nil t)
  (org-roam-pi-apply-config "${configJsonPath}")
  (org-roam-pi-set-debug-logs "${debugLog}" "${contextLog}"))`;
}

let currentConfig: OrgRoamMemoryConfig = DEFAULT_CONFIG;

async function elispEval<T>(
  pi: ExtensionAPI,
  elisp: string,
  timeout = 30000
): Promise<T | null> {
  const configPath = join(resolveConfigDir(), "config.json");
  const fullElisp = `(progn ${buildBootstrap(configPath, currentConfig)} ${elisp})`;
  dbg(`emacsclient: ${elisp.substring(0, 120)}`);

  const result = await pi.exec("emacsclient", ["--eval", fullElisp], { timeout });
  const rawStdout = result.stdout?.trim() || "";
  const rawStderr = result.stderr?.trim() || "";
  
  if (result.code !== 0) {
    dbg(`emacsclient error code=${result.code}`);
    dbg(`stderr (${rawStderr.length} chars)`);
    dbg(`stdout (${rawStdout.length} chars)`);
    console.error(`org-roam-memory: emacsclient error (code=${result.code})`);
    if (rawStderr) console.error(`stderr: ${rawStderr}`);
    if (rawStdout) console.error(`stdout: ${rawStdout}`);
    return null;
  }

  const output = rawStdout;
  dbg(`emacsclient stdout (${output.length} chars): ${output.substring(0, 200)}`);
  if (!output || output.startsWith("*ERROR*")) {
    dbg(`elisp error or empty output`);
    console.error(`org-roam-memory: Elisp error (stdout_len=${output.length}, stderr_len=${rawStderr.length})`);
    if (output) console.error(`  stdout: ${output}`);
    if (rawStderr) console.error(`  stderr: ${rawStderr}`);
    if (!output && !rawStderr) console.error(`  (both empty)`);
    return null;
  }

  const unquoted = output.replace(/^"|"$/g, "").replace(/\\"/g, '"');
  try {
    const parsed = JSON.parse(unquoted) as T;
    dbg(`parsed OK`);
    return parsed;
  } catch {
    dbg(`JSON parse failed`);
    console.error(`org-roam-memory: JSON parse error: ${output}`);
    return null;
  }
}

// ─── Snapshot Management ──────────────────────────────────────────────────

class MemorySnapshot {
  private cached: string | null = null;

  async get(pi: ExtensionAPI, forceRebuild = false): Promise<string> {
    if (!forceRebuild && this.cached !== null) {
      dbg(`Snapshot cache hit`);
      return this.cached;
    }
    dbg(`Snapshot cache miss, building context...`);

    const result = await elispEval<{ context: string; chars: number }>(
      pi, `(org-roam-pi-memory-context)`
    );

    if (!result || "error" in result) {
      dbg(`Context build failed: ${JSON.stringify(result)}`);
      console.error(`org-roam-memory: Context build failed (result=${JSON.stringify(result)})`);
      return "";
    }

    this.cached = result.context;
    dbg(`Context built: ${result.chars} chars`);
    return result.context;
  }

  invalidate() {
    dbg(`Snapshot invalidated`);
    this.cached = null;
  }
}

// ─── Extension Entry Point ────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  currentConfig = loadConfig();
  const snapshot = new MemorySnapshot();
  dbg(`Extension initialized`);

  // ── Ambient Context Injection ──────────────────────────────────────────

  pi.on("session_start", () => {
    dbg(`session_start`);
    snapshot.invalidate();
  });
  pi.on("session_before_compact", () => {
    dbg(`session_before_compact`);
    snapshot.invalidate();
  });

  pi.on("before_agent_start", async (event) => {
    dbg(`before_agent_start`);
    try {
      const context = await snapshot.get(pi);
      if (!context) { dbg(`no context`); return; }

      let promptText = "";
      const promptPath = expandTilde(currentConfig["prompt-file"]);
      if (existsSync(promptPath)) {
        promptText = readFileSync(promptPath, "utf8");
      }

      dbg(`Injected ${promptText.length + context.length} chars into system prompt`);
      return {
        systemPrompt: event.systemPrompt + "\n\n" + promptText + "\n\n" + context,
      };
    } catch (err) {
      dbg(`Context injection failed: ${err}`);
      console.error(`org-roam-memory: Failed to inject context: ${err}`);
    }
  });

  pi.on("resources_discover", () => {
    dbg(`resources_discover`);
    currentConfig = loadConfig();
    snapshot.invalidate();
  });

  // ── Debug Command ──────────────────────────────────────────────────────

  pi.registerCommand("org-roam-memory", {
    description: "Show current org-roam memory snapshot",
    handler: async (_args, ctx) => {
      try {
        const context = await snapshot.get(pi, true);
        if (!context) {
          ctx.ui.notify("No memory context loaded", "warning");
          return;
        }
        ctx.ui.setWidget(
          "org-roam-memory",
          [
            `--- Org-Roam Memory Snapshot (${context.length} chars) ---`,
            ...context.split("\n").slice(0, 50),
            context.split("\n").length > 50 ? "... (truncated)" : "",
            "Press Escape to close",
          ],
          "top"
        );
      } catch (err) {
        ctx.ui.notify(`org-roam-memory: ${err}`, "error");
      }
    },
  });
}
