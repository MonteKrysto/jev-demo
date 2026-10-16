import { useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Download, Play, Pause } from "lucide-react";
import type { BenchmarkOptions, BenchmarkReport } from "../../../packages/core/benchmark";
import { api } from "../lib/api";
import { useWorkspace } from "../lib/workspace";
import { dateTime, downloadJson, modeNames, number } from "../lib/format";
import { EmptyState, ErrorState, Loading, PageHeading, Panel } from "../components/ui";

const percent = (n: number | null) => n === null ? "—" : `${(n * 100).toFixed(1)}%`;
const seconds = (n: number | null) => n === null ? "—" : `${(n / 1000).toFixed(2)}s`;

function Results({ report }: { report: BenchmarkReport }) {
  const { plan, analysis, results } = report;
  const [failuresOnly, setFailuresOnly] = useState(false);
  const rows = results.filter(row => !failuresOnly || row.finished && (!row.matched || !row.noteChecksPassed));
  type Summary = typeof analysis.summaries[number];
  const measures: { name: string; value: (s: Summary) => string | number }[] = [
    { name: "Finished trials", value: s => `${s.finished} / ${s.planned}` },
    { name: "Expected outcome reached", value: s => percent(s.accuracy) },
    { name: "Accuracy averaged across families", value: s => percent(s.familyAccuracy) },
    { name: "Wrong operational actions", value: s => s.wrongActions },
    { name: "Unnecessary human escalations", value: s => s.unnecessaryEscalations },
    { name: "Required escalations missed", value: s => s.missedEscalations },
    { name: "Stopped with an error", value: s => s.failed },
    { name: "Evidence validation failures", value: s => s.groundingFailures },
    { name: "Notes passing source checks", value: s => `${s.noteChecksPassed} / ${s.finished}` },
    { name: "Returned source fields captured", value: s => percent(s.meanSourceCoverage) },
    { name: "Tool attempts per trial", value: s => s.meanToolAttempts?.toFixed(1) ?? "—" },
    { name: "Active execution time · mean / p95", value: s => `${seconds(s.meanActiveMs)} / ${seconds(s.p95ActiveMs)}` },
    { name: "Input / output tokens", value: s => `${number(s.inputTokens)} / ${number(s.outputTokens)}` },
    { name: "Estimated token cost", value: s => s.estimatedCostUsd === null ? "Prices not supplied" : `$${s.estimatedCostUsd.toFixed(4)}` },
    { name: "Decisions with competing capabilities", value: s => s.routingChoices },
    { name: "Repeated cases with a stable action", value: s => `${s.stableRepeats} / ${s.repeatGroups}` },
  ];
  return <div className="stack" id="benchmark-results">
    <Panel title={analysis.complete ? "Completed evaluation" : "Evaluation in progress"}
      aside={<span className="tag">{analysis.finished} / {analysis.planned} trials finished</span>}>
      <div className="panel-body">
        <p>{analysis.cases} cases across {analysis.families} families · {plan.options.repeats} trial(s) per case and mode · {plan.options.split} split</p>
        <p className="muted">{plan.options.mode === "fixture" ? "Fixture check — no live model comparison." : "Live JEV + OpenAI compared with OpenAI-only routing."}
          {" "}Corpus v{plan.corpusVersion} · seed: {plan.options.seed}</p>
        <p className="muted">Requested models: {plan.models.jev} / {plan.models.openai}. Maximum {plan.settings.maxSteps} checkpoints and {plan.settings.maxPayerCalls} payer contacts per trial.
          JEV confidence gate: {percent(plan.settings.confidenceThreshold)}; OpenAI baseline has no confidence gate.</p>
        <p className="muted">Observed models: {[...new Set(results.flatMap(r => Object.keys(r.providerUsage)))].join(", ") || "No provider responses recorded"}.</p>
        {!analysis.complete && <p className="inline-notice">Results are provisional while trials are running. Pause takes effect after each active checkpoint.</p>}
      </div>
      <div className="table-scroll"><table className="comparison-table">
        <thead><tr><th>Measure</th>{analysis.summaries.map(s => <th key={s.mode}>{modeNames[s.mode]}</th>)}</tr></thead>
        <tbody>{measures.map(m => <tr key={m.name}><td>{m.name}</td>{analysis.summaries.map(s => <td key={s.mode}>{m.value(s)}</td>)}</tr>)}</tbody>
      </table></div>
      <div className="panel-note">Metrics use finished trials. Active time excludes queue waits and includes failed checkpoints. Cost uses your supplied USD-per-million-token prices; it excludes unreported usage, cache discounts, and account-specific charges. Note checks measure source coverage and citations, not writing quality.</div>
    </Panel>
    {plan.options.mode === "compare" && <Panel title="Paired outcomes">
      <div className="benchmark-pairs">
        <div><strong>{analysis.paired.bothCorrect}</strong><span>Both correct</span></div>
        <div><strong>{analysis.paired.liveOnlyCorrect}</strong><span>Only JEV + OpenAI correct</span></div>
        <div><strong>{analysis.paired.openaiOnlyCorrect}</strong><span>Only OpenAI baseline correct</span></div>
        <div><strong>{analysis.paired.bothWrong}</strong><span>Neither correct</span></div>
      </div>
      <div className="panel-note">{analysis.paired.count} completed pairs. Outcome accuracy difference, JEV + OpenAI minus OpenAI: {analysis.paired.accuracyDifference === null ? "—" : `${(analysis.paired.accuracyDifference * 100).toFixed(1)} percentage points`}.
        Repeats and variants share case families; this exploratory result does not establish statistical significance or a production advantage.</div>
    </Panel>}
    {plan.options.mode === "compare" && <Panel title="JEV action confidence">
      <div className="panel-body">{analysis.confidence.map(bin => <p key={bin.low}>
        {Math.round(bin.low * 100)}–{Math.round(bin.high * 100)}: {bin.correct} correct proposed actions / {bin.count} proposals
      </p>)}</div>
      <div className="panel-note">One final action proposal per finished JEV trial, including proposals blocked by policy. Confidence summarizes the model’s option distribution; these counts do not make it a calibrated probability of correctness. Trials that never proposed an action are excluded.</div>
    </Panel>}
    <Panel title="Inspect individual trials" aside={<label className="benchmark-filter"><input type="checkbox" checked={failuresOnly} onChange={e => setFailuresOnly(e.target.checked)} />Failures and mismatches only</label>}>
      <div className="table-scroll"><table className="comparison-table benchmark-trials">
        <thead><tr><th>Case / repeat</th><th>Mode</th><th>Expected</th><th>Observed</th><th>Result</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.runId}>
          <td><Link to={`/investigations/${row.runId}`}>{row.title}</Link><span className="cell-sub">Repeat {row.repeat} · {row.variant}</span></td>
          <td>{modeNames[row.mode]}</td><td>{row.expected}</td><td>{row.actual ?? "—"}</td>
          <td>{!row.finished ? "Pending" : row.status === "failed" ? "Failed" : row.matched ? "Expected outcome" : "Mismatch"}
            {row.reviewReason && <span className="cell-sub">{row.reviewReason}</span>}</td>
        </tr>)}</tbody>
      </table></div>
      {!rows.length && <p className="panel-body muted">No matching trials.</p>}
    </Panel>
    <Panel title="What this evidence can establish">
      <div className="panel-body">
        <p>These are authored synthetic workflows. The comparison holds case sources, tools, the OpenAI agent, evidence rules, and budgets constant. The routing provider and JEV confidence gate differ.</p>
        <p>Family splits prevent related variants from appearing in different splits. The cases were created while building this POC, so the test split is not an independently collected, unseen benchmark.</p>
        <p>For an adoption decision, add representative de-identified cases, RCM expert-reviewed expected actions and acceptable investigation paths, and blinded review of completion-note usefulness. This report cannot measure real payer integration or operational outcomes.</p>
      </div>
    </Panel>
  </div>;
}

export function EvaluationsPage() {
  const [params, setParams] = useSearchParams();
  const id = params.get("id") ?? "";
  const client = useQueryClient();
  const { config } = useWorkspace();
  const [options, setOptions] = useState<BenchmarkOptions>({ mode: "compare", scope: "curated", split: "development", limit: 3, repeats: 2, seed: "rcm-comparison-1" });
  const [rates, setRates] = useState(["", "", "", ""]);
  const pricesReady = rates.every(r => r === "") || rates.every(r => r.trim() !== "" && Number.isFinite(Number(r)) && Number(r) >= 0);
  const effective: BenchmarkOptions = { ...options, ...(rates.every(r => r.trim() !== "") && pricesReady ? {
    pricing: { jev: { input: Number(rates[0]), output: Number(rates[1]) }, openai: { input: Number(rates[2]), output: Number(rates[3]) } },
  } : {}) };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef<{ key: string; id: string } | null>(null);
  const list = useQuery({ queryKey: ["benchmarks"], queryFn: ({ signal }) => api.benchmarks(signal), refetchInterval: 5000 });
  const preview = useQuery({ queryKey: ["benchmark-preview", effective], queryFn: ({ signal }) => api.previewBenchmark(effective, signal), enabled: !id && pricesReady, retry: false });
  const report = useQuery({ queryKey: ["benchmark", id], queryFn: ({ signal }) => api.benchmark(id, signal), enabled: Boolean(id), refetchInterval: query => query.state.data?.analysis.complete ? false : 2000 });
  async function start(event: FormEvent) {
    event.preventDefault();
    if (busy || !preview.data || !pricesReady) return;
    setBusy(true); setError("");
    const key = JSON.stringify(effective);
    if (!requestId.current || requestId.current.key !== key) requestId.current = { key, id: crypto.randomUUID() };
    try {
      const created = await api.startBenchmark(requestId.current.id, effective);
      requestId.current = null;
      setParams({ id: created.id });
      await client.invalidateQueries({ queryKey: ["benchmarks"] });
    } catch (error) { setError(error instanceof Error ? error.message : "Could not start evaluation"); }
    finally { setBusy(false); }
  }
  async function control(action: "pause" | "resume") {
    setBusy(true); setError("");
    try { await api.controlBenchmark(id, action); await report.refetch(); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not update evaluation"); }
    finally { setBusy(false); }
  }
  return <>
    <PageHeading title="Evaluations" description="Compare routing approaches on the same evidence, with repeated trials and inspectable results."
      action={id && <button className="button primary" onClick={() => { setParams({}); setError(""); }}>New evaluation</button>} />
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!id ? <div className="settings-grid">
      <Panel title="Set up an evaluation">
        <form className="panel-body stack benchmark-form" onSubmit={start}>
          <label>Evaluation type<select value={options.mode} onChange={e => setOptions({ ...options, mode: e.target.value as BenchmarkOptions["mode"] })}>
            <option value="compare">Live JEV + OpenAI vs OpenAI baseline</option><option value="fixture">Fixture check · no provider calls</option>
          </select></label>
          <div className="benchmark-fields">
            <label>Case pool<select value={options.scope} onChange={e => setOptions({ ...options, scope: e.target.value as BenchmarkOptions["scope"] })}>
              <option value="curated">16 authored cases</option><option value="all">528 cases including variants</option>
            </select></label>
            <label>Case split<select value={options.split} onChange={e => setOptions({ ...options, split: e.target.value as BenchmarkOptions["split"] })}>
              <option value="development">Development families</option><option value="validation">Validation families</option><option value="test">Test families</option><option value="all">All families</option>
            </select></label>
            <label>Maximum cases<input type="number" min={1} max={528} required value={options.limit} onChange={e => setOptions({ ...options, limit: Number(e.target.value) })} /></label>
            <label>Trials per case and mode<input type="number" min={1} max={5} required value={options.repeats} onChange={e => setOptions({ ...options, repeats: Number(e.target.value) })} /></label>
          </div>
          <label>Selection seed<input required maxLength={80} value={options.seed} onChange={e => setOptions({ ...options, seed: e.target.value })} /></label>
          <details><summary>Optional pricing estimates</summary>
            <p className="muted">Enter USD per million tokens for your configured models. Leave all fields empty to report usage without a dollar estimate.</p>
            <div className="benchmark-fields">{["JEV input", "JEV output", "OpenAI input", "OpenAI output"].map((name, i) => <label key={name}>{name}<input type="number" min={0} max={10000} step="any" value={rates[i]} onChange={e => setRates(rates.map((r, index) => index === i ? e.target.value : r))} /></label>)}</div>
          </details>
          {!pricesReady && <p className="inline-notice">Enter all four prices, or leave all four empty.</p>}
          {preview.error && <p className="inline-error">{preview.error.message}</p>}
          {preview.data && <div className="context-note">
            <strong>{preview.data.cases.length} cases · {preview.data.families} families · {preview.data.runs} total runs</strong>
            <p>Each run can use up to {preview.data.maxSteps} checkpoints. Selection covers different families and expected actions. The same seed and options select the same cases.</p>
            <details><summary>Preview selected cases</summary><ul>{preview.data.cases.map(c => <li key={c.id}>{c.title}</li>)}</ul></details>
          </div>}
          {options.mode === "compare" && <p className="small-note">Starting this comparison makes paid requests to both configured providers. It uses synthetic records and saves no handoffs.</p>}
          {options.mode === "compare" && !config.data?.modes.live && <p className="inline-notice">Both provider keys are required. <Link to="/settings">View configuration</Link>.</p>}
          {preview.data && preview.data.runs > 160 && <p className="inline-notice">Reduce the sample or repeats to at most 160 total runs.</p>}
          <button className="button primary" disabled={busy || !pricesReady || preview.isFetching || !preview.data || preview.data.runs > 160 || options.mode === "compare" && !config.data?.modes.live}>
            <Play size={16} />{busy ? "Starting…" : options.mode === "compare" ? "Start paid comparison" : "Run fixture check"}
          </button>
        </form>
      </Panel>
      <Panel title="Saved evaluations">
        {list.isPending ? <Loading /> : list.isError ? <ErrorState error={list.error} retry={() => void list.refetch()} /> : list.data.length ?
          <div className="benchmark-history">{list.data.map(plan => <Link key={plan.id} to={`/evaluations?id=${plan.id}`}>
            <strong>{plan.options.mode === "compare" ? "Live comparison" : "Fixture check"}</strong>
            <span>{dateTime(plan.generatedAt)} · {plan.trials.length} trials · {plan.options.split}</span>
          </Link>)}</div> : <EmptyState title="No evaluations yet">Start a fixture check to verify the setup, or compare both live routing approaches.</EmptyState>}
      </Panel>
    </div> : report.isPending ? <Loading label="Loading evaluation…" /> : report.isError ? <ErrorState error={report.error} retry={() => void report.refetch()} /> : <>
      <div className="benchmark-actions">
        <button className="button secondary" onClick={() => downloadJson(report.data, `evaluation-${id}.json`)}><Download size={16} />Export evaluation</button>
        {!report.data.analysis.complete && <button className="button secondary" disabled={busy} onClick={() => void control(report.data.paused ? "resume" : "pause")}>
          {report.data.paused ? <Play size={16} /> : <Pause size={16} />}{report.data.paused ? "Resume evaluation" : "Pause evaluation"}
        </button>}
        <Link to="/evaluations" className="button ghost">All evaluations</Link>
      </div>
      <Results report={report.data} />
    </>}
  </>;
}
