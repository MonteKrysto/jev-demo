import { test, expect } from "@playwright/test";
import { Engine, newRun } from "../../packages/core/engine";
import { DemoRouter } from "../../packages/core/jev";
import { FixtureAgents } from "../../packages/core/agents";
import { event } from "../../packages/core/domain";

test("evaluation preview, durable pause/resume, results, and read-only trial inspection", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/evaluations");
  await expect(page.getByRole("button", { name: "Start paid comparison" })).toBeVisible();
  await expect(page.getByText(/Starting this comparison makes paid requests/)).toBeVisible();
  await page.getByLabel("Evaluation type").selectOption("fixture");
  await page.getByLabel("Maximum cases").fill("2");
  await expect(page.getByText("2 cases · 2 families · 4 total runs")).toBeVisible();
  await page.getByText("Preview selected cases", { exact: true }).click();
  await page.screenshot({ path: "test-results/evaluation-setup-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Run fixture check" }).click();
  await expect(page).toHaveURL(/evaluations\?id=/);
  const url = page.url();
  await page.getByRole("button", { name: "Pause evaluation", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume evaluation" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Resume evaluation" })).toBeVisible();
  await page.getByRole("button", { name: "Resume evaluation" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Completed evaluation", exact: true })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("4 / 4 trials finished", { exact: true })).toBeVisible();
  await expect(page.getByText("Fixture check — no live model comparison.", { exact: false })).toBeVisible();
  await page.getByLabel("Failures and mismatches only").check();
  await expect(page.getByText("No matching trials.")).toBeVisible();
  await page.getByLabel("Failures and mismatches only").uncheck();
  await page.screenshot({ path: "test-results/evaluation-results-desktop.png", fullPage: true });
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export evaluation" }).click();
  expect((await exported).suggestedFilename()).toMatch(/^evaluation-.*\.json$/);
  const id = new URL(url).searchParams.get("id");
  const report = await (await page.request.get(`/api/benchmarks/${id}`)).json();
  expect(report.analysis.summaries[0].accuracy).toBe(1);
  expect(report.analysis.summaries[0].noteChecksPassed).toBe(4);
  await page.locator(`a[href="/investigations/${report.results[0].runId}"]`).click();
  await expect(page.getByRole("button", { name: "Next checkpoint" })).toHaveCount(0);
  await page.getByRole("tab", { name: /^Outputs/ }).click();
  await expect(page.getByText(/Evaluation output is preserved/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve & save handoff" })).toHaveCount(0);
  await page.getByRole("link", { name: "View evaluation", exact: true }).first().click();
  await expect(page).toHaveURL(url);
});

test("live providers are visible before the corpus and selection reaches the API", async ({ page }) => {
  await page.goto("/investigations/new");
  await expect(page.getByRole("radio", { name: "Fixture demo", exact: true })).toBeChecked();
  const live = page.getByRole("radio", { name: "Live JEV + OpenAI", exact: true });
  await expect(live).toBeInViewport();
  await live.check();
  await expect(page).toHaveURL(/mode=live/);
  await page.reload();
  await expect(live).toBeChecked();
  await expect(page.getByText("jev-latest", { exact: true })).toBeVisible();
  await expect(page.getByText("gpt-4.1-mini", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start investigation", exact: true })).toBeInViewport();
  await page.screenshot({ path: "test-results/live-setup-desktop.png", fullPage: true });

  await page.getByRole("searchbox", { name: "Search cases" }).fill("SYN-1002");
  const cases = page.getByRole("radiogroup", { name: "Synthetic case" });
  await expect(cases.getByRole("radio")).toHaveCount(1);
  await cases.getByRole("radio").check();
  // Create a real, persisted live-mode run without executing provider requests.
  await page.getByRole("radio", { name: "Open and step through manually" }).check();
  const created = page.waitForResponse(response =>
    response.url().endsWith("/api/runs") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Start investigation", exact: true }).click();
  const response = await created;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON()).toEqual({ scenarioId: "corrected-claim", mode: "live" });
  const run = await response.json();
  expect(run.mode).toBe("live");
  await expect(page).toHaveURL(`/investigations/${run.id}`);
  await expect(page.getByText(/Live JEV \+ OpenAI/)).toBeVisible();
  const saved = await (await page.request.get(`/api/runs/${run.id}`)).json();
  expect(saved.mode).toBe("live");
  expect(saved.steps).toBe(0);

  await page.goto("/settings");
  await page.getByRole("link", { name: "Start with JEV + OpenAI" }).click();
  await expect(live).toBeChecked();
});

test("live deep links explain missing credentials and cannot start a run", async ({ page }) => {
  await page.route("**/api/config", async route => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({ json: { ...config, modes: { demo: true, jev: false, live: false, openai: false } } });
  });
  await page.goto("/investigations/new?mode=live");
  const live = page.getByRole("radio", { name: "Live JEV + OpenAI", exact: true });
  await expect(live).toBeChecked();
  await expect(live).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("This mode needs provider keys.");
  await expect(page.getByRole("button", { name: "Start investigation", exact: true })).toBeDisabled();
  await page.getByRole("radio", { name: "Fixture demo", exact: true }).check();
  await expect(page.getByRole("button", { name: "Start investigation", exact: true })).toBeEnabled();
  await page.goto("/investigations/new?mode=invalid");
  await expect(page.getByRole("radio", { name: "Fixture demo", exact: true })).toBeChecked();
});

test("create, step, reload, complete, inspect evidence, and approve a claim", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/investigations/new?case=corrected-claim");
  await page
    .getByRole("radio", { name: "Open and step through manually" })
    .check();
  await page
    .getByRole("button", { name: "Start investigation", exact: true })
    .click();
  await expect(page).toHaveURL(/\/investigations\/[a-f0-9-]+$/);
  await expect(
    page.getByRole("heading", { name: "SYN-1002", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next checkpoint" }).click();
  await expect(
    page.getByRole("heading", { name: "Look up the claim", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Look up the claim", exact: true }),
  ).toBeVisible();
  const enqueued = page.waitForResponse(response => response.url().endsWith("/start") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Run to review" }).click();
  expect((await enqueued).ok()).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Review outputs" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /^Evidence/ }).click();
  await expect(
    page.getByRole("cell", { name: "missing modifier", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /^Decision trail/ }).click();
  await page.getByRole("tab", { name: /^Decision trail/ }).press("ArrowRight");
  await expect(page.getByRole("tab", { name: /^Evidence/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("tab", { name: /^Evidence/ }).press("Home");
  await expect(
    page.getByRole("tab", { name: /^Decision trail/ }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByText("Scripted scores & technical details").first().click();
  await expect(
    page
      .getByText(
        "The current policy permits one workflow step plus human review.",
      )
      .first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review outputs" }).click();
  await expect(
    page.getByRole("textbox", { name: "Completion note", exact: true }),
  ).toHaveValue(/missing modifier/);
  await page
    .getByRole("textbox", { name: "Reviewer name" })
    .fill("Browser reviewer");
  await page.getByRole("button", { name: "Approve & save handoff" }).click();
  await expect(
    page.getByText("Handoff saved by Browser reviewer"),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export run" }).click();
  expect((await download).suggestedFilename()).toMatch(
    /^investigation-.*\.json$/,
  );
  await page.screenshot({
    path: "test-results/investigation-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("automatic execution survives navigation, pauses, and resumes", async ({
  page,
}) => {
  await page.goto("/investigations/new?case=second-contact");
  await page
    .getByRole("button", { name: "Start investigation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Pause after step" }),
  ).toBeVisible();
  const runUrl = page.url();
  await page.getByRole("link", { name: "Case library", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Case library", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "View investigation", exact: true })
    .click();
  await expect(page).toHaveURL(runUrl);
  await page.getByRole("button", { name: "Pause after step" }).click();
  await expect(
    page.getByRole("button", { name: "Run to review" }),
  ).toBeVisible();
  const id = new URL(runUrl).pathname.split("/").at(-1)!;
  const paused = await (await page.request.get(`/api/runs/${id}`)).json();
  expect(paused.status).toBe("ready");
  expect(paused.steps).toBeLessThan(7);
  await page.getByRole("button", { name: "Run to review" }).click();
  await expect(
    page.getByRole("button", { name: "Review outputs" }),
  ).toBeVisible();
  const finished = await (await page.request.get(`/api/runs/${id}`)).json();
  expect(finished.steps).toBe(7);
  expect(finished.payerCalls).toBe(2);
  expect(finished.taskAction).toBe("appeal");
});

test("human-review case preserves conflicting findings and saves a review handoff", async ({
  page,
}) => {
  await page.goto("/investigations/new?case=contradiction");
  await page
    .getByRole("button", { name: "Start investigation", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Review outputs" })).toBeVisible();
  const review = page.getByRole("article", { name: "Checkpoint 4: Request human review" });
  await expect(review.getByText("missing prior authorization", { exact: true })).toBeVisible();
  await expect(review.getByText("duplicate claim", { exact: true })).toBeVisible();
  await expect(review.getByText("Only human review was permitted.", { exact: true })).toBeVisible();
  await expect(review.getByText(/did not resolve the disagreement/)).toBeVisible();
  await expect(review.getByText("Fixture router proposed", { exact: true })).toBeVisible();
  await expect(review.getByText("Application allowed", { exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Checkpoint 1: Look up the claim" }).getByText("duplicate claim", { exact: true })).toHaveCount(0);
  const verification = page.getByRole("article", { name: "Checkpoint 3: Verify the evidence" });
  await expect(verification.getByText(/Verification does not resolve which source is correct/)).toBeVisible();
  await review.getByText("Scripted scores & technical details", { exact: true }).click();
  await expect(review.getByText(/They are scripted, not measured model confidence/)).toBeVisible();
  await review.getByText("Scripted scores & technical details", { exact: true }).click();
  await review.screenshot({ path: "test-results/contradiction-decision-desktop.png" });
  await page.screenshot({ path: "test-results/contradiction-trail-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Review outputs" }).click();
  await expect(
    page.getByRole("textbox", { name: "Completion note", exact: true }),
  ).toHaveValue(/missing prior authorization/);
  await expect(
    page.getByRole("textbox", { name: "Completion note", exact: true }),
  ).toHaveValue(/duplicate claim/);
  await page.getByRole("button", { name: "Save review handoff" }).click();
  await expect(page.getByText("Handoff saved by Local reviewer")).toBeVisible();
});

for (const mode of ["live", "openai"] as const) test(`${mode} investigation shows routing and agent work together in the saved order`, async ({ page }) => {
  // Render saved provider runs with fixture responses; no model APIs are called.
  const run = newRun("corrected-claim", mode);
  const engine = new Engine(new DemoRouter(), new FixtureAgents());
  while (run.status === "ready") await engine.step(run);
  await page.route(`**/api/runs/${run.id}`, route => route.fulfill({ json: run }));
  await page.goto(`/investigations/${run.id}`);
  const decisionLabel = mode === "live" ? "JEV decision" : "OpenAI routing";
  const first = page.getByRole("article", { name: "Checkpoint 1: Look up the claim" });
  await expect(first.getByRole("region", { name: decisionLabel, exact: true })).toBeVisible();
  const work = first.getByRole("list", { name: "Work after this decision" });
  await expect(work.getByText("OpenAI agent", { exact: true })).toBeVisible();
  await expect(work.getByRole("heading", { name: "Claim record returned findings" })).toBeVisible();
  await expect(work.locator("code")).toHaveText("get_claim");
  await expect(work.getByText("denied", { exact: true })).toBeVisible();
  await expect(first.locator(".checkpoint-content > *")).toHaveCount(2);
  const payer = page.getByRole("article", { name: "Checkpoint 2: Contact the payer" });
  await expect(payer.getByRole("region", { name: decisionLabel, exact: true })).toBeVisible();
  await expect(payer.getByRole("list", { name: "Work after this decision" }).getByText("missing modifier", { exact: true })).toBeVisible();
  const verify = page.getByRole("article", { name: "Checkpoint 3: Verify the evidence" });
  await expect(verify.getByRole("heading", { name: "Checked 5 facts against their sources" })).toBeVisible();
  await expect(verify.locator(".demo-sequence-agent")).toHaveCount(0);
  const note = page.getByRole("article", { name: "Checkpoint 5: Prepare the completion note" });
  await expect(note.getByRole("list", { name: "Work after this decision" }).getByRole("heading")).toHaveText([
    "Organized verified facts for the note", "Completion note prepared",
  ]);
  await first.screenshot({ path: `test-results/${mode}-decision-and-agent-desktop.png` });
});

test("investigation preserves an attempted tool call before a source-recording failure", async ({ page }) => {
  const run = newRun("corrected-claim", "live");
  const engine = new Engine(new DemoRouter(), {
    async gather(_capability, state) {
      event(state, "tool", "LLM called get_claim", { tool: "get_claim", sourceId: "unaccepted" });
      throw new Error("Source check failed for claim_status");
    },
    async composeNote() { throw new Error("Unexpected note call"); },
  });
  await engine.step(run);
  await page.route(`**/api/runs/${run.id}`, route => route.fulfill({ json: run }));
  await page.goto(`/investigations/${run.id}`);
  const first = page.getByRole("article", { name: "Checkpoint 1: Look up the claim" });
  await expect(first.getByRole("list", { name: "Work after this decision" }).getByRole("heading")).toHaveText([
    "Called get_claim", "Source check failed for claim_status",
  ]);
  await expect(first.getByText("No accepted findings were recorded for this call.")).toBeVisible();
  await expect(first.locator(".demo-sequence-agent").getByText("OpenAI agent", { exact: true })).toBeVisible();
  await expect(first.locator(".demo-sequence-application").getByText("Application", { exact: true })).toBeVisible();
});

test("decision trail distinguishes a live confidence override from a discovered conflict", async ({ page }) => {
  const run = newRun("contradiction", "live");
  const router = new DemoRouter();
  const engine = new Engine({ async evaluate(state, settings) {
    const decision = await router.evaluate(state, settings);
    decision.model = "jev-test";
    if (state.steps === 1) {
      decision.answers.next_agent.choice = "coverage_lookup";
      decision.answers.next_agent.confidence = .26;
    }
    return decision;
  } }, new FixtureAgents());
  while (run.status === "ready") await engine.step(run);
  await page.route(`**/api/runs/${run.id}`, route => route.fulfill({ json: run }));
  await page.goto(`/investigations/${run.id}`);
  const review = page.getByRole("article", { name: "Checkpoint 2: Request human review" });
  await expect(review.getByText(/Routing confidence \(26%\) was below the 70% threshold/)).toBeVisible();
  await expect(review.getByText("JEV proposed", { exact: true })).toBeVisible();
  await expect(review.getByText("Application redirected to", { exact: true })).toBeVisible();
  await expect(review.locator(".decision-applied").getByText("Check coverage and authorization", { exact: true })).toBeVisible();
  await expect(review.getByText("THE SOURCES DISAGREE", { exact: true })).toHaveCount(0);
  await expect(review.getByText("duplicate claim", { exact: true })).toHaveCount(0);
  await expect(review.locator(".demo-sequence-agent")).toHaveCount(0);
  await expect(review.getByRole("heading", { name: "Handed off for human review" })).toBeVisible();
  await review.screenshot({ path: "test-results/confidence-override-desktop.png" });
});

test("search, compare, deep links, and desktop configuration", async ({
  page,
}) => {
  // Set up comparison data through the API so this test can also run alone.
  const ids: string[] = [];
  for (const scenarioId of ["corrected-claim", "processing"]) {
    const run = await (
      await page.request.post("/api/runs", {
        data: { scenarioId, mode: "demo" },
      })
    ).json();
    ids.push(run.id);
  }
  await page.goto("/lab");
  await expect(
    page.getByRole("heading", {
      name: "See the evidence. Understand the decision.",
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/overview-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: /^Investigations/ })
    .click();
  await page
    .getByRole("textbox", { name: "Search investigations" })
    .fill("SYN-1002");
  await expect(
    page.getByRole("link", { name: "SYN-1002", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "SYN-1004", exact: true }),
  ).toHaveCount(0);
  await page.goto("/compare");
  await page.getByLabel("First investigation").selectOption(ids[0]);
  await page.getByLabel("Second investigation").selectOption(ids[1]);
  await expect(
    page.getByRole("cell", { name: "Task Action", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("First investigation")).toHaveValue(ids[0]);
  await page.goto("/cases");
  await page.getByRole("textbox", { name: "Search cases" }).fill("modifier");
  await expect(
    page.getByRole("heading", { name: "Correct a claim" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Records needed for appeal" }),
  ).toHaveCount(0);
  await page.goto("/settings");
  await expect(page.getByText("React 19.3.0", { exact: true })).toBeVisible();
});

test("unknown API routes stay JSON 404s and read failures are recoverable", async ({
  page,
}) => {
  const api = await page.request.get("/api/missing", {
    headers: { accept: "text/html" },
  });
  expect(api.status()).toBe(404);
  expect(api.headers()["content-type"]).toContain("application/json");
  const asset = await page.request.get("/missing.js", {
    headers: { accept: "text/html" },
  });
  expect(asset.status()).toBe(404);
  await page.route("**/api/scenarios", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "The case service is temporarily unavailable." },
    }),
  );
  await page.goto("/cases");
  await expect(
    page.getByText("The case service is temporarily unavailable."),
  ).toBeVisible();
  await page.unroute("**/api/scenarios");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "Case library", exact: true }),
  ).toBeVisible();
});
