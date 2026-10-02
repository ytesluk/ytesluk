# Fontes oficiais da Meta consultadas

> Data da consulta: **2026-10-02** (UTC).
> Todas as regras de cobrança implementadas no WCO estão em **dados versionados**
> (`PricingPolicyVersion` + `PricingRule` + `PriceCatalog`) e apontam para as
> fontes abaixo pelo campo `sourceUrl`. Nenhuma regra temporal está espalhada em
> `if/else` no código.

## Como a consulta foi feita (e suas limitações)

| Item | Situação |
| --- | --- |
| `developers.facebook.com` via HTTP direto | **Bloqueado** pelo proxy de saída do ambiente de desenvolvimento (política de rede). |
| `developers.facebook.com` via serviço de leitura (Exa) | Funcionou. As páginas foram lidas em versões diferentes de cache (carimbos "Updated: Jul 1, 2026", "Aug 5, 2026" e "Aug 25, 2026"). |
| CSVs oficiais de rate card (`scontent-*.fbcdn.net`) | **Bloqueados** (política de rede) e não legíveis pelo serviço de leitura (URLs assinadas). Por isso **nenhuma tarifa real foi embarcada**: o sistema traz um catálogo `DEMO` claramente marcado e um importador administrativo (`pnpm pricing`). |
| Blogs/BSPs (Twilio, Wati, SendPulse, Voltade, etc.) | Usados **somente** para localizar páginas oficiais e para identificar conflitos. Nunca como fonte de verdade. |

Regra adotada (seção 85 da especificação): **documentação oficial atual da Meta
prevalece**; quando duas páginas oficiais divergem, o conflito é registrado em
[`KNOWN-CONFLICTS.md`](./KNOWN-CONFLICTS.md) e vira uma `PricingPolicyVersion`
separada, com status explícito.

---

## S1 — Pricing on the WhatsApp Business Platform

- URL: <https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/>
  (alias antigo: <https://developers.facebook.com/docs/whatsapp/pricing>)
- Carimbos observados: `Updated: Jul 1, 2026` e `Updated: Aug 5, 2026`.

Trechos usados no modelo:

1. **Cobrança por mensagem entregue** — "Effective July 1, 2025, Meta charges on a
   **per-message basis** for messages businesses deliver to WhatsApp users: You are
   only charged when a template message is *delivered*."
2. **Mercado pelo código de país do destinatário** — "Rates vary based on the
   template's category and the recipient WhatsApp phone number's country calling
   code." e "Charges for messages are based on the country calling code of the
   recipient WhatsApp phone number. [...] If a country is not listed below, it maps
   to Other." → implementado em `packages/domain/src/market.ts` (tabela de
   mercados versionada).
3. **Categorias de template** — Marketing, Utility, Authentication. Service é
   **não-template** (`"type":"text"`, `"type":"image"`, ...) e só pode ser enviada
   dentro da janela de atendimento.
4. **Regras gratuitas (política vigente até 30/09/2026)**:
   - "As of November 1, 2024 - Meta does not charge for non-template messages".
   - "As of July 1, 2025 - Meta does not charge for utility templates in response
     to users (delivered within an open customer service window)."
5. **Free Entry Point (FEP)** — "If a WhatsApp user messages you via a Click to
   WhatsApp Ad or Facebook Page Call-to-Action button using a device running our
   Android or iOS app (our desktop and web apps are not supported): A 24-hour
   customer service window is opened (as normal). If you respond within 24 hours
   using any type of message, the message will be free, and a Free Entry Point
   ("FEP") window will be opened, starting from the time when you responded. FEP
   windows remain open for 72 hours. [...] the customer service window is
   independent of the FEP window".
6. **Volume tiers** — "You can unlock lower utility and authentication rates based
   on the number of messages you send in a month."
   - "Messages are aggregated at the business portfolio level, across all WhatsApp
     Business accounts (WABAs) owned by the portfolio [...] for each market-category
     pair".
   - "Only messages that are charged count toward the tiers — Thus, the following
     messages do not count: Utility templates delivered to WhatsApp users within an
     open customer service window. Utility templates delivered within a free entry
     point window."
   - "Rates are tier-specific — When a business sends enough messages [...] to reach
     the next tier, they unlock the rate of the next tier, **specifically for
     messages in that tier**."
   - Exemplo 1: "List rate for the first A messages. Tier rate 1 for messages A+1 to
     B. Total charges for that month = Rate per tier x messages in each tier." →
     implementado em `TierCalculator` (distribuição marginal, nunca "taxa média =
     taxa do maior tier").
   - "Tiers reset monthly — At the start of the next month (12am WABA timezone)".
7. **Fuso horário de vigência** — "Rate updates below apply as of 12am by WhatsApp
   Business Account (WABA) timezone". → o motor converte o instante UTC para o fuso
   da WABA **apenas** para decidir data de vigência e mês de acúmulo; todos os
   timestamps continuam gravados em UTC.
8. **Calendário de preços** — "Meta may update pricing only on the 1st day of each
   quarter [...] January 1, April 1, July 1, and/or October 1", com aviso mínimo
   de 1 mês (rate card), 3 meses (add-on) e 6 meses (mudança de modelo).
9. **Mudanças vigentes a partir de 01/10/2026** (seção "Updates to rate cards"):
   - "Effective October 1, 2026 – Meta will charge on a per-message basis for
     service messages. [...] rates for service messages will be the same as those
     of utility and authentication, by market."
   - "(NEW) Effective October 1, 2026 – Meta will introduce a free monthly tier of
     service messages. Each month, every business phone number will receive 1,000
     free service messages; Meta will only charge as of the 1,001st service message
     delivered. These free service messages do not roll over [...] and reset
     monthly, for each business phone number."
   - "Effective October 1, 2026 – Meta will charge for utility messages sent in an
     open 24-hour customer service window".
   - 9 mercados saem de regiões "Rest of" (Bangladesh, Iraq, Kazakhstan, Kuwait,
     Morocco, Nepal, Oman, Sri Lanka, Ukraine) com tarifas e tiers próprios.
10. **Webhooks de preço** — objeto `pricing` nos webhooks de status:
    `{"billable": true, "pricing_model": "PMP", "type": "regular", "category": "<PRICING_CATEGORY>"}`;
    mensagens gratuitas por janela têm `type: "free_customer_service"`.
    "Note that currently, tiering information is not included in any webhooks. Use
    the pricing_analytics field to get tiering information".
11. **Webhook de tier** — `account_update` com `event: VOLUME_BASED_PRICING_TIER_UPDATE`
    e `volume_tier_info` (`tier_update_time`, `pricing_category`, `tier`,
    `effective_month`, `region`); "use the webhook with the smaller
    `tier_update_time` Unix timestamp as the official webhook".
12. **Localização de faturamento (BRL/INR)** — WABAs elegíveis no Brasil podem ser
    criadas em BRL desde 01/07/2026, e devem migrar até 30/06/2027. → `PriceCatalog`
    é sempre por moeda; o WCO nunca converte moeda implicitamente.

## S2 — Upcoming pricing updates for Meta Business Agent, service and utility messages

- URL: <https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages>
- Carimbo: `Updated: Aug 25, 2026`.

Trechos usados:

- "Meta charges for messages from businesses to WhatsApp users only, and only when
  the message is **delivered** (vs. sent)."
- "Effective October 1, 2026 - Meta will charge on a per-message basis for all
  service messages [...]. These messages have not been charged since November 1,
  2024."
- "Effective October 1, 2026 - Meta will charge on a per-message basis for utility
  messages sent in response to users (within an open 24-hour customer service
  window). These messages have not been charged since July 1, 2025."
- Service: "Volume tiers: None. Meta will not offer volume tiers for service
  messages."
- Tabela "Is this message free in the 72-hour FEP?": Marketing **Yes**, Utility
  **Yes**, Authentication **Yes**, Service **Yes**, Meta Business Agent **No**.
- "Only one charge applies per message. [...] This also applies to non-template
  messages with promotional content: Meta does not additionally apply a marketing
  template charge."
- Meta Business Agent (desde 01/08/2026): cobrança por token ("One global rate of
  $2.00 USD per 1 million (M) tokens"). O WCO **não envia** mensagens de MBA; a
  categoria existe apenas para que webhooks com essa categoria não sejam
  contabilizados de forma errada (resultado `UNKNOWN` sem contagem de tokens).

## S3 — Service messages / Customer service windows

- URL: <https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages>
- Carimbo: `Updated: May 21, 2026`.

- "When a WhatsApp user messages you or calls you, a 24-hour timer called a
  customer service window starts. If the user messages or calls you again before
  the timer expires, the timer resets to 24 hours."
- "When the window closes, you can only send pre-approved template messages."
- "you can only send messages to WhatsApp users who have opted in to receiving
  messages from you."
- "Service messages are billed under the SERVICE pricing category."
- TTL padrão: 30 dias (exceto autenticação: 10 minutos).
- "the order in which messages are delivered is not guaranteed to match the order
  of your API requests".
- Exemplo oficial usa `https://graph.facebook.com/v26.0/...`.

## S4 — Status messages webhook reference

- URL: <https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status>
- Carimbo: `Updated: May 21, 2026`.

- `status`: `sent`, `delivered`, `read`, `failed`, `played`. "A status is
  considered read only if it has been delivered [...] the 'delivered' webhook is
  not sent because it's implied" → o WCO trata `read` sem `delivered` prévio como
  entrega implícita para fins de custo.
- `pricing.type`: `regular` (billable), `free_customer_service`, `free_entry_point`.
- `pricing.category`: `authentication`, `authentication-international`, `marketing`,
  `marketing_lite`, `referral_conversion` (FEP), `service`, `utility`.
- "The `billable` property will be deprecated [...] Use `pricing.type` and
  `pricing.category` together to determine whether a message is billable".
- `conversation` omitido em v24.0+ "unless the webhook is for a message sent within
  an open free entry point window"; `expiration_timestamp` presente no `sent` → o
  WCO usa esse valor para **confirmar** a janela FEP calculada localmente.
- O objeto `pricing` aparece em `sent` **ou** `delivered/read` ("the object can only
  appear in one or the other").

## S5 — Webhook endpoint (verificação e assinatura)

- URL: <https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint/>

- GET de verificação com `hub.mode=subscribe`, `hub.challenge`, `hub.verify_token`;
  responder `200` com o `hub.challenge` quando o token confere.
- POST com `X-Hub-Signature-256: sha256=<HMAC-SHA256(payload, app secret)>`.
  O WCO valida sobre o **corpo bruto** (raw body) com comparação em tempo constante.

## S6 — Text messages webhook (objeto `referral`)

- URL: <https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/text>

- `referral` presente "only included if message sent via a Click to WhatsApp ad":
  `source_url`, `source_id`, `source_type` (`ad`), `body`, `headline`,
  `media_type`, `image_url`, `video_url`, `thumbnail_url`, `ctwa_clid`
  ("omitted entirely for messages originating from an ad in WhatsApp Status"),
  `welcome_message`.

## S7 — Template categorization

- URL: <https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization>
- Carimbo: `Updated: May 21, 2026`.

- Utility exige **ambos**: "Must be non-promotional" **e** "specific to or requested
  by the user [...] OR essential or critical to the user".
- "Templates with mixed content (for example, both utility and marketing [...]) [are
  considered marketing]".
- "Only authentication templates can be used to send a one-time passcode".
- Desde 09/04/2025, um template enviado como UTILITY que a Meta considera MARKETING
  é aprovado como MARKETING; recategorização automática via webhook
  `template_category_update`.
- Restrições escalonadas para quem classifica marketing como utility
  (warning → rate limit → utility restriction → portfolio restriction).
  → O WCO **nunca** sugere reescrever conteúdo para mudar de categoria.

## S8 — Error codes

- URL: <https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes>
- Carimbo: `Updated: Jun 18, 2026`.

Classificação usada em `packages/whatsapp/src/errors.ts`:

| Código | Significado (resumo oficial) | Tratamento WCO |
| --- | --- | --- |
| 4, 80007, 130429 | Limites de chamadas / throughput | retryable + backoff |
| 131056 | Pair rate limit (mesmo destinatário) | retryable + backoff |
| 131000, 131016, 131057 | Erro desconhecido / serviço indisponível / manutenção | retryable |
| 131047 | Mais de 24h desde a última mensagem do usuário | non-retryable (exige template) |
| 131049 | Não entregue para manter engajamento saudável | non-retryable ("wait at least 24 hours") |
| 131050 | Usuário parou de receber marketing | non-retryable + opt-out de marketing |
| 131026 | Não entregável | non-retryable |
| 131042 | Problema de método de pagamento | non-retryable + alerta |
| 132000–132016 | Problemas de template | non-retryable |
| 0, 3, 10, 190, 200 | Autorização | non-retryable + alerta |
| 368, 130497, 131031 | Restrições de conta/política | non-retryable + alerta |

## S9 — Throughput

- URL: <https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput>

- "For each registered business phone number, Cloud API supports up to 80 messages
  per second (mps) by default, and up to 1,000 mps by automatic upgrade."
- Pair rate limit (overview): "1 message every 6 seconds to the same WhatsApp user".
  → O WCO **respeita** os limites (fila + backoff); nunca tenta contorná-los.

## S10 — Graph API versions

- URL: <https://developers.facebook.com/docs/graph-api/changelog/versions/>

- "The latest Graph API version is: v26.0" (lançada em 29/07/2026). v20.0 removida
  em 24/09/2026; v21.0 será removida em 21/01/2027.
- O WCO lê a versão de `META_GRAPH_API_VERSION` (padrão sugerido no `.env.example`:
  `v26.0`). Nenhuma versão fixa no código.

## S11 — Embedded Signup / Tech Provider

- URLs:
  <https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation>,
  <https://developers.facebook.com/docs/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider/>

- "You must already be a Solution Partner or Tech Provider."
- O Embedded Signup devolve WABA ID, phone number ID e um código trocável
  ("time-to-live of 30 seconds") por um business token
  (`GET /oauth/access_token`), seguido de `POST /<WABA_ID>/subscribed_apps` e
  `POST /<PHONE_NUMBER_ID>/register`.
- "You will not be able to onboard [...] customers until your app has been approved
  for advanced access for each of the permissions it requires"
  (`whatsapp_business_management`, `whatsapp_business_messaging`).
  → Production Mode do WCO bloqueia onboarding comercial sem essas configurações.

---

## Política → fonte (rastreabilidade)

| PricingPolicyVersion | Vigência | Fontes | Status |
| --- | --- | --- | --- |
| `meta-pmp-2025-07` | 2025-07-01 → 2026-09-30 | S1 (itens 1–8), S4 | `ACTIVE` (histórico) |
| `meta-pmp-2026-10` | 2026-10-01 → aberta | S1 (item 9), S2 | `ACTIVE` |
| `meta-fep-ctwa-7d-2026-09` | candidata | apenas fontes de terceiros | `UNVERIFIED` (não usada) |

Ver detalhes em [`KNOWN-CONFLICTS.md`](./KNOWN-CONFLICTS.md) e
[`PRICING.md`](./PRICING.md).
