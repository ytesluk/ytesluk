import { generateDataset, type ScenarioParams } from "./dataset";
import { ARMS, runArm, type ArmResult, type ExperimentDeps } from "./experiment";

/**
 * Parameter sweeps for the report charts (spec §78). Each point regenerates the dataset with ONE
 * parameter changed (same seed) and runs the control arm (A) and the optimized arm (E).
 */
export interface SweepPoint {
  x: number;
  control: ArmResult;
  optimized: ArmResult;
  metaSavingsPercent: number;
  totalSavingsPercent: number;
}

export interface SweepResult {
  name: string;
  parameter: string;
  points: SweepPoint[];
}

const armA = ARMS.find((a) => a.id === "A")!;
const armE = ARMS.find((a) => a.id === "E")!;

function point(params: ScenarioParams, x: number, deps: ExperimentDeps): SweepPoint {
  const ds = generateDataset(params);
  const control = runArm(ds, params, armA, deps);
  const optimized = runArm(ds, params, armE, deps);
  const pct = (a: string, b: string) => {
    const base = Number(a);
    return base === 0 ? 0 : Math.round(((base - Number(b)) / base) * 10000) / 100;
  };
  return { x, control, optimized, metaSavingsPercent: pct(control.metaCost, optimized.metaCost), totalSavingsPercent: pct(control.totalCost, optimized.totalCost) };
}

export function sweep(name: string, parameter: string, base: ScenarioParams, values: number[], apply: (p: ScenarioParams, v: number) => ScenarioParams, deps: ExperimentDeps = {}): SweepResult {
  return { name, parameter, points: values.map((v) => { deps.onProgress?.(`${name}: ${parameter}=${v}`); return point(apply({ ...base }, v), v, deps); }) };
}

export function standardSweeps(base: ScenarioParams, deps: ExperimentDeps = {}): SweepResult[] {
  const small = { ...base, events: Math.min(base.events, 20_000), customers: Math.min(base.customers, 6_000) };
  return [
    sweep("cost_vs_volume", "events", base, [10_000, 25_000, 50_000, 100_000].filter((v) => v <= Math.max(base.events, 10_000)), (p, v) => ({ ...p, events: v, customers: Math.max(2_000, Math.round(v / 5)) }), deps),
    sweep("savings_vs_duplication", "duplicateRate", small, [0, 0.05, 0.1, 0.2, 0.3], (p, v) => ({ ...p, duplicateRate: v }), deps),
    sweep("savings_vs_aggregation", "burstRate", small, [0, 0.25, 0.5, 0.75, 1], (p, v) => ({ ...p, burstRate: v }), deps),
    sweep("savings_vs_fep", "fepRate", small, [0, 0.1, 0.25, 0.5, 0.75], (p, v) => ({ ...p, fepRate: v }), deps),
    sweep("savings_vs_free_quota", "supportShare", small, [0.05, 0.1, 0.2, 0.3, 0.4], (p, v) => ({ ...p, mix: { ...p.mix, support: v } }), deps),
  ];
}
