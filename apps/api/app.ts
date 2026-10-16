import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { event } from "../../packages/core/domain.js";
import { newRun } from "../../packages/core/engine.js";
import { toolCatalog } from "../../packages/core/tools.js";
import { configFromEnv, createEngine, type Config } from "./config.js";
import { RunStore, ConflictError, NotFoundError } from "./store.js";
import { benchmarkOptionsSchema, makeBenchmarkPlan, selectBenchmarkCases, sameBenchmarkOptions } from "../../packages/core/benchmark.js";

const createSchema = z
  .object({
    scenarioId: z.string().max(100),
    mode: z.enum(["demo", "jev", "live", "openai"]).default("demo"),
  })
  .strict();
const stepSchema = z
  .object({ expectedRevision: z.number().int().nonnegative() })
  .strict();
const approvalSchema = stepSchema.extend({
  actor: z.string().trim().min(1).max(80),
});
export async function buildApp(
  store: RunStore,
  config: Config = configFromEnv(),
) {
  const app = Fastify({
    logger: false,
    bodyLimit: 16000,
    requestTimeout: 120000,
  });
  app.setErrorHandler((err, _req, reply) => {
    const status =
      err instanceof z.ZodError
        ? 400
        : ((err as { statusCode?: number }).statusCode ?? 400);
    reply.code(status).send({
      error:
        err instanceof z.ZodError
          ? "Invalid request body"
          : err instanceof Error
            ? err.message
            : "Request failed",
    });
  });
  app.addHook("onRequest", async (request, reply) => {
    if (
      ["POST", "PUT", "DELETE", "PATCH"].includes(request.method) &&
      request.headers.origin &&
      ![
        `http://localhost:${config.PORT}`,
        `http://127.0.0.1:${config.PORT}`,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        config.PUBLIC_ORIGIN,
        config.PUBLIC_ORIGIN?.replace("localhost", "127.0.0.1"),
      ].includes(request.headers.origin)
    ) {
      return reply
        .code(403)
        .send({ error: "Origin is not allowed for this local POC" });
    }
  });
  app.addHook("preHandler", async (request) => {
    const match = request.url.match(/^\/api\/runs\/([^/?]+)\/(step|start|pause|retry|approve)(?:\?|$)/);
    if (request.method === "POST" && match && (await store.get(match[1])).benchmark)
      throw new ConflictError("Benchmark trials are read-only. Pause or resume the whole benchmark from Evaluations.");
  });
  app.get("/api/health", async (_request, reply) => {
    try {
      await store.ping();
      return {
        ok: true,
        database: store.backend,
        queue: await store.queueHealth(),
      };
    } catch {
      return reply.code(503).send({ ok: false, database: store.backend });
    }
  });
  app.get("/api/config", async () => ({
    syntheticOnly: true,
    database: store.backend,
    modes: {
      demo: true,
      openai: Boolean(config.OPENAI_API_KEY),
      jev: Boolean(config.TYPESAFE_API_KEY),
      live: Boolean(config.TYPESAFE_API_KEY && config.OPENAI_API_KEY),
    },
    confidenceThreshold: config.CONFIDENCE_THRESHOLD,
    maxSteps: config.MAX_STEPS,
    maxPayerCalls: config.MAX_PAYER_CALLS,
    jevModel: config.TYPESAFE_MODEL,
    llmModel: config.LLM_MODEL,
  }));
  app.get("/api/scenarios", async () => store.cases());
  app.get("/api/runs", async () => store.list());
  app.post("/api/runs", async (request) => {
    const input = createSchema.parse(request.body);
    createEngine(input.mode, config); // Validate configured credentials before creating a run.
    return store.create(newRun(input.scenarioId, input.mode));
  });
  app.get<{ Params: { id: string } }>("/api/runs/:id", async (request) =>
    store.get(request.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/step",
    async (request) => {
      const input = stepSchema.parse(request.body);
      return store.mutate(request.params.id, input.expectedRevision, (run) =>
        createEngine(run.mode, config, store).step(run),
      );
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/retry",
    async (request) => {
      const input = stepSchema.parse(request.body);
      return store.mutate(
        request.params.id,
        input.expectedRevision,
        async (run) => {
          if (run.status !== "failed")
            throw new Error("Only failed runs may be retried");
          run.status = "ready";
          delete run.reviewReason;
          event(run, "policy", "Reviewer requested a retry");
          return run;
        },
      );
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/approve",
    async (request) => {
      const input = approvalSchema.parse(request.body);
      return store.mutate(
        request.params.id,
        input.expectedRevision,
        async (run) =>
          createEngine(run.mode, config, store).approve(run, input.actor),
      );
    },
  );
  app.get("/api/tools", async () => toolCatalog);
  app.get<{ Params: { id: string } }>(
    "/api/runs/:id/tools",
    async (request) => {
      await store.get(request.params.id);
      return store.invocations(request.params.id);
    },
  );
  app.get("/api/jobs", async () => store.jobs());
  app.get("/api/queue", async () => store.queueHealth());
  app.get("/api/evaluations", async () => store.evaluations());
  app.get("/api/benchmarks", async () => store.benchmarks());
  app.post("/api/benchmarks/preview", async request => {
    const options = benchmarkOptionsSchema.parse(request.body);
    const cases = selectBenchmarkCases(options);
    return { cases: cases.map(s => ({ id: s.id, title: s.title, family: s.family, variant: s.variant })),
      runs: cases.length * options.repeats * (options.mode === "compare" ? 2 : 1),
      families: new Set(cases.map(s => s.family)).size, maxSteps: config.MAX_STEPS };
  });
  app.post("/api/benchmarks", async request => {
    const input = z.object({ id: z.string().uuid(), options: benchmarkOptionsSchema }).strict().parse(request.body);
    // A retried request returns the original batch, even if server settings changed.
    try {
      const saved = await store.benchmarkPlan(input.id);
      if (!sameBenchmarkOptions(saved.options, input.options))
        throw new ConflictError("This request ID belongs to a different benchmark");
      return { id: saved.id };
    } catch (error) { if (!(error instanceof NotFoundError)) throw error; }
    for (const mode of input.options.mode === "compare" ? ["live", "openai"] as const : ["demo"] as const)
      createEngine(mode, config);
    const { plan, runs } = makeBenchmarkPlan(input.id, input.options,
      { maxSteps: config.MAX_STEPS, maxPayerCalls: config.MAX_PAYER_CALLS, confidenceThreshold: config.CONFIDENCE_THRESHOLD },
      { jev: config.TYPESAFE_MODEL, openai: config.LLM_MODEL });
    if (!runs.length || runs.length > 160) throw new Error("Choose between 1 and 160 total runs per benchmark");
    await store.createBenchmark(plan, runs);
    return { id: plan.id };
  });
  app.get<{ Params: { id: string } }>("/api/benchmarks/:id", request => store.benchmarkReport(request.params.id));
  app.post<{ Params: { id: string } }>("/api/benchmarks/:id/control", async request => {
    const { action } = z.object({ action: z.enum(["pause", "resume"]) }).strict().parse(request.body);
    await store.controlBenchmark(request.params.id, action);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/start",
    async (request) => {
      const input = stepSchema.parse(request.body);
      return store.enqueue(request.params.id, input.expectedRevision);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/pause",
    async (request) => {
      z.object({}).strict().parse(request.body);
      return store.pause(request.params.id);
    },
  );
  const staticRoot = resolve("dist/web");
  if (existsSync(staticRoot)) {
    await app.register(fastifyStatic, { root: staticRoot });
    app.setNotFoundHandler((request, reply) => {
      const path = request.url.split("?")[0];
      // Preserve client routes on reload, but return real 404s for missing APIs and assets.
      if (
        request.method === "GET" &&
        request.headers.accept?.includes("text/html") &&
        path !== "/api" &&
        !path.startsWith("/api/") &&
        !path.split("/").at(-1)?.includes(".")
      ) {
        return reply.type("text/html").sendFile("index.html");
      }
      return reply.code(404).send({ error: "Not found" });
    });
  }
  return app;
}
