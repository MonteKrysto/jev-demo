import { test } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { DemoRouter, JevRouter, parseDecision } from "../packages/core/jev.js";
import { OpenAiRouter } from "../packages/core/openai-router.js";
import { LlmAgents } from "../packages/core/agents.js";
import { Engine, newRun } from "../packages/core/engine.js";
import { defaultSettings } from "../packages/core/domain.js";
import { factKeys } from "../packages/core/domain.js";
import { SyntheticTools } from "../packages/core/tools.js";

async function rawDecision() {
  const d = await new DemoRouter().evaluate(
    newRun("records-appeal"),
    defaultSettings,
  );
  return {
    ...d,
    model: "jev-test",
    usage: { input_tokens: 42, output_tokens: 10 },
  };
}
test("actual TypeSafe SDK sends the documented endpoint and batched primitives", async () => {
  let inspected = false;
  const raw = await rawDecision();
  const router = new JevRouter({
    apiKey: "test-key",
    baseURL: "http://test.invalid",
    retry: { maxRetries: 0 },
    fetch: async (url, init) => {
      assert.equal(url, "http://test.invalid/v1/systemone");
      assert.equal(init?.method, "POST");
      const request = JSON.parse(init?.body as string);
      assert.equal(request.model, "jev-latest");
      assert.equal(request.questions.next_agent.type, "choice");
      assert.equal(request.questions.task_action.type, "choice");
      assert.equal(request.questions.needs_documents.type, "noul");
      assert.equal(Object.keys(request.questions).length, 5);
      assert.deepEqual(request.state.execution.eligibleAgents, [
        "human_review",
        "claim_lookup",
      ]);
      inspected = true;
      return Response.json(raw);
    },
  });
  const result = await router.evaluate(
    newRun("records-appeal"),
    defaultSettings,
  );
  assert.ok(inspected);
  assert.equal(result.answers.next_agent.choice, "claim_lookup");
  assert.equal(result.usage.inputTokens, 42);
});
test("malformed JEV answers cannot cross the provider boundary", async () => {
  const raw = await rawDecision();
  const unknown = structuredClone(raw);
  unknown.answers.next_agent.choice = "delete_everything" as never;
  assert.throws(() => parseDecision(unknown), /unknown/);
  const distribution = structuredClone(raw);
  distribution.answers.next_agent.probabilities!.claim_lookup = 0.1;
  assert.throws(() => parseDecision(distribution), /sum/);
  const confidence = structuredClone(raw);
  confidence.answers.next_agent.confidence = 0;
  assert.throws(() => parseDecision(confidence), /inconsistent/);
  const missing = structuredClone(raw);
  delete (missing.answers as Partial<typeof missing.answers>).payer_incomplete;
  assert.throws(() => parseDecision(missing));
  const range = structuredClone(raw);
  range.answers.needs_documents.noul = 2;
  assert.throws(() => parseDecision(range));
});
function fakeLlm(
  argsFor: (name: string, body: Record<string, any>) => unknown,
  choose?: (body: Record<string, any>) => string,
) {
  return new OpenAI({
    apiKey: "test-key",
    baseURL: "http://test.invalid/v1",
    maxRetries: 0,
    fetch: async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      assert.equal(body.store, false);
      const name =
        body.tool_choice === "required"
          ? (choose?.(body) ?? body.tools[0].function.name)
          : body.tool_choice.function.name;
      assert.ok(body.tools.some((tool: any) => tool.function.name === name));
      assert.equal(body.tools[0].function.strict, true);
      return Response.json({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 1,
        model: "mock-llm",
        choices: [
          {
            index: 0,
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: `call-${name}`,
                  type: "function",
                  function: {
                    name,
                    arguments: JSON.stringify(argsFor(name, body)),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 9, total_tokens: 20 },
      });
    },
  });
}
test("actual LLM SDK round-trips function calls and source-bound extraction", async () => {
  const run = newRun("corrected-claim", "live");
  const llm = fakeLlm((name, body) => {
    if (name === "get_claim") return { claimId: run.claimId };
    const output = JSON.parse(
      body.messages.find((m: any) => m.role === "tool").content,
    );
    return {
      facts: [
        {
          key: "claim_status",
          value: "denied",
          sourceId: output.id,
          quote: "claim_status: denied",
        },
      ],
    };
  });
  const runtime = new LlmAgents(llm, "test-model");
  const result = await runtime.gather(
    "claim_lookup",
    run,
    new SyntheticTools(),
  );
  assert.equal(result.receipt.claimId, run.claimId);
  assert.equal(result.facts[0].value, "denied");
  assert.equal(run.metrics.length, 2);
  assert.equal(run.metrics[0].inputTokens, 11);
});
test("LLM cannot access an unrelated claim", async () => {
  const runtime = new LlmAgents(
    fakeLlm(() => ({ claimId: "SYN-9999" })),
    "test-model",
  );
  await assert.rejects(
    () =>
      runtime.gather(
        "claim_lookup",
        newRun("records-appeal"),
        new SyntheticTools(),
      ),
    /another claim/,
  );
});
test("LLM hallucinated extraction stops the workflow", async () => {
  const run = newRun("records-appeal", "live");
  const runtime = new LlmAgents(
    fakeLlm((name) =>
      name === "get_claim"
        ? { claimId: run.claimId }
        : {
            facts: [
              {
                key: "claim_status",
                value: "paid",
                sourceId: `${run.id}:claim`,
                quote: "claim_status: paid",
              },
            ],
          },
    ),
    "test-model",
  );
  await new Engine(new DemoRouter(), runtime).step(run);
  assert.equal(run.status, "failed");
  assert.equal(run.facts.length, 0);
  assert.equal(run.receipts.length, 0);
});
test("LLM note composition returns the existing action with sourced fact IDs", async () => {
  const run = newRun("records-appeal");
  run.taskAction = "appeal";
  run.facts = [
    {
      id: "fact-1",
      key: "claim_status",
      value: "denied",
      sourceId: "source-1",
      quote: "claim_status: denied",
      verified: true,
    },
  ];
  const runtime = new LlmAgents(
    fakeLlm((name, body) => {
      assert.equal(name, "compose_note");
      const state = JSON.parse(body.messages.at(-1).content);
      assert.equal(state.taskAction, "appeal");
      return { factIds: ["fact-1"], action: "appeal" };
    }),
    "test-model",
  );
  assert.deepEqual(await runtime.composeNote(run), {
    factIds: ["fact-1"],
    action: "appeal",
  });
});
test("complete loop runs with both real SDKs behind mocked HTTP transports", async () => {
  const run = newRun("second-contact", "live");
  const router = new JevRouter({
    apiKey: "test-key",
    retry: { maxRetries: 0 },
    fetch: async (_url, init) => {
      const body = JSON.parse(init?.body as string);
      assert.equal(body.state.claimId, run.claimId);
      assert.equal(body.state.verification.complete, run.verified);
      const d = await new DemoRouter().evaluate(run, defaultSettings);
      return Response.json({
        ...d,
        model: "mock-jev",
        usage: { input_tokens: 40, output_tokens: 10 },
      });
    },
  });
  const runtime = new LlmAgents(
    fakeLlm((name, body) => {
      if (["get_claim", "call_payer", "get_documents"].includes(name))
        return { claimId: run.claimId };
      if (name === "compose_note")
        return { factIds: run.facts.map((f) => f.id), action: run.taskAction };
      const output = JSON.parse(
        body.messages.filter((m: any) => m.role === "tool").at(-1).content,
      );
      const facts = output.text.split("\n").flatMap((line: string) => {
        const colon = line.indexOf(": ");
        const key = line.slice(0, colon);
        return factKeys.includes(key as (typeof factKeys)[number])
          ? [
              {
                key,
                value: line.slice(colon + 2),
                sourceId: output.id,
                quote: line,
              },
            ]
          : [];
      });
      return { facts };
    }),
    "test-model",
  );
  const engine = new Engine(router, runtime);
  for (let i = 0; i < 16 && run.status === "ready"; i++) await engine.step(run);
  assert.equal(run.status, "awaiting_review");
  assert.equal(run.taskAction, "appeal");
  assert.equal(run.payerCalls, 2);
  assert.equal(run.metrics.filter((m) => m.provider === "llm").length, 9);
  engine.approve(run, "SDK contract reviewer");
  assert.equal(run.handoff?.taskAction, "appeal");
});

test("OpenAI selects a tool within a capability with several eligible tools", async () => {
  const run = newRun("authorization-found", "live");
  const client = fakeLlm(
    (name, body) => {
      if (name === "check_authorization")
        return { claimId: run.claimId, topic: "denial" };
      const receipt = JSON.parse(
        body.messages.find((m: any) => m.role === "tool").content,
      );
      return {
        facts: [
          {
            key: "authorization_status",
            value: "valid",
            sourceId: receipt.id,
            quote: "authorization_status: valid",
          },
        ],
      };
    },
    (body) => {
      assert.deepEqual(
        body.tools.map((tool: any) => tool.function.name),
        ["check_eligibility", "check_authorization"],
      );
      assert.ok(!JSON.stringify(body.messages).includes("authorization-found"));
      return "check_authorization";
    },
  );
  const result = await new LlmAgents(client, "test-model").gather(
    "coverage_lookup",
    run,
    new SyntheticTools(),
  );
  assert.equal(result.receipt.tool, "check_authorization");
  assert.equal(result.facts[0].value, "valid");
});
test("OpenAI baseline routes with the same evidence but does not fabricate confidence", async () => {
  const run = newRun("corrected-claim", "openai");
  const client = fakeLlm((name, body) => {
    assert.equal(name, "select_next_step");
    const state = JSON.parse(body.messages.at(-1).content).state;
    assert.equal(state.claimId, run.claimId);
    assert.equal(state.scenarioId, undefined);
    assert.equal(state.expected, undefined);
    return { next_agent: "claim_lookup", task_action: "human_review" };
  });
  const result = await new OpenAiRouter(client, "test-model").evaluate(
    run,
    defaultSettings,
  );
  assert.equal(result.answers.next_agent.choice, "claim_lookup");
  assert.equal(result.answers.next_agent.confidence, undefined);
  assert.equal(result.answers.next_agent.probabilities, undefined);
  assert.equal(result.confidenceKind, "not_provided");
});
