# Motor de cobrança (CostEngine)

`packages/pricing/src/cost-engine.ts` + `policy.ts` + `windows.ts` + `tier-calculator.ts`.
Função pura: `(contexto da mensagem, políticas, rate cards) → PricingEligibilityResult`. O mesmo motor
é usado pela API, pelo worker, pelo simulador e pelos testes.

## Entrada

`category`, `messageKind`, `at` (instante previsto/real da entrega), `timezone` (da WABA), `recipient`
ou `market`, `businessPhoneNumberId`, `conversation` (fatos de CSW/FEP), `quotaUsed`, `tierPosition`,
`authInternationalEligible`, `currency`. Opcional: `policyVersionId` (recalcular com uma versão
específica) e `includeUnverifiedPolicies` (what-if).

## Ordem de avaliação

1. **Data de cobrança** = `at` no fuso da WABA → seleciona política (`PolicyRegistry.forDate`) e rate card.
2. **Mercado** pelo código do destinatário e mapeamento vigente.
3. **Janelas** recalculadas no instante `at` com as durações da política (nunca só um timer local).
4. **Autenticação internacional** quando a empresa é elegível no mercado.
5. **Regra** da categoria; mensagem livre fora da janela → `NOT_ELIGIBLE`.
6. Unidade por token → `UNKNOWN` (não modelado).
7. **Tarifa** (com `rateCategoryFallback`, ex.: Service usa a tarifa de Utility do mercado).
8. **Gratuidade**: não cobrável / FEP / CSW, conforme `freeEligibility`.
9. **Cota** (`QUOTA`) enquanto houver saldo.
10. Sem tarifa → `UNKNOWN`.
11. **Tier** pela posição marginal no mês → `PAID` com tarifa da faixa.

A saída inclui `status`, `reason`, `rate`, `listRate` ("quanto custaria"), `freeReason`, `policyVersion`,
`rateCardId`, `isDemoRate`, `billingDate`, `billingMonth`, janelas, tier e uma trilha de **evidências**
em texto (exibida na auditoria da mensagem).

## Três custos por intent

| `CostDecision.kind` | Quando | Uso |
|---|---|---|
| `BASELINE` | na decisão | custo contrafactual "sem WCO": mensagem enviada já, como chegou |
| `OPTIMIZED` | na decisão | custo previsto do que o WCO decidiu (quando, como, consolidada…) |
| `REALIZED` | no webhook `delivered` | confirmado pelo objeto `pricing` da Meta |

## Realização (estimado → realizado)

No webhook de status com `pricing` (`billable`, `type`, `category`):

* `billable=false` → custo realizado 0 (com o tipo informado: `free_entry_point`, `free_customer_service`…).
* `billable=true` → tarifa do rate card vigente na data da entrega, tier pela posição confirmada.
* Divergência com a estimativa (ex.: estimado FEP, Meta cobrou) → realizado segue a Meta; a entrada FEP
  vira `REJECTED`; contadores `*Confirmed` acompanham a Meta.
* Sem objeto `pricing` → mantém ESTIMADO (nunca promove a REALIZADO sem evidência).

## Economia

`SavingsRecord` por intent × tipo (META, BSP, INFRASTRUCTURE) × mecanismo (DEDUPLICATION, SUPERSESSION,
CONSOLIDATION, FREE_WINDOW, FREE_QUOTA, CATEGORY — mensagem livre na janela em vez de template —, VOLUME_TIER,
DIRECT_API, BSP_MARKUP, INFRASTRUCTURE, NONE), com `confidence`:

* **ESTIMATED**: baseline − otimizado no momento da decisão.
* **REALIZED**: baseline − custo confirmado pela Meta.
* **UNKNOWN**: sem baseline ou preço desconhecido → não soma.

Infraestrutura usa `INFRA_COST_PER_MESSAGE_PROCESSED` e `INFRA_COST_PER_PROVIDER_CALL`; pode ser
**negativa** (o WCO tem custo próprio). BSP usa o `bspFeeModel` do tenant (NONE, PERCENTAGE,
FIXED_PER_MESSAGE, MONTHLY, MIXED) — hipótese configurável, nem todo BSP cobra markup.

## Precisão numérica

`decimal.js` (`Money`) em todo cálculo; banco `numeric(18,8)`; serialização como string; arredondamento
apenas na apresentação.
