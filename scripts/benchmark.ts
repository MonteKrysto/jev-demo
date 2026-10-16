import { parseArgs } from "node:util";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { benchmarkOptionsSchema, type BenchmarkReport } from "../packages/core/benchmark.js";

const { values } = parseArgs({ options: {
  mode: { type: "string", default: "compare" }, scope: { type: "string", default: "curated" },
  split: { type: "string", default: "development" }, limit: { type: "string", default: "3" },
  repeats: { type: "string", default: "2" }, seed: { type: "string", default: "rcm-comparison-1" },
  url: { type: "string" }, prices: { type: "string" }, output: { type: "string" },
  wait: { type: "boolean", default: false }, "dry-run": { type: "boolean", default: false },
} });
const options = benchmarkOptionsSchema.parse({ mode: values.mode, scope: values.scope, split: values.split,
  limit: Number(values.limit), repeats: Number(values.repeats), seed: values.seed,
  ...(values.prices ? { pricing: JSON.parse(await readFile(values.prices, "utf8")) } : {}) });
const base = (values.url ?? `http://127.0.0.1:${process.env.APP_PORT ?? process.env.PORT ?? 3001}`).replace(/\/$/, "");
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}/api${path}`, { method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data as T;
}
const preview = await request<{ runs: number; families: number; cases: { id: string }[] }>("/benchmarks/preview", options);
console.log(`${preview.cases.length} cases across ${preview.families} families; ${options.repeats} repeats; ${preview.runs} total runs.`);
console.log(`Cases: ${preview.cases.map(c => c.id).join(", ")}`);
if (preview.runs > 160) throw new Error("Reduce the sample or repeats to at most 160 total runs");
if (values["dry-run"]) {
  console.log("Preview only. No runs created and no provider calls made.");
} else {
  const id = crypto.randomUUID();
  const output = resolve(values.output ?? `.data/benchmark-${id}.json`);
  if (values.wait || values.output) {
    await mkdir(dirname(output), { recursive: true });
    await access(dirname(output), constants.W_OK);
    try { await access(output, constants.W_OK); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  console.log(options.mode === "compare" ? "Starting paid provider comparison." : "Starting fixture check (no provider calls).");
  await request("/benchmarks", { id, options });
  console.log(`Saved evaluation: ${process.env.PUBLIC_ORIGIN ?? base}/evaluations?id=${id}`);
  if (values.wait || values.output) {
    let report: BenchmarkReport;
    let progress = -1;
    do {
      report = await request<BenchmarkReport>(`/benchmarks/${id}`);
      if (report.analysis.finished !== progress) {
        progress = report.analysis.finished;
        console.log(`${progress}/${report.analysis.planned} trials finished`);
      }
      if (report.paused) break;
      if (!report.analysis.complete) await new Promise(resolve => setTimeout(resolve, 2000));
    } while (!report.analysis.complete);
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    console.log(`Report: ${output}${report.paused ? " (paused; partial results)" : ""}`);
    if (!report.analysis.complete || report.results.some(r => !r.matched || !r.noteChecksPassed)) process.exitCode = 1;
  }
}
