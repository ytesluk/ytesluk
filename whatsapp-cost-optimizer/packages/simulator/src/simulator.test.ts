import { describe, expect, it } from "vitest";
import { BUILTIN_POLICIES, PolicyRegistry, demoRateCatalog } from "@wco/pricing";
import { DEFAULT_SCENARIO, datasetStats, generateDataset, importHistory, readDatasetCsv, runExperiment, scenarioPreset, simulateSavings, lineChart } from "./index";

const small = { ...DEFAULT_SCENARIO, events: 3000, customers: 800 };

describe("synthetic datasets (spec §40)", () => {
  it("is reproducible from the seed", () => {
    const a = generateDataset(small);
    const b = generateDataset(small);
    expect(a.length).toBe(b.length);
    expect(JSON.stringify(a.slice(0, 50))).toBe(JSON.stringify(b.slice(0, 50)));
    expect(generateDataset({ ...small, seed: 1 }).length).not.toBe(0);
  });

  it("presets vary only their dimension", () => {
    expect(scenarioPreset("HIGH_DUPLICATION").duplicateRate).toBeGreaterThan(scenarioPreset("LOW_DUPLICATION").duplicateRate);
    expect(scenarioPreset("HIGH_FEP").burstRate).toBe(DEFAULT_SCENARIO.burstRate);
    const s = datasetStats(generateDataset(scenarioPreset("HIGH_DUPLICATION", { events: 2000, customers: 500 })));
    expect(s.duplicates! / s.intents!).toBeGreaterThan(0.1);
  });
});

describe("experiments A–F (spec §77)", () => {
  const r = runExperiment(small);
  it("all arms process the same events; control sends one message per event", () => {
    expect(new Set(r.arms.map((a) => a.events)).size).toBe(1);
    const A = r.arms.find((a) => a.arm === "A")!;
    expect(A.messagesSent + A.blocked + A.cancelled).toBe(A.events);
  });

  it("each mechanism never increases the number of messages", () => {
    const sent = Object.fromEntries(r.arms.map((a) => [a.arm, a.messagesSent]));
    expect(sent.B).toBeLessThanOrEqual(sent.A!);
    expect(sent.C).toBeLessThanOrEqual(sent.B!);
    expect(sent.D).toBeLessThanOrEqual(sent.C!);
  });

  it("separates Meta, BSP and infrastructure costs; F removes only BSP fees", () => {
    const E = r.arms.find((a) => a.arm === "E")!;
    const F = r.arms.find((a) => a.arm === "F")!;
    expect(F.metaCost).toBe(E.metaCost);
    expect(Number(F.bspCost)).toBe(0);
    expect(r.label).toBe("SIMULATED");
    expect(r.isDemoRates).toBe(true);
  });
});

describe("historical CSV import (spec §38)", () => {
  it("validates rows, prices as-sent traffic and replays through WCO", () => {
    const csv = [
      "timestamp,customer,eventType,category,country,template,delivered,status,source,isFEP,isServiceWindow",
      "2026-10-05T12:00:00Z,5511999990001,order.status,UTILITY,BR,order_status_update,true,SHIPPED,erp,false,false",
      "2026-10-05T12:00:10Z,5511999990001,order.status,UTILITY,BR,order_status_update,true,SHIPPED,erp,false,false",
      "2026-10-05T13:00:00Z,5511999990002,marketing.campaign,MARKETING,BR,weekly_offer,true,SENT,crm,true,false",
      "not-a-date,5511999990003,x,UTILITY,BR,t,true,,,false,false",
      "2026-10-05T14:00:00Z,5511999990004,x,PROMO,BR,t,true,,,false,false",
    ].join("\n");
    const r = importHistory(csv);
    expect(r.rows).toBe(5);
    expect(r.valid).toBe(3);
    expect(r.invalid).toBe(2);
    expect(r.errors.map((e) => e.line)).toEqual([5, 6]);
    expect(r.asSent.cost).toBe("0.0800"); // two utility messages (0.04 DEMO); FEP marketing is free
    expect(r.asSent.free).toBe(1);
    expect(r.replay?.optimized.messagesSent).toBeLessThan(r.replay!.control.messagesSent);
    expect(r.label).toBe("ESTIMATED");
  });
});

describe("analytical savings simulator (spec §37)", () => {
  it("returns an estimate, never a guarantee", () => {
    const r = simulateSavings(
      {
        date: "2026-10-15",
        market: "BR",
        currency: "BRL",
        customers: 10_000,
        monthlyMessages: 100_000,
        mix: { marketing: 20, utility: 60, authentication: 10, service: 10 },
        duplicateRate: 0.05,
        consolidationRate: 0.1,
        supersessionRate: 0.1,
        fepEligibilityPercent: 5,
        phoneNumbers: 2,
        bsp: { type: "PERCENTAGE", percentOfMeta: "10" },
      },
      new PolicyRegistry(BUILTIN_POLICIES),
      demoRateCatalog(),
    );
    expect(r.label).toBe("Resultado estimado");
    expect(Number(r.savings.meta)).toBeGreaterThan(0);
    expect(r.optimized.messages).toBeLessThan(r.baseline.messages);
    expect(r.isDemoRate).toBe(true);
  });
});

describe("charts and CSV round trip", () => {
  it("renders an accessible SVG with legend for 2 series", () => {
    const svg = lineChart({ title: "t", xLabel: "x", yLabel: "y", series: [{ name: "A", points: [{ x: 1, y: 1 }, { x: 2, y: 3 }] }, { name: "B", points: [{ x: 1, y: 2 }, { x: 2, y: 1 }] }] });
    expect(svg).toContain('role="img"');
    expect(svg).toContain("<title>A — 1: 1</title>");
  });

  it("dataset CSV can be read back", async () => {
    const { writeDatasetCsv } = await import("./dataset-csv");
    const { mkdtempSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const ds = generateDataset({ ...small, events: 300, customers: 100 });
    const file = join(mkdtempSync(join(tmpdir(), "wco-")), "d.csv");
    await writeDatasetCsv(file, ds);
    const back = readDatasetCsv(readFileSync(file, "utf8"));
    expect(back).toHaveLength(ds.length);
    expect(back[0]!.at).toBe(ds[0]!.at);
  });
});
