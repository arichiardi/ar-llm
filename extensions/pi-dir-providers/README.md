# @ar-llm/pi-dir-providers

[![npm](https://img.shields.io/npm/v/@ar-llm/pi-dir-providers)](https://www.npmjs.com/package/@ar-llm/pi-dir-providers) [![Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](./LICENSE)

Pi extension that scopes which providers are visible in `/model` based on the
working directory. In `~/git` you may only want `anthropic` and `openrouter` —
`github-copilot` and everything else disappear from model
selection entirely.

## Install

```bash
pi install 'npm:@ar-llm/pi-dir-providers'
```

Or try without installing:

```bash
pi -e 'npm:@ar-llm/pi-dir-providers'
```

## Config

Create `<agentDir>/ar-llm/dir-providers.json` (same convention as
`pi-custom-compaction`; `<agentDir>` is `$PI_CODING_AGENT_DIR` or
`~/.config/pi/agent`):

```json
{
  "rules": [
    {
      "dirs": ["~/git"],
      "allowedProviders": ["anthropic", "openrouter"],
      "defaultModel": "anthropic/claude-sonnet-4-5"
    },
    {
      "dirs": ["~/git/acme-corp", "~/work/acme-corp"],
      "allowedProviders": ["anthropic"],
      "providers": {
        "anthropic": { "baseUrl": "https://anthropic-proxy.acme.com/v1" }
      }
    }
  ]
}
```

### Rule ordering (important!)

Rules are applied **strictly in array order** — not by specificity. Every rule
whose `dirs` match the current working directory applies; for `allowedProviders`
and `defaultModel`, **the last matching rule wins** (its value replaces any
earlier rule's value). The `providers` field is different: overrides from all
matching rules are **merged** together per provider id.

> **You must order rules from least specific to most specific.** Put the broadest
> directory rules first and the narrowest (most specific) directory rules last.
> If you reverse this order, a generic rule will silently override a specific
> one. For example, with rules `[{dirs: ["~/git/managing-construction"], allowedProviders: ["github-copilot"]}, {dirs: ["~/git"], allowedProviders: ["openrouter"]}]`, running in
> `~/git/managing-construction/gossamer` matches **both** rules, and the second
> rule's `openrouter` wins — `github-copilot` gets hidden. The correct order is
> to swap them so `~/git` comes first and `~/git/managing-construction` comes
> second.

- `dirs`: list of directory subtrees. A leading `~` is expanded; a directory
  matches when the cwd equals it or is inside it (subdirectories inherit their
  ancestor's rules; a more-specific rule then overrides on top). Directory
  paths are symlink-resolved, so `/tmp` on macOS (which resolves to
  `/private/tmp`) matches the physical cwd. Nonexistent or inaccessible
  directories warn at startup and match as-is; point the rule at the real
  resolved path.
- `allowedProviders`: **replaces** the effective set of visible providers.
  Providers outside the set are hidden from `/model` (their models are removed
  for the session; auth/`/login` state is untouched).
- `defaultModel`: `"provider/model-id"` applied to fresh sessions when the
  current model differs. Skipped when `--model`/`--provider` was passed on the
  command line. Note that switching the model persists the choice to
  `settings.json`, exactly like picking a model manually in `/model`.
- `providers`: per-provider overrides with `models.json` override semantics
  (e.g. `baseUrl`, `headers`), merged across matching rules per provider id.

If no rule matches, the extension does nothing.

## How it works

Hiding happens at extension-factory time — before pi selects the initial
model
— by registering a `models: []` overlay on each disallowed provider via
`pi.registerProvider()`. This goes through pi's normal provider-composition
path and is **in-memory only**: nothing on disk is touched, and `/reload` or a
new pi process restores the default provider set.

Provider overrides (`baseUrl`, `headers`, extra fields, `models`) are applied
the same way — as a `registerProvider` overlay — and are therefore also
in-memory and reversible. A `models` field in an override replaces the
provider's model set (like `models.json`), whereas an override object without
`models` only tweaks connection fields and keeps the provider's existing models.

## Validation

- Missing config file, invalid JSON, or a missing `rules` array disable the
  extension (it stays a no-op).
- Per-rule problems (empty `dirs`, relative dirs, duplicate dirs across rules,
  nonexistent dirs, malformed `defaultModel`, `defaultModel` provider not in
  the rule's `allowedProviders`) produce warnings and skip the offending part.
- Unknown provider ids in `allowedProviders` warn at startup; check actual ids
  with `pi --list-models`.
- If a later rule's directory is a **parent** of an earlier rule's directory (i.e.
  the broad rule appears after the narrow one), a warning is emitted at startup:
  the parent rule's `allowedProviders`/`defaultModel` will silently override the
  child rule's, and reordering is needed to fix it.

## Commands

- `/dir-providers` — print the effective profile for the current directory:
  matched rule indices, allowed providers, default model, and merged provider
  overrides. A startup log line on stderr (`[dir-providers] Active in <cwd>:`)
  is also emitted whenever the extension is active — the quickest way to
  confirm it loaded.

  Config-loading warnings (nonexistent/inaccessible dirs, unknown providers,
  rule shadowing) are also surfaced as a TUI notification at `session_start`,
  since the stderr output alone may not be visible once the TUI is running.

## Development

```bash
make typecheck   # type-check source + tests
make test        # run unit tests (26 checks across match.ts and config.ts)
make test-watch  # same as `make test` but re-runs on file changes
```

Tests use Node.js's built-in `node:test` runtime — no external test runner
is required (Node ≥ 22.6). The `test/` directory contains a small ESM loader
(`loader.mjs` + `register.mjs`) that maps NodeNext-style `.js` imports
to their `.ts` source files so they can be imported without a build step.

## Limitations

- Providers registered by *other* extensions are not enumerated and cannot be
  hidden.
- Directory globs are not supported; use explicit directory subtrees.
- The profile is computed once per pi process from the startup cwd.

## License

[The Unlicense](./LICENSE) — public domain. Original work.
