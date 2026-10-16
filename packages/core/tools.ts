import type { Receipt, Run, Scenario, SourceSpec } from "./domain.js";
import { getScenario } from "./scenarios.js";
import { toolCatalog, toolArgsSchema, type ToolName } from "./catalog.js";
export * from "./catalog.js";
export interface ToolExecutor {
  execute(name: ToolName, args: unknown, run: Run): Receipt | Promise<Receipt>;
}

export function sourcesFor(scenario: Scenario): Record<string, SourceSpec> {
  return Object.fromEntries(
    toolCatalog.map((tool) => [
      tool.name,
      scenario.sources?.[tool.name] ??
        (tool.name === "get_claim"
          ? { fields: scenario.claim }
          : tool.name === "call_payer"
            ? { fields: scenario.payer[0], clarification: scenario.payer[1] }
            : tool.name === "get_documents" &&
                Object.keys(scenario.documents).length
              ? { fields: scenario.documents }
              : {
                  fields: {
                    lookup_status: `${tool.name}: no matching record in this synthetic case`,
                  },
                }),
    ]),
  );
}
export function makeReceipt(
  name: ToolName,
  args: unknown,
  run: Run,
  source: SourceSpec,
  id?: string,
): Receipt {
  const input = toolArgsSchema.parse(args);
  if (input.claimId !== run.claimId)
    throw new Error("Tool attempted to access another claim");
  const fields =
    input.topic === "clarification" && source.clarification
      ? source.clarification
      : source.fields;
  return {
    id:
      id ??
      `${run.id}:${name}-${run.receipts.filter((r) => r.tool === name).length + 1}`,
    tool: name,
    claimId: run.claimId,
    observedAt: new Date().toISOString(),
    text: [
      source.wording ?? `SYNTHETIC OBSERVATION ONLY. Claim ${run.claimId}.`,
      ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`),
    ].join("\n"),
    fields: { ...fields },
  };
}
/** In-memory adapter for unit tests. The API and worker use the database adapter. */
export class SyntheticTools implements ToolExecutor {
  execute(name: ToolName, args: unknown, run: Run): Receipt {
    const input = toolArgsSchema.parse(args);
    // Compatibility for callers without a topic; live agents provide an explicit query.
    if (name === "call_payer" && !input.topic)
      input.topic = run.payerCalls ? "clarification" : "status";
    return makeReceipt(
      name,
      input,
      run,
      sourcesFor(getScenario(run.scenarioId))[name],
    );
  }
}
