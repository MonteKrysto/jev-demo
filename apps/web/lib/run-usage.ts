import type { Run } from "../../../packages/core/domain";

export function runUsage(run: Run) {
  const models = new Map<string, {
    provider: "jev" | "llm"; model: string; calls: number; ms: number; inputTokens: number; outputTokens: number;
  }>();
  for (const metric of run.metrics) {
    // Fixture router records are execution bookkeeping, not model API calls.
    if (metric.model.startsWith("fixture")) continue;
    const key = JSON.stringify([metric.provider, metric.model]);
    const row = models.get(key) ?? { provider: metric.provider, model: metric.model, calls: 0, ms: 0, inputTokens: 0, outputTokens: 0 };
    row.calls++;
    row.ms += metric.ms;
    row.inputTokens += metric.inputTokens;
    row.outputTokens += metric.outputTokens;
    models.set(key, row);
  }
  const providers = [...models.values()];
  const inputTokens = providers.reduce((sum, row) => sum + row.inputTokens, 0);
  const outputTokens = providers.reduce((sum, row) => sum + row.outputTokens, 0);
  const notStarted = run.steps === 0 && run.events.length === 0 && run.metrics.length === 0;
  return {
    executionMs: run.activeMs ?? (notStarted ? 0 : null),
    providerMs: providers.reduce((sum, row) => sum + row.ms, 0),
    jevMs: providers.filter(row => row.provider === "jev").reduce((sum, row) => sum + row.ms, 0),
    openaiMs: providers.filter(row => row.provider === "llm").reduce((sum, row) => sum + row.ms, 0),
    modelCalls: providers.reduce((sum, row) => sum + row.calls, 0),
    tokens: inputTokens + outputTokens, inputTokens, outputTokens, providers,
  };
}

export function recordedDuration(ms: number | null) {
  if (ms === null) return "Not recorded";
  if (ms > 0 && ms < 10) return "<0.01s";
  return `${(ms / 1000).toFixed(2)}s`;
}
