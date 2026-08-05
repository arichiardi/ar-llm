# Top-level Makefile for the @ar-llm pi extensions monorepo.
#
# Development:
#   make typecheck   — typecheck every extension
#   make pack        — dry-run pack every extension (npm pack --dry-run)
#
# Publishing (staged workflow — requires 2FA for final approval):
#   1. Edit version in extensions/pi-<name>/package.json
#   2. make publish-<name>              — stages the package, prints stage ID
#   3. npm stage approve <stage-id>     ←  HUMAN ONLY, requires 2FA token
#
# Run `make help` for the full target list.

SCOPE         := @ar-llm
EXTENSIONS    := custom-compaction dir-providers handoff notify plan-mode skill-request-params

# --- Development targets ----------------------------------------------------

.PHONY: help typecheck pack $(addprefix publish-,$(EXTENSIONS)) publish-all stage-list

help: ## Show available targets
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | \
	  sed -E 's/^([a-zA-Z_-]+):.*## (.*)/  \1  \2/'
	@echo
	@echo "Publish targets:"
	@for ext in $(EXTENSIONS); do \
	  echo "  publish-$$ext   stages $(SCOPE)/pi-$$ext"; \
	done

typecheck: ## Typecheck all extensions
	npm run typecheck

pack: ## Dry-run pack every extension
	@for ext in $(EXTENSIONS); do \
	  echo "==> Packing $(SCOPE)/pi-$$ext"; \
	  npm --workspace $(SCOPE)/pi-$$ext pack --dry-run; \
	done

# --- Publishing targets -----------------------------------------------------
#
# Each `publish-<name>` target stages one extension, then lists its stage ID
# so you can copy-paste it into `npm stage approve <id>` (human + 2FA).
# Remember to bump the version in the package's package.json first!

stage-list: ## List all staged packages awaiting approval
	npm stage list

publish-all: ## Stage every extension (bump versions first)
	@for ext in $(EXTENSIONS); do \
	  $(MAKE) publish-$$ext; \
	done

define publish_recipe
publish-$(1):
	@echo "==> Staging $(SCOPE)/pi-$(1)"
	@cd extensions/pi-$(1) && npm stage publish
	@echo
	@echo "Stage ID for $(SCOPE)/pi-$(1):"
	@npm stage list $(SCOPE)/pi-$(1)
	@echo "==> Next step:  npm stage approve <stage-id>   (requires 2FA)"
endef

$(foreach ext,$(EXTENSIONS),$(eval $(call publish_recipe,$(ext))))
