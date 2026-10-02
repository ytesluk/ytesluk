# Preços (modelo de dados e regras)

Fontes oficiais consultadas e trechos citados: [META-SOURCES.md](META-SOURCES.md). Divergências e
decisões: [KNOWN-CONFLICTS.md](KNOWN-CONFLICTS.md). Consulta: **2026-10-02**.

## Três camadas, todas versionadas

| Camada | Onde | Muda quando |
|---|---|---|
| **Política** (`PricingPolicyVersion` + `PricingRule`) | `packages/pricing/src/policy-definitions.ts` → banco | a Meta muda *regras* (o que é cobrado, janelas, cotas, tiers) |
| **Rate card** (`PriceCatalogImport` + `PriceCatalog` + `PricingTier`) | importado por administrador | a Meta publica novos *valores* |
| **Mapa de mercados** (`MARKET_MAPPINGS`) | `packages/domain/src/market.ts` | a Meta move países entre regiões |

Cada `CostDecision` grava a política, o rate card, o mapeamento de mercado e o tier usados.
Mudar uma política ou importar um rate card **nunca** recalcula decisões, faturas ou economias
passadas: a seleção é feita pela **data de cobrança** (instante de entrega convertido para o fuso da WABA).

## Políticas embarcadas

| ID | Vigência | Status | Resumo |
|---|---|---|---|
| `meta-pmp-2025-07` | 2025-07-01 → 2026-09-30 | ACTIVE | cobrança por mensagem entregue; Service grátis; Utility grátis dentro da janela de atendimento; FEP 72 h grátis; tiers para Utility/Authentication |
| `meta-pmp-2026-10` | 2026-10-01 → | ACTIVE | Service passa a ser cobrada (tarifa = Utility do mercado), com **1.000 grátis por número/mês** e sem tiers; Utility cobrada também dentro da janela; FEP 72 h continua grátis; Meta Business Agent cobrado por token (não modelado → UNKNOWN) |
| `meta-fep-ctwa-7d-2026-09` | 2026-09-21 → | UNVERIFIED | candidata de fontes de terceiros (janela CTWA até 7 dias). **Nunca** selecionada automaticamente; só para análise what-if |

Estrutura de uma regra (`CategoryRule`): `market`, `category`, `messageKind` (TEMPLATE/NON_TEMPLATE),
`billable`, `requiresCustomerServiceWindow`, `freeEligibility` (`ALWAYS`, `FREE_ENTRY_POINT`,
`CUSTOMER_SERVICE_WINDOW`), `freeQuota` (quantidade, escopo, período), `tiered`, `rateCategory` /
`rateCategoryFallback`, `unit` (MESSAGE/TOKEN) e `sourceIds` (rastreabilidade para as fontes).

### Adicionar uma nova política

1. Leia a documentação oficial atual e registre os trechos em `META-SOURCES.md`.
2. Crie um novo `PolicyDefinition` com `effectiveFrom`, `sources` e regras — **não** edite a anterior
   além de fechar `effectiveUntil`.
3. Registre conflitos em `KNOWN-CONFLICTS.md`. Na dúvida, use status `UNVERIFIED`.
4. Testes em `packages/pricing/src/pricing.test.ts` para cada mudança de comportamento.

## Mercado

* Determinado pelo **código de discagem do destinatário** (S1). Nunca pelo país da empresa.
* Mapeamentos versionados (`meta-markets-2025-07`, `meta-markets-2026-07`, `meta-markets-2026-10`);
  países fora da lista caem em `OTHER`.
* Rate cards DEMO usam agrupamentos fictícios: `US` cobre `NORTH_AMERICA`; `EU` agrupa mercados
  europeus (a Meta **não** tem um mercado "EU" — KNOWN-CONFLICTS C8).

## Janelas gratuitas

* **Janela de atendimento (CSW)**: 24 h após a última mensagem do cliente. Mensagens livres
  (non-template) só podem ser enviadas com ela aberta (erro 131047). Se torna algo grátis depende da política.
* **Free Entry Point (FEP)**: cliente chega por anúncio Click-to-WhatsApp ou CTA de Página; a primeira
  resposta da empresa em até 24 h é grátis e abre janela de 72 h a partir da resposta. Expiração
  confirmada pela Meta (`conversation.expiration_timestamp`) prevalece; se a Meta cobrar uma mensagem
  que o WCO estimou como FEP, a entrada é marcada `REJECTED` e não volta a ser considerada.
* O scheduler só usa janelas **já abertas**; nunca "espera o cliente escrever".

## Cota gratuita e tiers

* Cota de Service (política 2026-10): 1.000 por número de telefone por mês (escopo: KNOWN-CONFLICTS C2;
  reinício no fuso da WABA: C3). Contadores `FreeQuotaCounter.used` (estimado no envio) e
  `usedConfirmed` (webhooks).
* Tiers: acumulados por (portfólio, mercado, categoria) no mês; somente mensagens **cobradas** contam;
  preço **marginal** por faixa (`TierCalculator`): a mensagem nº *n* paga a tarifa da faixa que contém *n*.
  `TierAccrual.chargedConfirmed` e `metaReportedTier` acompanham o que a Meta reportar. O WCO nunca envia
  mensagens extras para alcançar um tier.

## Rate cards

A Meta não oferece API de preços; o administrador importa os arquivos oficiais:

```bash
pnpm pricing validate meu-rate-card.csv                 # só valida
pnpm pricing import meu-rate-card.csv --tiers tiers.csv --name "Meta BRL 2026-10" \
  --currency BRL --from 2026-10-01 --source-url https://developers.facebook.com/... --source-doc "Rate card BRL"
pnpm pricing list
pnpm pricing retire <id>                                # aposenta (histórico mantido)
pnpm pricing export-demo data/rate-cards                # JSON de exemplo (DEMO)
```

Formatos aceitos: JSON; CSV "longo" (`market,currency,category,tier_start,tier_end,unit_rate`);
CSV "largo" (uma coluna por categoria) + CSV de tiers. Cabeçalhos são casados de forma tolerante e a
importação **falha** em vez de adivinhar colunas desconhecidas (C6). Cada importação tem checksum
SHA-256 (reimportar o mesmo arquivo não duplica), gera auditoria e alerta `PRICE_CHANGED`.

### DEMO

`DEMO-BRL-2025-07`, `DEMO-BRL-2026-10`, `DEMO-USD-2025-07`, `DEMO-USD-2026-10` têm valores **fictícios**
e são marcados `isDemo` em todo lugar (API, dashboard, relatórios: "TARIFAS DEMO"). Não são tarifas da Meta.

## Status de preço

| Status | Significado |
|---|---|
| `FREE` | gratuita pela regra (não cobrável, FEP, janela) |
| `QUOTA` | gratuita por consumir cota |
| `PAID` | cobrada, com tarifa e tier |
| `UNKNOWN` | sem rate card/tarifa, unidade por token, etc. — **não** entra como economia |
| `NOT_ELIGIBLE` | não pode ser enviada assim (ex.: mensagem livre fora da janela) |
