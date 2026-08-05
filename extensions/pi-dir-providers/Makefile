.PHONY: test test-watch typecheck

test:
	node --import ./test/register.mjs --test test/match.test.ts test/config.test.ts

test-watch:
	node --import ./test/register.mjs --test --watch test/match.test.ts test/config.test.ts

typecheck:
	node ../../node_modules/typescript/bin/tsc --noEmit
