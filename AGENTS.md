# ar-llm — Pi Extensions

Personal [Pi](https://pi.dev) extension packages for the Pi coding agent, published under the `@ar-llm` npm scope.

## Repository structure

```
extensions/        # Pi extension packages (list with `ls extensions/`)
pi/                # Pi agent configuration files (symlinked into ~/.config/pi)
prompts/           # Custom prompt templates
skills/            # Custom skills
```

To see available extensions, run `ls extensions/` — each package is named `pi-<name>/`.

Each extension lives under `extensions/<name>/` with:
- `src/` — TypeScript source (entry point declared in `package.json` under `pi.extensions`)
- `package.json` — npm metadata + `pi` manifest
- `tsconfig.json` — extends root `tsconfig.json`
- `LICENSE` — MIT for upstream-derived extensions, Unlicense for original work

## Development commands

```bash
# Install all workspace dependencies
npm install --ignore-scripts

# Typecheck all packages
npm run typecheck

# Preview what gets published for a package (dry-run)
# List available packages with `ls extensions/`, then run:
npm run pack:<package-name>

A top-level `Makefile` provides convenience targets for bulk operations:
```bash
make typecheck      # typecheck all extensions
make pack           # dry-run pack all extensions
make help           # list all available targets
```
```

## TypeScript conventions

- All extensions are TypeScript, loaded by pi via [jiti](https://github.com/unjs/jiti) — no compilation step needed.
- Root `tsconfig.json` sets `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"strict": true`, `"noEmit": true`.
- Each package `tsconfig.json` extends the root and sets `"rootDir": "."`.
- Relative imports between files in the same package must use `.js` extensions (NodeNext requirement), e.g. `import { foo } from "./utils.js"`.
- `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-tui` are `peerDependencies` — never bundle them.

## Adding a new extension

1. Create `extensions/pi-<name>/src/<name>.ts`
2. Add `extensions/pi-<name>/package.json` with `"pi": { "extensions": ["./src/<name>.ts"] }` and `"keywords": ["pi-package", "pi-extension"]`
3. Add `extensions/pi-<name>/tsconfig.json` extending `../../tsconfig.json`
4. Add `extensions/pi-<name>/LICENSE` (copy from an existing package)
5. Add `"pack:<name>"` script to root `package.json`
6. Add `<name>` to the `EXTENSIONS` list in the top-level `Makefile`
7. Run `npm install --ignore-scripts` to register the new workspace

## Publishing

Publishing follows a two-step staged workflow: an agent stages the package, a human approves it with 2FA.

### Prerequisites

- npm CLI ≥ 11.15.0 and Node ≥ 22.14.0 (check with `npm --version` and `node --version`)
- 2FA enabled on the `arichiardi` npm account
- The package must already exist on the registry — staged publishing is for updates only

### Publishing a new version (staged workflow)

1. **Bump the version** in `extensions/pi-<name>/package.json`
2. **Stage the package** (agent/LLM can do this — uploads to npm's staging area, does NOT publish):
   ```bash
   cd extensions/pi-<name>
   npm stage publish
   ```
   Or use the Makefile shortcut which combines steps 2–3 and prints the stage ID:
   ```bash
   make publish-<name>
   ```
3. **List staged packages** to get the stage ID:
   ```bash
   npm stage list @ar-llm/pi-<name>
   ```
4. **Inspect before approving** (optional):
   ```bash
   npm stage view <stage-id>
   npm stage download <stage-id>
   ```
5. **Approve** — human only, requires 2FA (LLM cannot skip this):
   ```bash
   npm stage approve <stage-id>
   ```
   Or approve via the **Staged Packages** tab on [npmjs.com](https://www.npmjs.com).

An agent (LLM) can safely perform steps 1–3. Staging uploads the package to npm's staging area but does **not** publish it to the registry. Approval (step 5) always requires 2FA and must be done by a human. After staging, report the stage ID so a human can run `npm stage approve <stage-id>`.

## License

Check each extension's `LICENSE` file for its license. Common patterns:
- Unlicense — original work
- MIT — derived from earendil-works/pi
