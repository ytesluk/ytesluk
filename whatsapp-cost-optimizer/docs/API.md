# API REST

Base: `/api/v1`. Documentação interativa (OpenAPI 3.1): **`/api/docs`**; JSON: `/api/openapi.json`.
Valores monetários são strings decimais; custos e economias vêm rotulados (`ESTIMATED`, `REALIZED`,
`UNKNOWN`) e com `isDemoRates` quando o rate card é DEMO.

## Autenticação

* Sistemas: `X-API-Key: wco_…` (papel definido na chave, normalmente OPERATOR).
* Usuários: `POST /auth/login` → `{ token }` → `Authorization: Bearer <token>`.

## Enviar eventos

```bash
curl -X POST http://localhost:4000/api/v1/messages/intents \
  -H "X-API-Key: $WCO_API_KEY" -H "Content-Type: application/json" \
  -d '{
        "customer": "+5511999999999",
        "eventType": "order.status",
        "entityId": "ORD-1234",
        "data": { "orderId": "ORD-1234", "status": "SHIPPED", "statusLabel": "enviado" },
        "idempotencyKey": "erp-evt-998877",
        "occurredAt": "2026-10-02T13:00:40Z"
      }'
# 202 {"intentId":"…","status":"PENDING_OPTIMIZATION","idempotent":false}
# replay da mesma idempotencyKey → 200 {"intentId": <o mesmo>, "idempotent": true}
```

Campos opcionais: `priority` (LOW/NORMAL/HIGH/CRITICAL), `maxDelaySeconds`, `category`, `template`
(`name`, `language`), `text` (mensagem livre; só com janela de atendimento aberta), `mustSendImmediately`,
`earliestSendAt`, `preferredSendAt`, `phoneNumberId`, `optimization` (`allowDeduplication`,
`allowAggregation`, `allowSupersession`), `consent` (`optIn`, `source`).

`POST /messages/send` é igual, com `mustSendImmediately: true` (nunca entra no buffer).

## Endpoints

| Método | Caminho | Permissão | Descrição |
|---|---|---|---|
| GET | `/health` | pública | DB + Redis, modo, versão da Graph API |
| GET | `/metrics` | autenticada | Prometheus |
| POST | `/auth/login` · GET `/auth/me` | — | sessão |
| GET/POST/DELETE | `/api-keys`, `/users` | tenant/usuários | gestão de acesso |
| POST | `/messages/intents`, `/messages/send` | messages:write | criar intents |
| GET | `/messages`, `/messages/{id}` | messages:read | lista (filtros, cursor) e **auditoria** (decisões, custos, tentativas, webhooks, economia, "por quê") |
| GET/POST | `/webhooks/meta` | assinatura Meta | verificação e recebimento |
| GET | `/webhooks/events` | webhooks:read | eventos recebidos/DLQ |
| GET | `/conversations`, `/conversations/{id}` | conversations:read | janelas CSW/FEP |
| GET | `/cost/estimate`, `/cost/actual` | cost:read | estimado vs realizado |
| GET | `/savings`, `/analytics` | analytics:read | economia (Meta, BSP, infra separados), séries diárias, breakdown, insights |
| GET | `/observability` | observability:read | filas, throughput, erros, latência |
| GET/POST | `/alerts`, `/alerts/{id}/ack` | analytics / policies:write | alertas |
| GET | `/audit` | audit:read | trilha de auditoria |
| GET · POST · PATCH | `/pricing`, `/pricing/import`, `/pricing/rate-cards/{id}` | pricing | políticas e rate cards |
| GET · POST | `/templates`, `/templates/cost-analysis`, `/templates/{id}/assistant` | templates | templates e análise de custo |
| GET · POST · PUT | `/optimization/policies`, `/optimization/rules` | policies | políticas por evento e regras |
| GET · PATCH | `/tenant` | tenant | configurações (opt-in, BSP) |
| GET · POST | `/onboarding`, `/onboarding/mock`, `/onboarding/manual`, `/onboarding/embedded-signup` | providers | conectar WhatsApp |
| POST | `/dev/simulate-inbound` | messages:write | (MOCK) simular mensagem de cliente |
| POST · GET · PUT | `/privacy/export`, `/privacy/delete`, `/privacy/consent`, `/privacy/retention` | privacy | LGPD |
| POST | `/simulate/savings`, `/simulate/rate-card`, `/simulate/bsp` | simulator | simuladores |
| POST | `/import/history` | simulator | CSV histórico → baseline + simulação |
| POST · GET | `/research/run`, `/research/runs` | simulator | experimento A–F (até 20k eventos) |
| GET | `/admin/platform/tenants` | `PLATFORM_ADMIN_EMAILS` | visão de plataforma |

Filtros de período: `?from=<ISO>&to=<ISO>` (padrão: últimos 30 dias).

## Erros

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request", "retryable": false,
             "requestId": "…", "timestamp": "…", "httpStatus": 400,
             "details": { "issues": [{ "path": "customer", "message": "…" }] } } }
```

Códigos: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404),
`CONFLICT` / `INVALID_STATE_TRANSITION` (409), `PRICING_UNKNOWN` (422), `RATE_LIMITED` (429),
`CONFIGURATION_ERROR` e `INTERNAL_ERROR` (500); erros do provedor trazem `provider` e `providerCode`
(código da Meta). Todo response traz `x-request-id` (aceita o do cliente).

## Limites

`RATE_LIMIT_PER_MINUTE` por credencial (padrão 600/min); login 20/min; corpo 2 MB (12 MB importação de
preços, 60 MB CSV histórico).
