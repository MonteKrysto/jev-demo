import {
  CheckCircle2,
  Circle,
  Database,
  Server,
  ShieldCheck,
} from "lucide-react";
import { version } from "react";
import { Link } from "react-router-dom";
import { ErrorState, Loading, PageHeading, Panel } from "../components/ui";
import { modeDescriptions, modeNames } from "../lib/format";
import { useWorkspace } from "../lib/workspace";
import type { Mode } from "../../../packages/core/domain";

export function SettingsPage() {
  const { config } = useWorkspace();
  if (config.isPending)
    return <Loading label="Reading the server configuration…" />;
  if (config.isError)
    return (
      <ErrorState
        error={config.error}
        retry={() => {
          void config.refetch();
        }}
      />
    );
  const c = config.data;
  return (
    <>
      <PageHeading
        title="Configuration"
        description="Provider availability, execution limits, and the environment behind this workspace."
        action={
          <Link className="button primary" to="/investigations/new?mode=live">
            Start with JEV + OpenAI
          </Link>
        }
      />
      <div className="settings-grid">
        <Panel title="Execution modes">
          <div className="settings-modes">
            {(["demo", "jev", "live", "openai"] as Mode[]).map((mode) => (
              <div key={mode}>
                {c.modes[mode] ? (
                  <CheckCircle2 className="green-text" size={22} />
                ) : (
                  <Circle className="muted" size={22} />
                )}
                <div>
                  <h3>{modeNames[mode]}</h3>
                  <p>{modeDescriptions[mode]}</p>
                </div>
                <span className={`tag ${c.modes[mode] ? "green-tag" : ""}`}>
                  {c.modes[mode] ? "Configured" : "Keys required"}
                </span>
              </div>
            ))}
          </div>
          <div className="panel-note">
            Configured means credentials are present. It does not verify
            provider connectivity or model access.
          </div>
        </Panel>
        <Panel title="Execution limits">
          <div className="panel-body">
            <dl className="detail-list spacious">
              <div>
                <dt>Routing confidence gate</dt>
                <dd>{Math.round(c.confidenceThreshold * 100)}%</dd>
              </div>
              <div>
                <dt>Maximum checkpoints</dt>
                <dd>{c.maxSteps}</dd>
              </div>
              <div>
                <dt>Maximum payer contacts</dt>
                <dd>{c.maxPayerCalls ?? "—"}</dd>
              </div>
              <div>
                <dt>Final handoff</dt>
                <dd>Reviewer approval</dd>
              </div>
            </dl>
            <p className="small-note">
              The confidence gate is an illustrative setting, not a calibrated
              measure of decision accuracy.
            </p>
          </div>
        </Panel>
      </div>
      <Panel title="Environment">
        <div className="environment-grid">
          <div>
            <Database size={21} />
            <span>Database</span>
            <strong>{c.database}</strong>
          </div>
          <div>
            <Server size={21} />
            <span>JEV model</span>
            <strong>{c.jevModel}</strong>
          </div>
          <div>
            <Server size={21} />
            <span>LLM model</span>
            <strong>{c.llmModel}</strong>
          </div>
          <div>
            <ShieldCheck size={21} />
            <span>Application</span>
            <strong>React {version}</strong>
          </div>
        </div>
      </Panel>
      <div className="context-note settings-note">
        <h3>Configuration stays on the server</h3>
        <p>
          Update provider keys, model names, and limits in the server’s
          environment configuration, then restart the service. This page
          displays the effective nonsecret settings.
        </p>
        <p>
          For JEV + OpenAI, set <code>TYPESAFE_API_KEY</code> and{" "}
          <code>OPENAI_API_KEY</code> in <code>.env</code>, then run{" "}
          <code>make bootstrap</code> to apply them to the API and worker.
        </p>
        <p>
          Reviewer names are local labels. This development workspace does not
          authenticate reviewer identity.
        </p>
        <button
          className="button secondary"
          disabled={config.isFetching}
          onClick={() => {
            void config.refetch();
          }}
        >
          {config.isFetching ? "Refreshing…" : "Refresh configuration"}
        </button>
      </div>
    </>
  );
}
