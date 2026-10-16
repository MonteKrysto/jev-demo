import { ArrowRight, ChevronDown, AlertTriangle, GitBranch, ShieldCheck, Wrench } from "lucide-react";
import type { Agent, AuditEvent, Run } from "../../../packages/core/domain";
import { agentNames, dateTime, factNames } from "../lib/format";
import { explainDecision, groupCheckpoints, sourceNames, type DecisionData } from "../lib/decision-explanation";
import { sequenceEntries } from "../lib/demo-sequence";
import { EmptyState } from "./ui";
import { ConfidenceCheck } from "./decision-context";

type Explanation = ReturnType<typeof explainDecision>;

function InputFacts({ facts, observations }: {
  facts: Explanation["evidence"];
  observations: NonNullable<Explanation["state"]>["observations"];
}) {
  return <div className="decision-facts">
    {facts.map((fact, index) => {
      const source = observations?.find(o => o.id === fact.sourceId);
      return <div className="decision-fact" key={`${fact.sourceId}-${fact.key}-${index}`}>
        <span className="fact-source">{source ? sourceNames[source.tool] ?? source.tool : "Recorded source"}</span>
        <span className="fact-label">{factNames[fact.key] ?? fact.key}</span>
        <strong>{fact.value}</strong>
        <details className="source-details">
          <summary>View source</summary>
          <span className="source-reference">{fact.sourceId}</span>
          {source ? <pre>{source.text}</pre> : <p>Original source text was not saved in this checkpoint.</p>}
        </details>
      </div>;
    })}
  </div>;
}

function CheckpointOutcome({ events, run }: { events: AuditEvent[]; run: Run }) {
  const entries = sequenceEntries(events);
  const agent = run.mode === "demo" || run.mode === "jev" ? "Scripted agent" : "OpenAI agent";
  if (!entries.length) return <p className="checkpoint-pending">No work has been recorded after this decision yet.</p>;
  return <ol className="checkpoint-outcome demo-sequence-entries" aria-label="Work after this decision">
    {entries.map(entry => {
      const Icon = entry.role === "agent" ? Wrench : ShieldCheck;
      return <li key={entry.id} className={`demo-sequence-entry demo-sequence-${entry.role}${entry.warning ? " demo-sequence-warning" : ""}`}>
        <span className="demo-sequence-icon"><Icon size={15} aria-hidden="true" /></span>
        <div className="demo-sequence-content">
          <span className="demo-sequence-role">{entry.role === "agent" ? agent : "Application"}</span>
          <h3>{entry.title}</h3>
          {entry.detail && <p>{entry.detail}</p>}
          {entry.receipt && <>
            <p>Called <code>{entry.receipt.tool}</code> and recorded these findings:</p>
            <dl>{Object.entries(entry.receipt.fields).map(([key, value]) => <div key={key}>
              <dt>{factNames[key] ?? key}</dt><dd>{value}</dd>
            </div>)}</dl>
          </>}
        </div>
      </li>;
    })}
  </ol>;
}

function Checkpoint({ event, following, index, run }: { event: AuditEvent; following: AuditEvent[]; index: number; run: Run }) {
  const data = event.data as DecisionData;
  const info = explainDecision(data);
  const { selected, allowed, changed, conflicts, state } = info;
  const isReview = data.appliedAgent === "human_review";
  const router = run.mode === "demo" ? "Fixture router" : run.mode === "openai" ? "OpenAI" : "JEV";
  const decisionLabel = run.mode === "demo" ? "Fixture decision (scripted)" : run.mode === "openai" ? "OpenAI routing" : "JEV decision";
  const visibleFacts = conflicts.length ? conflicts.flatMap(c => c.facts) : info.evidence.slice(0, 2);
  const additional = info.evidence.filter(f => !visibleFacts.includes(f));
  return <article className={`checkpoint ${isReview ? "checkpoint-review" : ""}`} id={`checkpoint-${event.id}`} aria-label={`Checkpoint ${index + 1}: ${agentNames[data.appliedAgent]}`}>
    <div className="checkpoint-rail"><span>{String(index + 1).padStart(2, "0")}</span></div>
    <div className="checkpoint-content">
      <section className="checkpoint-decision" aria-label={decisionLabel}>
      <div className="checkpoint-title">
        <div>
          <span className="eyebrow"><GitBranch size={15} aria-hidden="true" />{decisionLabel} · CHECKPOINT {index + 1}</span>
          <h3>{agentNames[selected.choice] ?? event.title}</h3>
        </div>
        <span className={`decision-kind ${isReview || conflicts.length ? "decision-attention" : ""}`}>
          {isReview || conflicts.length ? <AlertTriangle size={14} /> : <ShieldCheck size={14} />}{info.title}
        </span>
      </div>
      <p className="checkpoint-explanation">{info.explanation}</p>
      {changed && <p className="checkpoint-explanation">{info.proposalExplanation}</p>}
      <ConfidenceCheck data={data} />
      <div className="decision-basis">
        <section className={`decision-evidence ${conflicts.length ? "evidence-conflict" : ""}`} aria-label="Evidence at this checkpoint">
          <span className="field-label">{conflicts.length ? "THE SOURCES DISAGREE" : "EVIDENCE BEFORE THIS DECISION"}</span>
          {visibleFacts.length ? <InputFacts facts={visibleFacts} observations={state?.observations} /> :
            <p className="decision-empty">{state?.evidence ? "No findings had been collected yet." : "Input evidence was not saved for this checkpoint."}</p>}
          {additional.length > 0 && <details className="additional-inputs"><summary>{additional.length} more input facts</summary><InputFacts facts={additional} observations={state?.observations} /></details>}
        </section>
        <section className="decision-rule" aria-label="Application rule">
          <span className="field-label">APPLICATION RULE</span>
          <p>{info.rule}</p>
          <p className="decision-permission">{info.permission}</p>
          {allowed && allowed.length > 1 && <details className="allowed-steps"><summary>See permitted steps</summary><ul>{allowed.map(agent => <li key={agent}>{agentNames[agent]}</li>)}</ul></details>}
        </section>
      </div>
      <div className={`decision-applied ${changed ? "decision-overridden" : ""}`}>
        <div><span>{router} proposed</span><strong>{agentNames[selected.choice]}</strong></div>
        <ArrowRight size={20} aria-hidden="true" />
        <div><span>{changed ? "Application redirected to" : "Application allowed"}</span><strong>{agentNames[data.appliedAgent]}</strong></div>
      </div>
      <details className="decision-details">
        <summary>{run.mode === "demo" ? "Scripted scores & technical details" : "Router scores & technical details"}<ChevronDown size={14} /></summary>
        <div className="detail-section">
          <p className="small-note">{run.mode === "demo"
            ? "Fixture mode assigns these scores in code. They are scripted, not measured model confidence or evidence of accuracy."
            : "These scores describe the router's option distribution. They are not a written rationale or a probability that the decision is correct."}</p>
          <p className="small-note">{data.response.confidenceKind === "not_provided" ? "This router did not supply confidence or a probability distribution."
            : `Routing confidence: ${selected.confidence === undefined ? "not recorded" : `${Math.round(selected.confidence * 100)}%`}${data.settings ? ` · Configured threshold: ${Math.round(data.settings.confidenceThreshold * 100)}%` : ""}.`}</p>
          {selected.probabilities && <><span className="field-label">ROUTER DISTRIBUTION</span><div className="distribution-list">
            {Object.entries(selected.probabilities).sort(([, a], [, b]) => b - a).map(([agent, probability]) => <div className="distribution-row" key={agent}>
              <span>{agentNames[agent as Agent]}{allowed && !allowed.includes(agent as Agent) && <small>Not permitted</small>}</span>
              <div><i style={{ width: `${probability * 100}%` }} /></div>
              <strong>{probability > 0 && probability < .01 ? "<1" : Math.round(probability * 100)}%</strong>
            </div>)}
          </div></>}
          <p className="small-note">Recorded gate result: {data.policyReason}. · {dateTime(event.at)}</p>
          <details className="raw-details"><summary>Raw request & response</summary><pre>{JSON.stringify(event.data, null, 2)}</pre></details>
          {following.length > 0 && <details className="raw-details"><summary>Tool and execution records</summary><pre>{JSON.stringify(following, null, 2)}</pre></details>}
        </div>
      </details>
      </section>
      <CheckpointOutcome events={following} run={run} />
    </div>
  </article>;
}

export function DecisionTrace({ run }: { run: Run }) {
  const { checkpoints, other } = groupCheckpoints(run.events);
  if (!run.events.length) return <EmptyState title="The investigation starts here">Advance one checkpoint or run the case to begin gathering evidence.</EmptyState>;
  return <div className="decision-timeline">
    {checkpoints.length > 0 && <div className="trace-guide">
      <strong>Follow each decision and the work it triggered</strong>
      <p>Each checkpoint pairs the routing decision with the agent’s tool calls and findings, followed by any application checks or handoff. Some steps only run an application check; a blocked decision does not trigger agent work. Explanations summarize the saved record; the router does not return a written rationale.</p>
      <div className="demo-role-legend" aria-label="Role color key">
        <span className="demo-role-decision"><GitBranch size={15} aria-hidden="true" />{run.mode === "demo" ? "Fixture decision (scripted)" : run.mode === "openai" ? "OpenAI routing" : "JEV decision"}</span>
        <span className="demo-role-agent"><Wrench size={15} aria-hidden="true" />{run.mode === "demo" || run.mode === "jev" ? "Scripted agent" : "OpenAI agent"} & tools</span>
        <span className="demo-role-application"><ShieldCheck size={15} aria-hidden="true" />Application checks & handoff</span>
      </div>
      <nav aria-label="Investigation checkpoints"><ol>{checkpoints.map(({ event }, index) => {
        const data = event.data as DecisionData;
        return <li key={event.id}><a className={data.appliedAgent === "human_review" ? "review-stop" : ""} href={`#checkpoint-${event.id}`}><span>{index + 1}</span>{agentNames[data.appliedAgent]}</a></li>;
      })}</ol></nav>
    </div>}
    {other.map(item => <div className="timeline-notice" key={item.id}><strong>{item.title}</strong><span>{dateTime(item.at)}</span></div>)}
    {checkpoints.map(({ event, following }, index) => <Checkpoint key={event.id} event={event} following={following} index={index} run={run} />)}
  </div>;
}
