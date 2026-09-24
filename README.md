# Pi Extensions for the Pi Coding Agent

[![npm scope](https://img.shields.io/badge/npm-%40ar--llm-blue)](https://www.npmjs.com/org/ar-llm)

Personal [Pi](https://pi.dev) extension packages for the Pi coding agent. Each package is independently installable under the `@ar-llm` npm scope.

## Extensions

| Package | Description |
| --- | --- |
| [`@ar-llm/pi-custom-compaction`](./extensions/pi-custom-compaction/README.md) | LLM-powered session compaction with configurable model and request params |
| [`@ar-llm/pi-skill-request-params`](./extensions/pi-skill-request-params/README.md) | Per-skill, per-model, per-provider request parameter injection |
| [`@ar-llm/pi-handoff`](./extensions/pi-handoff/README.md) | Context handoff to new focused sessions via `/handoff` |
| [`@ar-llm/pi-notify`](./extensions/pi-notify/README.md) | Terminal notifications when the agent is done and waiting for input |
| [`@ar-llm/pi-plan-mode`](./extensions/pi-plan-mode/README.md) | Read-only plan mode with step tracking and constrained tool execution |

See each package's README for install instructions and details.

## Local development

Try a package locally from the repo root:

```bash
pi -e ./extensions/pi-custom-compaction
pi -e ./extensions/pi-skill-request-params
pi -e ./extensions/pi-handoff
pi -e ./extensions/pi-notify
pi -e ./extensions/pi-plan-mode
```

For build commands, adding new extensions, and publishing instructions see [AGENTS.md](./AGENTS.md).

## Repository structure

```
extensions/
├── pi-custom-compaction/    # LLM-powered session compaction
├── pi-handoff/              # Context handoff to new sessions
├── pi-notify/               # Terminal notifications on agent idle
├── pi-plan-mode/            # Read-only plan-and-execute mode
└── pi-skill-request-params/ # Per-skill provider request params
pi/                          # Pi agent configuration files
prompts/                     # Custom prompt templates
root/                        # Byte-for-byte copy of the LLM box's system files
skills/                      # Custom skills
```

Each extension package contains its own `package.json`, `README.md`, `LICENSE`, `tsconfig.json`, and TypeScript source under `src/`.

## LLM box system files (`root/`)

`root/` is a byte-for-byte copy of the system files that make up the LLM server setup: everything is stored at its literal on-disk path, so the tree is self-documenting and deployable as-is.

```
root/
├── etc/conf.d/                              # symlinks into /opt/llm
│   ├── llama -> ../../opt/llm/llama/conf
│   └── vllm  -> ../../opt/llm/vllm/conf
├── opt/llm/
│   ├── bin/                                 # llama.cpp / vLLM wrapper scripts
│   ├── chat-templates/                      # .jinja chat templates
│   ├── llama/conf/                          # llama-server env files
│   ├── mcp-proxy/Containerfile
│   └── vllm/                                # conf/, Containerfile, entrypoint
└── var/lib/llm/.config/systemd/user/        # llama-server, ik_llama@, vllm@
```

### Recreating the copy from a live box

Files are mirrored verbatim (no content transformation); `rsync -a` preserves symlinks, permissions, and timestamps. Run from the repo root on the source machine:

```bash
# /opt/llm — confs, chat templates, Containerfiles, build helpers
sudo rsync -a /opt/llm/ root/opt/llm/

# systemd user units of the llm user
sudo mkdir -p root/var/lib/llm/.config/systemd/user
sudo rsync -a \
  /var/lib/llm/.config/systemd/user/llama-server.service \
  /var/lib/llm/.config/systemd/user/ik_llama@.service \
  /var/lib/llm/.config/systemd/user/vllm@.container \
  root/var/lib/llm/.config/systemd/user/

# /etc/conf.d symlinks (relative, so the tree is relocatable)
sudo mkdir -p root/etc/conf.d
sudo ln -sfn ../../opt/llm/llama/conf root/etc/conf.d/llama
sudo ln -sfn ../../opt/llm/vllm/conf  root/etc/conf.d/vllm
```

### Deploying to (re)create the setup on a server

```bash
sudo rsync -a root/. /
sudo -u llm systemctl --user daemon-reload
```

The `llm` user, model weights (`/var/lib/llm/models`), and the `codeberg.org/k153/vllm-openai-custom` image (build with `root/opt/llm/vllm/Containerfile`) must exist on the target beforehand.

## License

- [`pi-custom-compaction`](./extensions/pi-custom-compaction): [The Unlicense](./extensions/pi-custom-compaction/LICENSE) — substantially rewritten from [earendil-works/pi](https://github.com/earendil-works/pi) (see [NOTICE](./extensions/pi-custom-compaction/NOTICE))
- [`pi-skill-request-params`](./extensions/pi-skill-request-params): [The Unlicense](./extensions/pi-skill-request-params/LICENSE) — original work, public domain
- [`pi-handoff`](./extensions/pi-handoff), [`pi-notify`](./extensions/pi-notify), [`pi-plan-mode`](./extensions/pi-plan-mode): [MIT](./extensions/pi-handoff/LICENSE) — derived from [earendil-works/pi](https://github.com/earendil-works/pi), copyright Mario Zechner
