.DEFAULT_GOAL := help
NODE := node
PORT ?= 8787
STATE ?= .wrangler/state
export COREPACK_HOME := $(CURDIR)/.sites-runtime/corepack
export COREPACK_ENABLE_DOWNLOAD_PROMPT := 0
export CLOUDFLARE_CF_FETCH_ENABLED := false
export WRANGLER_SEND_METRICS := false
export WRANGLER_WRITE_LOGS := false

.PHONY: help runtime setup setup-offline test test-migrations smoke-built db-preflight db-migrate build prepare-deploy remote-repair-and-verify dev start container-start typecheck lint
help:
	@$(NODE) -e 'console.log("make setup | setup-offline | test | test-migrations | db-preflight | db-migrate | build | start | dev | typecheck | lint\nOverrides: STATE=.wrangler/state PORT=8787")'

runtime:
	@$(NODE) scripts/check-runtime.mjs

setup: runtime
	$(NODE) scripts/setup.mjs

setup-offline: runtime
	$(NODE) scripts/setup.mjs --offline

# Tests never invoke a package manager, fetch dependencies, or use .wrangler/state.
test: runtime
	$(NODE) scripts/test.mjs

test-migrations: runtime
	$(NODE) --test tests/migrations.test.mjs

smoke-built: build
	$(NODE) scripts/smoke-built.mjs

db-preflight: runtime
	$(NODE) scripts/migrate.mjs preflight --persist-to "$(STATE)"

db-migrate: runtime
	$(NODE) scripts/migrate.mjs apply --persist-to "$(STATE)"

build: runtime
	$(NODE) scripts/run-framework.mjs build

prepare-deploy: runtime build
	$(NODE) scripts/prepare-deploy.mjs

remote-repair-and-verify: runtime
	bash scripts/remote-repair-and-verify.sh

dev: runtime
	$(NODE) scripts/run-framework.mjs dev

start: runtime
	$(NODE) --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --local --persist-to "$(STATE)" --ip 127.0.0.1 --inspector-port 0 --port "$(PORT)"

container-start: db-migrate
	$(NODE) --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --local --persist-to "$(STATE)" --ip 0.0.0.0 --inspector-port 0 --port "$(PORT)"

typecheck: runtime
	$(NODE) node_modules/typescript/bin/tsc --noEmit

lint: runtime
	$(NODE) node_modules/eslint/bin/eslint.js . --ignore-pattern dist --ignore-pattern .next
