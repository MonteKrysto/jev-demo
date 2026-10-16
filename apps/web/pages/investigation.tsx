import { useState, type FormEvent } from "react";
import {
  ArrowLeft,
  CheckCheck,
  Copy,
  Download,
  FileCheck2,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  StepForward,
} from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { Run } from "../../../packages/core/domain";
import { actionLabel } from "../../../packages/core/evidence";
import { DecisionTrace } from "../components/trace";
import { Evidence } from "../components/evidence";
import {
  EmptyState,
  ErrorState,
  Loading,
  Panel,
  Status,
} from "../components/ui";
import {
  dateTime,
  downloadJson,
  modeNames,
  needsReview,
  number,
  runMetrics,
  shortId,
} from "../lib/format";
import { useExecution, useRun, useWorkspace } from "../lib/workspace";

function Outputs({ run }: { run: Run }) {
  const execution = useExecution();
  const [actor, setActor] = useState("Local reviewer");
  const [copyState, setCopyState] = useState("Copy note");
  async function copyNote() {
    try {
      await navigator.clipboard.writeText(run.completionNote ?? "");
      setCopyState("Copied");
    } catch {
      setCopyState("Select the text below to copy");
    }
  }
  function approve(event: FormEvent) {
    event.preventDefault();
    if (actor.trim()) void execution.approve(run, actor);
  }
  if (!run.completionNote)
    return (
      <EmptyState title="Outputs are being prepared">
        The proposed action and sourced completion note appear once the
        investigation reaches review.
      </EmptyState>
    );
  return (
    <div className="outputs-body">
      <div className="output-action">
        <span className="field-label">PROPOSED TASK ACTION</span>
        <h2>{run.taskAction ? actionLabel(run.taskAction) : "Pending"}</h2>
        {run.reviewReason && <p>{run.reviewReason}</p>}
      </div>
      <div className="note-heading">
        <h3>Completion note</h3>
        <button className="button subtle" onClick={copyNote}>
          <Copy size={15} />
          {copyState}
        </button>
      </div>
      <textarea
        className="completion-note"
        aria-label="Completion note"
        readOnly
        value={run.completionNote}
      />
      {run.status === "completed" ? (
        <div className="saved-banner">
          <CheckCheck size={20} />
          <div>
            <strong>Handoff saved by {run.approval?.actor}</strong>
            <p>
              {run.approval && dateTime(run.approval.at)} · {run.handoff?.id}
            </p>
          </div>
        </div>
      ) : run.benchmark ? (
        <p className="inline-notice">Evaluation output is preserved for comparison. <Link to={`/evaluations?id=${run.benchmark.id}`}>View evaluation</Link>.</p>
      ) : needsReview(run) ? (
        <form className="approval-form" onSubmit={approve}>
          <div>
            <h3>
              {run.status === "needs_human"
                ? "Record the review handoff"
                : "Review and approve"}
            </h3>
            <p>
              Check the action and its source evidence. This saves the handoff
              in the synthetic workspace.
            </p>
          </div>
          <label className="field-label" htmlFor="reviewer">
            Reviewer name
          </label>
          <input
            id="reviewer"
            maxLength={80}
            required
            value={actor}
            onChange={(e) => setActor(e.target.value)}
          />
          <button
            className="button primary"
            disabled={Boolean(execution.activeId) || !actor.trim()}
          >
            <CheckCheck size={17} />
            {run.status === "needs_human"
              ? "Save review handoff"
              : "Approve & save handoff"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function ProviderMetrics({ run }: { run: Run }) {
  const metrics = runMetrics(run);
  return (
    <div className="panel-body">
      <div className="metric-strip">
        <div>
          <strong>{number(metrics.tokens)}</strong>
          <span>Total tokens</span>
        </div>
        <div>
          <strong>{(metrics.providerMs / 1000).toFixed(1)}s</strong>
          <span>Summed call time</span>
        </div>
        <div>
          <strong>{metrics.modelCalls}</strong>
          <span>Live model calls</span>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Model</th>
              <th>Input tokens</th>
              <th>Output tokens</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {run.metrics.map((m, i) => (
              <tr key={i}>
                <td>
                  {m.model.startsWith("fixture")
                    ? "Fixture"
                    : m.provider === "jev"
                      ? "JEV"
                      : "OpenAI-compatible"}
                </td>
                <td className="mono">{m.model}</td>
                <td>{number(m.inputTokens)}</td>
                <td>{number(m.outputTokens)}</td>
                <td>{(m.ms / 1000).toFixed(2)}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small-note">
        Call time is summed provider duration, not wall-clock investigation
        time. Fixture timings do not measure model performance.
      </p>
    </div>
  );
}

export function InvestigationPage() {
  const { id = "" } = useParams();
  const query = useRun(id);
  const { scenarios } = useWorkspace();
  const execution = useExecution();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab") ?? "trace";
  const tab = ["trace", "evidence", "outputs", "usage"].includes(requestedTab)
    ? requestedTab
    : "trace";
  if (query.isPending) return <Loading label="Loading the investigation…" />;
  if (query.isError)
    return (
      <ErrorState
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
    );
  const run = query.data;
  const active = execution.activeIds.includes(run.id);
  const busy = Boolean(execution.activeId);
  const metrics = runMetrics(run);
  const scenario = scenarios.data?.find((s) => s.id === run.scenarioId);
  const chooseTab = (value: string) =>
    setParams({ tab: value }, { replace: true });
  const tabs = [
    {
      key: "trace",
      label: "Decision trail",
      count: run.events.filter((e) => e.kind === "decision").length,
    },
    { key: "evidence", label: "Evidence", count: run.facts.length },
    {
      key: "outputs",
      label: "Outputs & review",
      count: run.completionNote ? 2 : 0,
    },
    { key: "usage", label: "Model usage" },
  ];
  return (
    <>
      <Link className="back-link" to="/investigations">
        <ArrowLeft size={16} />
        Investigations
      </Link>
      <div className="run-heading">
        <div>
          <div className="run-title">
            <h1>{run.claimId}</h1>
            <Status run={run} active={active} />
          </div>
          <p>
            {scenario?.title ?? run.scenarioId}
            <span>·</span>
            <span className="mono">{shortId(run.id)}</span>
            <span>·</span>
            {modeNames[run.mode]}
          </p>
        </div>
        <div className="button-group">
        <Link className="button primary" to={`/demo/${run.id}?step=0&replay=1`}>Guided replay</Link>
        <button
          className="button secondary"
          onClick={() =>
            downloadJson(run, `investigation-${shortId(run.id)}.json`)
          }
        >
          <Download size={16} />
          Export run
        </button>
        </div>
      </div>
      <div className="run-control-bar">
        <div className="run-summary">
          <span>
            <strong>{run.steps}</strong> checkpoints
          </span>
          <span>
            <strong>{run.receipts.length}</strong> observations
          </span>
          <span>
            <strong>{run.payerCalls}</strong> payer contacts
          </span>
        </div>
        <div className="button-group">
          {run.benchmark ? (
            <Link className="button secondary" to={`/evaluations?id=${run.benchmark.id}`}>View evaluation</Link>
          ) : active ? (
            <>
              <span className="working-label">
                <LoaderCircle className="spin" size={15} />
                Working…
              </span>
              <button
                className="button secondary"
                disabled={execution.stopping}
                onClick={() => execution.pause(run.id)}
              >
                <Pause size={15} />
                {execution.stopping ? "Pausing…" : "Pause after step"}
              </button>
            </>
          ) : run.status === "ready" ? (
            <>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  void execution.execute(run, false);
                }}
              >
                <StepForward size={15} />
                Next checkpoint
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => {
                  void execution.execute(run, true);
                }}
              >
                <Play size={15} />
                Run to review
              </button>
            </>
          ) : run.status === "failed" ? (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                void execution.retry(run);
              }}
            >
              <RotateCcw size={15} />
              Retry investigation
            </button>
          ) : needsReview(run) ? (
            <button
              className="button primary"
              onClick={() => chooseTab("outputs")}
            >
              <FileCheck2 size={16} />
              Review outputs
            </button>
          ) : (
            <span className="saved-label">
              <CheckCheck size={17} />
              Review complete
            </span>
          )}
        </div>
      </div>
      {run.status === "failed" && (
        <div className="inline-error" role="alert">
          {run.reviewReason}
        </div>
      )}
      <div className="investigation-grid">
        <section className="panel investigation-panel">
          <div
            className="content-tabs"
            role="tablist"
            aria-label="Investigation views"
          >
            {tabs.map((item) => (
              <button
                role="tab"
                aria-selected={tab === item.key}
                aria-controls={
                  tab === item.key ? `panel-${item.key}` : undefined
                }
                tabIndex={tab === item.key ? 0 : -1}
                id={`tab-${item.key}`}
                key={item.key}
                className={tab === item.key ? "selected" : ""}
                onClick={() => chooseTab(item.key)}
                onKeyDown={(event) => {
                  const index = tabs.findIndex(
                    (entry) => entry.key === item.key,
                  );
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % tabs.length
                      : event.key === "ArrowLeft"
                        ? (index + tabs.length - 1) % tabs.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? tabs.length - 1
                            : null;
                  if (next === null) return;
                  event.preventDefault();
                  chooseTab(tabs[next].key);
                  document.getElementById(`tab-${tabs[next].key}`)?.focus();
                }}
              >
                {item.label}
                {item.count !== undefined && <span>{item.count}</span>}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`panel-${tab}`}
            aria-labelledby={`tab-${tab}`}
          >
            {tab === "evidence" ? (
              <Evidence run={run} />
            ) : tab === "outputs" ? (
              <Outputs run={run} />
            ) : tab === "usage" ? (
              <ProviderMetrics run={run} />
            ) : (
              <DecisionTrace run={run} />
            )}
          </div>
        </section>
        <aside className="stack run-sidebar">
          <Panel title="Investigation at a glance">
            <div className="panel-body">
              <span className="field-label">TASK ACTION</span>
              <h3 className="action-title">
                {run.taskAction
                  ? actionLabel(run.taskAction)
                  : "Gathering the evidence"}
              </h3>
              <p className="muted">
                {run.reviewReason ??
                  (run.taskAction
                    ? "Review the findings and sourced note before saving."
                    : "The next action will be determined from the findings.")}
              </p>
              <dl className="detail-list">
                <div>
                  <dt>Verified facts</dt>
                  <dd>
                    {metrics.verified} / {run.facts.length}
                  </dd>
                </div>
                <div>
                  <dt>Conflicts</dt>
                  <dd className={run.conflicts.length ? "warning-text" : ""}>
                    {run.conflicts.length}
                  </dd>
                </div>
                <div>
                  <dt>Tokens used</dt>
                  <dd>{number(metrics.tokens)}</dd>
                </div>
                <div>
                  <dt>Started</dt>
                  <dd>{dateTime(run.createdAt)}</dd>
                </div>
                <div>
                  <dt>Last updated</dt>
                  <dd>{dateTime(run.updatedAt)}</dd>
                </div>
              </dl>
            </div>
          </Panel>
          <div className="context-note">
            <FlaskNote />
            <h3>What’s happening here?</h3>
            <p>
              {run.mode === "demo"
                ? "This run uses scripted decisions and evidence extraction to demonstrate the workflow."
                : run.mode === "jev"
                  ? "JEV is making real routing decisions. Evidence extraction uses fixture agents."
                  : run.mode === "openai"
                    ? "OpenAI is routing and using tools under the same evidence and approval rules."
                    : "JEV is making routing decisions. OpenAI is executing assigned tools and extracting findings."}
            </p>
            <p>
              Claim records, payer contacts, and saved handoffs are synthetic.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
function FlaskNote() {
  return <span className="eyebrow">ABOUT THIS RUN</span>;
}
