import { test, expect } from "@playwright/test";
import { Engine, newRun } from "../../packages/core/engine";
import { DemoRouter } from "../../packages/core/jev";
import { FixtureAgents } from "../../packages/core/agents";

test("focused demo rehearses one claim, reveals evidence, and ends with two outputs", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Can JEV guide an investigation/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run to completion", exact: true })).toBeInViewport();
  await expect(page.getByRole("link", { name: "Advanced workspace" })).toBeVisible();
  await expect(page.getByText("528", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/focused-demo-home.png", fullPage: true });
  await page.getByRole("radio", { name: "Fixture only", exact: true }).check();
  await page.getByRole("button", { name: "Step through manually" }).click();
  await expect(page).toHaveURL(/\/demo\/[a-f0-9-]+$/);
  const runUrl = page.url();
  await expect(page.getByText("No steps taken yet", { exact: true })).toBeVisible();
  const metrics = page.getByRole("region", { name: "Run metrics", exact: true });
  await expect(metrics.locator("dl > div").filter({ has: page.getByText("Model calls", { exact: true }) }).locator("dd")).toHaveText("0");
  await expect(metrics.locator("dl > div").filter({ has: page.getByText("Provider time", { exact: true }) }).locator("dd")).toHaveText("0.00s");
  await expect(page.getByText("missing modifier", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Run next step", exact: true }).click();
  await expect(page.getByText("denied", { exact: true })).toBeVisible();
  const sequence = page.getByRole("region", { name: "Investigation sequence" });
  await expect(sequence.getByRole("heading", { name: "Look up the claim", exact: true })).toBeVisible();
  await expect(sequence.getByRole("heading", { name: "Contact the payer", exact: true })).toHaveCount(0);
  await expect(page.getByText("missing modifier", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Run next step", exact: true }).click();
  await expect(page.getByText("missing modifier", { exact: true })).toBeVisible();
  await expect(sequence.getByRole("heading", { name: "Look up the claim", exact: true })).toBeVisible();
  await expect(sequence.getByRole("heading", { name: "Contact the payer", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/focused-demo-payer.png", fullPage: true });
  await page.reload();
  await expect(page.getByText("missing modifier", { exact: true })).toBeVisible();
  for (let step = 3; step <= 5; step++) {
    await page.getByRole("button", { name: "Run next step", exact: true }).click();
    await expect(page.locator(".demo-step-toolbar").getByText(new RegExp(`^Step ${step}( · Ready for review)?$`))).toBeVisible();
  }
  await expect(sequence.getByRole("heading")).toHaveText([
    "Sequence so far", "Look up the claim", "Claim record returned findings",
    "Contact the payer", "Payer contact returned findings", "Verify the evidence",
    "Checked 5 facts against their sources", "Determine the next action", "Task Action recorded",
    "Prepare the completion note", "Organized verified facts for the note", "Completion note prepared",
  ]);
  await sequence.getByText("Findings · 4", { exact: true }).click();
  await expect(sequence.locator(".demo-sequence-agent").getByText("missing modifier", { exact: true })).toBeVisible();
  const output = page.getByRole("region", { name: "Investigation outputs" });
  await expect(output.getByRole("heading", { name: "Prepare corrected claim" })).toBeVisible();
  await expect(output.getByText(/Payer contact\]/)).toBeVisible();
  await page.screenshot({ path: "test-results/focused-demo-outputs.png", fullPage: true });
  await page.getByRole("button", { name: "Replay from start" }).click();
  await expect(output).toHaveCount(0);
  await expect(page.getByText("missing modifier", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/No new model calls are made/)).toBeVisible();
  await page.getByRole("button", { name: "Show next step" }).click();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByText("No steps taken yet", { exact: true })).toBeVisible();
  await expect(sequence.getByRole("heading", { name: "Contact the payer", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Inspect the full record" }).click();
  await expect(page).toHaveURL(runUrl.replace("/demo/", "/investigations/") + "?tab=trace");
  await expect(page.getByRole("tab", { name: /^Decision trail/ })).toBeVisible();
  expect(errors).toEqual([]);
});

for (const [label, mode] of [["Agent only", "openai"], ["Agent + JEV", "live"]] as const) test(`${label} manual mode creates the right run without automatically making provider calls`, async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: label, exact: true }).check();
  const created = page.waitForResponse(response => response.url().endsWith("/api/runs") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Step through manually", exact: true }).click();
  const response = await created;
  expect(response.request().postDataJSON()).toEqual({ scenarioId: "corrected-claim", mode });
  const run = await response.json();
  await expect(page).toHaveURL(`/demo/${run.id}`);
  await expect(page.getByRole("button", { name: "Run to completion", exact: true })).toBeVisible();
  expect((await (await page.request.get(`/api/runs/${run.id}`)).json()).steps).toBe(0);
});

test("missing keys keep live mode visible and leave rehearsal available", async ({ page }) => {
  await page.route("**/api/config", async route => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({ json: { ...config, modes: { ...config.modes, live: false } } });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Run to completion", exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Configure providers" })).toBeVisible();
  await page.getByRole("radio", { name: "Agent only", exact: true }).check();
  await expect(page.getByRole("button", { name: "Run to completion", exact: true })).toBeEnabled();
  await page.getByRole("radio", { name: "Fixture only", exact: true }).check();
  await expect(page.getByRole("button", { name: "Run to completion", exact: true })).toBeEnabled();
});

test("guided automatic run can pause, survive reload, and resume to both outputs", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "Fixture only", exact: true }).check();
  const enqueued = page.waitForResponse(response => response.url().endsWith("/start") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Run to completion", exact: true }).click();
  await enqueued;
  await page.getByRole("button", { name: "Pause after step", exact: true }).click();
  await expect(page.getByRole("button", { name: "Run to completion", exact: true })).toBeVisible();
  const runUrl = page.url();
  await page.reload();
  const resumed = page.waitForResponse(response => response.url().endsWith("/start") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Run to completion", exact: true }).click();
  await resumed;
  await page.reload();
  const output = page.getByRole("region", { name: "Investigation outputs" });
  await expect(output.getByRole("heading", { name: "Prepare corrected claim", exact: true })).toBeVisible();
  const id = new URL(runUrl).pathname.split("/").at(-1)!;
  const finished = await (await page.request.get(`/api/runs/${id}`)).json();
  expect(finished.steps).toBe(5);
  expect(finished.status).toBe("awaiting_review");
  expect(finished.handoff).toBeUndefined();
  await page.getByRole("link", { name: "Compare this case across modes" }).click();
  await expect(page.getByRole("heading", { name: "One case. Three approaches.", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Fixture only run", exact: true })).toHaveValue(id);
  await expect(page.getByRole("table", { name: "Mode comparison" }).getByRole("cell", { name: "Prepare corrected claim", exact: true })).toBeVisible();
});

test("saved live replay is read-only and shows an early stop without inventing a successful investigation", async ({ page }) => {
  const run = newRun("contradiction", "live");
  const router = new DemoRouter();
  const engine = new Engine({ async evaluate(state, settings) {
    const decision = await router.evaluate(state, settings);
    if (state.steps === 1) {
      decision.answers.next_agent.choice = "coverage_lookup";
      decision.answers.next_agent.confidence = .26;
    }
    return decision;
  } }, new FixtureAgents());
  while (run.status === "ready") await engine.step(run);
  let writes = 0;
  await page.route(`**/api/runs/${run.id}**`, route => {
    if (route.request().method() !== "GET") writes++;
    return route.fulfill({ json: run });
  });
  await page.goto(`/demo/${run.id}?step=0&replay=1`);
  await page.getByRole("button", { name: "Show next step" }).click();
  await page.getByRole("button", { name: "Show next step" }).click();
  await expect(page.getByRole("region", { name: "Current step" }).getByText(/Routing confidence \(26%\) was below the 70% threshold/)).toBeVisible();
  const sequence = page.getByRole("region", { name: "Investigation sequence" });
  await expect(sequence.getByRole("heading", { name: "Check coverage and authorization", exact: true })).toBeVisible();
  await expect(sequence.getByRole("heading", { name: "Changed to: Request human review", exact: true })).toBeVisible();
  await expect(sequence.getByText(/Routing confidence \(26%\) was below the 70% threshold/)).toBeVisible();
  await expect(sequence.getByRole("heading", { name: "Payer contact returned findings" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Investigation outputs" }).getByRole("heading", { name: "Human review", exact: true })).toBeVisible();
  await expect(page.getByText("duplicate claim", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run next step" })).toHaveCount(0);
  expect(writes).toBe(0);
});

test("run metrics show recorded timing and provider usage, update on polling, and label replay totals", async ({ page }) => {
  const run = newRun("corrected-claim", "live");
  const engine = new Engine(new DemoRouter(), new FixtureAgents());
  while (run.status === "ready") await engine.step(run);
  run.activeMs = 6200;
  run.metrics = [
    { provider: "jev", model: "jev-test", ms: 600, inputTokens: 100, outputTokens: 10 },
    { provider: "llm", model: "agent-test", ms: 1400, inputTokens: 250, outputTokens: 20 },
    { provider: "llm", model: "agent-test", ms: 2500, inputTokens: 150, outputTokens: 40 },
  ];
  let writes = 0;
  await page.route(`**/api/runs/${run.id}`, route => {
    if (route.request().method() !== "GET") writes++;
    return route.fulfill({ json: run });
  });
  await page.goto(`/demo/${run.id}?step=0&replay=1`);
  const metrics = page.getByRole("region", { name: "Run metrics", exact: true });
  const value = (label: string) => metrics.locator("dl > div").filter({ has: page.getByText(label, { exact: true }) }).locator("dd");
  await expect(value("Execution time")).toHaveText("6.20s");
  await expect(value("Provider time")).toHaveText("4.50s");
  await expect(value("Model tokens")).toHaveText("570");
  await expect(value("Model calls")).toHaveText("3");
  await expect(value("Tool results")).toHaveText("2");
  await expect(metrics.getByText("Full saved run · independent of replay position", { exact: true })).toBeVisible();
  await metrics.getByText("Provider breakdown · input/output tokens and timing", { exact: true }).click();
  const breakdown = metrics.getByRole("table", { name: "Provider usage breakdown", exact: true });
  await expect(breakdown.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "JEV", exact: true }) }).getByRole("cell")).toHaveText(["jev-test", "1", "0.60s", "100", "10"]);
  await expect(breakdown.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "OpenAI", exact: true }) }).getByRole("cell")).toHaveText(["agent-test", "2", "3.90s", "400", "60"]);
  await page.getByRole("button", { name: "Show next step", exact: true }).click();
  await expect(value("Model tokens")).toHaveText("570");
  // A newly persisted response is reflected without a page reload.
  run.metrics.push({ provider: "llm", model: "agent-test", ms: 2000, inputTokens: 200, outputTokens: 30 });
  run.activeMs = 8400;
  await expect(value("Execution time")).toHaveText("8.40s");
  await expect(value("Provider time")).toHaveText("6.50s");
  await expect(value("Model tokens")).toHaveText("800");
  delete run.activeMs;
  await expect(value("Execution time")).toHaveText("Not recorded");
  expect(writes).toBe(0);
});

test("stopped verification explains the evidence, competing choices, and application handoff", async ({ page }) => {
  const run = newRun("corrected-claim", "live");
  const fixture = new DemoRouter();
  const engine = new Engine({ async evaluate(state, settings) {
    const decision = await fixture.evaluate(state, settings);
    if (state.steps === 2) {
      decision.answers.next_agent.confidence = .69;
      decision.answers.next_agent.probabilities = {
        claim_lookup: .02, payer_contact: .01, document_lookup: 0, coverage_lookup: 0,
        billing_lookup: .19, history_lookup: 0, policy_lookup: .01, portal_lookup: 0,
        verify_findings: .72, task_action: .04, completion_note: 0, human_review: .01,
      };
      decision.answers.task_action.confidence = .97;
    }
    return decision;
  } }, new FixtureAgents());
  while (run.status === "ready") await engine.step(run);
  await page.route(`**/api/runs/${run.id}`, route => route.fulfill({ json: run }));
  await page.goto(`/demo/${run.id}`);
  const current = page.getByRole("region", { name: "Investigation sequence" }).locator('li[aria-current="step"]');
  await expect(current.getByText(/5 recorded facts.*source check was still pending/)).toBeVisible();
  const context = current.locator(".routing-context");
  await expect(context).toHaveAttribute("open", "");
  await expect(context.getByText("Source verification was pending.", { exact: true })).toBeVisible();
  await expect(context.getByText("submit a corrected claim with the modifier", { exact: true })).toBeVisible();
  const rows = context.locator(".routing-options").first().locator("li");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Verify the evidenceProposed72%");
  await expect(rows.nth(1)).toContainText("19%");
  await expect(rows.nth(2)).toContainText("Request human review1%");
  await expect(context.getByText(/The application chose the handoff/)).toBeVisible();
  await expect(context.getByText(/Prepare corrected claim · 97% confidence/)).toBeVisible();
  const gate = current.getByLabel("Routing confidence check");
  await expect(gate.getByText("69%", { exact: true })).toBeVisible();
  await expect(gate.getByText("70%", { exact: true })).toBeVisible();
  await expect(gate.getByText("1 percentage point below the saved threshold.", { exact: true })).toBeVisible();
  await current.screenshot({ path: "test-results/step3-handoff-context.png" });
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.locator('li[aria-current="step"] .routing-context')).not.toHaveAttribute("open", "");
  await expect(page.locator('li[aria-current="step"]').getByText("Source verification was pending.", { exact: true })).not.toBeVisible();
});
