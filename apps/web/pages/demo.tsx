import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, GitBranch, GitCompareArrows, LoaderCircle, Pause, Play, RotateCcw, ShieldCheck, Wrench } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Mode, Receipt, Run } from "../../../packages/core/domain";
import { actionLabel } from "../../../packages/core/evidence";
import { api } from "../lib/api";
import { useExecution, useRun } from "../lib/workspace";
import { agentNames, factNames, modeNames } from "../lib/format";
import { explainDecision, sourceNames } from "../lib/decision-explanation";
import { demoFrame, demoNote } from "../lib/demo";
import { demoComparePath, demoModes, demoModeNames, demoModeDescriptions, isDemoMode, type DemoMode } from "../lib/demo-modes";
import { ErrorState, Loading } from "../components/ui";
import { DemoMetrics } from "../components/demo-metrics";
import { ConfidenceCheck, DecisionContext } from "../components/decision-context";

const sourceName = (receipt: Receipt) => sourceNames[receipt.tool] ?? receipt.tool;

export function DemoHome() {
  const config = useQuery({ queryKey: ["config"], queryFn: ({ signal }) => api.config(signal) });
  const runs = useQuery({ queryKey: ["runs"], queryFn: ({ signal }) => api.runs(signal) });
  const execution = useExecution();
  const navigate = useNavigate();
  const creating = useRef(false);
  const [mode, setMode] = useState<DemoMode>("live");
  const [pending, setPending] = useState<Mode | null>(null);
  const [error, setError] = useState("");
  if (config.isPending) return <Loading label="Preparing the demo…" />;
  if (config.isError) return <ErrorState error={config.error} retry={() => void config.refetch()} />;
  const saved = runs.data?.find(run => run.scenarioId === "corrected-claim" && run.mode === "live" &&
    ["awaiting_review", "needs_human", "completed"].includes(run.status));
  async function start(automatic: boolean) {
    if (creating.current || execution.activeId || !config.data?.modes[mode]) return;
    creating.current = true;
    setPending(mode);
    setError("");
    try {
      const run = await api.create("corrected-claim", mode);
      await execution.remember(run);
      navigate(`/demo/${run.id}`);
      if (automatic) void execution.execute(run, true);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not start the demo."); }
    finally { creating.current = false; setPending(null); }
  }
  return <div className="demo-home">
    <span className="eyebrow">THE QUESTION THIS POC TESTS</span>
    <h1>Can JEV guide an investigation<br />as new evidence arrives?</h1>
    <p className="demo-intro">A claim is denied. We need to find out why before choosing what to do next.</p>
    <div className="demo-loop" aria-label="JEV decides, the agent gathers evidence, then JEV decides again">
      <div className="demo-loop-decision"><span>01</span><strong><GitBranch size={16} aria-hidden="true" />JEV decides</strong><p>What do we need to find out?</p></div>
      <ArrowRight aria-hidden="true" size={22} />
      <div className="demo-loop-agent"><span>02</span><strong><Wrench size={16} aria-hidden="true" />Agent + tool</strong><p>Obtain the missing information.</p></div>
      <ArrowRight aria-hidden="true" size={22} />
      <div className="demo-loop-decision"><span>03</span><strong><GitBranch size={16} aria-hidden="true" />JEV decides again</strong><p>Use the findings to choose the next step.</p></div>
    </div>
    <section className="demo-launch" aria-label="Start the guided demo">
      <span className="eyebrow">ONE CLAIM · THREE WAYS TO INVESTIGATE</span><h2>Investigate claim SYN-1002</h2>
      <p>Choose who makes the decisions, then run to the <strong>Task Action</strong> and <strong>completion note</strong>.</p>
      <fieldset className="demo-mode-picker"><legend>Execution mode</legend>{demoModes.map(option => <label key={option} className={mode === option ? "selected" : ""}>
        <input type="radio" name="demo-mode" aria-label={demoModeNames[option]} checked={mode === option} onChange={() => setMode(option)} disabled={Boolean(pending)} />
        <span><strong>{demoModeNames[option]}</strong><small>{demoModeDescriptions[option]}</small>{!config.data.modes[option] && <small className="warning-text">Provider keys required</small>}</span>
      </label>)}</fieldset>
      <div className="demo-launch-actions">
        <div><button className="button primary" disabled={Boolean(pending || execution.activeId) || !config.data.modes[mode]} onClick={() => void start(true)}>
          {pending ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />}Run to completion
        </button><button className="button secondary" disabled={Boolean(pending || execution.activeId) || !config.data.modes[mode]} onClick={() => void start(false)}>Step through manually</button></div>
        <Link className="demo-compare-link" to={demoComparePath()}><GitCompareArrows size={17} />Compare all three modes</Link>
      </div>
      <p className="demo-launch-note">Automatic runs stop when outputs are ready for review, human review is required, or an error occurs. You can pause after a step.</p>
    </section>
    {!config.data.modes[mode] && <p className="inline-notice">{mode === "live" ? "Agent + JEV needs both provider keys." : "Agent only needs an OpenAI key."} <Link to="/settings">Configure providers</Link> or select Fixture only.</p>}
    {execution.activeId && <p className="inline-notice">An investigation is active. <Link to={`/demo/${execution.activeId}`}>Open it to finish or pause it.</Link></p>}
    {error && <p role="alert" className="inline-error">{error}</p>}
    <div className="demo-home-footer">
      <p>Claim and payer data are synthetic. This demonstrates the decision loop; it does not establish improved accuracy.</p>
      {saved && <Link to={`/demo/${saved.id}?step=0&replay=1`}>Replay a saved live run <ArrowRight size={14} /></Link>}
    </div>
  </div>;
}

function WorkPerformed({ run, frame }: { run: Run; frame: ReturnType<typeof demoFrame> }) {
  if (!frame.checkpoint || !frame.data) return <p>The agent will use a tool to obtain the first claim facts.</p>;
  const receipts = frame.receipts.filter(receipt => frame.newSources.has(receipt.id));
  const agent = run.mode === "demo" || run.mode === "jev" ? "Scripted agent" : "OpenAI agent";
  if (receipts.length) return <>{receipts.map(receipt => <p key={receipt.id}><strong>{agent}</strong> called <code>{receipt.tool}</code> and recorded the returned findings.</p>)}</>;
  const verified = frame.checkpoint.following.find(event => event.kind === "agent" && typeof (event.data as { verifiedFacts?: unknown })?.verifiedFacts === "number");
  const action = frame.checkpoint.following.find(event => event.kind === "agent" && (event.data as { taskAction?: unknown })?.taskAction);
  const hasNote = frame.checkpoint.following.some(event => event.kind === "agent" && (event.data as { notePlan?: unknown })?.notePlan);
  const error = frame.checkpoint.following.find(event => event.kind === "error");
  if (error) return <p className="warning-text">This step stopped: {error.title}</p>;
  if (verified) return <p>The application checked {(verified.data as { verifiedFacts: number }).verifiedFacts} facts against their sources. This confirms what the sources said.</p>;
  if (action) return <p>The application recorded the proposed action: <strong>{actionLabel((action.data as { taskAction: NonNullable<Run["taskAction"]> }).taskAction)}</strong>.</p>;
  if (hasNote) return <p>{agent} organized the verified facts. The application assembled the sourced completion note.</p>;
  if (frame.data.appliedAgent === "human_review") return <p>The application stopped automatic investigation and prepared a handoff for a person to review.</p>;
  return <p>No completed tool result was recorded for this step.</p>;
}

export function InvestigationSequence({ run, frame, decisionLabel }: { run: Run; frame: ReturnType<typeof demoFrame>; decisionLabel: string }) {
  const agent = run.mode === "demo" || run.mode === "jev" ? "Scripted agent" : "OpenAI agent";
  return <section className="demo-sequence" aria-label="Investigation sequence">
    <h2>Sequence so far</h2>
    <p className="demo-sequence-intro">Decisions and results, in the order they happened.</p>
    {frame.sequence.length ? <ol className="demo-sequence-steps">{frame.sequence.map(group => <li key={group.id} aria-current={group.step === frame.step ? "step" : undefined}>
      <div className="demo-sequence-step"><strong>{group.step ? `Step ${group.step}` : "Before routing"}</strong>{group.step === frame.step && <span>Current step</span>}</div>
      <ol className="demo-sequence-entries">{group.entries.map(entry => {
        const Icon = entry.role === "decision" ? GitBranch : entry.role === "agent" ? Wrench : ShieldCheck;
        const role = entry.role === "decision" ? decisionLabel : entry.role === "agent" ? agent : "Application";
        return <li key={entry.id} className={`demo-sequence-entry demo-sequence-${entry.role}${entry.warning ? " demo-sequence-warning" : ""}`}>
          <span className="demo-sequence-icon"><Icon size={15} aria-hidden="true" /></span>
          <div className="demo-sequence-content"><span className="demo-sequence-role">{role}</span><h3>{entry.title}</h3>
            {entry.detail && <p>{entry.detail}</p>}
            {entry.decision && <DecisionContext key={`${entry.id}-${group.step === frame.step}`} data={entry.decision} mode={run.mode} expanded={group.step === frame.step && entry.decision.appliedAgent !== entry.decision.response.answers.next_agent.choice} />}
            {entry.gate && <ConfidenceCheck data={entry.gate} />}
            {entry.receipt && <details key={`${entry.id}-${group.step === frame.step}`} open={group.step === frame.step}>
              <summary>Findings · {Object.keys(entry.receipt.fields).length}</summary>
              <dl>{Object.entries(entry.receipt.fields).map(([key, value]) => <div key={key}><dt>{factNames[key] ?? key}</dt><dd>{value}</dd></div>)}</dl>
            </details>}
          </div>
        </li>;
      })}</ol>
    </li>)}</ol> : <div className="demo-unknown"><strong>No steps taken yet</strong><p>Advance to reveal the first decision and the work it triggers.</p></div>}
  </section>;
}

export function DemoRun() {
  const { id = "" } = useParams();
  const query = useRun(id);
  const execution = useExecution();
  const [params, setParams] = useSearchParams();
  if (query.isPending) return <Loading label="Loading the investigation…" />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const run = query.data;
  const requested = params.has("step") ? Number(params.get("step")) : Infinity;
  const frame = demoFrame(run, requested);
  const info = frame.data ? explainDecision(frame.data) : undefined;
  const replay = params.get("replay") === "1";
  const canExecute = !replay && !run.benchmark && frame.atLatest && run.status === "ready";
  const active = execution.activeIds.includes(run.id);
  const router = run.mode === "demo" ? "Fixture router" : run.mode === "openai" ? "OpenAI" : "JEV";
  const decisionLabel = run.mode === "demo" ? "Fixture decision (scripted)" : run.mode === "openai" ? "OpenAI routing" : "JEV decision";
  const notePrepared = frame.checkpoint?.following.some(event => event.kind === "agent" && Boolean((event.data as { notePlan?: unknown })?.notePlan));
  const agentWorked = frame.newSources.size > 0 || notePrepared;
  const busy = Boolean(execution.activeId);
  function showStep(step: number) { setParams({ ...(replay ? { replay: "1" } : {}), step: String(step) }); }
  async function next() {
    if (!frame.atLatest) showStep(frame.step + 1);
    else if (canExecute) {
      await execution.execute(run, false);
      setParams({});
    }
  }
  async function runAll() {
    if (!canExecute || busy) return;
    setParams({});
    await execution.execute(run, true);
  }
  return <div className="demo-investigation">
    <div className="demo-run-heading">
      <div><Link className="back-link" to="/"><ArrowLeft size={15} />Demo</Link><h1>Investigating {run.claimId}</h1></div>
      <span className={`demo-mode ${run.mode === "demo" ? "demo-mode-scripted" : ""}`}>{replay ? "Saved replay · " : ""}{isDemoMode(run.mode) ? demoModeNames[run.mode] : modeNames[run.mode]}</span>
    </div>
    <p className="demo-mode-description">{replay ? "You are revealing a saved investigation. No new model calls are made." : run.mode === "demo" ? "Scripted rehearsal. The decisions and tool responses are simulated; no model APIs are called." : run.mode === "live" ? "JEV chooses the next step. OpenAI uses the assigned tools. Each new step makes paid model calls against synthetic data." : run.mode === "jev" ? "JEV chooses the next step. A scripted agent gathers synthetic evidence." : "OpenAI chooses the next step and uses tools against synthetic data."}</p>
    <div className="demo-role-legend" aria-label="Role color key">
      <span className="demo-role-decision"><GitBranch size={15} aria-hidden="true" />{decisionLabel}</span>
      <span className="demo-role-agent"><Wrench size={15} aria-hidden="true" />Agent & tool work</span>
      <span className="demo-role-application"><ShieldCheck size={15} aria-hidden="true" />Application checks & results</span>
    </div>
    <div className="demo-step-toolbar">
      <span>{frame.step ? `Step ${frame.step}` : "Before the investigation"}{frame.finished ? " · Ready for review" : frame.failed ? " · Stopped" : ""}</span>
      <div>
        <button className="button subtle" disabled={!frame.step || busy} onClick={() => showStep(frame.step - 1)}><ArrowLeft size={15} />Previous</button>
        {active && !replay ? <><span className="working-label"><LoaderCircle size={15} className="spin" />Running…</span><button className="button secondary" disabled={execution.stopping} onClick={() => execution.pause(run.id)}><Pause size={15} />{execution.stopping ? "Pausing…" : "Pause after step"}</button></> : <>
          {!frame.atLatest || canExecute ? <button className={`button ${canExecute ? "secondary" : "primary"}`} disabled={busy} onClick={() => void next()}><ArrowRight size={16} />{frame.atLatest ? "Run next step" : "Show next step"}</button> : <button className="button secondary" disabled={busy} onClick={() => setParams({ step: "0", replay: "1" })}><RotateCcw size={15} />Replay from start</button>}
          {canExecute && <button className="button primary" disabled={busy} onClick={() => void runAll()}><Play size={15} />Run to completion</button>}
          {replay && !frame.atLatest && <button className="button secondary" disabled={busy} onClick={() => showStep(frame.total)}>Show full run</button>}
        </>}
      </div>
    </div>
    {active && !replay && <p className="demo-running-note" role="status">Running automatically in the background. This sequence updates as each step finishes; you can leave this page and return.</p>}
    {frame.failed && <p className="inline-error" role="alert">The investigation stopped: {run.reviewReason}. <Link to={`/investigations/${run.id}`}>Open the full record to inspect or retry.</Link></p>}
    <DemoMetrics run={run} historical={replay || !frame.atLatest} active={active} />
    <div className="demo-stage" aria-live="polite">
      <section className="demo-decision" aria-label="Current step">
        <div className={`demo-router-work ${frame.step ? "demo-router-work-recorded" : ""}`}>
        <span className="eyebrow">{frame.step ? `${router.toUpperCase()} · NEXT STEP` : "THE STARTING POINT"}</span>
        <h2>{frame.data ? agentNames[frame.data.response.answers.next_agent.choice] : "We have a claim to investigate."}</h2>
        <p>{info ? info.proposalExplanation : "The investigation starts with a claim ID. Its findings will be obtained through tools, one step at a time."}</p>
        </div>
        {(info?.changed || info?.confidenceGate) && <div className="demo-intervention"><strong>Why the application stopped</strong><p>{info.explanation}</p>{frame.data && <ConfidenceCheck data={frame.data} />}</div>}
        <div className={`demo-agent-work ${agentWorked ? "demo-agent-work-recorded" : ""}`}><span className="eyebrow">{frame.step ? agentWorked ? notePrepared ? "AGENT · NOTE PREPARATION" : "AGENT · TOOL USE" : "APPLICATION · RESULT" : "WHAT HAPPENS NEXT"}</span><WorkPerformed run={run} frame={frame} /></div>
        {!frame.finished && !frame.failed && <div className="demo-loop-return"><ArrowRight size={17} /><span>{frame.step ? "Each result feeds the next decision. Follow the full sequence on the right." : "Begin to see the first decision and tool result."}</span></div>}
      </section>
      <InvestigationSequence run={run} frame={frame} decisionLabel={decisionLabel} />
    </div>
    {frame.finished && <section className="demo-final" aria-label="Investigation outputs">
      <div><span className="eyebrow">OUTPUT 1 · TASK ACTION</span><h2>{run.taskAction ? actionLabel(run.taskAction) : "No action recorded"}</h2><p>{run.reviewReason ?? "The proposed action is ready for a person to review. No claim has been submitted."}</p><span className="demo-output-state"><Check size={16} />{run.status === "completed" ? "Synthetic handoff saved" : "Awaiting human review"}</span></div>
      <div><span className="eyebrow">OUTPUT 2 · COMPLETION NOTE</span><p className="demo-note">{demoNote(run, sourceName) || "No completion note was recorded."}</p></div>
    </section>}
    <div className="demo-run-footer"><Link to={demoComparePath(run)} className="demo-compare-link"><GitCompareArrows size={16} />Compare this case across modes</Link><Link to={`/investigations/${run.id}?tab=trace`}>Inspect the full record</Link></div>
  </div>;
}
