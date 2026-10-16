# JEV RCM Investigation Lab

A desktop React application and durable investigation backend for a synthetic revenue-cycle workflow. JEV selects the next investigative capability and proposed Task Action. OpenAI selects tools within that assignment, references the returned fields, and orders citations for a completion note. The application binds those references to exact tool values and citations, and enforces evidence requirements, budgets, claim access, and reviewer approval.

## Demonstrating the POC

The home page is a focused demo of one question: **Can JEV guide an investigation as new evidence arrives?** It starts with claim SYN-1002. Choose **Fixture only** (scripted routing and extraction), **Agent only** (OpenAI routing and tools), or **Agent + JEV** (JEV routing and OpenAI tools). All three use synthetic claim and payer data. Agent modes make paid API calls when executed.

**Run to completion** queues the investigation for the background worker and stops at review or an error; it never approves or submits a claim. **Pause after step** stops after the current checkpoint, and **Run to completion** resumes it. Execution survives navigation and reload. **Step through manually** creates a run without executing providers; use **Run next step** or switch to automatic execution on the run page. The left panel explains the current step; **Sequence so far** on the right preserves every revealed decision and result in order. Purple marks routing decisions, blue marks agent/tool work, and neutral entries show application checks and results, including overrides. Findings expand under the tool that returned them. The Task Action and completion note appear on the same page.

**Compare all three modes** opens `/demo/compare` with three columns for the same case. **Run all three** creates and queues a new run for each mode; each column also supports individual execution and selection of saved runs. The comparison shows actions, review reasons, evidence sources, steps, verified facts, conflicts, usage, notes, and expandable sequences. Selected run IDs are retained in the URL across reloads, including runs outside the recent-run list. **Compare this case across modes** from an investigation keeps that run selected. If queueing one mode fails, its newly created run stays selected and can be resumed; other modes remain visible. Differences are descriptive, not an accuracy score, and fixture timing is not a model benchmark.

Every guided run shows **Run metrics** above the sequence: execution time, summed provider time, tokens, model calls, tool results, and recorded steps. **Provider breakdown** shows each provider/model's call count, time, and input/output tokens. Execution time covers recorded step attempts and excludes queue waits and pauses; it is not derived from the run's creation/update timestamps. Older runs without this measurement show **Not recorded**. Fixture bookkeeping is excluded from model-call totals. Metrics update after persisted steps and describe the full saved run even while replaying an earlier checkpoint, as labeled. The comparison also includes execution time and separate JEV/OpenAI timing.

**Replay a saved live run** reveals an existing investigation without new provider requests. The home page uses the most recent reviewable live correction case among the loaded runs, including a human-review outcome if that is how it ended. Replay is for demonstrating the recorded sequence, not choosing an accuracy winner. Each replay starts before any evidence is shown and reveals only observations available by the displayed checkpoint. A confidence stop or provider failure is shown as recorded; the demo does not replace it with an idealized outcome. Source IDs in the presented note are displayed as source names; the original saved note and all receipts remain available in the full record.

The previous dashboard, corpus, comparisons, evaluations, tools, configuration, and detailed investigation screens are in **Advanced workspace** (`/lab`). Existing links remain valid. Any investigation has a **Guided replay** link to its presentation view. The focused demo establishes the iterative integration pattern on synthetic data; it does not establish that JEV improves accuracy.

## Bootstrap

Install Docker Desktop, start it, then run:

```sh
make bootstrap
```

Open http://localhost:3001 (or the `APP_PORT` saved in `.env`). Bootstrap creates `.env` from `.env.example` only when missing, builds the development image, applies migrations, seeds 528 synthetic cases, and waits for PostgreSQL, API, and worker health checks. No API keys are needed for fixture mode. Set keys in `.env` to enable live modes; keys stay on the server.

A host-side `pnpm install` or `npm install` is not needed for Docker bootstrap. The Docker image installs its own Linux dependencies with `npm ci` from `package-lock.json`; host `node_modules` is excluded from the image and is not mounted into the running containers.

For everyday Docker use:

```sh
make start       # start the whole stack in the background; code reload stays active
make stop        # stop all services; retain containers and data
make restart     # restart all services, applying current .env settings
make rebuild     # rebuild dependencies/images and start; no manual down needed
make status      # show service health
make logs        # follow API, React, and worker logs
make down        # remove containers/network; retain the database volume
```

`make up` and `make dev` are aliases for `make start`; `make bootstrap` is an alias for `make rebuild`. Development mode is the default for Make commands. Source directories are mounted read-only into the containers, while dependencies and caches stay inside the Linux image. Editing React components or styles updates the browser through Vite. Editing imported API, worker, or shared core code automatically restarts the affected Node process inside its existing container. A shared JEV prompt change reloads both API and worker. No separate watch terminal is required.

The browser keeps the same `APP_PORT` address. In development, Vite listens on container port 3001 and proxies `/api` to the API on internal port 3002; only the public port is published. The worker uses the same PostgreSQL database as before. Automatic worker reload waits for its current checkpoint to finish. Start a new investigation to compare a prompt change against a complete earlier run; saved traces are historical records and do not change when code changes.

| Change | Apply it |
| --- | --- |
| React, API, worker, or shared source | Save the file; reload is automatic |
| `.env` keys, models, limits, or ports | `make start` applies changed container settings; `make restart` also works |
| Dependencies, package scripts, Dockerfile, or image-only files | `make rebuild` |
| Existing synthetic case data | Increment `corpusVersion`, run `make db-seed`, and start a new investigation; existing run snapshots remain unchanged |

For the built, static production app, use `MODE=production make rebuild`. Subsequent production commands use the same prefix, for example `MODE=production make start`. Return to automatic reload with `make start`. Both modes use the same database volume; production code changes require a rebuild. Plain `docker compose` uses the base production configuration; Make selects `compose.dev.yaml` automatically in development mode.

If the port is occupied, set `APP_PORT=3301` in `.env` before starting. `make help` lists the commands. Database storage is the named `postgres_data` volume; it is not inside the application container. Stop/down targets never delete that volume.

For local development with Node 22.12 or newer:

```sh
make dev-local # installs dependencies; API + embedded worker + Vite
make local     # installs, builds, starts on port 3001
```

Without `DATABASE_URL`, local mode uses disk-backed PGlite at `.data/postgres` and runs a worker inside the API process. Do not open that directory from another process. With native PostgreSQL, run `npm run worker` separately; Docker does this automatically. The desktop layout is the current target; mobile work is out of scope.

## Execution modes

To use both live providers:

1. Set `TYPESAFE_API_KEY` (JEV) and `OPENAI_API_KEY` in the server's `.env`, then run `make start`. This applies updated settings to both the API and worker.
2. Open **New investigation**. **Live JEV + OpenAI** is the first mode at the top of the page; its badge shows whether keys are configured. You can also use **Configuration → Start with JEV + OpenAI**, or open `/investigations/new?mode=live` on your app's port.
3. Select a case, leave **Run until review** selected, and click **Start investigation**. Choose **Open and step through manually** to control each checkpoint instead.

The default remains **Fixture demo** unless you select another mode or follow a mode-specific link. Live mode makes paid model requests against synthetic case data. “API keys configured” confirms keys are present; it does not test provider connectivity or model access.

| Mode     | Routing                      | Tool use and extraction            |
| -------- | ---------------------------- | ---------------------------------- |
| `demo`   | Deterministic fixture policy | Deterministic fixture agent        |
| `jev`    | Live TypeSafe JEV            | Deterministic fixture agent        |
| `live`   | Live TypeSafe JEV            | OpenAI function-calling agent      |
| `openai` | OpenAI baseline              | Same OpenAI function-calling agent |

The OpenAI integration is an application-owned, bounded agent runtime using the official OpenAI SDK. It is not the separate OpenAI Agents SDK. JEV uses `@typesafe-ai/sdk`, `systemOne`, `choice`, and `noul`. The OpenAI baseline receives the same evidence, tool catalog, budgets, and action gates. It provides no probability distribution, so no JEV confidence threshold is applied to that baseline. JEV confidence is an option-distribution measure, not a validated probability of correctness.

## Backend behavior

- **Durable jobs:** Automatic runs enqueue a PostgreSQL job. Workers claim with `FOR UPDATE SKIP LOCKED`, renew leases, save one checkpoint at a time, and use owner tokens and revision checks to reject stale writes. Closing the browser does not stop a job. Pause takes effect after the current checkpoint. Expired jobs are recovered; three interrupted recoveries stop for explicit retry.
- **Persistent tools:** Twelve synthetic tools cover claim records, payer contact, clinical documents, eligibility, authorization, remittance, coding, submissions, claim history, prior contacts, policy, and payer portal status. OpenAI chooses among tools offered by its assigned capability. Payer clarification depends on the query topic. Transient failures receive one bounded automatic retry.
- **Reproducible sources:** Cases and source payloads live in PostgreSQL. Every new run snapshots its source data. Invocation receipts are cached by run, evidence position, tool, and arguments; retrying extraction reuses the observation. This is idempotency for the synthetic tool environment, not an exactly-once guarantee for future external integrations.
- **Adaptive decisions:** Multiple investigation capabilities are eligible after the initial claim lookup. Required checks must be collected before an operational action. Conflicting observations, unsupported coding, missing authorization, inactive eligibility, an expired appeal window, and unavailable required records lead to review.
- **Sourced outputs:** Every extracted value must match its receipt, every cited fact must verify, and notes retain all observations. Reviewer approval atomically saves the run and a synthetic handoff. No claim is actually submitted, no payer is contacted, and no real patient data is present.

The synthetic tools return structured `fields` alongside their source text. After a tool call, OpenAI calls `record_findings` with `fieldKeys`, restricted to keys present in that result. The application copies exact values, source IDs, and quotes from the receipt. The agent does not retype those strings. Missing, duplicate, or absent fields fail before any findings are committed; the existing claim, value, and source-text checks still run. This follows the [OpenAI function-calling guidance](https://developers.openai.com/api/docs/guides/function-calling) on constrained parameters and letting application code supply already-known data. This contract applies to structured tool output; extracting facts from an unstructured payer transcript would need its own extraction and evaluation stage.

The recording schema requires as many field references as the tool returned. The note schema likewise requires as many IDs as there are verified facts, restricts those IDs to the verified set, and restricts the action to the already-drafted action. Separate facts with the same value retain their distinct source references. Application checks still reject duplicates, missing evidence, and altered actions before a note can be accepted.

If an older build stops after a successful routing decision with **“Extracted fact does not match its authoritative tool receipt”**, the failure is in recording the agent's findings, not the routing-confidence check. That build asked the agent to copy values and citations verbatim. Update the project files on that machine and run `make rebuild`, then start a new investigation. The full investigation record also offers **Retry investigation** for failed runs. New source-check errors identify the field and mismatch type. Rebuilding retains the PostgreSQL data volume.

The **Decision trail** shows the evidence available before each decision, the application rule, the router's proposal, the step actually applied, and the findings returned afterward. Conflicting values appear side by side with their original sources. A policy that permits only human review is distinguished from an override of the router's proposed step, such as a confidence gate. These explanations summarize saved inputs and gate results; they are not provider-written rationales. Earlier checkpoints never borrow facts from later steps. Scores and raw records remain available under technical details; fixture scores are explicitly labeled as scripted. Source verification confirms that a finding matches its recorded source, not that one conflicting source is correct.

## Corpus and evaluation

There are **16 authored cases plus 32 variants each: 528 cases total**. Variations cover wording, missing references, missing deadlines, unavailable records, contradictory status, delays, and transient failures. The variants are controlled engineering tests, not independent clinical cases. Family-based development/validation/test splits prevent related variants from crossing splits. Expected labels live in a separate evaluation table and never enter router or agent prompts. They are authored POC labels and have not been reviewed as clinical or billing guidance.

```sh
make evaluate                     # 16 authored cases; fixture mode
make evaluate-all                 # all 528; fixture mode
make evaluate-live                # one authored case; live JEV + OpenAI, paid calls
LIMIT=3 make evaluate-live        # three authored cases; live paid calls
LIMIT=3 REPEATS=2 make compare    # queued paired comparison; live paid calls, visible in Evaluations
npm run evaluate -- --mode=demo --cases=all --split=test
npm run evaluate -- --modes=live,openai --limit=3 --dry-run
```

The runner records outcome accuracy, escalation, evidence grounding, tool attempts, an unrequested-read proxy, elapsed time, token usage, paired outcomes, and consistency across variants with the same expected answer. It never approves handoffs. Reports are persisted in `workflow_evaluations` and written under `.data`; Docker reports can be copied with `docker compose cp`. Evaluation runs are excluded from the interactive run list. Offline results validate plumbing and fixture behavior, not live model accuracy.

## Paired evaluations in the app

Open **Evaluations** in the sidebar. Preview a sample, choose **Live JEV + OpenAI vs OpenAI baseline**, and press **Start paid comparison**. A fixture-only option verifies the workflow without provider calls. The default live sample uses three development cases, two repeats, and both modes: twelve investigations. Batches are limited to 160 investigations; the preview shows the actual count before starting. Both providers must be configured for a live comparison.

Case selection uses a saved seed and draws across families before adding more variants of a family. Within each round it balances expected action categories where available, so a small sample is less likely to consist entirely of human-review cases. Labels are used only for evaluation sampling and grading, never sent to the agents. This is a stratified engineering sample, not an estimate of real-world case prevalence. A pair uses the same case and repeat number; provider enqueue order alternates. Workers can interleave their checkpoints. Batch creation saves every run, source snapshot, and queue job atomically, and request IDs prevent duplicate batches on retries. Settings and requested models are saved with each run so changing those server defaults does not change an existing batch. Observed provider model versions and token usage are included in exported results. Model sampling itself is not deterministic.

Accepted batches survive browser navigation and server restarts. Pause/resume controls apply to the whole batch; active checkpoints finish before pausing. Trial outputs are read-only and cannot be retried or approved individually. Start a new batch for a new measurement. The JSON export includes selection, settings, paired outcomes, per-mode metrics, and run IDs linking to complete decision trails.

The report counts failed runs as unsuccessful outcomes. It reports wrong operational actions, missed and unnecessary escalations, evidence validation failures, source-field coverage, note source checks, tool attempts, active execution time, tokens, repeated-action consistency, and decisions with competing eligible capabilities. Active execution time includes completed checkpoint attempts, including provider failures, but excludes queue waits and process interruptions before a checkpoint was saved. Note checks verify recorded source values and citations; they do not grade prose or business usefulness. JEV confidence bins compare final proposed actions to synthetic labels; the bins do not establish calibration.

Enter optional USD-per-million input/output prices for each provider to estimate token cost. No current prices are assumed. Estimates exclude cache discounts, account-specific charges, and requests whose provider usage was not returned. Without prices the report shows token counts and leaves cost unavailable.

The fixture corpus has 16 authored families, not 528 independent examples. Split membership is fixed per family. These cases were available during POC development, so even the test split is not independently collected unseen evidence. Use development cases while changing prompts, then freeze the experiment before checking validation/test families. Production adoption additionally needs representative de-identified cases, expert-reviewed expected actions and acceptable investigation paths, and blinded review of note usefulness.

```sh
make benchmark-preview           # selection and count only; no provider calls
make benchmark-fixture           # queue fixture checks and print the results link
LIMIT=3 REPEATS=2 make benchmark  # same as make compare; paid requests
# Local CLI against the running app; APP_PORT from .env is respected:
npm run benchmark -- --mode=fixture --limit=2 --repeats=2 --wait
npm run benchmark -- --mode=compare --scope=all --split=test --limit=6 --seed=holdout-1 --dry-run
```

For CLI cost estimates use `--prices=path/to/prices.json` with the shape `{"jev":{"input":0,"output":0},"openai":{"input":0,"output":0}}`, replacing the zeros with your actual rates. `--wait` or `--output=path.json` waits for completion and writes a report; interrupting the CLI leaves accepted jobs running. Legacy `npm run evaluate` remains available for full fixture-corpus checks and does not populate the new paired-evaluation screen.

## APIs and persistence

| Endpoint                                                   | Purpose                                                                |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| `GET /api/health`, `/api/queue`                            | Database and worker/queue status                                       |
| `GET /api/config`, `/api/scenarios`, `/api/tools`          | Safe configuration, public case metadata, tool catalog                 |
| `GET /api/runs`, `/api/runs/:id`                           | Recent interactive runs and complete audit trails                      |
| `POST /api/runs`                                           | Create `{ scenarioId, mode }`                                          |
| `POST /api/runs/:id/start`                                 | Enqueue or resume `{ expectedRevision }`                               |
| `POST /api/runs/:id/pause`                                 | Pause after checkpoint, body `{}`                                      |
| `POST /api/runs/:id/step`                                  | Manual checkpoint `{ expectedRevision }`; blocked during an active job |
| `POST /api/runs/:id/retry`                                 | Reset a failed run `{ expectedRevision }`                              |
| `POST /api/runs/:id/approve`                               | Save synthetic handoff `{ expectedRevision, actor }`                   |
| `GET /api/jobs`, `/api/runs/:id/tools`, `/api/evaluations` | Jobs, durable invocation receipts, evaluation reports                  |
| `GET /api/benchmarks`, `/api/benchmarks/:id` | Saved batch plans and live computed reports |
| `POST /api/benchmarks/preview`, `/api/benchmarks` | Preview options; create and enqueue an idempotent `{id, options}` batch |
| `POST /api/benchmarks/:id/control` | Pause/resume with `{action: "pause" \| "resume"}` |

SQL migrations in `db/` are recorded in `schema_migrations`; native PostgreSQL uses a migration advisory lock. `db/schema.ts` documents the entities. The stack is a loopback-bound local POC with browser origin checks, not an authenticated multi-user deployment.

To move recent saved investigations from an older local app, run `make export-runs` while that app is running, stop it, run `make bootstrap`, then `make import-runs`. The export includes the 50 most recent interactive runs; existing IDs are skipped on import. The embedded database is left intact.

## Verification

```sh
make check
make test-browser                 # desktop Chromium; isolated database, no provider calls
# First-time browser setup: npx playwright install chromium
docker compose exec app npm run test:native
```

Native smoke testing creates and removes an isolated database schema. Tests cover concurrent workers, lease fencing, source snapshots, tool retries, strict provider contracts, adaptive eligibility, approval, and browser reload/pause/resume. See `docs/VALIDATION.md` for recorded results.

Provider references: [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [TypeSafe function calling](https://docs.typesafe.ai/cookbooks/function_calling), [PostgreSQL queue locking](https://www.postgresql.org/docs/current/sql-select.html).
