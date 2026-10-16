import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Run } from "../../../packages/core/domain";
import { api, ApiError } from "./api";

export function useWorkspace() {
  const config = useQuery({
    queryKey: ["config"],
    queryFn: ({ signal }) => api.config(signal),
    staleTime: 30_000,
  });
  const scenarios = useQuery({
    queryKey: ["scenarios"],
    queryFn: ({ signal }) => api.scenarios(signal),
    staleTime: Infinity,
  });
  const runs = useQuery({
    queryKey: ["runs"],
    queryFn: ({ signal }) => api.runs(signal),
    refetchInterval: 10_000,
  });
  return { config, scenarios, runs };
}
export function useRun(id: string) {
  return useQuery({
    queryKey: ["run", id],
    queryFn: ({ signal }) => api.run(id, signal),
    enabled: Boolean(id),
    refetchInterval: 1_000,
  });
}

interface Execution {
  activeId: string | null;
  activeIds: string[];
  stopping: boolean;
  error: string | null;
  execute: (run: Run, automatic: boolean) => Promise<void>;
  pause: (id?: string) => void;
  approve: (run: Run, actor: string) => Promise<void>;
  retry: (run: Run) => Promise<void>;
  remember: (run: Run) => Promise<void>;
  dismissError: () => void;
}
const ExecutionContext = createContext<Execution | null>(null);

export function ExecutionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const lock = useRef(false);
  const mounted = useRef(true);
  const [pendingId, setActiveId] = useState<string | null>(null);
  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: ({ signal }) => api.jobs(signal),
    refetchInterval: 1000,
  });
  const activeJobs = (jobs.data ?? []).filter((job) =>
    !job.benchmarkId && ["queued", "running"].includes(job.status),
  );
  const activeIds = [
    ...new Set([
      ...(pendingId ? [pendingId] : []),
      ...activeJobs.map((job) => job.runId),
    ]),
  ];
  const activeId = activeIds[0] ?? null;
  const stopping = activeJobs.some((job) => job.pauseRequested);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function remember(run: Run) {
    // Cancel older reads so a slow response cannot overwrite a completed mutation.
    await Promise.all([
      client.cancelQueries({ queryKey: ["run", run.id] }),
      client.cancelQueries({ queryKey: ["runs"] }),
    ]);
    client.setQueryData(["run", run.id], run);
    client.setQueryData<Run[]>(["runs"], (previous) =>
      [run, ...(previous ?? []).filter((r) => r.id !== run.id)]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 50),
    );
  }
  async function operation(run: Run, work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setActiveId(run.id);
    setError(null);
    try {
      await work();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await api
          .run(run.id)
          .then(remember)
          .catch(() => undefined);
      }
      if (mounted.current)
        setError(
          error instanceof Error
            ? error.message
            : "The investigation could not be updated.",
        );
    } finally {
      lock.current = false;
      if (mounted.current) {
        setActiveId(null);
      }
      void client.invalidateQueries({ queryKey: ["runs"] });
      void client.invalidateQueries({ queryKey: ["jobs"] });
    }
  }
  const value: Execution = {
    activeId,
    activeIds,
    stopping,
    error,
    remember,
    dismissError: () => setError(null),
    pause: (id = activeId ?? undefined) => {
      if (!id) return;
      void api
        .pause(id)
        .then(() => client.invalidateQueries({ queryKey: ["jobs"] }))
        .catch((error) => setError(error.message));
    },
    execute: (run, automatic) =>
      operation(run, async () => {
        if (automatic) {
          const current = await api.run(run.id);
          await remember(current);
          await api.start(current);
        } else await remember(await api.step(run));
      }),
    retry: (run) =>
      operation(run, async () => {
        await remember(await api.retry(run));
      }),
    approve: (run, actor) =>
      operation(run, async () => {
        await remember(await api.approve(run, actor.trim()));
      }),
  };
  return (
    <ExecutionContext.Provider value={value}>
      {children}
    </ExecutionContext.Provider>
  );
}
export function useExecution() {
  const context = useContext(ExecutionContext);
  if (!context) throw new Error("ExecutionProvider is missing");
  return context;
}
