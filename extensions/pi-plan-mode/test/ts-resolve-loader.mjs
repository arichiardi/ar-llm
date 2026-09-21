// Node module resolution hook for running the TypeScript sources (and tests)
// directly, without a build step.
//
// The sources use NodeNext ".js" relative specifiers, but Node's type stripping
// does not map those back to ".ts". This hook rewrites a relative ".js"
// specifier to ".ts" when a sibling ".ts" file exists.
//
// Usage: node --experimental-strip-types --import ./test/ts-resolve-loader.mjs --test ...

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL) {
			const candidate = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
			if (existsSync(fileURLToPath(candidate))) {
				return nextResolve(candidate.href, context);
			}
		}
		return nextResolve(specifier, context);
	},
});