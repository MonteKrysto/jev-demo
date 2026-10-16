import { mkdir, writeFile } from "node:fs/promises";
const url = process.env.EXPORT_URL ?? "http://127.0.0.1:3001";
const response = await fetch(`${url}/api/runs`);
if (!response.ok)
  throw new Error("Could not read the existing local application");
const runs = await response.json();
await mkdir(".data", { recursive: true });
await writeFile(
  ".data/exported-runs.json",
  JSON.stringify(runs, null, 2) + "\n",
);
console.log(
  `Exported ${runs.length} recent interactive runs to .data/exported-runs.json.`,
);
