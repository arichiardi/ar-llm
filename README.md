# Large Language Model Files

Custom skills and extensions for LLM-assisted development. Includes Clojure coding (REPL-driven, Babashka scripting, formatting), git commit/PR writing, PRD generation, web search (SearXNG), and web page crawling (Crawl4AI).

## Pi Coding Agent

[Pi](https://github.com/earendil-works/pi-mono) is a minimal terminal coding harness — extend it with TypeScript extensions, skills, prompt templates, and themes without forking internals.

### Extensions

#### skill-request-params

Sets custom provider request parameters (temperature, top_p, thinking mode, etc.) per skill. Detects the active skill through three strategies — explicit `/skill:name` commands, expanded `<skill>` blocks in the prompt, and LLM auto-invocations referencing skill file paths — then injects matching parameters into every provider payload before the request fires. A configurable `"default"` entry serves as fallback when no skill is detected.

## License

[The Unlicense](LICENSE)
