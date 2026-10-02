# Conflitos e incertezas conhecidos

Este documento registra divergências entre fontes e as decisões tomadas. Cada
conflito resolvido vira dados versionados (`PricingPolicyVersion`), nunca código
condicional espalhado. Consulta realizada em **2026-10-02**.

## C1 — Service e Utility dentro da janela: grátis ou cobradas?

| Fonte | O que diz |
| --- | --- |
| S1, topo da página ("Updated: Jul 1, 2026" / "Aug 5, 2026") | "As of November 1, 2024 - Meta does not charge for non-template messages" e "As of July 1, 2025 - Meta does not charge for utility templates in response to users". O exemplo "Charge example" mostra Service e Utility-na-CSW como **None**. |
| S1, seção "Updates to rate cards" (mesma página) | "Effective October 1, 2026 – Meta will charge on a per-message basis for service messages" + cota grátis de 1.000/número/mês + "Meta will charge for utility messages sent in an open 24-hour customer service window". |
| S2 ("Updated: Aug 25, 2026") | Confirma a cobrança de Service e Utility-na-CSW a partir de 01/10/2026. Não menciona a cota de 1.000 (a cota aparece como "[New]"/"(NEW)" em S1). |

**Natureza do conflito:** temporal. O texto do topo descreve a regra vigente até
30/09/2026 e não foi reescrito; as seções de atualização descrevem a regra a
partir de 01/10/2026.

**Decisão:** duas `PricingPolicyVersion`:

- `meta-pmp-2025-07` (2025-07-01 → 2026-09-30): Service grátis; Utility grátis na
  CSW; FEP 72h; tiers para Utility/Authentication.
- `meta-pmp-2026-10` (2026-10-01 → aberta): Service paga com cota de 1.000
  mensagens/número/mês e sem tiers; Utility paga também na CSW; FEP 72h continua
  grátis para Marketing/Utility/Authentication/Service.

Mensagens entregues até 30/09/2026 (no fuso da WABA) continuam calculadas pela
política antiga (seção 86: não reescrever histórico).

## C2 — Escopo da cota grátis de Service: por número ou por WABA?

| Fonte | O que diz |
| --- | --- |
| S1 (oficial) | "every business phone number will receive 1,000 free service messages". |
| Wati (BSP) | "1,000 free service messages per month for each WhatsApp Business Account". |

**Decisão:** seguir a fonte oficial → escopo `PHONE_NUMBER`. O escopo é um campo da
`PricingRule` (`freeQuotaScope`), portanto alterável sem deploy.

## C3 — Fuso horário do reset mensal da cota de Service

A documentação oficial diz que a cota "reset[s] monthly", mas não explicita o fuso
(para tiers e vigência de tarifas ela diz "12am WABA timezone").

**Decisão (premissa):** usar o fuso da WABA, por consistência com tiers e
vigência. Registrado como premissa no campo `notes` da política e exibido como
evidência (`evidence`) em cada `PricingEligibilityResult`.

## C4 — Janela FEP de até 7 dias para anúncios Click-to-WhatsApp

| Fonte | O que diz |
| --- | --- |
| S1 e S2 (oficiais) | FEP "remain open for 72 hours"; S2 (25/08/2026): "The 72-hour free entry point window is unchanged". |
| Blog de terceiro citando comunicado da Meta a parceiros | A partir da semana de 21/09/2026, a janela "may extend up to 7 days", com +24h por nova mensagem do cliente. |
| Wati (BSP) | "Starting September 28, 2026: [...] free messaging window of up to 7 days". |

**Decisão:** não há confirmação na documentação pública oficial. A regra de 72h
permanece ativa. Foi criada a política `meta-fep-ctwa-7d-2026-09` com status
`UNVERIFIED`, que **nunca** é usada automaticamente. Além disso, o WCO confirma a
janela FEP real pelo `conversation.expiration_timestamp` enviado pela Meta nos
webhooks de status (S4), de modo que, se a Meta estender a janela, o valor
confirmado prevalece sobre o cálculo local.

## C5 — Comportamento sem método de pagamento após 01/10/2026

| Fonte | O que diz |
| --- | --- |
| S2 (25/08/2026) | "Meta will stop delivering service messages as of when they become charged". |
| Terceiros citando S1 em 10/09/2026 | Meta "will deliver service messages within the shared free tier but not deliver them after the free tier has been used". |

**Decisão:** o WCO não decide entrega; apenas registra `131042` (erro de método de
pagamento) como não-retryable e gera alerta `PAYMENT_METHOD_ISSUE`.

## C6 — Tarifas reais não puderam ser baixadas

Os CSVs oficiais de rate card (por moeda) ficam em `scontent-*.fbcdn.net` com URLs
assinadas; o domínio está bloqueado pela política de rede deste ambiente.

**Decisão:** nenhuma tarifa real está embarcada. O seed usa o catálogo
`DEMO-2026` (mercados `BR`, `US`, `EU`), marcado `isDemo = true` e exibido com o
selo **DEMO** em toda a interface. Tarifas reais devem ser importadas pelo
administrador (`pnpm pricing import <arquivo>` ou `/pricing` no painel), com
`sourceUrl` e `checksum` registrados.

## C7 — Determinação de elegibilidade FEP pelo dispositivo

FEP só vale para mensagens vindas do app Android/iOS. O webhook de entrada **não**
informa o dispositivo. Portanto o WCO marca a elegibilidade como
`ESTIMATED` ao receber o `referral` e só passa a `CONFIRMED` quando um webhook de
status traz `pricing.type = free_entry_point` (ou `category = referral_conversion`).
Se a primeira resposta vier como `regular`, a janela é marcada `REJECTED`.

## C8 — Mercado para "EU"

A Meta não tem um mercado "EU": há mercados próprios (França, Alemanha, Itália,
Espanha, Holanda...) e regiões ("Rest of Western Europe", etc.). O mercado `EU`
existe **somente** no catálogo DEMO, por exigência da especificação (seção 91), e
não corresponde a nenhuma região real.
