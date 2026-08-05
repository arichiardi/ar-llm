// Minimal ESM loader that maps `.js` specifiers to `.ts` files so that
// Node.js (which can natively strip TypeScript) can resolve imports written
// with the NodeNext convention (e.g. `import … from "./match.js"`).
export async function resolve(specifier, context, nextResolve) {
	if (specifier.endsWith(".js")) {
		const tsSpec = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL).href;
		try {
			return nextResolve(tsSpec, context, nextResolve);
		} catch {
			// fall through to default resolution
		}
	}
	return nextResolve(specifier, context, nextResolve);
}
