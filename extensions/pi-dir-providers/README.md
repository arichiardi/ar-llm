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

### Rule semantics

- Rules are applied **in array order, from less generic to more specific**.
  Every rule whose `dirs` match the current working directory applies; later
  rules override earlier ones.
- `dirs`: list of directory subtrees. A leading `~` is expanded; a directory
  matches when the cwd equals it or is inside it (subdirectories inherit their
  ancestor's rules; a more-specific rule then overrides on top). Directory
  paths are symlink-resolved, so `/tmp` on macOS (which resolves to
  `/private/tmp`) matches the physical cwd. Nonexistent directories warn at
  startup and match as-is; point the rule at the real resolved path.
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

A directory may appear in more than one rule; all matching rules apply in
order and the later one takes precedence. config warns once about such overlap
so accidental shadowing is visible.

## Commands

- `/dir-providers` — print the effective profile for the current directory:
  matched rule indices, allowed providers, default model, and merged provider
  overrides. A startup log line on stderr (`[dir-providers] Active in <cwd>:`)
  is also emitted whenever the extension is active — the quickest way to
  confirm it loaded.

## Limitations

- Providers registered by *other* extensions are not enumerated and cannot be
  hidden.
- Directory globs are not supported; use explicit directory subtrees.
- The profile is computed once per pi process from the startup cwd.

## License

[The Unlicense](./LICENSE) — public domain. Original work.
