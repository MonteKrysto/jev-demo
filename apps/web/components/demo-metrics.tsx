import type { Run } from "../../../packages/core/domain";
import { number } from "../lib/format";
import { recordedDuration, runUsage } from "../lib/run-usage";

export function DemoMetrics({ run, historical, active }: { run: Run; historical: boolean; active: boolean }) {
  const usage = runUsage(run);
  return <section className="demo-metrics" aria-label="Run metrics">
    <div className="demo-metrics-heading"><h2>Run metrics</h2><span>{historical ? "Full saved run · independent of replay position" : active ? "Updates after each step" : "Recorded totals"}</span></div>
    <dl className="demo-metrics-strip">
      <div><dt>Execution time</dt><dd>{recordedDuration(usage.executionMs)}</dd></div>
      <div><dt>Provider time</dt><dd>{recordedDuration(usage.providerMs)}</dd></div>
      <div><dt>Model tokens</dt><dd>{number(usage.tokens)}</dd></div>
      <div><dt>Model calls</dt><dd>{number(usage.modelCalls)}</dd></div>
      <div><dt>Tool results</dt><dd>{number(run.receipts.length)}</dd></div>
      <div><dt>Steps recorded</dt><dd>{number(run.steps)}</dd></div>
    </dl>
    <p className="demo-metrics-caption">Execution time covers recorded step attempts, excluding pauses and queue waits. Provider time sums recorded model calls.</p>
    <details className="demo-metrics-breakdown"><summary>Provider breakdown · input/output tokens and timing</summary>
      {usage.providers.length ? <div className="table-scroll"><table aria-label="Provider usage breakdown"><thead><tr>
        <th scope="col">Provider</th><th scope="col">Model</th><th scope="col">Calls</th><th scope="col">Time</th><th scope="col">Input tokens</th><th scope="col">Output tokens</th>
      </tr></thead><tbody>{usage.providers.map(row => <tr key={`${row.provider}:${row.model}`}>
        <th scope="row">{row.provider === "jev" ? "JEV" : "OpenAI"}</th><td>{row.model}</td><td>{number(row.calls)}</td><td>{recordedDuration(row.ms)}</td><td>{number(row.inputTokens)}</td><td>{number(row.outputTokens)}</td>
      </tr>)}</tbody></table></div> : <p>{run.mode === "demo" ? "Fixture only uses scripted responses and makes no model API calls." : "No model-call responses have been recorded yet."}</p>}
    </details>
  </section>;
}
