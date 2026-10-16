import type { Mode } from "../../../packages/core/domain";
import { actionLabel } from "../../../packages/core/evidence";
import { explainDecision, sourceNames, type DecisionData } from "../lib/decision-explanation";
import { agentNames, factNames } from "../lib/format";

const percent = (value: number | undefined) => value === undefined ? "Not recorded"
  : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value * 100)}%`;

function ConfidenceCalculation({ data, mode }: { data: DecisionData; mode: Mode }) {
  const answer = data.response.answers.next_agent;
  const probabilities = Object.values(answer.probabilities ?? {});
  if (probabilities.length < 2 || answer.confidence === undefined || data.response.confidenceKind === "not_provided") return null;
  // Count every option in the saved response, not just today's eligible options.
  const count = probabilities.length;
  const leading = Math.max(...probabilities);
  const evenSplit = 1 / count;
  const calculated = (leading - evenSplit) / (1 - evenSplit);
  const allowed = data.request?.state?.execution?.eligibleAgents;
  const hasBlockedChoices = allowed !== undefined && Object.keys(answer.probabilities!).some(option =>
    !allowed.includes(option as typeof answer.choice));
  return <section className="routing-calculation" aria-label="How routing confidence is calculated">
    <strong className="routing-context-label">How {percent(leading)} becomes {percent(answer.confidence)}</strong>
    <ol>
      <li><strong>Start with an equal share.</strong><p>There were {count} choices. If none were favored, each would get the same share:</p>
        <p className="routing-calculation-math">100% ÷ {count} choices ≈ <strong>{percent(evenSplit)} each</strong></p>
        <p>That is an “even split.”</p>
      </li>
      <li><strong>Adjust the leading score.</strong><p>The leading choice received {percent(leading)}. The formula treats an even split as 0% confidence and all the probability on one choice as 100% confidence.</p>
        <p className="routing-calculation-math"><span>({percent(leading)} − {percent(evenSplit)})</span><span>÷</span><span>(100% − {percent(evenSplit)})</span><strong>≈ {percent(calculated)}</strong></p>
      </li>
      <li><strong>Use the reported confidence.</strong><p>{mode === "demo" ? "The fixture assigned" : "JEV returned"} <strong>{percent(answer.confidence)}</strong>.{data.settings
        ? <> The application compared that score with the <strong>{percent(data.settings.confidenceThreshold)} required</strong> to continue.</>
        : " The threshold for this step was not saved."}</p>
      </li>
    </ol>
    <p className="routing-calculation-note">Numbers in the calculation are rounded for readability.{hasBlockedChoices && <> All {count} choices count, including those marked “Not permitted.”</>}</p>
    <p className="routing-calculation-note">This score describes how strongly one choice is favored; it does not tell us how often the decision will be correct.</p>
  </section>;
}

export function DecisionContext({ data, mode, expanded = false }: { data: DecisionData; mode: Mode; expanded?: boolean }) {
  const info = explainDecision(data);
  const { selected, state, choices } = info;
  const primary = choices.filter((choice, index) => index < 2 || choice.agent === "human_review");
  const remaining = choices.filter(choice => !primary.includes(choice));
  const facts = new Map<string, typeof info.evidence>();
  for (const fact of info.evidence) {
    const key = `${fact.key}\u0000${fact.value}`;
    facts.set(key, [...(facts.get(key) ?? []), fact]);
  }
  const action = data.response.answers.task_action;
  function distribution(rows: typeof choices) {
    return <ul className="routing-options">{rows.map(option => <li key={option.agent}>
      <span>{agentNames[option.agent]}{option.agent === selected.choice && <small>Proposed</small>}{option.permitted === false && <small>Not permitted at this step</small>}</span>
      <strong>{percent(option.probability)}</strong>
      <span className="routing-option-bar" aria-hidden="true"><i style={{ width: `${option.probability * 100}%` }} /></span>
    </li>)}</ul>;
  }
  return <details className="routing-context" open={expanded}>
    <summary>Evidence & router scores</summary>
    <div className="routing-context-body">
      <strong className="routing-context-label">Next-step probabilities</strong>
      {choices.length ? <>
        {distribution(primary)}
        {remaining.length > 0 && <details className="routing-other-options"><summary>All other choices ({remaining.length})</summary>{distribution(remaining)}</details>}
        {mode === "demo" && <p className="routing-score-note">These are scripted fixture scores, not measured confidence.</p>}
      </> : <p>This router did not supply probabilities or confidence.</p>}
      {selected.confidence !== undefined && <p><strong>Routing confidence: {percent(selected.confidence)}</strong>{data.settings && ` · Required: ${percent(data.settings.confidenceThreshold)}`}</p>}
      <ConfidenceCalculation data={data} mode={mode} />
      {info.changed && selected.choice !== "human_review" && <p className="routing-attribution">The router proposed {agentNames[selected.choice].toLowerCase()}. The application chose the handoff.</p>}
      <strong className="routing-context-label">What was known then</strong>
      <p>{state?.verification?.complete === false ? "Source verification was pending." : state?.verification?.complete === true ? "Source verification was complete." : "Verification status was not recorded."}</p>
      {facts.size ? <ul className="routing-evidence">{[...facts.entries()].map(([key, group]) => <li key={key}>
        <span>{factNames[group[0].key] ?? group[0].key}</span><strong>{group[0].value}</strong>
        <small>{[...new Set(group.map(fact => {
          const source = state?.observations?.find(item => item.id === fact.sourceId);
          return source ? sourceNames[source.tool] ?? source.tool : "Recorded source";
        }))].join(" · ")}</small>
      </li>)}</ul> : <p>{state?.evidence ? "No tool findings had been collected." : "The input evidence was not saved."}</p>}
      {info.confidenceGate?.kind === "Routing" && <div className="routing-action-prediction">
        <strong className="routing-context-label">Separate question: possible final action</strong>
        <p>{actionLabel(action.choice)}{action.confidence !== undefined && ` · ${percent(action.confidence)} confidence`}</p>
        <p>This prediction does not approve an action or satisfy the next-step confidence rule.</p>
      </div>}
      <p className="routing-provenance">{mode === "demo" ? "Context summarized from the saved fixture inputs." : "Context summarized from the saved inputs. The router did not return a written explanation of its scores."}</p>
    </div>
  </details>;
}

export function ConfidenceCheck({ data }: { data: DecisionData }) {
  const gate = explainDecision(data).confidenceGate;
  if (!gate) return null;
  return <div className="routing-gate" aria-label={`${gate.kind} confidence check`}>
    <dl><div><dt>{gate.kind} confidence</dt><dd>{percent(gate.score)}</dd></div>
      <div><dt>Required to continue</dt><dd>{percent(gate.threshold)}</dd></div></dl>
    {gate.score !== undefined && gate.threshold !== undefined && gate.score < gate.threshold && <p>
      {new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format((gate.threshold - gate.score) * 100)} percentage {Math.abs(gate.threshold - gate.score - .01) < 1e-8 ? "point" : "points"} below the saved threshold.
    </p>}
  </div>;
}
