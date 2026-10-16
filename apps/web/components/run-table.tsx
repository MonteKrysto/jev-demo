import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { Run } from "../../../packages/core/domain";
import type { PublicScenario } from "../lib/api";
import { dateTime, modeNames, shortId } from "../lib/format";
import { useExecution } from "../lib/workspace";
import { EmptyState, NewRunLink, Status } from "./ui";

export function RunTable({
  runs,
  scenarios,
}: {
  runs: Run[];
  scenarios: PublicScenario[];
}) {
  const { activeId } = useExecution();
  if (!runs.length)
    return (
      <EmptyState title="No investigations here yet" action={<NewRunLink />}>
        Start a case to see the decisions, evidence, and resulting action.
      </EmptyState>
    );
  return (
    <div className="table-scroll">
      <table className="run-table">
        <thead>
          <tr>
            <th>Claim / investigation</th>
            <th>Case</th>
            <th>Execution</th>
            <th>Status</th>
            <th>Updated</th>
            <th>
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>
                <Link className="claim-link" to={`/investigations/${run.id}`}>
                  {run.claimId}
                </Link>
                <span className="mobile-case-title">
                  {scenarios.find((s) => s.id === run.scenarioId)?.title ??
                    run.scenarioId}
                </span>
                <span className="cell-sub mono">{shortId(run.id)}</span>
              </td>
              <td>
                {scenarios.find((s) => s.id === run.scenarioId)?.title ??
                  run.scenarioId}
                <span className="cell-sub">
                  {run.steps} checkpoints · {run.receipts.length} observations
                </span>
              </td>
              <td>
                <span className={`mode-pill ${run.mode}`}>
                  {modeNames[run.mode]}
                </span>
              </td>
              <td>
                <Status run={run} active={activeId === run.id} />
              </td>
              <td className="muted nowrap">{dateTime(run.updatedAt)}</td>
              <td>
                <Link
                  className="icon-button"
                  aria-label={`Open investigation ${shortId(run.id)}`}
                  to={`/investigations/${run.id}`}
                >
                  <ArrowUpRight size={17} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
