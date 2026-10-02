import { BillingCategory, billingMonth, monthBoundsUtc } from "@wco/domain";
import type { PricingCounters } from "@wco/optimization";
import type { AppContext } from "./context";

type DbLike = Pick<AppContext["db"], "freeQuotaCounter" | "tierAccrual">;

/**
 * Free-quota and volume-tier counters (spec §5). `used`/`chargedCount` are WCO's estimates (incremented
 * at dispatch); `usedConfirmed`/`chargedConfirmed` follow Meta's delivery webhooks (billing event).
 * Meta remains the authority: "Volume tiers will be determined solely by Meta".
 */
export async function loadCounters(
  db: DbLike,
  input: { tenantId: string; phoneNumberId: string; businessAccountId: string; market: string | null; timezone: string; at: Date },
): Promise<PricingCounters> {
  const months = [billingMonth(input.at, input.timezone), billingMonth(new Date(input.at.getTime() + 32 * 86_400_000), input.timezone)];
  const [quotas, tiers] = await Promise.all([
    db.freeQuotaCounter.findMany({ where: { tenantId: input.tenantId, scope: "PHONE_NUMBER", scopeKey: input.phoneNumberId, periodKey: { in: months } } }),
    input.market
      ? db.tierAccrual.findMany({ where: { tenantId: input.tenantId, businessAccountId: input.businessAccountId, market: input.market, periodKey: { in: months } } })
      : Promise.resolve([]),
  ]);
  const q = new Map(quotas.map((r) => [`${r.category}|${r.periodKey}`, Math.max(r.used, r.usedConfirmed)]));
  const t = new Map(tiers.map((r) => [`${r.category}|${r.periodKey}`, Math.max(r.chargedCount, r.chargedConfirmed)]));
  return {
    quotaUsed: (_phone, month) => q.get(`${BillingCategory.SERVICE}|${month}`) ?? 0,
    tierPosition: (_market, category, month) => t.get(`${category}|${month}`) ?? 0,
  };
}

export async function incrementQuota(
  db: DbLike,
  input: { tenantId: string; phoneNumberId: string; wabaId: string; businessAccountId: string; category: BillingCategory; at: Date; timezone: string; quota: number; policyVersion: string; confirmed: boolean },
): Promise<void> {
  const { start, end, key } = monthBoundsUtc(input.at, input.timezone);
  await db.freeQuotaCounter.upsert({
    where: { tenantId_scope_scopeKey_category_periodKey: { tenantId: input.tenantId, scope: "PHONE_NUMBER", scopeKey: input.phoneNumberId, category: input.category, periodKey: key } },
    create: {
      tenantId: input.tenantId,
      businessAccountId: input.businessAccountId,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      scope: "PHONE_NUMBER",
      scopeKey: input.phoneNumberId,
      category: input.category,
      periodKey: key,
      periodStart: start,
      periodEnd: end,
      used: input.confirmed ? 0 : 1,
      usedConfirmed: input.confirmed ? 1 : 0,
      quota: input.quota,
      sourcePolicyVersion: input.policyVersion,
    },
    update: input.confirmed ? { usedConfirmed: { increment: 1 } } : { used: { increment: 1 } },
  });
}

export async function incrementTier(
  db: DbLike,
  input: { tenantId: string; businessAccountId: string; market: string; category: BillingCategory; at: Date; timezone: string; confirmed: boolean },
): Promise<void> {
  const key = billingMonth(input.at, input.timezone);
  await db.tierAccrual.upsert({
    where: { tenantId_businessAccountId_market_category_periodKey: { tenantId: input.tenantId, businessAccountId: input.businessAccountId, market: input.market, category: input.category, periodKey: key } },
    create: { tenantId: input.tenantId, businessAccountId: input.businessAccountId, market: input.market, category: input.category, periodKey: key, chargedCount: input.confirmed ? 0 : 1, chargedConfirmed: input.confirmed ? 1 : 0 },
    update: input.confirmed ? { chargedConfirmed: { increment: 1 } } : { chargedCount: { increment: 1 } },
  });
}
