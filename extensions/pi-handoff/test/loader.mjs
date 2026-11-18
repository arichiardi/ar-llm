// Minimal ESM loader that maps relative `.js` specifiers to `.ts` files so that
// Node.js (which strips TypeScript natively) can resolve imports written with
// the NodeNext convention (e.g. `import … from "../src/custom-compaction.js"`).
//
// Only relative specifiers are rewritten.  Package imports such as
// `@earendil-works/pi-ai` ship real `.js` files that must resolve unchanged.
export async function resolve(specifier, context, nextResolve) {
	if (specifier.startsWith("./") || specifier.startsWith("../")) {
		const tsSpec = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL).href;
		try {
			return await nextResolve(tsSpec, context, nextResolve);
		} catch {
			// fall through to default resolution
		}
	}
	return nextResolve(specifier, context, nextResolve);
}
