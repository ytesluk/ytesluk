import { z } from "zod";
import { AlertSeverity, AlertType, Errors, money, monthBoundsUtc, sumMoney, toStorage } from "@wco/domain";
import { audit, raiseAlert } from "./audit";
import type { Actor, AppContext } from "./context";

/**
 * SaaS billing of the WCO itself (spec §68) — NOT WhatsApp charges, which Meta bills to each
 * customer's own payment method. Usage is counted per calendar month in the tenant's timezone.
 * Plans never block traffic: going over the included volume raises an informative alert only
 * (critical/OTP messages must never be held back by a commercial limit).
 * Invoices are DRAFT snapshots (no payment gateway is integrated); once written they are never
 * recomputed, so later price or plan changes do not rewrite history.
 */

const MESSAGE_SENT = ["SENT", "DELIVERED", "READ"] as const;

async function usageBetween(ctx: AppContext, tenantId: string, start: Date, end: Date) {
  const [intents, messages] = await Promise.all([
    ctx.db.messageIntent.count({ where: { tenantId, createdAt: { gte: start, lt: end } } }),
    ctx.db.messageAttempt.count({ where: { tenantId, requestedAt: { gte: start, lt: end }, status: { in: [...MESSAGE_SENT] as never } } }),
  ]);
  return { intents, messages };
}

/** Current-month usage against the plan's included intents. */
export async function tenantUsage(ctx: AppContext, tenantId: string, at = ctx.now()) {
  const tenant = await ctx.db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const plan = await ctx.db.plan.findUnique({ where: { code: tenant.plan } });
  const { start, end, key } = monthBoundsUtc(at, tenant.defaultTimezone);
  const u = await usageBetween(ctx, tenantId, start, end);
  const included = plan?.includedIntents ?? null;
  return { periodKey: key, periodStart: start, periodEnd: end, timezone: tenant.defaultTimezone, ...u, includedIntents: included, percentUsed: included ? Math.round((u.intents / included) * 1000) / 10 : null };
}

export async function billingOverview(ctx: AppContext, tenantId: string) {
  const tenant = await ctx.db.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { subscription: true } });
  const [plans, usage, invoices] = await Promise.all([
    ctx.db.plan.findMany({ orderBy: { includedIntents: "asc" } }),
    tenantUsage(ctx, tenantId),
    ctx.db.invoice.findMany({ where: { tenantId }, orderBy: { periodKey: "desc" }, take: 12 }),
  ]);
  const fmtPlan = (p: (typeof plans)[number]) => ({ code: p.code, name: p.name, monthlyFee: p.monthlyFee.toString(), savingsShare: p.savingsShare.toString(), includedIntents: p.includedIntents, currency: p.currency });
  const current = plans.find((p) => p.code === tenant.plan);
  return {
    plan: current ? fmtPlan(current) : { code: tenant.plan, name: tenant.plan, monthlyFee: null, savingsShare: null, includedIntents: null, currency: null },
    subscription: tenant.subscription ? { status: tenant.subscription.status, startedAt: tenant.subscription.startedAt, endsAt: tenant.subscription.endsAt } : null,
    usage,
    plans: plans.map(fmtPlan),
    invoices: invoices.map((i) => ({ id: i.id, periodKey: i.periodKey, amount: i.amount.toString(), currency: i.currency, status: i.status, createdAt: i.createdAt, snapshot: i.snapshot })),
    paymentGateway: null,
    notes: [
      "Os custos de WhatsApp são cobrados pela Meta diretamente na forma de pagamento da sua conta; esta página mostra apenas a assinatura do WCO.",
      "Passar do volume incluído não bloqueia mensagens: o WCO avisa e continua processando.",
    ],
  };
}

/** Previous local month of `at` in `timeZone`. */
function previousMonth(at: Date, timeZone: string) {
  const current = monthBoundsUtc(at, timeZone);
  return monthBoundsUtc(new Date(current.start.getTime() - 1), timeZone);
}

/**
 * Closes the previous month for every tenant: stores Usage and a DRAFT Invoice (idempotent — an
 * existing invoice for the period is never touched). The optional savings share applies only to
 * REALIZED/RECONCILED Meta savings in the plan's currency, never to estimates.
 */
export async function closeBillingPeriod(ctx: AppContext, at = ctx.now()): Promise<{ created: number; skipped: number }> {
  const tenants = await ctx.db.tenant.findMany({ select: { id: true, plan: true, defaultTimezone: true } });
  const plans = new Map((await ctx.db.plan.findMany()).map((p) => [p.code, p]));
  let created = 0;
  let skipped = 0;
  for (const t of tenants) {
    const { start, end, key } = previousMonth(at, t.defaultTimezone);
    if (await ctx.db.invoice.findUnique({ where: { tenantId_periodKey: { tenantId: t.id, periodKey: key } } })) {
      skipped++;
      continue;
    }
    const plan = plans.get(t.plan);
    if (!plan) {
      skipped++;
      continue;
    }
    const usage = await usageBetween(ctx, t.id, start, end);
    const firstDay = new Date(`${key}-01T00:00:00Z`);
    const nextKey = monthBoundsUtc(end, t.defaultTimezone).key;
    const savingsRows = await ctx.db.savingsRecord.findMany({
      where: { tenantId: t.id, kind: "META", confidence: { in: ["REALIZED", "RECONCILED"] }, currency: plan.currency, day: { gte: firstDay, lt: new Date(`${nextKey}-01T00:00:00Z`) } },
      select: { savings: true, policyVersion: true },
    });
    const realized = sumMoney(savingsRows.map((r) => r.savings));
    const share = money(plan.savingsShare).times(realized.isNegative() ? 0 : realized);
    const amount = money(plan.monthlyFee).plus(share);
    await ctx.db.usage.upsert({ where: { tenantId_periodKey: { tenantId: t.id, periodKey: key } }, create: { tenantId: t.id, periodKey: key, ...usage }, update: usage });
    try {
      await ctx.db.invoice.create({
        data: {
          tenantId: t.id,
          periodKey: key,
          amount: toStorage(amount),
          currency: plan.currency,
          status: "DRAFT",
          snapshot: {
            plan: { code: plan.code, name: plan.name, monthlyFee: plan.monthlyFee.toString(), savingsShare: plan.savingsShare.toString(), includedIntents: plan.includedIntents },
            usage,
            overIncluded: usage.intents > plan.includedIntents,
            realizedMetaSavings: toStorage(realized),
            savingsShareAmount: toStorage(share),
            pricingPolicyVersions: [...new Set(savingsRows.map((r) => r.policyVersion).filter(Boolean))],
            period: { start: start.toISOString(), end: end.toISOString(), timezone: t.defaultTimezone },
            generatedAt: ctx.now().toISOString(),
          },
        },
      });
      created++;
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
      skipped++;
    }
  }
  return { created, skipped };
}

/** Informative alerts at 80% and 100% of the plan's included intents (once per period and level). */
export async function planUsageAlerts(ctx: AppContext, tenantId: string): Promise<number> {
  const u = await tenantUsage(ctx, tenantId);
  if (!u.includedIntents || u.percentUsed === null || u.percentUsed < 80) return 0;
  const over = u.intents >= u.includedIntents;
  const raised = await raiseAlert(ctx.db, {
    tenantId,
    type: AlertType.PLAN_USAGE_NEAR_LIMIT,
    severity: over ? AlertSeverity.WARNING : AlertSeverity.INFO,
    title: over ? "Volume do plano ultrapassado" : "Volume do plano perto do limite",
    message: `${u.intents.toLocaleString("pt-BR")} de ${u.includedIntents.toLocaleString("pt-BR")} eventos incluídos em ${u.periodKey}. Nenhuma mensagem é bloqueada; considere mudar de plano.`,
    dedupKey: `plan:${tenantId}:${u.periodKey}:${over ? "100" : "80"}`,
    data: u,
  });
  return raised ? 1 : 0;
}

export const ChangePlanSchema = z.object({ plan: z.enum(["FREE", "STARTER", "PRO", "ENTERPRISE"]) });

/** Platform operator changes a tenant's plan (no self-service upgrade while there is no payment gateway). */
export async function changeTenantPlan(ctx: AppContext, actor: Actor, tenantId: string, raw: unknown) {
  const { plan } = ChangePlanSchema.parse(raw);
  const tenant = await ctx.db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw Errors.notFound("Tenant");
  await ctx.db.$transaction([
    ctx.db.tenant.update({ where: { id: tenantId }, data: { plan } }),
    ctx.db.subscription.upsert({ where: { tenantId }, create: { tenantId, plan }, update: { plan, startedAt: ctx.now() } }),
  ]);
  await audit(ctx.db, { tenantId, actor, action: "tenant.plan_changed", entityType: "Tenant", entityId: tenantId, data: { from: tenant.plan, to: plan } });
  return { tenantId, plan };
}
