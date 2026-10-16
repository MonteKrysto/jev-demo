import type { AuditEvent, NotePlan, Receipt, TaskAction } from "../../../packages/core/domain";
import { actionLabel } from "../../../packages/core/evidence";
import { explainDecision, sourceNames, type DecisionData } from "./decision-explanation";
import { agentNames } from "./format";

export interface SequenceEntry {
  id: string;
  role: "decision" | "agent" | "application";
  title: string;
  detail?: string;
  receipt?: Receipt;
  decision?: DecisionData;
  gate?: DecisionData;
  warning?: boolean;
}

type WorkData = Partial<Receipt> & {
  sourceId?: string;
  verifiedFacts?: number;
  conflicts?: string[];
  taskAction?: TaskAction;
  notePlan?: NotePlan;
  reason?: string;
  addedFacts?: number;
};

// Use only this checkpoint's recorded events. A tool call and its accepted
// receipt describe one operation; failed calls without receipts stay visible.
export function sequenceEntries(events: AuditEvent[]): SequenceEntry[] {
  const receiptIds = new Set(events.filter(event => event.kind === "tool")
    .flatMap(event => {
      const data = event.data as WorkData | undefined;
      return data?.id && data.fields ? [data.id] : [];
    }));
  const entries: SequenceEntry[] = [];
  for (const event of events) {
    if (event.kind === "decision") {
      const data = event.data as DecisionData;
      const info = explainDecision(data);
      entries.push({ id: event.id, role: "decision", title: agentNames[info.selected.choice],
        detail: info.proposalExplanation, decision: data });
      if (info.changed || info.confidenceGate) entries.push({ id: `${event.id}-gate`, role: "application", warning: true,
        title: info.changed ? `Changed to: ${agentNames[data.appliedAgent]}` : "Human review required by confidence rule", detail: info.explanation, gate: data });
      continue;
    }
    const data = event.data as WorkData | undefined;
    if (event.kind === "tool") {
      if (data?.id && data.tool && data.fields) {
        entries.push({ id: event.id, role: "agent", title: `${sourceNames[data.tool] ?? data.tool} returned findings`, receipt: data as Receipt });
      } else if (!data?.sourceId || !receiptIds.has(data.sourceId)) {
        entries.push({ id: event.id, role: "agent", title: data?.tool ? `Called ${data.tool}` : event.title,
          detail: "No accepted findings were recorded for this call." });
      }
    } else if (event.kind === "agent" && typeof data?.verifiedFacts === "number") {
      entries.push({ id: event.id, role: "application", title: `Checked ${data.verifiedFacts} facts against their sources`,
        detail: data.conflicts?.length ? data.conflicts.join("; ") : "The recorded facts matched their sources. No conflicts were found.",
        warning: Boolean(data.conflicts?.length) });
    } else if (event.kind === "agent" && data?.taskAction) {
      entries.push({ id: event.id, role: "application", title: "Task Action recorded", detail: actionLabel(data.taskAction) });
    } else if (event.kind === "agent" && data?.notePlan) {
      entries.push({ id: event.id, role: "agent", title: "Organized verified facts for the note" });
      entries.push({ id: `${event.id}-rendered`, role: "application", title: "Completion note prepared", detail: "Assembled from the selected facts with source references, ready for review." });
    } else if (event.kind === "agent" && typeof data?.addedFacts === "number" && receiptIds.size) {
      // The accepted findings are shown on the tool result above.
      continue;
    } else {
      entries.push({ id: event.id, role: event.kind === "agent" ? "agent" : "application", title: event.title,
        detail: data?.reason, warning: event.kind === "error" || event.kind === "policy" });
    }
  }
  return entries;
}
