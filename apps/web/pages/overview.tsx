import {
  ArrowRight,
  ArrowUpRight,
  CheckCheck,
  FileSearch,
  GitBranch,
  Layers3,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useWorkspace } from "../lib/workspace";
import { needsReview, number } from "../lib/format";
import {
  ErrorState,
  Loading,
  NewRunLink,
  PageHeading,
  Panel,
} from "../components/ui";
import { RunTable } from "../components/run-table";

export function OverviewPage() {
  const { runs, scenarios } = useWorkspace();
  if (runs.isPending || scenarios.isPending) return <Loading />;
  if (runs.isError || scenarios.isError)
    return (
      <ErrorState
        error={runs.error ?? scenarios.error}
        retry={() => {
          void runs.refetch();
          void scenarios.refetch();
        }}
      />
    );
  const records = runs.data;
  const stats = [
    {
      label: "Investigations",
      value: records.length,
      note: "Most recent 50 runs",
      icon: Layers3,
    },
    {
      label: "Awaiting review",
      value: records.filter(needsReview).length,
      note: "Ready for a human decision",
      icon: FileSearch,
    },
    {
      label: "Handoffs saved",
      value: records.filter((r) => r.status === "completed").length,
      note: "Reviewed and recorded",
      icon: CheckCheck,
    },
    {
      label: "Evidence gathered",
      value: records.reduce((n, r) => n + r.facts.length, 0),
      note: "Facts across loaded runs",
      icon: GitBranch,
    },
  ];
  return (
    <>
      <PageHeading
        eyebrow="THE INVESTIGATION WORKSPACE"
        title="See the evidence. Understand the decision."
        description="A shared workspace for JEV decisions, agent execution, and claim review."
        action={<NewRunLink />}
      />
      <div className="stats-grid">
        {stats.map(({ label, value, note, icon: Icon }) => (
          <div className="stat-card" key={label}>
            <div>
              <span>{label}</span>
              <Icon size={18} />
            </div>
            <strong>{number(value)}</strong>
            <small>{note}</small>
          </div>
        ))}
      </div>
      <section className="intro-panel">
        <div className="intro-copy">
          <span className="eyebrow">
            <Sparkles size={14} /> FROM UNCERTAINTY TO A NEXT STEP
          </span>
          <h2>
            Follow the investigation,
            <br />
            one decision at a time.
          </h2>
          <p>
            Start with a claim. Watch the system gather findings, check its
            sources, and prepare an action you can review.
          </p>
          <Link className="text-link" to="/cases">
            Explore the case library <ArrowRight size={16} />
          </Link>
        </div>
        <div
          className="flow-preview"
          aria-label="Decision, investigation, verification, review"
        >
          <div className="flow-node">
            <span className="flow-symbol">J</span>
            <div>
              <strong>JEV decision</strong>
              <span>What should happen next?</span>
            </div>
            <span className="step-tag">01</span>
          </div>
          <div className="flow-connector" />
          <div className="flow-node">
            <span className="flow-symbol mint">
              <GitBranch size={19} />
            </span>
            <div>
              <strong>Agent + tools</strong>
              <span>Gather new evidence</span>
            </div>
            <span className="step-tag">02</span>
          </div>
          <div className="flow-connector" />
          <div className="flow-node">
            <span className="flow-symbol sand">
              <CheckCheck size={19} />
            </span>
            <div>
              <strong>Verify & review</strong>
              <span>A supported action and note</span>
            </div>
            <span className="step-tag">03</span>
          </div>
          <span className="flow-caption">
            New evidence feeds the next decision.
          </span>
        </div>
      </section>
      <Panel
        title="Recent investigations"
        aside={
          <Link to="/investigations" className="text-link">
            View all <ArrowUpRight size={15} />
          </Link>
        }
      >
        <RunTable runs={records.slice(0, 5)} scenarios={scenarios.data} />
      </Panel>
      <div className="section-heading">
        <div>
          <h2>Choose a starting point</h2>
          <p>Controlled cases for exploring the current workflow.</p>
        </div>
        <Link className="text-link" to="/cases">
          All {scenarios.data.length} cases <ArrowRight size={15} />
        </Link>
      </div>
      <div className="case-grid compact">
        {scenarios.data.slice(0, 3).map((scenario, index) => (
          <Link
            to={`/investigations/new?case=${scenario.id}`}
            className="case-card"
            key={scenario.id}
          >
            <div className="case-top">
              <span className={`case-number tone-${index}`}>0{index + 1}</span>
              <ArrowUpRight size={18} />
            </div>
            <h3>{scenario.title}</h3>
            <p>{scenario.description}</p>
            <span className="mono case-id">{scenario.claimId}</span>
          </Link>
        ))}
      </div>
    </>
  );
}
