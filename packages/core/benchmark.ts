import { z } from "zod";
import type { Decision, Mode, Run, Scenario, Settings, TaskAction } from "./domain.js";
import { corpus, corpusVersion } from "./scenarios.js";
import { newRun } from "./engine.js";
import { verifyFacts } from "./evidence.js";

export const benchmarkOptionsSchema = z.object({
  mode: z.enum(["compare", "fixture"]).default("compare"),
  scope: z.enum(["curated", "all"]).default("curated"),
  split: z.enum(["all", "development", "validation", "test"]).default("development"),
  limit: z.number().int().min(1).max(528).default(3),
  repeats: z.number().int().min(1).max(5).default(2),
  seed: z.string().trim().min(1).max(80).default("rcm-comparison-1"),
  pricing: z.object({
    jev: z.object({ input: z.number().finite().min(0).max(10000), output: z.number().finite().min(0).max(10000) }).strict(),
    openai: z.object({ input: z.number().finite().min(0).max(10000), output: z.number().finite().min(0).max(10000) }).strict(),
  }).strict().optional(),
}).strict();
export type BenchmarkOptions = z.infer<typeof benchmarkOptionsSchema>;
export interface BenchmarkTrial {
  runId: string;
  scenarioId: string;
  title: string;
  family: string;
  variant: string;
  expected: TaskAction;
  mode: Mode;
  repeat: number;
}
export interface BenchmarkPlan {
  kind: "benchmark-v1";
  id: string;
  generatedAt: string;
  corpusVersion: number;
  selectionMethod: "family-action-balanced-v1";
  options: BenchmarkOptions;
  settings: Settings;
  models: { jev: string; openai: string };
  trials: BenchmarkTrial[];
}

function random(seed: string) {
  let state = 2166136261;
  for (const c of seed) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => {
    state += 0x6d2b79f5;
    let n = Math.imul(state ^ (state >>> 15), state | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(items: T[], next: () => number) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
/** Cover families first; balance expected actions within each round. Labels stay in the evaluator. */
export function selectBenchmarkCases(options: BenchmarkOptions): Scenario[] {
  const next = random(options.seed);
  const groups = new Map<string, Scenario[]>();
  for (const item of corpus) {
    if (options.scope === "curated" && item.variant !== "curated") continue;
    if (options.split !== "all" && item.split !== options.split) continue;
    const family = item.family ?? item.id;
    groups.set(family, [...(groups.get(family) ?? []), item]);
  }
  const buckets = shuffle([...groups.values()], next).map(items => shuffle(items, next));
  const selected: Scenario[] = [];
  const actionCounts = new Map<TaskAction, number>();
  for (let index = 0; selected.length < options.limit; index++) {
    const row = buckets.flatMap(items => items[index] ? [items[index]] : []);
    if (!row.length) break;
    while (row.length && selected.length < options.limit) {
      const minimum = Math.min(...row.map(item => actionCounts.get(item.expected) ?? 0));
      const nextIndex = row.findIndex(item => (actionCounts.get(item.expected) ?? 0) === minimum);
      const [item] = row.splice(nextIndex, 1);
      selected.push(item);
      actionCounts.set(item.expected, (actionCounts.get(item.expected) ?? 0) + 1);
    }
  }
  return selected;
}
export function makeBenchmarkPlan(
  id: string,
  options: BenchmarkOptions,
  settings: Settings,
  models: BenchmarkPlan["models"],
): { plan: BenchmarkPlan; runs: Run[] } {
  const trials: BenchmarkTrial[] = [];
  const runs: Run[] = [];
  const selected = selectBenchmarkCases(options);
  for (let repeat = 1; repeat <= options.repeats; repeat++) {
    for (const [index, scenario] of selected.entries()) {
      const modes: Mode[] = options.mode === "fixture" ? ["demo"]
        : (index + repeat) % 2 ? ["live", "openai"] : ["openai", "live"];
      for (const mode of modes) {
        const run = newRun(scenario.id, mode);
        run.purpose = "evaluation";
        run.benchmark = { id, settings, models };
        run.benchmarkOrder = runs.length;
        runs.push(run);
        trials.push({ runId: run.id, scenarioId: scenario.id, title: scenario.title,
          family: scenario.family ?? scenario.id, variant: scenario.variant ?? "curated",
          expected: scenario.expected, mode, repeat });
      }
    }
  }
  return { plan: { kind: "benchmark-v1", id, generatedAt: new Date().toISOString(),
    corpusVersion, selectionMethod: "family-action-balanced-v1", options, settings, models, trials }, runs };
}

export interface TrialResult extends BenchmarkTrial {
  status: Run["status"];
  finished: boolean;
  actual: TaskAction | null;
  matched: boolean;
  reviewReason: string | null;
  groundingFailure: boolean;
  noteChecksPassed: boolean;
  sourceCoverage: number | null;
  steps: number;
  toolAttempts: number;
  observations: number;
  providerMs: number;
  activeMs: number;
  estimatedCostUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  providerUsage: Record<string, { inputTokens: number; outputTokens: number; calls: number }>;
  routingChoices: number;
  proposedAction: TaskAction | null;
  actionConfidence: number | null;
}
export function scoreTrial(trial: BenchmarkTrial, run: Run, toolAttempts: number, pricing?: BenchmarkOptions["pricing"]): TrialResult {
  const finished = run.status !== "ready";
  const reviewable = ["awaiting_review", "needs_human", "completed"].includes(run.status);
  let groundingFailure = /authoritative tool receipt|source|citation|unverified fact/i.test(
    run.status === "failed" ? run.reviewReason ?? "" : "",
  );
  const copy = structuredClone(run);
  try { verifyFacts(copy); } catch { groundingFailure = true; }
  const sourceFields = run.receipts.flatMap(receipt => Object.entries(receipt.fields)
    .map(([key, value]) => ({ key, value, sourceId: receipt.id })));
  const covered = sourceFields.filter(field => run.facts.some(fact =>
    fact.key === field.key && fact.value === field.value && fact.sourceId === field.sourceId));
  const decisions = run.events.filter(e => e.kind === "decision").map(e => e.data as {
    response: Decision; request: { state: { execution: { eligibleAgents: string[] } } };
  });
  const action = [...decisions].reverse().find(d => d.response.answers.next_agent.choice === "task_action")
    ?.response.answers.task_action;
  const providerUsage: TrialResult["providerUsage"] = {};
  for (const metric of run.metrics) {
    if (metric.model.startsWith("fixture")) continue;
    const usage = providerUsage[metric.model] ??= { inputTokens: 0, outputTokens: 0, calls: 0 };
    usage.inputTokens += metric.inputTokens;
    usage.outputTokens += metric.outputTokens;
    usage.calls++;
  }
  return { ...trial, status: run.status, finished, actual: run.taskAction ?? null,
    matched: reviewable && run.taskAction === trial.expected,
    reviewReason: run.reviewReason ?? null, groundingFailure,
    noteChecksPassed: reviewable && !groundingFailure && Boolean(run.completionNote) &&
      covered.length === sourceFields.length &&
      run.facts.every(fact => run.completionNote!.includes(fact.value) && run.completionNote!.includes(fact.sourceId)),
    sourceCoverage: sourceFields.length ? covered.length / sourceFields.length : null,
    steps: run.steps, toolAttempts, observations: run.receipts.length,
    providerMs: run.metrics.reduce((n, m) => n + m.ms, 0),
    activeMs: run.activeMs ?? 0,
    estimatedCostUsd: trial.mode === "demo" ? 0 : pricing ? run.metrics.reduce((sum, metric) => {
      const price = metric.provider === "jev" ? pricing.jev : pricing.openai;
      return sum + (metric.inputTokens * price.input + metric.outputTokens * price.output) / 1_000_000;
    }, 0) : null,
    inputTokens: run.metrics.reduce((n, m) => n + m.inputTokens, 0),
    outputTokens: run.metrics.reduce((n, m) => n + m.outputTokens, 0), providerUsage,
    routingChoices: decisions.filter(d => d.request.state.execution.eligibleAgents
      .filter(a => a !== "human_review").length > 1).length,
    proposedAction: action?.choice ?? null, actionConfidence: action?.confidence ?? null };
}
function mean(values: number[]) {
  return values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
}
export function summarizeBenchmark(plan: BenchmarkPlan, results: TrialResult[]) {
  const summaries = [...new Set(plan.trials.map(t => t.mode))].map(mode => {
    const rows = results.filter(r => r.mode === mode && r.finished);
    const times = rows.map(r => r.activeMs).sort((a, b) => a - b);
    const families = [...new Set(rows.map(r => r.family))];
    const repeatGroups = [...new Set(rows.map(r => r.scenarioId))].map(id => rows.filter(r => r.scenarioId === id))
      .filter(group => group.length === plan.options.repeats && group.length > 1);
    return { mode, planned: plan.trials.filter(t => t.mode === mode).length, finished: rows.length,
      matched: rows.filter(r => r.matched).length, accuracy: mean(rows.map(r => Number(r.matched))),
      familyAccuracy: mean(families.map(f => mean(rows.filter(r => r.family === f).map(r => Number(r.matched)))!)),
      failed: rows.filter(r => r.status === "failed").length,
      wrongActions: rows.filter(r => r.actual && r.actual !== "human_review" && r.actual !== r.expected).length,
      unnecessaryEscalations: rows.filter(r => r.actual === "human_review" && r.expected !== "human_review").length,
      missedEscalations: rows.filter(r => r.expected === "human_review" && r.actual && r.actual !== "human_review").length,
      groundingFailures: rows.filter(r => r.groundingFailure).length,
      noteChecksPassed: rows.filter(r => r.noteChecksPassed).length,
      meanSourceCoverage: mean(rows.flatMap(r => r.sourceCoverage === null ? [] : [r.sourceCoverage])),
      meanToolAttempts: mean(rows.map(r => r.toolAttempts)),
      meanActiveMs: mean(times), p95ActiveMs: times.length ? times[Math.ceil(times.length * .95) - 1] : null,
      estimatedCostUsd: rows.length && rows.every(r => r.estimatedCostUsd !== null)
        ? rows.reduce((n, r) => n + r.estimatedCostUsd!, 0) : null,
      inputTokens: rows.reduce((n, r) => n + r.inputTokens, 0),
      outputTokens: rows.reduce((n, r) => n + r.outputTokens, 0),
      routingChoices: rows.reduce((n, r) => n + r.routingChoices, 0),
      repeatGroups: repeatGroups.length,
      stableRepeats: repeatGroups.filter(group => group.every(r => r.actual !== null && r.actual === group[0].actual && r.status !== "failed")).length,
    };
  });
  const pairs = results.filter(r => r.mode === "live" && r.finished).flatMap(live => {
    const openai = results.find(r => r.mode === "openai" && r.finished && r.scenarioId === live.scenarioId && r.repeat === live.repeat);
    return openai ? [{ scenarioId: live.scenarioId, repeat: live.repeat, live: live.matched, openai: openai.matched }] : [];
  });
  const confidence = [[0, .7], [.7, .9], [.9, 1.01]].map(([low, high]) => {
    const rows = results.filter(r => r.mode === "live" && r.finished && r.actionConfidence !== null && r.actionConfidence >= low && r.actionConfidence < high);
    return { low, high: Math.min(high, 1), count: rows.length,
      correct: rows.filter(r => r.proposedAction === r.expected).length };
  });
  return { summaries, confidence, paired: { count: pairs.length,
    bothCorrect: pairs.filter(p => p.live && p.openai).length,
    liveOnlyCorrect: pairs.filter(p => p.live && !p.openai).length,
    openaiOnlyCorrect: pairs.filter(p => !p.live && p.openai).length,
    bothWrong: pairs.filter(p => !p.live && !p.openai).length,
    accuracyDifference: mean(pairs.map(p => Number(p.live) - Number(p.openai))) },
    families: [...new Set(plan.trials.map(t => t.family))].length,
    cases: new Set(plan.trials.map(t => t.scenarioId)).size,
    finished: results.filter(r => r.finished).length, planned: plan.trials.length,
    complete: results.length === plan.trials.length && results.every(r => r.finished) };
}
export interface BenchmarkReport {
  plan: BenchmarkPlan;
  results: TrialResult[];
  analysis: ReturnType<typeof summarizeBenchmark>;
  paused: boolean;
}
export function sameBenchmarkOptions(left: BenchmarkOptions, right: BenchmarkOptions) {
  const normalize = (options: BenchmarkOptions) => JSON.stringify([
    options.mode, options.scope, options.split, options.limit, options.repeats, options.seed,
    options.pricing?.jev.input, options.pricing?.jev.output, options.pricing?.openai.input, options.pricing?.openai.output,
  ]);
  return normalize(left) === normalize(right);
}
