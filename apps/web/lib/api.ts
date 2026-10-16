import type { Mode, Run, Scenario } from "../../../packages/core/domain";
import type { BenchmarkOptions, BenchmarkPlan, BenchmarkReport } from "../../../packages/core/benchmark";

export type PublicScenario = Pick<
  Scenario,
  "id" | "title" | "description" | "claimId"
>;
export interface AppConfig {
  syntheticOnly: boolean;
  modes: Record<Mode, boolean>;
  confidenceThreshold: number;
  maxSteps: number;
  maxPayerCalls: number;
  database: string;
  jevModel: string;
  llmModel: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ApiError(
      data?.error ??
        `The server returned ${response.status}. Please try again.`,
      response.status,
    );
  if (data === null)
    throw new ApiError(
      "The server returned an unreadable response. Check that the API is running.",
      response.status,
    );
  return data as T;
}

export interface Job {
  runId: string;
  status: "queued" | "running" | "paused" | "completed" | "failed";
  pauseRequested: boolean;
  attempts: number;
  lastError: string | null;
  benchmarkId?: string;
}
export const api = {
  benchmarks: (signal?: AbortSignal) => request<BenchmarkPlan[]>("/benchmarks", undefined, signal),
  benchmark: (id: string, signal?: AbortSignal) => request<BenchmarkReport>(`/benchmarks/${encodeURIComponent(id)}`, undefined, signal),
  previewBenchmark: (options: BenchmarkOptions, signal?: AbortSignal) => request<{
    cases: { id: string; title: string; family: string; variant: string }[];
    runs: number; families: number; maxSteps: number;
  }>("/benchmarks/preview", options, signal),
  startBenchmark: (id: string, options: BenchmarkOptions) => request<{ id: string }>("/benchmarks", { id, options }),
  controlBenchmark: (id: string, action: "pause" | "resume") => request(`/benchmarks/${id}/control`, { action }),
  jobs: (signal?: AbortSignal) => request<Job[]>("/jobs", undefined, signal),
  start: (run: Run) =>
    request<Job>(`/runs/${run.id}/start`, { expectedRevision: run.revision }),
  pause: (id: string) => request<Job>(`/runs/${id}/pause`, {}),
  config: (signal?: AbortSignal) =>
    request<AppConfig>("/config", undefined, signal),
  scenarios: (signal?: AbortSignal) =>
    request<PublicScenario[]>("/scenarios", undefined, signal),
  runs: (signal?: AbortSignal) => request<Run[]>("/runs", undefined, signal),
  run: (id: string, signal?: AbortSignal) =>
    request<Run>(`/runs/${encodeURIComponent(id)}`, undefined, signal),
  create: (scenarioId: string, mode: Mode) =>
    request<Run>("/runs", { scenarioId, mode }),
  step: (run: Run) =>
    request<Run>(`/runs/${run.id}/step`, { expectedRevision: run.revision }),
  retry: (run: Run) =>
    request<Run>(`/runs/${run.id}/retry`, { expectedRevision: run.revision }),
  approve: (run: Run, actor: string) =>
    request<Run>(`/runs/${run.id}/approve`, {
      expectedRevision: run.revision,
      actor,
    }),
};
