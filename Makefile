.PHONY: setup dev demo eval eval-docs coverage test lint typecheck build check up down logs db-up db-migrate db-seed db-generate

setup:          ## Install deps and create .env from the example
	pnpm install
	[ -f .env ] || cp .env.example .env

dev: db-up db-migrate db-seed   ## Run API (localhost:3000) and web (localhost:5173) with hot reload
	pnpm dev

demo:           ## Run sample leads through the agent (no Docker, no API key needed)
	@for f in hot-lead big-budget spam ukrainian vague; do echo "\n=== $$f ==="; pnpm -s agent data/samples/$$f.json || exit 1; done

eval:           ## Run every sample against its expectation (demo mock); report in reports/eval.md
	pnpm -s eval

eval-docs: eval ## Refresh the committed eval report in docs/
	cp reports/eval.md docs/eval-mock.md && pnpm prettier --write docs/eval-mock.md >/dev/null

coverage:       ## API tests with a coverage report (apps/api/coverage/index.html)
	pnpm --filter @lead-agent/api test:coverage

test:           ## Unit + e2e tests (mock LLM, no API key needed)
	pnpm test

lint:
	pnpm lint

typecheck:
	pnpm typecheck

build:
	pnpm build

check: lint typecheck test   ## Everything CI runs

up:             ## Full stack in Docker: web on :8080, API on :3000
	docker compose up --build -d

down:
	docker compose down

logs:
	docker compose logs -f api

db-up:
	docker compose up -d --wait postgres

db-migrate:     ## Apply SQL migrations to the dev database
	pnpm --filter @lead-agent/api db:migrate

db-seed:        ## Load data/portfolio case studies (idempotent)
	pnpm --filter @lead-agent/api db:seed

db-generate:    ## Generate a migration after changing src/db/schema.ts
	pnpm --filter @lead-agent/api db:generate
