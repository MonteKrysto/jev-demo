import { ArrowRight, Check, ChevronDown, AlertTriangle, ShieldCheck } from "lucide-react";
import type { Agent, AuditEvent, Receipt, Run } from "../../../packages/core/domain";
import { actionLabel } from "../../../packages/core/evidence";
import { agentNames, dateTime, factNames } from "../lib/format";
import { explainDecision, groupCheckpoints, sourceNames, type DecisionData } from "../lib/decision-explanation";
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

function CheckpointOutcome({ events }: { events: AuditEvent[] }) {
  const observations = events.filter(e => e.kind === "tool" && (e.data as Partial<Receipt> | undefined)?.fields);
  const results = events.filter(e => ["agent", "policy", "error", "approval"].includes(e.kind));
  if (!observations.length && !results.length) return null;
  return <div className="checkpoint-outcome">
    <span className="field-label">WHAT HAPPENED NEXT</span>
    {observations.map(event => {
      const receipt = event.data as Receipt;
      return <div className="outcome-observation" key={event.id}>
        <strong>{sourceNames[receipt.tool] ?? receipt.tool} returned</strong>
        <dl>{Object.entries(receipt.fields).map(([key, value]) => <div key={key}>
          <dt>{factNames[key] ?? key}</dt><dd>{value}</dd>
        </div>)}</dl>
      </div>;
    })}
    {results.map(event => {
      const result = event.data as { taskAction?: Run["taskAction"]; verifiedFacts?: number; conflicts?: string[]; reason?: string } | undefined;
      if (event.kind === "agent" && observations.length) return null;
      return <p className={`checkpoint-result result-${event.kind}`} key={event.id}>
        {event.kind === "error" || result?.conflicts?.length ? <AlertTriangle size={15} /> : <Check size={15} />}
        <span>{result?.verifiedFacts !== undefined
          ? `${result.verifiedFacts} facts matched their sources. ${result.conflicts?.length ? `${result.conflicts.length} conflict${result.conflicts.length === 1 ? "" : "s"} recorded: ${result.conflicts.join("; ")}. Verification does not resolve which source is correct.` : "No conflicts were detected in the collected evidence."}`
          : result?.taskAction ? `Task Action drafted: ${actionLabel(result.taskAction)}.`
          : event.kind === "policy" && result?.reason ? `Human review required: ${result.reason}.`
          : event.title}</span>
      </p>;
    })}
  </div>;
}

function Checkpoint({ event, following, index, run }: { event: AuditEvent; following: AuditEvent[]; index: number; run: Run }) {
  const data = event.data as DecisionData;
  const info = explainDecision(data);
  const { selected, allowed, changed, conflicts, state } = info;
  const isReview = data.appliedAgent === "human_review";
  const router = run.mode === "demo" ? "Fixture router" : run.mode === "openai" ? "OpenAI" : "JEV";
  const visibleFacts = conflicts.length ? conflicts.flatMap(c => c.facts) : info.evidence.slice(0, 2);
  const additional = info.evidence.filter(f => !visibleFacts.includes(f));
  return <article className={`checkpoint ${isReview ? "checkpoint-review" : ""}`} id={`checkpoint-${event.id}`} aria-label={`Checkpoint ${index + 1}: ${agentNames[data.appliedAgent]}`}>
    <div className="checkpoint-rail"><span>{String(index + 1).padStart(2, "0")}</span></div>
    <div className="checkpoint-content">
      <div className="checkpoint-title">
        <div>
          <span className="eyebrow">{router.toUpperCase()} · CHECKPOINT {index + 1}</span>
          <h3>{agentNames[data.appliedAgent] ?? event.title}</h3>
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
      <CheckpointOutcome events={following} />
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
    </div>
  </article>;
}

export function DecisionTrace({ run }: { run: Run }) {
  const { checkpoints, other } = groupCheckpoints(run.events);
  if (!run.events.length) return <EmptyState title="The investigation starts here">Advance one checkpoint or run the case to begin gathering evidence.</EmptyState>;
  return <div className="decision-timeline">
    {checkpoints.length > 0 && <div className="trace-guide">
      <strong>Follow the evidence to the decision</strong>
      <p>Each checkpoint shows the evidence available then, the application rule, and the step that actually ran. Explanations summarize the saved record; the router does not return a written rationale.</p>
      <nav aria-label="Investigation checkpoints"><ol>{checkpoints.map(({ event }, index) => {
        const data = event.data as DecisionData;
        return <li key={event.id}><a className={data.appliedAgent === "human_review" ? "review-stop" : ""} href={`#checkpoint-${event.id}`}><span>{index + 1}</span>{agentNames[data.appliedAgent]}</a></li>;
      })}</ol></nav>
    </div>}
    {other.map(item => <div className="timeline-notice" key={item.id}><strong>{item.title}</strong><span>{dateTime(item.at)}</span></div>)}
    {checkpoints.map(({ event, following }, index) => <Checkpoint key={event.id} event={event} following={following} index={index} run={run} />)}
  </div>;
}
