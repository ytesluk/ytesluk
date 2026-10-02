# Arquitetura

## Visão geral

```
 Sistema de origem (ERP, e-commerce, CRM)            Meta WhatsApp Cloud API
            │  POST /api/v1/messages/intents                ▲            │ webhooks (assinados)
            ▼                                               │            ▼
 ┌──────────────────────┐   BullMQ (Redis)   ┌──────────────┴─────────────────────┐
 │  API (Fastify)        │ ─────────────────▶ │  Worker                            │
 │  auth/RBAC, validação │  wco-optimize      │  optimizeIntent → decisão          │
 │  idempotência         │  wco-flush         │  flushGroup (buffer, consolidação) │
 │  webhooks: valida →   │  wco-dispatch      │  dispatchAttempt (WhatsAppProvider) │
 │  persiste → ACK 200   │  wco-webhook       │  processWebhook (status, pricing,  │
 │  OpenAPI /api/docs    │  wco-maintenance   │    inbound, templates, conta)      │
 └──────────┬───────────┘  wco-dead-letter    │  rollup, alertas, retenção (LGPD)  │
            │                                 └──────────────┬─────────────────────┘
            ▼                                                ▼
                         PostgreSQL 16 (Prisma 7, Decimal(18,8), timestamptz)
            ▲
            │ /bff/* (cookie httpOnly → Bearer JWT)
 ┌──────────┴───────────┐
 │ Dashboard (Next.js)   │  visão geral, otimização, auditoria, simulador, admin
 └──────────────────────┘
```

* **API** recebe intents (202 Accepted), webhooks da Meta e serve o dashboard. Nunca envia mensagens
  de forma síncrona.
* **Worker** executa o pipeline assíncrono. Pode ter N réplicas: a serialização por grupo de buffer é
  garantida por `pg_advisory_xact_lock(hashtextextended(groupKey, 0))`; a idempotência por chaves
  únicas no banco.
* **Provider** (`packages/whatsapp`) é o único lugar com chamadas HTTP à Meta. `MetaCloudApiProvider`
  usa `META_GRAPH_API_VERSION` (nunca fixa no código), circuit breaker e classificação de erros;
  `MockWhatsAppProvider` simula `sent/delivered/read/failed`, atrasos e webhooks assinados.
* **Dashboard** é um BFF: o JWT da API fica em cookie httpOnly; o navegador só fala com `/bff/*`.

## Ciclo de vida de uma intent

```
CREATED → PENDING_OPTIMIZATION ─┬─▶ READY_TO_SEND → QUEUED → SENDING → SENT → DELIVERED → READ
                                ├─▶ DELAYED (buffer) ─▶ (flush) ─┬─▶ READY_TO_SEND …
                                │                                ├─▶ CONSOLIDATED (coberta por outra mensagem)
                                │                                └─▶ SUPERSEDED (estado mais recente venceu)
                                ├─▶ DEDUPLICATED
                                ├─▶ BLOCKED (opt-out, sem opt-in, fora da janela)
                                └─▶ CANCELLED / FAILED
```

A máquina de estados (`packages/domain/src/state-machine.ts`) rejeita transições inválidas; cada
transição gera um `ConversationEvent` (linha do tempo da auditoria).

## Pipeline

1. **Ingestão** (`services/intents.ts`): valida (zod), normaliza o telefone (E.164), calcula
   `customerHash` (HMAC com pepper), criptografa o telefone, resolve o mercado do destinatário e
   persiste `MessageIntent` com `eventHash`, `groupKey`, `supersessionKey`, `consolidationKey`.
   Idempotência: índice único `(tenantId, idempotencyKey)`.
2. **Otimização** (`optimizer.ts` + `packages/optimization`): sob lock do grupo, monta os fatos
   (duplicata? supersede? janela aberta? prazo?), roda o `PolicyEngine` (regras declarativas com
   invariantes), o scheduler e o `CostEngine`. Grava `OptimizationDecision` + `CostDecision`
   (BASELINE e OPTIMIZED) + `SavingsRecord` estimado.
3. **Buffer/flush**: intents em `DELAYED` têm `flushAt`/`hardDeadline`; o job `wco-flush` agrupa,
   aplica supersession/consolidação e cria `MessageAttempt` (uma por mensagem real).
4. **Envio** (`dispatcher.ts`): checagens finais (opt-out, janela ainda aberta), limitador global
   (80 mps por padrão), retentativas com backoff, DLQ.
5. **Webhooks** (`webhooks.ts`): validação HMAC → persistência bruta → ACK → fila → processamento
   idempotente; o objeto `pricing` da Meta transforma custo ESTIMADO em REALIZADO.
6. **Manutenção**: rollup diário (`DailyMetric`), alertas (custo anômalo, cota, falhas), retenção LGPD.

## Multi-tenancy

* Toda tabela de negócio tem `tenantId`; serviços sempre filtram por `tenantId` explícito.
* `forTenant(db, tenantId)` (extensão Prisma) injeta `tenantId` em leituras/escritas e recusa criação
  em outro tenant — disponível como defesa adicional e coberto por testes.
* A identidade do tenant vem **só** da credencial (JWT ou API key), nunca do corpo da requisição.
* O mesmo telefone em dois tenants são dois clientes distintos (hash por tenant + pepper).

## Dados principais (Prisma)

`Tenant, User, ApiKey, BusinessAccount, Waba (fuso/moeda/token cifrado), PhoneNumber, Customer,
ConsentRecord, Conversation, CustomerServiceWindow, ConversationEntryPoint, ConversationEvent,
MessageIntent, MessageAttempt, MessageDelivery, Template, PricingPolicyVersion, PricingRule,
PriceCatalogImport, PriceCatalog, PricingTier, FreeQuotaCounter, TierAccrual, OptimizationPolicy,
PolicyRuleSet, OptimizationDecision, CostDecision, SavingsRecord, DailyMetric, WebhookEvent,
AuditLog, Alert, DataRetentionPolicy, DataSubjectRequest, ImportJob, ExperimentRun, AiUsage, Plan,
Subscription, Usage, Invoice.`

Dinheiro em `Decimal(18,8)`; instantes em `timestamptz` (UTC); datas de vigência como `date`
interpretadas no fuso da WABA.

## Observabilidade

* Logs JSON (pino) com redação de segredos/PII e `requestId`/`tenantId`.
* Prometheus: API em `/api/v1/metrics`, worker em `:9100/metrics` (`wco_intents_received_total`,
  `wco_messages_avoided_total`, `wco_estimated_savings_total`, `wco_meta_api_latency_seconds`,
  `wco_queue_depth`, `wco_circuit_breaker_open`, `wco_cost_calculation_errors_total`, …).
* `/api/v1/observability` e a página Observabilidade mostram filas, throughput e taxa de erro.

## Escala

* Simulador em memória: ~45–100 µs/evento por braço (1 milhão de eventos × 6 braços em 451 s).
* Produção: API e worker sem estado; escalam horizontalmente. Gargalo esperado é o PostgreSQL
  (índices por `tenantId`/`groupKey`/`status`); filas e limitador ficam no Redis.
