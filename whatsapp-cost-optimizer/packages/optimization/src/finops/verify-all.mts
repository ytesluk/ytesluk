import assert from 'node:assert/strict';
import {
  FinOpsCostOrchestrator,
  GlobalDeliverabilityCache,
  InMemorySuppressionStore,
  TemplateMirrorPool,
  evaluateFepAndKeepAlive,
  WebhookMirrorSigner,
} from './index.ts';

async function run() {
  const store = new InMemorySuppressionStore();
  const cache = new GlobalDeliverabilityCache(store, 'wco-global-salt-2026');
  const orchestrator = new FinOpsCostOrchestrator(cache);

  const baseConfig = {
    intentId: 'intent-001',
    tenantId: 'tenant-curitiba',
    recipientPhone: '+5541999998888',
    renderedBodyText: 'Seu pedido #4812 saiu para entrega!',
    hasActive24hWindow: true,
    hasActiveFep72hWindow: false,
    allowMarketingToFreeForm: true,
    hasMarketingConsent: true,
    routingTransport: 'DIRECT_CLOUD_API' as const,
    directRouteConfig: {
      phoneNumberId: '123456789',
      accessToken: 'EAAB_TEST',
      legacyBspMarkupPerMsgUsd: 0.008,
    },
    monthlyFreeServiceQuotaUsed: 120,
    serviceUnitCostUsd: 0.0068,
    utilityUnitCostUsd: 0.0068,
    marketingUnitCostUsd: 0.0625,
  };

  // 1. Teste Módulo 1 + 4: Marketing -> Free-form na janela 24h + Bypass BSP
  const m1 = await orchestrator.evaluateAndRoute({
    ...baseConfig,
    category: 'MARKETING',
    buttons: [{ id: 'btn_1', title: 'Rastrear agora' }],
  });
  assert.equal(m1.deliveryMode, 'CSW_24H_FREE_FORM');
  assert.equal(m1.finalTotalCostUsd, 0);
  assert.equal(m1.totalSavingsUsd, 0.0705); // 0.0625 Meta + 0.008 BSP
  console.log('[OK] Módulo 1 & 4 (CSW 24h + Bypass BSP):', m1.appliedStrategies);

  // 2. Teste Módulo 2: Failover automático de Mirror Pool UTILITY -> MARKETING
  const pool = new TemplateMirrorPool();
  const variants = [
    { id: '1', tenantId: 't1', groupKey: 'order_update', metaTemplateName: 'order_v1', language: 'pt_BR', category: 'UTILITY' as const, status: 'APPROVED' as const, priority: 1 },
    { id: '2', tenantId: 't1', groupKey: 'order_update', metaTemplateName: 'order_v2_mirror', language: 'pt_BR', category: 'UTILITY' as const, status: 'APPROVED' as const, priority: 2 },
  ];
  const update = pool.handleCategoryUpdate(variants, 'order_v1', 'MARKETING');
  assert.equal(update.degradedToMarketing, true);
  assert.equal(update.nextActiveVariant?.metaTemplateName, 'order_v2_mirror');
  console.log('[OK] Módulo 2 (Mirror Pool Failover):', update.nextActiveVariant?.metaTemplateName);

  // 3. Teste Módulo 3: Keep-Alive inteligente com ROI positivo
  const ka = evaluateFepAndKeepAlive({
    hasActiveFep72hWindow: false,
    hasActiveCsw24hWindow: true,
    cswExpiresAt: new Date(Date.now() + 20 * 60_000),
    upcomingCategory: 'MARKETING',
    upcomingTemplateCostUsd: 0.0625,
    keepAliveEnabled: true,
    triggerBeforeExpiryMinutes: 45,
    estimatedReplyRate: 0.4,
    monthlyFreeServiceQuotaUsed: 1500, // Acima da franquia de 1000
    serviceUnitCostUsd: 0.0068,
  });
  assert.equal(ka.action, 'SEND_KEEP_ALIVE_PING');
  assert.ok(ka.expectedNetSavingsUsd > 0.015);
  console.log('[OK] Módulo 3 (Keep-Alive ROI positivo):', ka);

  // 4. Teste Módulo 4: Assinatura HMAC-SHA256 de espelho de webhook
  const signer = new WebhookMirrorSigner();
  const signed = signer.prepareMirror('https://crm.cliente.com/webhook', { event: 'delivered' }, 'secret123');
  assert.ok(signed.signatureHeader.startsWith('sha256='));
  console.log('[OK] Módulo 4 (Webhook Mirror HMAC):', signed.signatureHeader.slice(0, 24) + '...');

  // 5. Teste Módulo 5: Cache Global 131049 bloqueia Marketing mas libera Utility
  await cache.recordMetaFailure('+5541999998888', 131049);
  const blockedMkt = await orchestrator.evaluateAndRoute({
    ...baseConfig,
    hasActive24hWindow: false,
    category: 'MARKETING',
  });
  assert.equal(blockedMkt.status, 'DEFERRED');
  const allowedUtil = await orchestrator.evaluateAndRoute({
    ...baseConfig,
    hasActive24hWindow: false,
    category: 'UTILITY',
  });
  assert.equal(allowedUtil.status, 'DISPATCH');
  console.log('[OK] Módulo 5 (Cache Global 131049): Marketing=', blockedMkt.status, '| Utility=', allowedUtil.status);

  // 6. Teste Módulo 6: External HTTP Bridge + Handoff wa.me para número oficial
  await cache.clearOnInboundMessage('+5541999998888');
  const bridgeRoute = await orchestrator.evaluateAndRoute({
    ...baseConfig,
    hasActive24hWindow: false,
    category: 'MARKETING',
    routingTransport: 'EXTERNAL_HTTP_BRIDGE',
    externalBridgeConfig: {
      endpointUrl: 'https://bridge.local/send',
      officialWabaPhone: '5541988887777',
      appendHandoffLink: true,
      unitCostUsd: 0.002,
    },
  });
  assert.equal(bridgeRoute.deliveryMode, 'EXTERNAL_BRIDGE_WITH_HANDOFF');
  assert.ok(bridgeRoute.handoffUrl?.includes('https://wa.me/5541988887777'));
  console.log('[OK] Módulo 6 (External Bridge + Handoff):', bridgeRoute.handoffUrl);

  console.log('\nTODAS AS 6 FUNCIONALIDADES VALIDADAS COM SUCESSO!');
}

run();
