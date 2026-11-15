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

async function run() {
  const mockPrisma = createMockPrisma();
  const bridge = new FinOpsRuntimeBridge(mockPrisma, 'salt-prod-2026');

  const failover = await bridge.onTemplateCategoryUpdated('tenant-1', 'boleto_v1', 'MARKETING');
  assert.equal(failover?.nextActiveVariant?.metaTemplateName, 'boleto_v2_espelho');
  console.log('[OK] Failover Mirror Pool persistido:', failover?.nextActiveVariant?.metaTemplateName);

  const decision = await bridge.routeAndPersist({
    intentId: 'int-999',
    tenantId: 'tenant-1',
    recipientPhone: '+5541999990000',
    category: 'MARKETING',
    templateGroupKey: 'boleto_aviso',
    renderedBodyText: 'Seu boleto vence hoje!',
    hasActive24hWindow: true,
    hasActiveFep72hWindow: false,
    allowMarketingToFreeForm: true,
    hasMarketingConsent: true,
    routingTransport: 'DIRECT_CLOUD_API',
    directRouteConfig: { phoneNumberId: '987654321', accessToken: 'TOKEN', legacyBspMarkupPerMsgUsd: 0.008 },
    serviceUnitCostUsd: 0.0068,
    utilityUnitCostUsd: 0.0068,
    marketingUnitCostUsd: 0.0625,
  });

  assert.equal(decision.deliveryMode, 'CSW_24H_FREE_FORM');
  assert.equal(mockPrisma._ledger.get('int-999').totalSavingsUsd, 0.0705);
  assert.equal(await bridge.repo.getMonthlyFreeServiceQuotaUsed('987654321'), 1);
  console.log('[OK] Ledger e Franquia Mensal persistidos!');

  await bridge.onMetaStatusFailed('+5541999990000', 131049);
  const blocked = await bridge.routeAndPersist({
    intentId: 'int-1000',
    tenantId: 'tenant-1',
    recipientPhone: '+5541999990000',
    category: 'MARKETING',
    renderedBodyText: 'Oferta relampago',
    hasActive24hWindow: false,
    hasActiveFep72hWindow: false,
    allowMarketingToFreeForm: true,
    hasMarketingConsent: true,
    routingTransport: 'DIRECT_CLOUD_API',
    directRouteConfig: { phoneNumberId: '987654321', accessToken: 'TOKEN', legacyBspMarkupPerMsgUsd: 0.008 },
    serviceUnitCostUsd: 0.0068,
    utilityUnitCostUsd: 0.0068,
    marketingUnitCostUsd: 0.0625,
  });
  assert.equal(blocked.status, 'DEFERRED');

  await bridge.onMetaInboundMessage('+5541999990000');
  assert.equal(mockPrisma._suppressions.size, 0);
  console.log('[OK] Supressao 131049 e desbloqueio inbound validados!');
}

run();
