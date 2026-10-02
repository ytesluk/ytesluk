import { BillingCategory, Money, PolicyStatus, sha256Hex, canonicalJson } from "@wco/domain";
import { RateCard, RateCatalog, type ImportResult, type PolicyDefinition, type RateRow } from "@wco/pricing";
import type { Db } from "./client";

/**
 * Persistence of versioned pricing data. Runtime engines are built from the DATABASE, never from code
 * constants (the code constants are only the seed source).
 */
const toDate = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00.000Z`) : null);
const fromDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export async function upsertPolicyDefinition(db: Db, def: PolicyDefinition): Promise<{ created: boolean }> {
  const existing = await db.pricingPolicyVersion.findUnique({ where: { id: def.id } });
  const sourceHash = sha256Hex(canonicalJson(def.sources));
  if (existing) {
    // ACTIVE versions are immutable (spec §86): only status/notes may change.
    if (existing.sourceHash !== sourceHash && existing.status === PolicyStatus.ACTIVE) {
      throw new Error(`Policy ${def.id} is ACTIVE and its sources changed — create a new version instead`);
    }
    return { created: false };
  }
  await db.pricingPolicyVersion.create({
    data: {
      id: def.id,
      name: def.name,
      effectiveFrom: toDate(def.effectiveFrom)!,
      effectiveUntil: toDate(def.effectiveUntil),
      sourceUrl: def.sourceUrl,
      sourceCheckedAt: new Date(def.sourceCheckedAt),
      sourceHash,
      status: def.status,
      notes: def.notes,
      definition: JSON.parse(JSON.stringify(def)),
      rules: {
        create: def.rules.map((r) => ({
          market: r.market,
          currency: "*",
          messageCategory: r.category,
          billable: r.billable,
          freeEligibility: r.freeEligibility,
          freeQuota: r.freeQuota?.amount ?? null,
          freeQuotaScope: r.freeQuota?.scope ?? null,
          tiered: r.tiered,
          requiresCustomerServiceWindow: r.requiresCustomerServiceWindow,
          customerServiceWindowHours: def.customerServiceWindowHours,
          freeEntryPointWindowHours: def.freeEntryPoint.windowHours,
          freeEntryPointReplyHours: def.freeEntryPoint.replyWithinHours,
          effectiveFrom: toDate(def.effectiveFrom)!,
          effectiveUntil: toDate(def.effectiveUntil),
          sourceUrl: def.sourceUrl,
        })),
      },
    },
  });
  return { created: true };
}

export async function loadPolicyDefinitions(db: Db): Promise<PolicyDefinition[]> {
  const rows = await db.pricingPolicyVersion.findMany({ orderBy: { effectiveFrom: "asc" } });
  return rows.map((r) => ({ ...(r.definition as unknown as PolicyDefinition), status: r.status as PolicyDefinition["status"], effectiveUntil: fromDate(r.effectiveUntil) }));
}

export async function saveRateCard(db: Db, result: ImportResult, meta: { importedBy?: string }): Promise<{ id: string; created: boolean }> {
  if (!result.ok || !result.card) throw new Error(`Rate card has issues: ${result.issues.map((i) => i.message).join("; ")}`);
  const existing = await db.priceCatalogImport.findUnique({ where: { checksum: result.checksum } });
  if (existing) return { id: existing.id, created: false };
  const m = result.card.meta;
  const created = await db.priceCatalogImport.create({
    data: {
      name: m.name,
      currency: m.currency,
      effectiveFrom: toDate(m.effectiveFrom)!,
      effectiveUntil: toDate(m.effectiveUntil),
      sourceUrl: m.sourceUrl,
      sourceDocument: m.sourceDocument,
      checksum: result.checksum,
      isDemo: m.isDemo,
      marketAliases: m.marketAliases,
      rowCount: result.rows.length,
      importedBy: meta.importedBy ?? null,
      rows: {
        create: result.rows.map((r) => ({
          market: r.market,
          currency: r.currency,
          category: r.category,
          tierStart: r.tierStart,
          tierEnd: r.tierEnd,
          unitRate: r.unitRate.toFixed(8),
          effectiveFrom: toDate(r.effectiveFrom)!,
          effectiveUntil: toDate(r.effectiveUntil),
          sourceUrl: m.sourceUrl,
          sourceDocument: m.sourceDocument,
          checksum: result.checksum,
          isDemo: m.isDemo,
        })),
      },
      tiers: { create: result.tiers.map((t) => ({ market: t.market, category: t.category, tierIndex: t.tierIndex, tierStart: t.tierStart, tierEnd: t.tierEnd, label: t.label })) },
    },
  });
  return { id: created.id, created: true };
}

/** Saves a RateCard object directly (seed of DEMO cards). */
export async function saveRateCardObject(db: Db, card: RateCard): Promise<{ id: string; created: boolean }> {
  const rows = card.rows();
  return saveRateCard(
    db,
    { ok: true, card, rows, tiers: [], checksum: card.meta.checksum, issues: [], format: "json" },
    { importedBy: "seed" },
  );
}

export async function loadRateCatalog(db: Db): Promise<RateCatalog> {
  const imports = await db.priceCatalogImport.findMany({ where: { status: { in: ["ACTIVE", "SUPERSEDED"] } }, include: { rows: true } });
  const cards = imports.map((imp) => {
    const rows: RateRow[] = imp.rows.map((r) => ({
      market: r.market,
      currency: r.currency,
      category: r.category as BillingCategory,
      tierStart: r.tierStart,
      tierEnd: r.tierEnd,
      unitRate: new Money(r.unitRate.toString()),
      effectiveFrom: fromDate(r.effectiveFrom)!,
      effectiveUntil: fromDate(r.effectiveUntil),
    }));
    return new RateCard(
      {
        id: imp.name,
        name: imp.name,
        currency: imp.currency,
        effectiveFrom: fromDate(imp.effectiveFrom)!,
        effectiveUntil: fromDate(imp.effectiveUntil),
        sourceUrl: imp.sourceUrl,
        sourceDocument: imp.sourceDocument,
        isDemo: imp.isDemo,
        checksum: imp.checksum,
        marketAliases: (imp.marketAliases as Record<string, string[]> | null) ?? {},
      },
      rows,
    );
  });
  return new RateCatalog(cards);
}
