import { Confidence, money, type Decimal, type MessageStatus } from "@wco/domain";
import { attributeSavings, type SavingsLine } from "@wco/optimization";
import type { BspFeeModel } from "@wco/pricing";
import type { AppContext, TenantConfig } from "./context";

type DbLike = Pick<AppContext["db"], "savingsRecord">;

/**
 * Persists SavingsRecord rows for one intent outcome (one row per kind+mechanism, upserted so that a
 * later realized cost upgrades the confidence instead of double counting).
 */
export async function recordSavings(
  db: DbLike,
  ctx: AppContext,
  tenant: TenantConfig,
  input: {
    intentId: string;
    status: MessageStatus;
    day: Date;
    currency: string;
    baselineCost: Decimal | null;
    optimizedCost: Decimal | null;
    optimizedConfidence: Confidence;
    freeReason?: string | null;
    switchedToFreeForm?: boolean;
    category?: string | null;
    eventType?: string | null;
    policyVersion?: string | null;
  },
): Promise<SavingsLine[]> {
  const lines = attributeSavings({
    status: input.status,
    baselineCost: input.baselineCost,
    optimizedCost: input.optimizedCost,
    optimizedConfidence: input.optimizedConfidence,
    freeReason: input.freeReason,
    switchedToFreeForm: input.switchedToFreeForm,
    usesBsp: tenant.usesBsp,
    bspModel: (tenant.bspFeeModel as BspFeeModel | null) ?? null,
    infraCostPerProviderCall: money(ctx.config.env.INFRA_COST_PER_PROVIDER_CALL),
  });
  const day = new Date(`${input.day.toISOString().slice(0, 10)}T00:00:00.000Z`);
  for (const l of lines) {
    const data = {
      tenantId: tenant.id,
      intentId: input.intentId,
      day,
      kind: l.kind,
      mechanism: l.mechanism === "NONE" ? ("NONE" as const) : l.mechanism,
      baselineCost: l.baselineCost.toFixed(8),
      optimizedCost: l.optimizedCost.toFixed(8),
      savings: l.savings.toFixed(8),
      currency: l.kind === "INFRASTRUCTURE" ? ctx.config.env.INFRA_CURRENCY : input.currency,
      confidence: l.confidence,
      category: (input.category ?? null) as never,
      eventType: input.eventType ?? null,
      policyVersion: input.policyVersion ?? null,
    };
    await db.savingsRecord.upsert({
      where: { intentId_kind_mechanism: { intentId: input.intentId, kind: l.kind, mechanism: data.mechanism } },
      create: data,
      update: { optimizedCost: data.optimizedCost, savings: data.savings, confidence: data.confidence, baselineCost: data.baselineCost },
    });
  }
  return lines;
}

export { Confidence };
