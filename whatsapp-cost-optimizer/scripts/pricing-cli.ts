/**
 * pnpm pricing <command> — administrative pricing tool (spec §15, §91).
 *
 *   pnpm pricing policies                         list built-in pricing policy versions (and their sources)
 *   pnpm pricing list                             list policies and rate cards stored in the database
 *   pnpm pricing validate <file> [--tiers f]      parse a CSV/JSON rate card without saving (no database)
 *   pnpm pricing import <file> [--tiers f] [--name n] [--currency BRL] [--from 2026-10-01] [--until d]
 *                              [--source-url u] [--source-doc d] [--dry-run]
 *   pnpm pricing retire <rateCardId>              mark a rate card RETIRED (history is kept)
 *   pnpm pricing export-demo <dir>                write the DEMO rate cards as JSON (format template)
 *   pnpm pricing estimate --market BR --category MARKETING [--at ISO] [--currency BRL] [--tz America/Sao_Paulo]
 *
 * Meta does not publish a pricing API: rates come from the official rate-card files, imported by an
 * administrator. DEMO rate cards are fictitious and always flagged as such.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { BillingCategory, EMPTY_CONTEXT, MessageKind } from "@wco/domain";
import { BUILTIN_POLICIES, CostEngine, PolicyRegistry, demoRateCards, demoRateCatalog, importRateCard } from "@wco/pricing";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    tiers: { type: "string" },
    name: { type: "string" },
    currency: { type: "string" },
    from: { type: "string" },
    until: { type: "string" },
    "source-url": { type: "string" },
    "source-doc": { type: "string" },
    "dry-run": { type: "boolean", default: false },
    market: { type: "string" },
    category: { type: "string" },
    at: { type: "string" },
    tz: { type: "string", default: "America/Sao_Paulo" },
    unverified: { type: "boolean", default: false },
  },
});

const [command, arg] = positionals;

function meta() {
  return {
    name: values.name,
    currency: values.currency,
    effectiveFrom: values.from,
    effectiveUntil: values.until ?? null,
    sourceUrl: values["source-url"],
    sourceDocument: values["source-doc"],
  };
}

function printIssues(issues: Array<{ row?: number; message: string }>) {
  for (const i of issues.slice(0, 50)) console.log(`  - ${i.row !== undefined ? `linha ${i.row}: ` : ""}${i.message}`);
  if (issues.length > 50) console.log(`  … mais ${issues.length - 50} problemas`);
}

async function withServices<T>(fn: (s: typeof import("@wco/services"), ctx: import("@wco/services").AppContext) => Promise<T>): Promise<T> {
  const services = await import("@wco/services");
  const ctx = services.createAppContext({ service: "pricing-cli", subscribe: false });
  try {
    return await fn(services, ctx);
  } finally {
    await ctx.close();
  }
}

switch (command) {
  case "policies": {
    for (const p of BUILTIN_POLICIES) {
      console.log(`${p.id}  ${p.effectiveFrom} → ${p.effectiveUntil ?? "…"}  [${p.status}]  ${p.name}`);
      for (const url of new Set(p.sources.map((s) => s.url))) console.log(`    fonte: ${url}`);
    }
    break;
  }
  case "list": {
    await withServices(async (s, ctx) => {
      const r = await s.listPricing(ctx);
      console.log("Políticas:");
      for (const p of r.policies) console.log(`  ${p.id}  ${p.effectiveFrom} → ${p.effectiveUntil ?? "…"}  [${p.status}]  regras=${p.rules.length}`);
      console.log("Rate cards:");
      for (const c of r.rateCards) console.log(`  ${c.id}  ${c.currency}  ${c.effectiveFrom} → ${c.effectiveUntil ?? "…"}  [${c.status}]${c.isDemo ? "  DEMO (valores fictícios)" : ""}  linhas=${c.rows.length}  ${c.name}`);
    });
    break;
  }
  case "validate": {
    if (!arg) throw new Error("uso: pnpm pricing validate <arquivo> [--tiers arquivo]");
    const r = importRateCard(readFileSync(arg, "utf8"), meta(), values.tiers ? readFileSync(values.tiers, "utf8") : undefined);
    console.log(`formato=${r.format} ok=${r.ok} linhas=${r.rows.length} tiers=${r.tiers.length} checksum=${r.checksum}`);
    printIssues(r.issues);
    process.exitCode = r.ok ? 0 : 1;
    break;
  }
  case "import": {
    if (!arg) throw new Error("uso: pnpm pricing import <arquivo> [--tiers arquivo] [--dry-run]");
    await withServices(async (s, ctx) => {
      const r = await s.importPricing(ctx, null, {
        content: readFileSync(arg, "utf8"),
        tiersContent: values.tiers ? readFileSync(values.tiers, "utf8") : undefined,
        ...Object.fromEntries(Object.entries(meta()).filter(([, v]) => v !== undefined)),
        dryRun: values["dry-run"],
      });
      console.log(JSON.stringify({ ...r, issues: undefined }, null, 2));
      printIssues(r.issues);
      process.exitCode = r.ok ? 0 : 1;
    });
    break;
  }
  case "retire": {
    if (!arg) throw new Error("uso: pnpm pricing retire <rateCardId>");
    await withServices(async (s, ctx) => console.log(await s.setRateCardStatus(ctx, null, arg, "RETIRED")));
    break;
  }
  case "export-demo": {
    const dir = arg ?? "data/rate-cards";
    mkdirSync(dir, { recursive: true });
    for (const card of demoRateCards()) {
      const m = card.meta;
      const json = {
        name: m.name,
        currency: m.currency,
        effectiveFrom: m.effectiveFrom,
        effectiveUntil: m.effectiveUntil,
        sourceUrl: m.sourceUrl,
        sourceDocument: m.sourceDocument,
        isDemo: true,
        marketAliases: m.marketAliases,
        rates: card.rows().map((r) => ({ market: r.market, category: r.category, tierStart: r.tierStart, tierEnd: r.tierEnd, unitRate: r.unitRate.toFixed(8) })),
      };
      const file = join(dir, `${m.id}.json`);
      writeFileSync(file, JSON.stringify(json, null, 2));
      console.log(`escrito ${file} (DEMO — valores fictícios)`);
    }
    break;
  }
  case "estimate": {
    const category = (values.category ?? "MARKETING").toUpperCase() as BillingCategory;
    if (!Object.values(BillingCategory).includes(category)) throw new Error(`categoria inválida: ${category}`);
    const engine = new CostEngine(new PolicyRegistry(BUILTIN_POLICIES), demoRateCatalog());
    const r = engine.evaluate({
      category,
      messageKind: category === BillingCategory.SERVICE ? MessageKind.NON_TEMPLATE : MessageKind.TEMPLATE,
      at: values.at ? new Date(values.at) : new Date(),
      timezone: values.tz!,
      market: values.market ?? "BR",
      currency: (values.currency ?? "BRL").toUpperCase(),
      businessPhoneNumberId: "cli",
      conversation: EMPTY_CONTEXT,
      includeUnverifiedPolicies: values.unverified,
    });
    console.log(JSON.stringify({ ...r, rate: r.rate?.toString() ?? null, listRate: r.listRate?.toString() ?? null, note: "Estimativa com rate card DEMO (valores fictícios). A cobrança final é determinada pela Meta." }, null, 2));
    break;
  }
  default:
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
    process.exitCode = command ? 1 : 0;
}
