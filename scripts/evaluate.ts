import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { configFromEnv, createEngine } from "../apps/api/config.js";
import { RunStore } from "../apps/api/store.js";
import { newRun } from "../packages/core/engine.js";
import { verifyFacts } from "../packages/core/evidence.js";
import { requiredFacts, toolCatalog } from "../packages/core/catalog.js";
import type { Mode, Run } from "../packages/core/domain.js";
import {
  corpus,
  corpusVersion,
  scenarios,
} from "../packages/core/scenarios.js";

const argument = (name: string) =>
  process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=");
const modes = (argument("modes") ?? argument("mode") ?? "demo").split(
  ",",
) as Mode[];
if (
  !modes.length ||
  modes.some((mode) => !["demo", "jev", "live", "openai"].includes(mode))
)
  throw new Error("Modes: demo, jev, live, openai");
const split = argument("split");
if (split && !["development", "validation", "test"].includes(split))
  throw new Error("Split: development, validation, test");
const limit = Number(argument("limit") ?? 528);
if (!Number.isInteger(limit) || limit < 1 || limit > 528)
  throw new Error("Limit must be between 1 and 528");
const scope = argument("cases") ?? "curated";
if (!["curated", "all"].includes(scope))
  throw new Error("Cases: curated or all");
const selected = (scope === "all" ? corpus : scenarios)
  .filter((s) => !split || s.split === split)
  .slice(0, limit);
const config = configFromEnv();
for (const mode of modes) createEngine(mode, config);
console.log(
  `${selected.length} cases × ${modes.length} modes = ${selected.length * modes.length} investigations; at most ${config.MAX_STEPS} checkpoints each.`,
);
if (process.argv.includes("--dry-run")) process.exit(0);
const output = resolve(
  argument("output") ?? `.data/evaluation-results-${modes.join("-")}.json`,
);
// Check report permissions before creating runs or making paid provider calls.
try {
  await mkdir(dirname(output), { recursive: true });
  await access(dirname(output), constants.W_OK);
  try {
    await access(output, constants.W_OK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
} catch (error) {
  throw new Error(
    `Cannot write the evaluation report to ${output}. Choose a writable --output path or rebuild the Docker image with make bootstrap. No investigations were started.`,
    { cause: error },
  );
}
const store = await RunStore.open({
  databaseUrl: config.DATABASE_URL,
  directory: ".data/evaluation-postgres",
});
interface EvaluationResult {
  scenarioId: string;
  family?: string;
  variant?: string;
  split?: string;
  mode: Mode;
  runId: string;
  expected: string;
  actual: string | null;
  status: Run["status"];
  matched: boolean;
  grounded: boolean;
  unrequestedReads: number;
  verifiedFacts: number;
  totalFacts: number;
  steps: number;
  payerCalls: number;
  observations: number;
  toolAttempts: number;
  elapsedMs: number;
  metrics: Run["metrics"];
  error: string | null | undefined;
}
const results: EvaluationResult[] = [];
try {
  for (const scenario of selected)
    for (const mode of modes) {
      const initial = newRun(scenario.id, mode);
      initial.purpose = "evaluation";
      let run = await store.create(initial);
      const engine = createEngine(mode, config, store);
      const start = performance.now();
      while (run.status === "ready")
        run = await store.mutate(run.id, run.revision, (current) =>
          engine.step(current),
        );
      const matched =
        run.taskAction === scenario.expected &&
        ["awaiting_review", "needs_human"].includes(run.status);
      let grounded = true;
      try {
        verifyFacts(run);
      } catch {
        grounded = false;
      }
      const requirements = requiredFacts(run);
      const unrequestedReads = run.receipts.filter(
        (r) =>
          !["get_claim", "call_payer", "get_documents"].includes(r.tool) &&
          !toolCatalog
            .find((t) => t.name === r.tool)
            ?.fields.some((f) => requirements.includes(f)),
      ).length;
      const invocations = await store.invocations(run.id);
      results.push({
        scenarioId: scenario.id,
        family: scenario.family,
        variant: scenario.variant,
        split: scenario.split,
        mode,
        runId: run.id,
        expected: scenario.expected,
        actual: run.taskAction ?? null,
        status: run.status,
        matched,
        grounded,
        unrequestedReads,
        verifiedFacts: run.facts.filter((f) => f.verified).length,
        totalFacts: run.facts.length,
        steps: run.steps,
        payerCalls: run.payerCalls,
        observations: run.receipts.length,
        toolAttempts: invocations.reduce(
          (sum, item) => sum + Number(item.attempts),
          0,
        ),
        elapsedMs: Math.round(performance.now() - start),
        metrics: run.metrics,
        error: run.status === "failed" ? run.reviewReason : null,
      });
      console.log(
        `${matched ? "PASS" : "FAIL"} ${mode} ${scenario.id}: ${run.taskAction ?? run.status} (${run.steps} checkpoints)`,
      );
    }
  const summary = Object.fromEntries(
    modes.map((mode) => {
      const rows = results.filter((r) => r.mode === mode);
      return [
        mode,
        {
          cases: rows.length,
          matched: rows.filter((r) => r.matched).length,
          accuracy: rows.filter((r) => r.matched).length / rows.length,
          groundingFailures: rows.filter((r) => !r.grounded).length,
          providerFailures: rows.filter((r) => r.status === "failed").length,
          escalations: rows.filter((r) => r.actual === "human_review").length,
          unnecessaryEscalations: rows.filter(
            (r) => r.actual === "human_review" && r.expected !== "human_review",
          ).length,
          unrequestedReads: rows.reduce(
            (sum, r) => sum + r.unrequestedReads,
            0,
          ),
          tokens: rows
            .flatMap((r) => r.metrics)
            .reduce((sum, m) => sum + m.inputTokens + m.outputTokens, 0),
          elapsedMs: rows.reduce((sum, r) => sum + r.elapsedMs, 0),
        },
      ];
    }),
  );
  const comparisons = selected.map((s) => ({
    scenarioId: s.id,
    expected: s.expected,
    outcomes: Object.fromEntries(
      results
        .filter((r) => r.scenarioId === s.id)
        .map((r) => [
          r.mode,
          {
            action: r.actual,
            matched: r.matched,
            steps: r.steps,
            toolAttempts: r.toolAttempts,
          },
        ]),
    ),
  }));
  const consistency = Object.fromEntries(
    modes.map((mode) => {
      const rows = results.filter((r) => r.mode === mode);
      const pairs = rows.flatMap((row) => {
        const anchor = rows.find(
          (other) =>
            other.scenarioId === row.family && other.expected === row.expected,
        );
        return anchor && anchor !== row
          ? [{ agrees: anchor.actual === row.actual }]
          : [];
      });
      return [
        mode,
        {
          sameExpectedPairs: pairs.length,
          consistent: pairs.filter((p) => p.agrees).length,
        },
      ];
    }),
  );
  const report = {
    generatedAt: new Date().toISOString(),
    corpusVersion,
    modes,
    scope,
    split: split ?? "all",
    models: { jev: config.TYPESAFE_MODEL, openai: config.LLM_MODEL },
    settings: {
      maxSteps: config.MAX_STEPS,
      maxPayerCalls: config.MAX_PAYER_CALLS,
      confidenceThreshold: config.CONFIDENCE_THRESHOLD,
    },
    fixtureOnly: modes.every((m) => m === "demo"),
    approvedWrites: 0,
    description:
      "Synthetic engineering evaluation. Variants share authored families; splits keep every family together. Accuracy is against fixture labels, not clinical validation. Unrequested reads are a proxy for tool inefficiency. The OpenAI baseline supplies no confidence distribution.",
    summary,
    consistency,
    comparisons,
    results,
  };
  const id = await store.saveEvaluation(report);
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    `Evaluation ${id}: ${results.filter((r) => r.matched).length}/${results.length} expected outcomes. Report: ${output}`,
  );
  if (results.some((r) => !r.matched || !r.grounded)) process.exitCode = 1;
} finally {
  await store.close();
}
