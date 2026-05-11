# ar-llm

Personal [pi](https://github.com/mariozechner/pi-coding-agent) skills and extensions for LLM-assisted development.

## Skills

| Skill | Description |
|-------|-------------|
| **clojure-coder** | Expert Clojure developer specializing in functional programming, REPL-driven development, and data-first architecture. Proficient in concurrency patterns, SICP principles, and idiomatic Clojure style. |
| **babashka-script-master** | Expert assistant for creating, writing, and modifying Babashka scripts (CLI Clojure). |
| **clojure-formatter** | Format (changed) Clojure files in the project. |
| **git-commit-writer** | Expert assistant for generating concise, imperative Git commit messages and structured Pull Request descriptions, adhering to strict style guidelines and project templates. |
| **prd-writer** | Use this agent when you need to create comprehensive Product Requirements Documents (PRDs) for software projects or features. This includes documenting business goals, user personas, functional requirements, user experience flows, success metrics, technical considerations, and user stories. The agent excels at creating structured PRDs with testable requirements and clear acceptance criteria. |
| **searxng-search** | Web search using a local SearXNG instance. Use for finding documentation, answering factual questions, searching for code examples, or any general web lookup. The endpoint is configured via the SEARXNG_URL environment variable. |
| **searxncrawl-local** | Fetch and read web page content from a local SearXN+Crawl MCP endpoint. The server uses Crawl4AI under the hood and provides crawling, site crawling, and search tools. |

## Extensions

### skill-request-params

Sets custom provider request parameters (temperature, top_p, thinking mode, etc.) per skill. Detects the active skill through three strategies — explicit `/skill:name` commands, expanded `<skill>` blocks in the prompt, and LLM auto-invocations referencing skill file paths — then injects matching parameters into every provider payload before the request fires. A configurable `"default"` entry serves as fallback when no skill is detected.

## License

[MIT](LICENSE)
