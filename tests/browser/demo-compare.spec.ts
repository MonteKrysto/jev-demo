import { test, expect, type Page } from "@playwright/test";
import { Engine, newRun } from "../../packages/core/engine";
import { DemoRouter } from "../../packages/core/jev";
import { FixtureAgents } from "../../packages/core/agents";
import type { Mode, Run } from "../../packages/core/domain";

// Provider responses are simulated for browser interaction checks. Real model
// endpoints are never used; fixture auto-execution has a separate worker test.
async function mockComparison(page: Page, failFirstLiveQueue = false) {
  const saved = new Map<string, Run>();
  const creates: { scenarioId: string; mode: Mode }[] = [];
  const starts: string[] = [];
  await page.route("**/api/jobs", route => route.fulfill({ json: [] }));
  await page.route("**/api/runs**", async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === "/api/runs") {
      if (method === "GET") return route.fulfill({ json: [] }); // Selected IDs load even outside the recent-run list.
      const input = route.request().postDataJSON();
      creates.push(input);
      const run = newRun(input.scenarioId, input.mode);
      saved.set(run.id, run);
      return route.fulfill({ json: run });
    }
    const id = path.split("/")[3];
    const run = saved.get(id);
    if (!run) return route.fulfill({ status: 404, json: { error: "Run unavailable" } });
    if (path.endsWith("/start")) {
      starts.push(id);
      if (failFirstLiveQueue && run.mode === "live") {
        failFirstLiveQueue = false;
        return route.fulfill({ status: 503, json: { error: "Queue temporarily unavailable" } });
      }
      const router = new DemoRouter();
      const engine = new Engine({ async evaluate(state, settings) {
        const result = await router.evaluate(state, settings);
        if (state.mode === "live" && state.steps === 1) {
          result.answers.next_agent.confidence = .26;
        }
        return result;
      } }, new FixtureAgents());
      while (run.status === "ready") await engine.step(run);
      return route.fulfill({ json: { runId: id, status: "completed", pauseRequested: false } });
    }
    return route.fulfill({ json: run });
  });
  return { saved, creates, starts };
}

test("three-mode comparison queues the selected modes, shows different outcomes, and keeps selected runs on reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const mock = await mockComparison(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Compare all three modes" }).click();
  await expect(page.getByRole("heading", { name: "One case. Three approaches." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Demo", exact: true })).toHaveAttribute("aria-current", "page");
  expect(mock.creates).toHaveLength(0);
  expect(mock.starts).toHaveLength(0);
  await page.getByRole("button", { name: "Run all three", exact: true }).click();
  const table = page.getByRole("table", { name: "Mode comparison" });
  const outcome = table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Task Action", exact: true }) });
  await expect(outcome.getByRole("cell")).toHaveText(["Prepare corrected claim", "Prepare corrected claim", "Human review"]);
  for (const label of ["Summed provider time", "JEV time", "OpenAI time"]) {
    await expect(table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: label, exact: true }) }).getByRole("cell")).toHaveText(["0.00s", "0.00s", "0.00s"]);
  }
  await expect(table.getByRole("rowheader", { name: "Execution time", exact: true })).toBeVisible();
  await expect(table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Model calls", exact: true }) }).getByRole("cell")).toHaveText(["0", "0", "0"]);
  expect(mock.creates).toEqual(["demo", "openai", "live"].map(mode => ({ scenarioId: "corrected-claim", mode })));
  expect(new Set(mock.starts).size).toBe(3);
  const url = page.url();
  for (const [label, mode] of [["Fixture only", "demo"], ["Agent only", "openai"], ["Agent + JEV", "live"]] as const) {
    await expect(page.getByRole("combobox", { name: `${label} run`, exact: true })).toHaveValue(new URL(url).searchParams.get(mode)!);
  }
  await expect(table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "Completion note", exact: true }) }).getByRole("cell")).toHaveCount(3);
  await page.screenshot({ path: "test-results/demo-three-mode-comparison.png", fullPage: true });
  await page.reload();
  await expect(outcome.getByRole("cell")).toHaveText(["Prepare corrected claim", "Prepare corrected claim", "Human review"]);
  expect(page.url()).toBe(url);
  expect(mock.creates).toHaveLength(3);
  expect(mock.starts).toHaveLength(3);
  await page.getByText("Show sequence · 2 steps", { exact: true }).click();
  await expect(table.getByRole("heading", { name: "Changed to: Request human review", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Open Agent only investigation", exact: true }).click();
  await expect(page.getByRole("region", { name: "Investigation outputs" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a partial queue failure keeps the new run selected and resumes it without creating duplicates", async ({ page }) => {
  const mock = await mockComparison(page, true);
  await page.goto("/demo/compare?case=corrected-claim");
  await page.getByRole("button", { name: "Run all three", exact: true }).click();
  await expect(page.getByText("Queue temporarily unavailable", { exact: true })).toBeVisible();
  const liveId = new URL(page.url()).searchParams.get("live");
  const live = page.getByRole("columnheader").filter({ has: page.getByRole("heading", { name: "Agent + JEV", exact: true }) });
  await live.getByRole("button", { name: "Run to completion", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Human review", exact: true })).toBeVisible();
  expect(mock.creates).toHaveLength(3);
  expect(mock.starts.filter(id => id === liveId)).toHaveLength(2);
  expect(new URL(page.url()).searchParams.get("live")).toBe(liveId);
  await expect(page.getByText("Queue temporarily unavailable", { exact: true })).toHaveCount(0);
});

test("comparison requires matching case and mode and disables modes without keys", async ({ page }) => {
  const mock = await mockComparison(page);
  const wrongCase = newRun("contradiction", "demo");
  const wrongMode = newRun("corrected-claim", "demo");
  mock.saved.set(wrongCase.id, wrongCase);
  mock.saved.set(wrongMode.id, wrongMode);
  await page.route("**/api/config", async route => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({ json: { ...config, modes: { demo: true, openai: false, live: false, jev: false } } });
  });
  await page.goto(`/demo/compare?case=corrected-claim&demo=${wrongCase.id}&openai=${wrongMode.id}&live=`);
  await expect(page.getByText("This run uses a different case or mode. Choose a matching run.", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Run all three", exact: true })).toBeDisabled();
  const fixture = page.getByRole("columnheader").filter({ has: page.getByRole("heading", { name: "Fixture only", exact: true }) });
  const agent = page.getByRole("columnheader").filter({ has: page.getByRole("heading", { name: "Agent only", exact: true }) });
  await expect(fixture.getByRole("button", { name: "Start new run", exact: true })).toBeEnabled();
  await expect(agent.getByRole("button", { name: "Start new run", exact: true })).toBeDisabled();
  await fixture.getByRole("button", { name: "Start new run", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Prepare corrected claim", exact: true })).toBeVisible();
  expect(mock.creates).toEqual([{ scenarioId: "corrected-claim", mode: "demo" }]);
});
