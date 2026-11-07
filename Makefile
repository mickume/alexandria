# Quality commands of the repository. `make help` lists them.

# Keep wrangler's logs inside the project and its telemetry off.
export WRANGLER_LOG_PATH ?= $(CURDIR)/.wrangler/logs
export WRANGLER_SEND_METRICS ?= false

NPX := npx --no-install

.PHONY: help build test e2e coverage fmt vet lint check doc clean

help: ## List all targets
	@grep -E '^[a-z]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  %-10s %s\n", $$1, $$2}'

build: ## Build the website and the Worker bundle into dist/
	$(NPX) vite build

test: ## Run the unit and integration tests (Worker and website)
	$(NPX) vitest run

e2e: ## Run the end-to-end tests in Chromium against wrangler dev
	$(NPX) playwright test

coverage: ## Run the tests with a coverage report in coverage/
	$(NPX) vitest run --coverage

fmt: ## Format all source files in place
	$(NPX) prettier --write --log-level warn .

vet: ## Type-check the project
	$(NPX) tsc --noEmit -p tsconfig.json

lint: ## Run the linter and check formatting
	$(NPX) eslint .
	$(NPX) prettier --check --log-level warn .

check: fmt vet lint test ## fmt, vet, lint and test

doc: ## Regenerate the API docs in docs/generated/
	rm -rf docs/generated
	$(NPX) typedoc

clean: ## Remove build output
	rm -rf dist coverage test-results playwright-report
