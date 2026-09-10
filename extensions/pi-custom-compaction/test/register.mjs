// Test bootstrap: registers the .js→.ts resolution loader using the modern
// register() API (preferred over the deprecated --loader flag).
import { register } from "node:module";

// Register the loader relative to this file's location.
register(new URL("./loader.mjs", import.meta.url), import.meta.url);
