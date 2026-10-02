# Webhooks da Meta

Endpoint: `https://<sua-api>/api/v1/webhooks/meta` (fontes S4, S5, S6 em [META-SOURCES.md](META-SOURCES.md)).

## Verificação (GET)

A Meta envia `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`. Se o token bater com
`META_WEBHOOK_VERIFY_TOKEN`, a API responde o `challenge` em texto puro; caso contrário 403.

## Recebimento (POST)

```
validar assinatura → persistir evento bruto → ACK 200 → fila wco-webhook → processador idempotente
```

1. **Assinatura**: `X-Hub-Signature-256: sha256=<HMAC-SHA256(corpo bruto, META_APP_SECRET)>`, comparação
   em tempo constante sobre os **bytes recebidos** (o parser guarda o `rawBody`). Inválida → 401, nada é salvo.
2. **Persistência**: `WebhookEvent` com payload bruto e `payloadHash` (SHA-256) **único** — reentregas
   idênticas viram `200 {"duplicate": true}` sem novo processamento (caso obrigatório 10).
3. **ACK** imediato (sem processamento síncrono).
4. **Processamento** (`processWebhook`), com retentativas exponenciais (6 tentativas) e dead-letter
   (`DEAD` + alerta `WEBHOOK_FAILURE` crítico).

## Campos tratados

| Campo | Tratamento |
|---|---|
| `messages` → `statuses` | `MessageDelivery` único por `(providerMessageId, status)`; atualiza a intent e as intents cobertas pela mensagem; com `pricing` (`billable`, `pricing_model`, `type`, `category`) torna o custo **REALIZADO**; `conversation.expiration_timestamp` confirma/rejeita janelas FEP; `errors` classificados (opt-out, janela, pagamento, restrição de conta) |
| `messages` → `messages` | mensagem do cliente: abre/renova a janela de atendimento; `referral` (anúncio CTWA) cria `ConversationEntryPoint`; palavras de opt-out ("PARAR", "STOP", "SAIR"…) registram opt-out |
| `message_template_status_update` | status do template (APPROVED, REJECTED, PAUSED…) |
| `template_category_update` | categoria definida pela Meta; guarda a anterior e gera alerta `TEMPLATE_CATEGORY_CHANGED` |
| `account_update` | restrições/violações → alerta `ACCOUNT_RESTRICTION` |
| `user_preferences` | preferências de marketing do usuário (opt-out de marketing) |

Campos desconhecidos são persistidos (payload bruto) sem efeitos colaterais; eventos sem conteúdo reconhecível ficam `IGNORED`.

## Idempotência em duas camadas

* bytes idênticos → `payloadHash` único;
* mesmo status reserializado (bytes diferentes) → novo `WebhookEvent`, mas `MessageDelivery` único e
  custo realizado gravado uma vez (testado em integração).

## Modo MOCK

`MockWhatsAppProvider` gera payloads com a mesma estrutura da Cloud API (`sent`, `delivered` com
`pricing`, `read`, `failed`), assinados com o app secret, entregues ao próprio endpoint pela fila
`wco-mock-emit` com latência configurável (`MOCK_MAX_LATENCY_MS`, `MOCK_DELIVERY_RATE`, `MOCK_READ_RATE`).
`POST /api/v1/dev/simulate-inbound` simula a mensagem de um cliente (orgânica ou via anúncio).

## Retenção

Payloads brutos são removidos após `rawWebhookRetentionDays` (padrão 30) pelo job de retenção;
o registro (`status`, horários) permanece para auditoria.
