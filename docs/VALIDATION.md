# Backend validation — 2026-10-11

## Structured source recording — 2026-10-16

A reported second-machine failure showed JEV allowing payer contact at 99% confidence, followed by the application's generic receipt-mismatch error. The screenshot does not identify the rejected field, and this workspace cannot inspect the other machine's original provider response. Inspection found that the previous agent contract required OpenAI to retype values, source IDs, and verbatim quotes from tool text even though each synthetic tool already returned structured fields.

`record_findings` now accepts only `fieldKeys`, with its allowed keys and required item count taken from the current receipt. The tool result supplies both structured fields and source text. Application code binds selected keys to exact values, source IDs, and quotes; all original evidence checks remain in place. Duplicate, missing, and absent fields are rejected atomically. Source-check errors identify the field and mismatch type. JEV routing, the 70% threshold, and seeded data are unchanged.

An initial live check, `395ac67c-f905-4ce5-a792-fa8786426101`, passed payer recording and verification but exposed a separate note omission. The note schema was then constrained to the complete count of verified fact IDs, the allowed ID set, and the existing action. Its instructions now distinguish identical values from distinct source citations. Duplicate and missing citation checks remain enforced by the application.

TypeScript, the production build, and **79 automated tests** passed. Provider tests use the real SDK over mocked HTTP, including exact punctuation/whitespace/source binding, malicious extra properties, absent/duplicate/omitted field references, cross-claim receipts, source-text mismatches, multi-source note cardinality, and the complete tool loop. A new live investigation, `988b18b5-4d83-41c7-bbf8-5ef7dd15d4a7`, completed all five steps with `correct_claim`, five source-checked facts, and a completion note containing every verified fact reference. The final live export is `.data/field-reference-live-validation-final.json`. These checks confirm this case's integration; they do not reproduce the exact unavailable second-machine model response or establish corpus-wide accuracy.

Docker bootstrap uses `npm ci` and the committed package-lock input; host `node_modules` is excluded and not bind-mounted. Host `pnpm install` is therefore unnecessary for the Docker path. The updated backend files must be copied to another installation before rebuilding or relying on development source reload. Saved runs and the PostgreSQL volume remain intact.

## Step 3 routing and handoff explanations — 2026-10-15

The saved live investigation `4e58b88e-7052-4578-aaeb-d265bfad664c` stopped because its routing confidence was 0.69 against the saved 0.70 threshold. JEV proposed verification (0.72 probability), followed by billing investigation (0.19); human review received 0.01. Its separate corrected-claim prediction had 0.97 confidence. The application gate, rather than the proposed next step, caused the handoff.

The routing question now distinguishes a payer's correction instruction from an explicit requirement for further billing checks. It also distinguishes pending verification from completed verification and directs completed, supported investigations toward action drafting and then note preparation. The full option set, probability validation, eligibility checks, evidence requirements, and 0.70 threshold remain unchanged. See [TypeSafe Choice guidance](https://docs.typesafe.ai/primitives/choice) for separating option criteria and [confidence semantics](https://docs.typesafe.ai/confidence) for the distinction between option probability and normalized confidence.

The guided sequence and comparison now retain proposal context through an override, show the competing choices and source evidence, and distinguish routing confidence, the saved threshold, and the separate action prediction. Current overridden decisions open their evidence and scores automatically. The full trail also retains the proposed step's evidence context. These explanations summarize saved inputs and rules; they do not invent a model-written rationale or use later verification results as earlier inputs.

A fresh live JEV + OpenAI run, `2d140dd1-ef99-47c1-b1bb-1b9779521e21`, completed all five checkpoints with `correct_claim` and a sourced completion note, ready for review. Routing confidence was **0.88, 0.99, 0.92, 1.00, 1.00**. Every saved checkpoint used the 0.70 threshold and the revised prompt. This used ten provider calls across `jev-1.13.0` and `gpt-4.1-mini-2025-04-14`; the saved export is `.data/live-routing-validation.json`. This is a single-case live integration check, not a measured accuracy improvement across the corpus.

TypeScript, the production build, and **73 automated tests** passed. **13 desktop browser workflows** passed across the guided demo, comparisons, and the affected full-trail scenarios. Regression coverage includes the 72% probability / 69% confidence distinction, separate action confidence, historical verification state, repeat-verification proposals, and confidence stops where human review was already proposed. Deployed desktop checks inspected both the original handoff and the successful live run without further provider calls. Source reload applied the changes without rebuilding containers. Mobile layouts were not changed.

## Docker development reload and lifecycle — 2026-10-15

Make now defaults to the development Compose overlay. The app serves React through Vite on the existing public port and proxies the watched API internally; the separate worker also watches its imported source. Read-only source mounts preserve the image's Linux dependencies. Production remains available with `MODE=production`. Start, stop, restart, rebuild, and down have separate targets; stop/down retain PostgreSQL storage.

TypeScript, all **70 automated tests**, the frontend production build, and both development and production Docker image builds passed. The deployed development stack is healthy on port 3301. A desktop Chromium check changed a temporary CSS property and observed hot reload without browser navigation. A temporary shared-core edit changed both API and worker child process IDs while container IDs, start times, and restart counts stayed unchanged. Both temporary edits were removed, preserving the user's JEV prompt changes.

A fixture-only investigation advanced once through the API and then completed through the durable worker in five steps with `correct_claim`. Its saved decision requests matched the current working-file prompt in both execution paths. All 24 pre-existing saved runs remained accessible. `make stop` left no services running; `make start` restored healthy services, an active worker, and the saved investigations. Verification details are recorded in `test-results/dev-reload.json`. No paid provider requests or mobile layout changes were made.

## Guided run metrics — 2026-10-15

The guided run displays its stored metrics above the sequence, with execution and provider time, tokens, model calls, tool results, and steps. The expandable provider/model table contains call counts, timing, and input/output tokens. Comparisons also show execution time and separate JEV/OpenAI timing. Fixture bookkeeping is excluded from model totals, missing historical execution time is distinguished from a recorded zero, and replay totals are explicitly labeled as full-run metrics.

TypeScript, production build, eight focused unit tests, and ten guided-demo desktop browser workflows passed. Checks cover aggregation, timing semantics, fixture exclusion, missing timing, polling updates, replay labeling, provider breakdowns, and the existing automatic-run/comparison flows. Provider responses were simulated; no paid model requests were made.

## Automatic demo and three-mode comparison — 2026-10-14

The guided home page now offers Fixture only, Agent only, and Agent + JEV with automatic or manual execution. Automatic execution uses the existing durable worker and stops at review or failure. The guided run supports pause/resume and retains the chronological sequence as it progresses. The comparison page can queue all three modes for the same case, execute one mode, or select saved runs. Selections are pinned in the URL and loaded by ID rather than relying on the recent-run list. A queue failure preserves the new run for resumption instead of silently creating another one.

TypeScript, the production build, six focused unit tests, nine guided-demo desktop workflows, and nine existing advanced-workspace desktop workflows passed. Checks include actual fixture worker execution through pause/reload/resume, both agent-mode request mappings, three-column outcomes and sequences, missing keys, mismatched case/mode rejection, older saved-run selection, and recovery from partial queue failure without duplicate creation. Browser provider responses were simulated; no new paid model requests were made. These checks validate execution and comparison behavior, not model accuracy. Desktop screenshots were inspected; mobile layouts remain out of scope.

## Guided sequence — 2026-10-14

The right panel now shows the cumulative recorded sequence: routing decisions, agent/tool results, application verification and overrides, the Task Action, and completion-note preparation. Current tool findings start expanded; earlier findings and decision context remain available within their entries. Successful tool-call and receipt events are combined into one operation; failed attempts remain visible. Application verification and note rendering are not attributed to JEV or the agent.

TypeScript and the production build passed, along with **six focused unit tests** and **four desktop browser workflows**. Checks cover chronological order, replay isolation, conflict preservation, a confidence override without a fabricated tool call, failed attempts, and failures before routing. Browser checks verify the whole sequence through the final outputs, earlier findings, and read-only saved replay. No live provider requests or mobile changes were made.

## Focused demonstration — 2026-10-14

The default entry point now follows one claim through the decision/tool/evidence loop. The former dashboard is at `/lab`; existing investigation and evaluation links remain valid. Live execution advances manually, fixture rehearsal is explicitly scripted, and saved replay is read-only. The simplified view displays observed results, including early human review and errors, rather than assuming a successful correction.

TypeScript, production build, and **65 automated tests** passed. **13 desktop browser workflows** passed, including fixture progression and reload, the two final outputs, live run creation without automatic provider calls, missing-key handling, replay evidence isolation, a read-only early-stop replay, and all previous advanced workspace checks. No new live model calls were made during these checks. Mobile layouts remain out of scope.

## Decision explanations — 2026-10-12

The decision trail now separates saved input evidence, application rules, router proposals, applied steps, and subsequent results. Conflict explanations show the original values side by side. Confidence overrides show the actual proposal, saved threshold, and review fallback. Fixture scores are labeled as scripted, and a sole permitted human-review step is no longer described as an open routing choice.

TypeScript, the production build, and **62 automated tests** passed. **Nine desktop browser workflows** were verified, including conflict sources, source verification versus conflict resolution, and a confidence override that must not claim the undiscovered payer contradiction. Four new explanation tests verify historical evidence isolation, recorded thresholds, the distinction between Task Action and routing confidence, and missing-input handling for older checkpoints. No live provider requests or mobile changes were made for this update. These are summaries derived from the saved audit record, not model-written rationales or expanded accuracy scores.

## Previous backend validation

The current backend has 12 synthetic tools, 16 authored cases, 512 controlled variants, durable execution, and an OpenAI-only comparison mode. Mobile layout changes were excluded from this work.

| Check | Result |
| --- | --- |
| TypeScript and production build | Passed |
| Backend, API, persistence and provider contract tests | 58 passed |
| Desktop Chromium workflows | 8 passed |
| Full fixture corpus | 528 / 528 expected outcomes |
| Source grounding failures in fixture evaluation | 0 |
| Same-outcome variant comparisons | 416 / 416 consistent |
| Native PostgreSQL smoke | Two worker connections; three investigations and an atomic, deduplicated four-trial benchmark; pause/resume and state retained on reconnect |
| Docker bootstrap | PostgreSQL, API and worker healthy; migrations and seeding completed |

The fixture evaluation used no provider tokens. It tests deterministic routing, source grounding, policy gates, retries, and persistence. It does **not** establish JEV or OpenAI accuracy, calibration, or real payer-system behavior. Provider contract tests exercised the actual TypeSafe and OpenAI SDKs with mocked HTTP transports, including selection between multiple tools and the OpenAI baseline's explicit lack of a confidence distribution. Live-provider benchmarking was not run during this backend implementation.

The corpus result is summarized in `backend-fixture-summary.json`. The complete local report is `.data/backend-corpus-evaluation.json`; the evaluator also saved it in the separate local evaluation database. An engineering evaluation is not a clinical or billing benchmark: the variants share 16 authored families and their expected actions are synthetic labels.

The tests cover:

- A queued run reaching review without browser step requests.
- Competing worker claims, expired lease recovery, stale owner fencing, and a bounded recovery budget.
- Pause/resume, stale revision rejection, and queue persistence across database reopen.
- Transient tool failures, durable receipt reuse, cross-claim rejection, and immutable run source snapshots.
- Payer clarification changing with the requested topic rather than contact count.
- Premature/unsupported action rejection, conflicting evidence, exact source matching, and complete note citations.
- Atomic, idempotent synthetic handoffs after reviewer approval.
- Browser navigation and reload after queue acceptance, manual checkpoints, background execution, evidence review, export, approval, search and comparison.

Two integration issues found during validation were corrected: the page could resume with a stale revision immediately after pause, and the browser test needed to wait for queue acknowledgement before reloading. An unacknowledged request can still be interrupted by closing the page before the server receives it; accepted jobs are independent of the browser.

The local Docker stack uses port **3301** because another application occupies ports 3001 and 3002. This preference is saved as `APP_PORT=3301` in the existing `.env`. All six original investigations were imported into PostgreSQL and compared field-for-field with the export. Their embedded database remains intact. The running API reports PostgreSQL, one active worker, 528 cases, and 12 tools; allowed and rejected browser origins were verified on port 3301.

Reproduce with `make check`, `make test-browser`, `docker compose exec app npm run test:native`, and `make evaluate-all`. Start a small live comparison separately with `LIMIT=3 make compare`; it uses the configured provider accounts.

Evaluation report permissions were subsequently checked in the deployed container. The Docker image now creates `/app/.data` with ownership assigned to its `node` runtime user. After rebuilding, the exact `make evaluate` command completed with 16/16 passing cases and a readable JSON report. An intentionally unwritable output path was also verified to fail before any investigations or provider calls start.

Live-mode setup is now visible above the searchable, bounded case list. Desktop checks verify that the mode and start button are in the viewport, the choice survives reload, and the API creates and persists a `live` investigation with the selected case. The configuration page's direct live link and missing-key blocking were also checked. These tests use dummy keys and loopback-only provider URLs, and create live investigations without executing them; no real model connectivity or accuracy claim is implied. `make evaluate-live` now provides an explicit paid-provider evaluation entry point, limited to one authored case by default.

The Evaluations screen now supports repeatable paired batches, family/action-balanced sampling, fixed family splits, repeated trials, background execution, whole-batch pause/resume, and JSON export. New tests exercise duplicate requests, credential and batch-size validation, atomic creation, persistence across database reopen, frozen settings, missing source fields, failed extractions, paired denominators, and explicit token-price estimates. Desktop checks verify preview, pause/reload/resume, completed metrics, export, and read-only trial inspection. The native PostgreSQL check repeats batch creation through two connections and verifies no duplicate batch trials.

A deployed fixture evaluation covered all 16 authored families twice: **32/32 expected outcomes, 32/32 notes passing source checks, 100% returned source-field coverage, and 16/16 repeated cases with consistent actions**. It is saved as evaluation `1fdea162-e87c-46c6-a7ef-076057f5048e`, with an export at `.data/benchmark-fixture-validation.json`. It used zero provider tokens. The live comparison preview was checked separately without starting paid requests. Earlier saved interactive live runs demonstrate provider connectivity on individual cases; they are not paired benchmark results. No new live-provider comparison was run as part of this implementation.
