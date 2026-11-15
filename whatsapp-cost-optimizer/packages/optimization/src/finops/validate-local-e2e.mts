import assert from 'node:assert/strict';
import { FinOpsRuntimeBridge, type FinOpsPrismaClientLike } from './index.ts';

function createMockPrisma(): FinOpsPrismaClientLike & {
  _suppressions: Map<string, any>;
  _variants: any[];
  _quotas: Map<string, any>;
  _ledger: Map<string, any>;
} {
  const _suppressions = new Map<string, any>();
  const _variants: any[] = [
    {
      id: 'var-1',
      tenantId: 'tenant-1',
      groupKey: 'boleto_aviso',
      metaTemplateName: 'boleto_v1',
      language: 'pt_BR',
      category: 'UTILITY',
      status: 'APPROVED',
      priority: 1,
      lastReclassifiedAt: null,
    },
    {
      id: 'var-2',
      tenantId: 'tenant-1',
      groupKey: 'boleto_aviso',
      metaTemplateName: 'boleto_v2_espelho',
      language: 'pt_BR',
      category: 'UTILITY',
      status: 'APPROVED',
      priority: 2,
      lastReclassifiedAt: null,
    },
  ];
  const _quotas = new Map<string, any>();
  const _ledger = new Map<string, any>();

  return {
    _suppressions,
    _variants,
    _quotas,
    _ledger,
    globalSuppression: {
      async findUnique({ where }) {
        return _suppressions.get(where.globalPhoneHash) ?? null;
      },
      async upsert({ where, create, update }) {
        const existing = _suppressions.get(where.globalPhoneHash);
        const next = existing ? { ...existing, ...update, updatedAt: new Date() } : { ...create, updatedAt: new Date() };
        _suppressions.set(where.globalPhoneHash, next);
        return next;
      },
      async deleteMany({ where }) {
        _suppressions.delete(where.globalPhoneHash);
      },
    },
    mirrorTemplateVariant: {
      async findMany({ where }) {
        return _variants.filter((v) => v.tenantId === where.tenantId && (!where.groupKey || v.groupKey === where.groupKey));
      },
      async update({ where, data }) {
        const item = _variants.find((v) => v.id === where.id);
        if (item) Object.assign(item, data);
        return item;
      },
    },
    monthlyServiceQuota: {
      async findUnique({ where }) {
        const key = `${where.wabaPhoneId_yearMonth.wabaPhoneId}:${where.wabaPhoneId_yearMonth.yearMonth}`;
        return _quotas.get(key) ?? null;
      },
      async upsert({ where, create }) {
        const key = `${where.wabaPhoneId_yearMonth.wabaPhoneId}:${where.wabaPhoneId_yearMonth.yearMonth}`;
        const existing = _quotas.get(key);
        const next = existing ? { ...existing, freeUsedCount: existing.freeUsedCount + 1 } : { ...create };
        _quotas.set(key, next);
        return next;
      },
    },
    finOpsSavingsLedger: {
      async upsert({ where, create }) {
        _ledger.set(where.intentId, create);
        return create;
      },
    },
  };
}
import { handleMetaWebhookFinOps } from "./webhook-auto-handler.ts";
import { getFinOpsBridge } from "./singleton.ts";
const db = createMockPrisma(), b = getFinOpsBridge(db), t = "e2e-1";
await handleMetaWebhookFinOps(db, { entry: [{ changes: [{ value: { statuses: [{ status: "failed", recipient_id: "5541999990002", errors: [{ code: 131026 }] }] } }] }] }, t);
const base = { tenantId: t, renderedBodyText: "Ok", hasActiveFep72hWindow: false, allowMarketingToFreeForm: true, hasMarketingConsent: true, routingTransport: "DIRECT_CLOUD_API" as const, serviceUnitCostUsd: 0.0068, utilityUnitCostUsd: 0.0068, marketingUnitCostUsd: 0.0625 };
const d1 = await b.routeAndPersist({ ...base, intentId: "i1", recipientPhone: "+5541999990001", category: "MARKETING", hasActive24hWindow: true, directRouteConfig: { phoneNumberId: "1", accessToken: "m", legacyBspMarkupPerMsgUsd: 0.008 } });
const d2 = await b.routeAndPersist({ directRouteConfig: { phoneNumberId: "1", accessToken: "m", legacyBspMarkupPerMsgUsd: 0.008 }, ...base, intentId: "i2", recipientPhone: "+5541999990002", category: "UTILITY", hasActive24hWindow: false });
console.log("1. CSW+Direct:", d1.status, "| Economia USD:", d1.totalSavedUsd);
console.log("2. Cache 131026:", d2.status, "| Economia USD:", d2.totalSavedUsd);
console.log("3. Auditoria Ledger:", db._ledger.size, "registros");
