import type { Db } from "./client";

/**
 * Tenant guard (spec §22): defense in depth on top of explicit `tenantId` filters in repositories.
 * Every operation on a tenant-scoped model gets `tenantId` injected into `where` (reads, updates,
 * deletes) or `data` (creates). A create with a different tenantId throws.
 *
 * Not covered: `$queryRaw`/`$executeRaw` — raw SQL must always bind tenantId explicitly
 * (see analytics repository), and is reviewed by the tenant-isolation tests.
 */
export const TENANT_SCOPED_MODELS = new Set([
  "User",
  "ApiKey",
  "BusinessAccount",
  "Waba",
  "PhoneNumber",
  "OnboardingSession",
  "Customer",
  "ConsentRecord",
  "Conversation",
  "CustomerServiceWindow",
  "ConversationEntryPoint",
  "ConversationEvent",
  "MessageIntent",
  "MessageAttempt",
  "MessageDelivery",
  "Template",
  "FreeQuotaCounter",
  "TierAccrual",
  "OptimizationPolicy",
  "PolicyRuleSet",
  "OptimizationDecision",
  "CostDecision",
  "SavingsRecord",
  "DailyMetric",
  "DataRetentionPolicy",
  "DataSubjectRequest",
  "ImportJob",
  "ExperimentRun",
  "AiUsage",
  "Usage",
  "Invoice",
  "Subscription",
]);

const WHERE_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
  "upsert",
]);

type Args = Record<string, unknown> & { where?: Record<string, unknown>; data?: unknown; create?: unknown };

function assertTenant(data: unknown, tenantId: string, model: string): Record<string, unknown> {
  const row = { ...(data as Record<string, unknown>) };
  if (row.tenantId !== undefined && row.tenantId !== tenantId) {
    throw new Error(`Tenant guard: attempted to write ${model} for another tenant`);
  }
  // Relation-style connects (tenant: { connect }) are not used for tenant-scoped writes.
  if (!("tenant" in row)) row.tenantId = tenantId;
  return row;
}

export function scopeArgs(model: string, operation: string, args: Args | undefined, tenantId: string): Args {
  if (!TENANT_SCOPED_MODELS.has(model)) return args ?? {};
  const a: Args = { ...(args ?? {}) };
  if (WHERE_OPS.has(operation)) {
    a.where = { ...(a.where ?? {}), tenantId };
  }
  if (operation === "create" || operation === "upsert") {
    const key = operation === "create" ? "data" : "create";
    a[key] = assertTenant(a[key], tenantId, model);
  }
  if (operation === "createMany" || operation === "createManyAndReturn") {
    const rows = Array.isArray(a.data) ? a.data : [a.data];
    a.data = rows.map((r) => assertTenant(r, tenantId, model));
  }
  if ((operation === "update" || operation === "updateMany" || operation === "upsert") && a.data) {
    const d = a.data as Record<string, unknown>;
    if (d.tenantId !== undefined && d.tenantId !== tenantId) {
      throw new Error(`Tenant guard: attempted to move ${model} to another tenant`);
    }
  }
  return a;
}

/** Returns a client whose every query on tenant-scoped models is restricted to `tenantId`. */
export function forTenant(db: Db, tenantId: string) {
  if (!tenantId) throw new Error("Tenant guard: tenantId is required");
  return db.$extends({
    name: "tenant-guard",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(model, operation, args as Args, tenantId) as never);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof forTenant>;
