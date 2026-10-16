import type { Receipt, Run } from "../../../packages/core/domain";
import { groupCheckpoints, type DecisionData } from "./decision-explanation";
import { sequenceEntries } from "./demo-sequence";

export function demoFrame(run: Run, requestedStep: number) {
  const { checkpoints, other } = groupCheckpoints(run.events);
  const step = Number.isFinite(requestedStep) ? Math.max(0, Math.min(Math.trunc(requestedStep), checkpoints.length)) : checkpoints.length;
  const checkpoint = step ? checkpoints[step - 1] : undefined;
  const data = checkpoint?.event.data as DecisionData | undefined;
  const receipts = checkpoints.slice(0, step).flatMap(c => c.following.flatMap(event => {
    const receipt = event.data as Partial<Receipt> | undefined;
    return event.kind === "tool" && receipt?.id && receipt.tool && receipt.fields && receipt.text ? [receipt as Receipt] : [];
  }));
  const newSources = new Set(checkpoint?.following.flatMap(event => {
    const receipt = event.data as Partial<Receipt> | undefined;
    return event.kind === "tool" && receipt?.fields && receipt.id ? [receipt.id] : [];
  }));
  const findings = new Map<string, { key: string; value: string; sources: Receipt[]; added: boolean }>();
  for (const receipt of receipts) for (const [key, value] of Object.entries(receipt.fields)) {
    const id = JSON.stringify([key, value]);
    const finding = findings.get(id) ?? { key, value, sources: [], added: false };
    if (!finding.sources.some(s => s.id === receipt.id)) finding.sources.push(receipt);
    finding.added ||= newSources.has(receipt.id);
    findings.set(id, finding);
  }
  const atLatest = step === checkpoints.length;
  const sequence = [
    ...(other.length ? [{ id: "before-routing", step: 0, entries: sequenceEntries(other) }] : []),
    ...checkpoints.slice(0, step).map((c, index) => ({
      id: c.event.id, step: index + 1, entries: sequenceEntries([c.event, ...c.following]),
    })),
  ];
  return { step, checkpoint, data, receipts, findings: [...findings.values()], newSources, sequence, atLatest,
    total: checkpoints.length,
    finished: atLatest && ["awaiting_review", "needs_human", "completed"].includes(run.status),
    failed: atLatest && run.status === "failed",
  };
}

// Only replace actual source IDs; preserve any other brackets in the note.
export function demoNote(run: Run, sourceName: (receipt: Receipt) => string) {
  return (run.completionNote ?? "").replace(/\[([^\]]+)\]/g, (original, ids: string) => {
    const sources = ids.split(", ").map(id => run.receipts.find(receipt => receipt.id === id));
    return sources.every(Boolean) ? `[${[...new Set(sources.map(receipt => sourceName(receipt!)))].join(", ")}]` : original;
  });
}
