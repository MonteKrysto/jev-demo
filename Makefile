.DEFAULT_GOAL := help
MODE ?= dev
ifeq ($(MODE),dev)
COMPOSE := docker compose -f compose.yaml -f compose.dev.yaml
else ifeq ($(MODE),production)
COMPOSE := docker compose -f compose.yaml
else
$(error MODE must be dev or production)
endif

.PHONY: help bootstrap doctor env start stop up down restart rebuild logs status check test test-browser evaluate evaluate-all evaluate-live compare benchmark benchmark-preview benchmark-fixture db-seed local dev dev-local install export-runs import-runs
help:
	@echo "make start        Start PostgreSQL, API, worker, and React with automatic code reload"
	@echo "make stop         Stop the whole stack; keep containers and database"
	@echo "make restart      Restart the whole stack and apply .env changes"
	@echo "make rebuild      Rebuild images and start; use after dependency or Dockerfile changes"
	@echo "make bootstrap    First-time setup; same as rebuild"
	@echo "make dev          Alias for start (Docker development mode is the default)"
	@echo "make down         Remove containers and network; keep the database volume"
	@echo "make logs/status  Inspect running services"
	@echo "MODE=production make rebuild  Build and start the static production app"
	@echo "make local        Install, build, and start with the embedded database"
	@echo "make dev-local    Start API, embedded worker, and React locally without Docker"
	@echo "make check        Typecheck, backend tests, and production build"
	@echo "make test-browser Run desktop browser integration tests"
	@echo "make evaluate     Evaluate the 16 authored cases without provider calls"
	@echo "make evaluate-all Evaluate all 528 seeded cases without provider calls"
	@echo "make evaluate-live Evaluate one case with live JEV + OpenAI (paid calls; LIMIT=N to change)"
	@echo "make compare      Queue a repeatable live comparison, shown under Evaluations (paid calls)"
	@echo "make benchmark-preview Preview the repeatable paired sample without provider calls"
	@echo "make benchmark    Queue a paired live evaluation; inspect it under Evaluations (paid calls)"
	@echo "make benchmark-fixture Queue a fixture check of the evaluation workflow"
	@echo "make export-runs  Export interactive runs from the running local API"
	@echo "make import-runs  Import that export into the Docker database (existing IDs skipped)"

doctor:
	@command -v docker >/dev/null || { echo "Install Docker Desktop first."; exit 1; }
	@docker info >/dev/null 2>&1 || { echo "Start Docker Desktop, then rerun make bootstrap."; exit 1; }
	@$(COMPOSE) version >/dev/null

env:
	@test -f .env || cp .env.example .env

bootstrap: rebuild

start: doctor env
	@$(COMPOSE) up --wait --wait-timeout 180
	@echo "Ready at http://$$($(COMPOSE) port app 3001) ($(MODE) mode)"

rebuild: doctor env
	@$(COMPOSE) up --build --wait --wait-timeout 180
	@echo "Ready at http://$$($(COMPOSE) port app 3001) ($(MODE) mode)"

up dev: start

stop:
	@$(COMPOSE) stop

down:
	@$(COMPOSE) down

restart: doctor env
	@$(COMPOSE) stop
	@$(COMPOSE) up --wait --wait-timeout 180
	@echo "Ready at http://$$($(COMPOSE) port app 3001) ($(MODE) mode)"

logs:
	@$(COMPOSE) logs --follow --tail=100 app worker

status:
	@$(COMPOSE) ps

db-seed:
	@$(COMPOSE) run --rm init

install:
	npm ci --no-audit --no-fund

local: env install
	npm run build
	npm start

dev-local: env install
	npm run dev

check:
	npm run check

test:
	npm test

test-browser:
	npm run test:browser

evaluate:
	@$(COMPOSE) exec -T app npm run evaluate -- --mode=demo

evaluate-all:
	@$(COMPOSE) exec -T app npm run evaluate -- --mode=demo --cases=all

evaluate-live:
	@$(COMPOSE) exec -T app npm run evaluate -- --mode=live --cases=curated --limit=$${LIMIT:-1}

compare: benchmark

benchmark:
	@$(COMPOSE) exec -T app npm run benchmark -- --url=http://127.0.0.1:3001 --mode=compare --limit=$${LIMIT:-3} --repeats=$${REPEATS:-2} --split=$${SPLIT:-development}

benchmark-preview:
	@$(COMPOSE) exec -T app npm run benchmark -- --url=http://127.0.0.1:3001 --mode=compare --limit=$${LIMIT:-3} --repeats=$${REPEATS:-2} --split=$${SPLIT:-development} --dry-run

benchmark-fixture:
	@$(COMPOSE) exec -T app npm run benchmark -- --url=http://127.0.0.1:3001 --mode=fixture --limit=$${LIMIT:-3} --repeats=$${REPEATS:-2} --split=$${SPLIT:-development}

export-runs:
	npm run db:export

import-runs:
	@$(COMPOSE) exec -T app npm run db:import < .data/exported-runs.json
