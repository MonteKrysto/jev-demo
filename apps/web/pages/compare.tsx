import { useSearchParams, Link } from "react-router-dom";
import { ArrowUpRight, GitCompareArrows } from "lucide-react";
import type { Run } from "../../../packages/core/domain";
import { actionLabel } from "../../../packages/core/evidence";
import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeading,
  Status,
} from "../components/ui";
import {
  dateTime,
  modeNames,
  number,
  runMetrics,
  shortId,
} from "../lib/format";
import { useWorkspace } from "../lib/workspace";

export function ComparePage() {
  const { runs } = useWorkspace();
  const [params, setParams] = useSearchParams();
  if (runs.isPending) return <Loading />;
  if (runs.isError)
    return (
      <ErrorState
        error={runs.error}
        retry={() => {
          void runs.refetch();
        }}
      />
    );
  const left = runs.data.find((r) => r.id === params.get("left"));
  const right = runs.data.find((r) => r.id === params.get("right"));
  function select(side: string, id: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (id) next.set(side, id);
      else next.delete(side);
      return next;
    });
  }
  const rows: { label: string; value: (run: Run) => string | number }[] = [
    { label: "Execution mode", value: (r) => modeNames[r.mode] },
    {
      label: "Task Action",
      value: (r) =>
        r.taskAction ? actionLabel(r.taskAction) : "Not yet determined",
    },
    { label: "Checkpoints", value: (r) => r.steps },
    { label: "Tool observations", value: (r) => r.receipts.length },
    { label: "Payer contacts", value: (r) => r.payerCalls },
    {
      label: "Verified facts",
      value: (r) => `${runMetrics(r).verified} / ${r.facts.length}`,
    },
    { label: "Conflicts", value: (r) => r.conflicts.length },
    { label: "Total tokens", value: (r) => number(runMetrics(r).tokens) },
    {
      label: "Summed provider time",
      value: (r) => `${(runMetrics(r).providerMs / 1000).toFixed(2)}s`,
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="COMPARE THE EVIDENCE"
        title="Two runs. A clearer picture."
        description="Inspect differences in actions, investigation steps, and provider usage."
        action={<Link className="button primary" to="/evaluations">Run a paired evaluation</Link>}
      />
      <div className="compare-selectors">
        {(["left", "right"] as const).map((side) => (
          <label key={side} className="compare-selector">
            <span className="field-label">
              {side === "left" ? "FIRST INVESTIGATION" : "SECOND INVESTIGATION"}
            </span>
            <select
              aria-label={
                side === "left" ? "First investigation" : "Second investigation"
              }
              value={params.get(side) ?? ""}
              onChange={(event) => select(side, event.target.value)}
            >
              <option value="">Choose an investigation</option>
              {runs.data.map((run) => (
                <option
                  key={run.id}
                  value={run.id}
                  disabled={
                    run.id === params.get(side === "left" ? "right" : "left")
                  }
                >
                  {run.claimId} · {modeNames[run.mode]} · {shortId(run.id)} ·{" "}
                  {dateTime(run.createdAt)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {left && right ? (
        <>
          {left.scenarioId !== right.scenarioId && (
            <p className="inline-notice">
              These runs use different cases. Their counts and timing are
              descriptive, not a controlled comparison.
            </p>
          )}
          {left.id === right.id && (
            <p className="inline-notice">
              Choose two different runs for a useful comparison.
            </p>
          )}
          <section className="panel">
            <div className="table-scroll">
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>Measure</th>
                    {[left, right].map((r, i) => (
                      <th key={i}>
                        <Link to={`/investigations/${r.id}`}>
                          {r.claimId} <ArrowUpRight size={15} />
                        </Link>
                        <span className="cell-sub mono">{shortId(r.id)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Status</td>
                    <td>
                      <Status run={left} />
                    </td>
                    <td>
                      <Status run={right} />
                    </td>
                  </tr>
                  {rows.map((row) => (
                    <tr
                      key={row.label}
                      className={
                        row.value(left) !== row.value(right) ? "different" : ""
                      }
                    >
                      <td>{row.label}</td>
                      <td>{row.value(left)}</td>
                      <td>{row.value(right)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="comparison-notes">
            {[left, right].map((run, index) => (
              <section className="panel" key={index}>
                <div className="panel-heading">
                  <h2>Completion note · {shortId(run.id)}</h2>
                </div>
                <pre>
                  {run.completionNote ??
                    "No completion note has been generated yet."}
                </pre>
              </section>
            ))}
          </div>
          <p className="footnote">
            Differences are highlighted. Fixture timing is not a model
            benchmark. These individual runs do not establish accuracy or a
            performance advantage.
          </p>
        </>
      ) : (
        <div className="panel">
          <EmptyState
            title="Bring two investigations side by side"
            action={<GitCompareArrows size={27} />}
          >
            Choose two saved runs above. Runs of the same case give the most
            useful comparison.
          </EmptyState>
        </div>
      )}
    </>
  );
}
