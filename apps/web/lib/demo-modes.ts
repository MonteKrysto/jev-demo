import type { Mode, Run } from "../../../packages/core/domain";

export const demoModes = ["demo", "openai", "live"] as const;
export type DemoMode = typeof demoModes[number];
export const demoModeNames: Record<DemoMode, string> = {
  demo: "Fixture only", openai: "Agent only", live: "Agent + JEV",
};
export const demoModeDescriptions: Record<DemoMode, string> = {
  demo: "Scripted decisions and tool responses. No model calls.",
  openai: "OpenAI makes decisions and uses tools. Paid OpenAI calls.",
  live: "JEV makes decisions; OpenAI uses tools. Paid JEV + OpenAI calls.",
};
export function isDemoMode(mode: Mode): mode is DemoMode {
  return demoModes.some(candidate => candidate === mode);
}
export function demoComparePath(run?: Run, scenarioId = "corrected-claim") {
  const params = new URLSearchParams({ case: run?.scenarioId ?? scenarioId });
  if (run && isDemoMode(run.mode)) params.set(run.mode, run.id);
  return `/demo/compare?${params}`;
}
