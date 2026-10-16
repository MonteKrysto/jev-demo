import { z } from "zod";
import OpenAI from "openai";
import { Engine } from "../../packages/core/engine.js";
import { DemoRouter, JevRouter } from "../../packages/core/jev.js";
import { FixtureAgents, LlmAgents } from "../../packages/core/agents.js";
import { OpenAiRouter } from "../../packages/core/openai-router.js";
import { DatabaseTools } from "./tool-adapter.js";
import type { RunStore } from "./store.js";
import type { Mode, Run } from "../../packages/core/domain.js";

const schema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default("127.0.0.1"),
  PUBLIC_ORIGIN: z.string().url().optional(),
  CONFIDENCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
  MAX_STEPS: z.coerce.number().int().min(1).max(40).default(12),
  MAX_PAYER_CALLS: z.coerce.number().int().min(1).max(5).default(2),
  TYPESAFE_API_KEY: z.string().optional(),
  TYPESAFE_MODEL: z.string().default("jev-latest"),
  TYPESAFE_BASE_URL: z.string().url().default("https://api.typesafe.ai"),
  OPENAI_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("gpt-4.1-mini"),
  LLM_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  DATABASE_URL: z.string().optional(),
  DATA_DIR: z.string().default(".data/postgres"),
});
export type Config = z.infer<typeof schema>;
export function configFromEnv(
  env: Record<string, string | undefined> = process.env,
): Config {
  const clean = Object.fromEntries(
    Object.entries(env).filter(([, val]) => val?.trim()),
  );
  return schema.parse(clean);
}

export function createEngine(mode: Mode, config: Config, store?: RunStore, run?: Run) {
  if (run?.benchmark) {
    config = {
      ...config,
      TYPESAFE_MODEL: run.benchmark.models.jev,
      LLM_MODEL: run.benchmark.models.openai,
      MAX_STEPS: run.benchmark.settings.maxSteps,
      MAX_PAYER_CALLS: run.benchmark.settings.maxPayerCalls,
      CONFIDENCE_THRESHOLD: run.benchmark.settings.confidenceThreshold,
    };
  }
  if (["jev", "live"].includes(mode) && !config.TYPESAFE_API_KEY)
    throw new Error("TYPESAFE_API_KEY is required for this mode");
  if (["live", "openai"].includes(mode) && !config.OPENAI_API_KEY)
    throw new Error("OPENAI_API_KEY is required for live LLM tool execution");

  const settings = {
    confidenceThreshold: config.CONFIDENCE_THRESHOLD,
    maxSteps: config.MAX_STEPS,
    maxPayerCalls: config.MAX_PAYER_CALLS,
  };

  const client = ["live", "openai"].includes(mode)
    ? new OpenAI({
        apiKey: config.OPENAI_API_KEY,
        baseURL: config.LLM_BASE_URL,
        maxRetries: 1,
        timeout: 15000,
      })
    : undefined;

  const router =
    mode === "demo"
      ? new DemoRouter()
      : mode === "openai"
        ? new OpenAiRouter(client!, config.LLM_MODEL)
        : new JevRouter(
            {
              apiKey: config.TYPESAFE_API_KEY,
              baseURL: config.TYPESAFE_BASE_URL,
            },
            config.TYPESAFE_MODEL,
          );
  const agents = client
    ? new LlmAgents(client, config.LLM_MODEL)
    : new FixtureAgents();
  return new Engine(
    router,
    agents,
    settings,
    store ? new DatabaseTools(store) : undefined,
  );
}
