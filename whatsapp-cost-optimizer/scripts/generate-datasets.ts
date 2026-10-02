/**
 * pnpm generate — synthetic datasets for the academic experiment (spec §40).
 *
 *   pnpm generate                                       10k, 50k and 100k × the 9 scenario presets
 *   pnpm generate --sizes 1000000 --scenarios MEDIUM_DUPLICATION     1M events (written gzipped)
 *   pnpm generate --sizes 10000,50000 --scenarios LOW_FEP,HIGH_FEP --out data/datasets
 *
 * Files: <out>/<size>/<SCENARIO>.csv (.csv.gz from 1M events) + manifest.json with the exact
 * parameters, seed and SHA-256 of every file, so any run can be reproduced (spec §79).
 * Phone numbers are synthetic; no real customer data is used.
 */
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { SCENARIOS, datasetStats, generateDataset, scenarioPreset, writeDatasetCsv, type ScenarioName } from "@wco/simulator";

const { values } = parseArgs({
  options: {
    sizes: { type: "string", default: "10000,50000,100000" },
    scenarios: { type: "string", default: SCENARIOS.join(",") },
    out: { type: "string", default: "data/datasets" },
    seed: { type: "string" },
    days: { type: "string" },
  },
});

const sizes = values.sizes!.split(",").map((s) => Number(s.trim().replace(/_/g, "")));
const scenarios = values.scenarios!.split(",").map((s) => s.trim()) as ScenarioName[];
for (const s of scenarios) if (!SCENARIOS.includes(s)) throw new Error(`cenário inválido: ${s}`);

async function sha256(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}

const manifest: Array<Record<string, unknown>> = [];
for (const size of sizes) {
  const dir = join(values.out!, String(size));
  mkdirSync(dir, { recursive: true });
  for (const name of scenarios) {
    const t0 = Date.now();
    const params = scenarioPreset(name, {
      events: size,
      customers: Math.max(2_000, Math.round(size / 5)),
      ...(values.seed ? { seed: Number(values.seed) } : {}),
      ...(values.days ? { days: Number(values.days) } : {}),
    });
    const events = generateDataset(params);
    const file = join(dir, `${name}.csv${size >= 1_000_000 ? ".gz" : ""}`);
    await writeDatasetCsv(file, events);
    const stats = datasetStats(events);
    manifest.push({ file, size, scenario: name, params, stats, bytes: statSync(file).size, sha256: await sha256(file) });
    console.log(`${file}  ${stats.intents} eventos + ${stats.inbound} inbound  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
}
writeFileSync(join(values.out!, "manifest.json"), JSON.stringify({ generatedAt: new Date().toISOString(), generator: "@wco/simulator generateDataset", datasets: manifest }, null, 2));
console.log(`manifest: ${join(values.out!, "manifest.json")}`);
