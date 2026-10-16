import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, LoaderCircle, Pause, Play } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import type { Run } from "../../../packages/core/domain";
import { actionLabel } from "../../../packages/core/evidence";
import { api } from "../lib/api";
import { demoFrame, demoNote } from "../lib/demo";
import { demoModes, demoModeNames, demoModeDescriptions, type DemoMode } from "../lib/demo-modes";
import { sourceNames } from "../lib/decision-explanation";
import { dateTime, number, runMetrics, shortId, statusNames } from "../lib/format";
import { recordedDuration, runUsage } from "../lib/run-usage";
import { useExecution, useWorkspace } from "../lib/workspace";
import { ErrorState, Loading } from "../components/ui";
import { InvestigationSequence } from "./demo";

export function DemoCompare() {
  const { config, scenarios, runs } = useWorkspace();
  const execution = useExecution();
  const client = useQueryClient();
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: ({ signal }) => api.jobs(signal), refetchInterval: 1000 });
  const [params, setParams] = useSearchParams();
  const scenarioId = params.get("case") ?? "corrected-claim";
  const [pending, setPending] = useState(false);
  const creating = useRef(false);
  const [errors, setErrors] = useState<Partial<Record<DemoMode, string>>>({});
  const ids = demoModes.map(mode => params.get(mode) ?? "");
  const selected = useQueries({ queries: ids.map(id => ({
    queryKey: ["run", id], queryFn: ({ signal }: { signal: AbortSignal }) => api.run(id, signal),
    enabled: Boolean(id), refetchInterval: 1000,
  })) });

  // Pin the initial choices in the URL. Later list refreshes must not silently
  // replace a selected run; explicitly selected older runs load by ID.
  useEffect(() => {
    if (!runs.data || demoModes.every(mode => params.has(mode))) return;
    const next = new URLSearchParams(params);
    next.set("case", scenarioId);
    for (const mode of demoModes) if (!next.has(mode)) {
      next.set(mode, runs.data.find(run => run.scenarioId === scenarioId && run.mode === mode)?.id ?? "");
    }
    setParams(next, { replace: true });
  }, [runs.data, params, scenarioId, setParams]);

  if (config.isPending || scenarios.isPending || runs.isPending) return <Loading label="Preparing the comparison…" />;
  if (config.isError || scenarios.isError || runs.isError) return <ErrorState error={config.error ?? scenarios.error ?? runs.error} retry={() => { void config.refetch(); void scenarios.refetch(); void runs.refetch(); }} />;
  const scenario = scenarios.data.find(item => item.id === scenarioId);
  if (!scenario) return <ErrorState error={new Error("This case is not available. Return to the demo to choose an investigation.")} />;
  const matched = selected.map(query => query.data?.scenarioId === scenarioId ? query.data : undefined);
  const compared = matched.map((run, index) => run?.mode === demoModes[index] ? run : undefined);
  const busy = pending || Boolean(execution.activeId);
  const allAvailable = demoModes.every(mode => config.data.modes[mode]);
  function change(mode: DemoMode, id: string) {
    setErrors(previous => ({ ...previous, [mode]: undefined }));
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.set(mode, id);
      return next;
    });
  }
  function resume(mode: DemoMode, run: Run) {
    setErrors(previous => ({ ...previous, [mode]: undefined }));
    void execution.execute(run, true);
  }

  async function launch(modes: readonly DemoMode[]) {
    if (creating.current || busy || modes.some(mode => !config.data?.modes[mode])) return;
    creating.current = true;
    setPending(true);
    setErrors({});
    const next = new URLSearchParams(params);
    // Each created run is selected before it is queued. If queueing fails,
    // it stays visible and can be resumed without creating a duplicate.
    try {
      for (const mode of modes) {
        try {
          const run = await api.create(scenarioId, mode);
          await execution.remember(run);
          next.set(mode, run.id);
          setParams(new URLSearchParams(next), { replace: true });
          await api.start(run);
        } catch (error) {
          setErrors(previous => ({ ...previous, [mode]: error instanceof Error ? error.message : "Could not start this run." }));
        }
        await client.invalidateQueries({ queryKey: ["jobs"] });
      }
    } finally {
      creating.current = false;
      setPending(false);
      void client.invalidateQueries({ queryKey: ["runs"] });
    }
  }

  const rows: { label: string; key: (run: Run) => string | number; render: (run: Run) => ReactNode }[] = [
    { label: "Task Action", key: run => run.taskAction ?? "", render: run => <strong>{run.taskAction ? actionLabel(run.taskAction) : "Not yet determined"}</strong> },
    { label: "Review / stop reason", key: run => run.reviewReason ?? "", render: run => run.reviewReason ?? (run.status === "awaiting_review" ? "Outputs ready for human review." : run.status === "completed" ? "Synthetic handoff saved." : "Investigation has not finished.") },
    { label: "Evidence gathered", key: run => run.receipts.map(receipt => receipt.tool).join(","), render: run => run.receipts.length ? <ul>{run.receipts.map(receipt => <li key={receipt.id}>{sourceNames[receipt.tool] ?? receipt.tool}</li>)}</ul> : "No tool findings yet" },
    { label: "Steps completed", key: run => run.steps, render: run => run.steps },
    { label: "Verified facts", key: run => `${runMetrics(run).verified}/${run.facts.length}`, render: run => `${runMetrics(run).verified} / ${run.facts.length}` },
    { label: "Conflicts found", key: run => run.conflicts.length, render: run => run.conflicts.length },
    { label: "Execution time", key: run => runUsage(run).executionMs ?? "not-recorded", render: run => recordedDuration(runUsage(run).executionMs) },
    { label: "Summed provider time", key: run => runUsage(run).providerMs, render: run => recordedDuration(runUsage(run).providerMs) },
    { label: "JEV time", key: run => runUsage(run).jevMs, render: run => recordedDuration(runUsage(run).jevMs) },
    { label: "OpenAI time", key: run => runUsage(run).openaiMs, render: run => recordedDuration(runUsage(run).openaiMs) },
    { label: "Model calls", key: run => runUsage(run).modelCalls, render: run => number(runUsage(run).modelCalls) },
    { label: "Model tokens", key: run => runUsage(run).tokens, render: run => number(runUsage(run).tokens) },
    { label: "Completion note", key: run => demoNote(run, receipt => sourceNames[receipt.tool] ?? receipt.tool), render: run => <p className="demo-note">{demoNote(run, receipt => sourceNames[receipt.tool] ?? receipt.tool) || "No completion note yet."}</p> },
  ];

  return <div className="demo-comparison">
    <Link className="back-link" to="/"><ArrowLeft size={15} />Demo</Link>
    <div className="demo-comparison-heading"><div><h1>One case. Three approaches.</h1><p>{scenario.claimId} · {scenario.title}</p></div>
      <button className="button primary" disabled={busy || !allAvailable} onClick={() => void launch(demoModes)}>{pending ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}Run all three</button>
    </div>
    <p className="demo-comparison-description">Compare the same case with scripted responses, OpenAI alone, and OpenAI with JEV. Start new runs or choose saved results below.</p>
    <p className="demo-comparison-cost">“Run all three” creates three new investigations and runs them automatically to review. Agent modes make paid API calls. Fixture only uses no model APIs.</p>
    {!allAvailable && <p className="inline-notice">Some modes need provider keys. Available modes can still run individually. <Link to="/settings">Configure providers</Link>.</p>}
    <div className="demo-comparison-scroll"><table className="demo-comparison-table" aria-label="Mode comparison">
      <thead><tr><th scope="col">{scenario.claimId}</th>{demoModes.map((mode, index) => {
        const run = compared[index];
        const job = jobs.data?.find(job => job.runId === run?.id);
        const active = Boolean(run && execution.activeIds.includes(run.id));
        const options = runs.data.filter(item => item.scenarioId === scenarioId && item.mode === mode);
        if (run && !options.some(item => item.id === run.id)) options.unshift(run);
        return <th scope="col" key={mode}><h2>{demoModeNames[mode]}</h2><p>{demoModeDescriptions[mode]}</p>
          <label><span className="sr-only">{demoModeNames[mode]} run</span><select aria-label={`${demoModeNames[mode]} run`} value={ids[index]} disabled={pending || active} onChange={event => change(mode, event.target.value)}>
            <option value="">Choose a saved run</option>
            {ids[index] && !options.some(item => item.id === ids[index]) && <option value={ids[index]}>Selected run · {shortId(ids[index])}</option>}
            {options.map(item => <option key={item.id} value={item.id}>{dateTime(item.createdAt)} · {shortId(item.id)}</option>)}
          </select></label>
          <div className="demo-comparison-controls">
            {active ? <button className="button secondary" disabled={job?.pauseRequested} onClick={() => execution.pause(run!.id)}><Pause size={14} />{job?.pauseRequested ? "Pausing…" : "Pause after step"}</button>
              : run?.status === "ready" && !run.benchmark ? <button className="button primary" disabled={busy || !config.data.modes[mode]} onClick={() => resume(mode, run)}><Play size={14} />Run to completion</button>
                : <button className="button secondary" disabled={busy || !config.data.modes[mode]} onClick={() => void launch([mode])}>Start new run</button>}
            {run && <Link to={`/demo/${run.id}`} aria-label={`Open ${demoModeNames[mode]} investigation`}>Open investigation <ArrowUpRight size={13} /></Link>}
          </div>
          <span className="demo-comparison-status" role="status">{active ? job?.status === "running" ? "Running…" : "Queued…" : job?.status === "paused" && run?.status === "ready" ? "Paused" : run ? statusNames[run.status] : ids[index] && selected[index].isPending ? "Loading run…" : "No run selected"}</span>
          {selected[index].isError && <p className="inline-error" role="alert">Could not load the selected run. Choose another saved run.</p>}
          {selected[index].data && !run && <p className="inline-error" role="alert">This run uses a different case or mode. Choose a matching run.</p>}
          {errors[mode] && <p className="inline-error" role="alert">{errors[mode]}</p>}
        </th>;
      })}</tr></thead>
      <tbody>{rows.map(row => {
        const values = compared.flatMap(run => run ? [row.key(run)] : []);
        return <tr key={row.label} className={new Set(values).size > 1 ? "different" : ""}><th scope="row">{row.label}</th>{compared.map((run, index) => <td key={demoModes[index]}>{run ? row.render(run) : "—"}</td>)}</tr>;
      })}
      <tr><th scope="row">Sequence taken</th>{compared.map((run, index) => <td key={demoModes[index]}>{run ? <details className="demo-comparison-sequence"><summary>Show sequence · {run.steps} steps</summary><InvestigationSequence run={run} frame={demoFrame(run, Infinity)} decisionLabel={run.mode === "demo" ? "Fixture decision (scripted)" : run.mode === "openai" ? "OpenAI routing" : "JEV decision"} /></details> : "—"}</td>)}</tr>
      </tbody>
    </table></div>
    <p className="demo-comparison-footnote">Execution time excludes pauses and queue waits; provider time sums recorded model calls. Older runs without execution timing show “Not recorded”. Differences are highlighted. All three modes use synthetic tools and application evidence checks; fixture results are scripted. Matching actions, fewer steps, or faster runs do not establish greater accuracy. Agent only has no JEV confidence gate.</p>
  </div>;
}
