import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FlaskConical,
  LoaderCircle,
  Search,
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Mode } from "../../../packages/core/domain";
import { api } from "../lib/api";
import { modeDescriptions, modeNames } from "../lib/format";
import { useExecution, useWorkspace } from "../lib/workspace";
import { ErrorState, Loading, PageHeading, Panel } from "../components/ui";

const executionModes = ["live", "demo", "jev", "openai"] as const;

export function NewInvestigationPage() {
  const { config, scenarios } = useWorkspace();
  const execution = useExecution();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState(
    params.get("case") ?? "records-appeal",
  );
  const requestedMode =
    executionModes.find((item) => item === params.get("mode")) ?? "demo";
  const [mode, setMode] = useState<Mode>(requestedMode);
  useEffect(() => setMode(requestedMode), [requestedMode]);
  const [search, setSearch] = useState("");
  const [automatic, setAutomatic] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  if (config.isPending || scenarios.isPending) return <Loading />;
  if (config.isError || scenarios.isError)
    return (
      <ErrorState
        error={config.error ?? scenarios.error}
        retry={() => {
          void config.refetch();
          void scenarios.refetch();
        }}
      />
    );
  const scenario = scenarios.data.find((s) => s.id === selected);
  const filtered = scenarios.data.filter((item) =>
    `${item.title} ${item.description} ${item.claimId}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  function selectMode(value: Mode) {
    setMode(value);
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("mode", value);
        return next;
      },
      { replace: true },
    );
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!scenario || creating || execution.activeId || !config.data?.modes[mode])
      return;
    setCreating(true);
    setError("");
    try {
      const run = await api.create(scenario.id, mode);
      await execution.remember(run);
      navigate(`/investigations/${run.id}`);
      if (automatic) void execution.execute(run, true);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not create the investigation.",
      );
    } finally {
      setCreating(false);
    }
  }
  return (
    <>
      <Link className="back-link" to="/investigations">
        <ArrowLeft size={16} />
        Investigations
      </Link>
      <PageHeading
        title="Start an investigation"
        description="Choose your providers, select a synthetic case, and start the investigation."
      />
      <form onSubmit={create} className="setup-grid">
        <div className="stack">
          <Panel title="01 · Choose an execution mode">
            <div
              className="mode-options"
              role="radiogroup"
              aria-label="Execution mode"
            >
              {executionModes.map((item) => (
                <label
                  key={item}
                  className={`mode-option ${mode === item ? "selected" : ""} ${!config.data.modes[item] ? "disabled" : ""}`}
                >
                  <input
                    type="radio"
                    name="mode"
                    aria-label={modeNames[item]}
                    value={item}
                    checked={mode === item}
                    disabled={!config.data.modes[item]}
                    onChange={() => selectMode(item)}
                  />
                  <span>
                    <strong>{modeNames[item]}</strong>
                    <small>{modeDescriptions[item]}</small>
                    <span
                      className={`tag ${config.data.modes[item] ? "green-tag" : ""}`}
                    >
                      {item === "demo"
                        ? "No API calls"
                        : config.data.modes[item]
                          ? "API keys configured"
                          : "Keys required"}
                    </span>
                  </span>
                  {mode === item && <Check size={18} aria-hidden="true" />}
                </label>
              ))}
            </div>
            <div className="panel-note">
              Live modes use your configured providers and incur API usage. All
              claim and payer data remains synthetic.
              {!config.data.modes.live && (
                <>
                  {" "}To enable JEV + OpenAI, configure both provider keys on the
                  server. <Link to="/settings">View configuration</Link>.
                </>
              )}
            </div>
          </Panel>
          <Panel
            title="02 · Choose a case"
            aside={
              <span className="tag">
                {filtered.length} of {scenarios.data.length} cases
              </span>
            }
          >
            <div className="setup-case-search">
              <label className="search-field">
                <Search size={17} />
                <input
                  type="search"
                  aria-label="Search cases"
                  placeholder="Search by claim ID, title, or evidence…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.preventDefault();
                  }}
                />
              </label>
            </div>
            <div
              className="case-options"
              role="radiogroup"
              aria-label="Synthetic case"
            >
              {filtered.map((item) => (
                <label
                  className={`case-option ${selected === item.id ? "selected" : ""}`}
                  key={item.id}
                >
                  <input
                    type="radio"
                    name="case"
                    value={item.id}
                    checked={selected === item.id}
                    onChange={() => setSelected(item.id)}
                  />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </span>
                  <span className="mono">{item.claimId}</span>
                </label>
              ))}
              {!filtered.length && (
                <p className="muted">
                  No matching cases. Try a claim ID or a different search term.
                </p>
              )}
            </div>
          </Panel>
        </div>
        <aside className="stack setup-summary">
          <Panel title="Investigation summary">
            <div className="panel-body">
              <div className="summary-icon">
                <FlaskConical size={25} />
              </div>
              <h2>{scenario?.title ?? "Choose a valid case"}</h2>
              <p className="muted">{scenario?.description}</p>
              <dl className="detail-list">
                <div>
                  <dt>Claim</dt>
                  <dd className="mono">{scenario?.claimId ?? "—"}</dd>
                </div>
                <div>
                  <dt>Execution</dt>
                  <dd>{modeNames[mode]}</dd>
                </div>
                {(mode === "live" || mode === "jev") && (
                  <div>
                    <dt>JEV model</dt>
                    <dd>{config.data.jevModel}</dd>
                  </div>
                )}
                {(mode === "live" || mode === "openai") && (
                  <div>
                    <dt>OpenAI model</dt>
                    <dd>{config.data.llmModel}</dd>
                  </div>
                )}
                <div>
                  <dt>Checkpoint limit</dt>
                  <dd>{config.data.maxSteps}</dd>
                </div>
                <div>
                  <dt>Confidence gate</dt>
                  <dd>
                    {mode === "openai"
                      ? "Not applied"
                      : `${Math.round(config.data.confidenceThreshold * 100)}%`}
                  </dd>
                </div>
              </dl>
              <fieldset className="start-options">
                <legend>How to begin</legend>
                <label>
                  <input
                    type="radio"
                    name="start"
                    checked={automatic}
                    onChange={() => setAutomatic(true)}
                  />
                  Run until review
                </label>
                <label>
                  <input
                    type="radio"
                    name="start"
                    checked={!automatic}
                    onChange={() => setAutomatic(false)}
                  />
                  Open and step through manually
                </label>
              </fieldset>
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
              {execution.activeId && (
                <p className="inline-notice">
                  Pause the active investigation before starting another.
                </p>
              )}
              {!config.data.modes[mode] && (
                <p className="inline-notice" role="status">
                  This mode needs provider keys.{" "}
                  <Link to="/settings">View configuration</Link> to enable it.
                </p>
              )}
              <button
                className="button primary full"
                disabled={
                  creating ||
                  !scenario ||
                  !config.data.modes[mode] ||
                  Boolean(execution.activeId)
                }
              >
                {creating ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <ArrowRight size={17} />
                )}
                Start investigation
              </button>
              <p className="small-note">
                The final action and completion note will be held for your
                review.
              </p>
            </div>
          </Panel>
        </aside>
      </form>
    </>
  );
}
