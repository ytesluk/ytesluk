# Motor de otimização

Código: `packages/optimization` (lógica pura) e `packages/policy` (políticas e regras), executados pelo
worker (`packages/services/src/optimizer.ts`) e, sem banco, pelo simulador (`InMemoryPipeline`). Sem
LLM no caminho quente: tudo é determinístico e explicável.

## Chaves

| Chave | Composição | Para quê |
|---|---|---|
| `eventHash` | tipo + entidade + payload canônico + destino + template | deduplicação |
| `groupKey` | tenant + número da empresa + cliente + entidade | unidade de serialização (lock) do buffer |
| `supersessionKey` | cliente + entidade + fluxo de atualização | estado mais recente substitui anteriores |
| `consolidationKey` | cliente + entidade + **mesma categoria** + mesmo template-resumo | o que pode virar uma única mensagem |

Todas usam identificadores pseudônimos (hash do cliente), nunca o telefone.

## Técnicas

### Deduplicação e idempotência
* `idempotencyKey` repetida → retorna a intent existente (HTTP 200, `idempotent: true`), índice único.
* Mesmo `eventHash` dentro de `dedupWindowSeconds`: se o gêmeo já foi enviado → `alreadySent`; se ainda
  está no buffer → um deles é suprimido (`SUPPRESS_DUPLICATE`, `duplicateOfId`). Com workers
  concorrentes, qual dos dois sobrevive depende da ordem de processamento — o conteúdo é idêntico.

### Supersession
* Em um mesmo fluxo, um estado mais novo (por `occurredAt` do cliente) substitui estados **ainda não
  enviados**; uma atualização que chega atrasada é ela própria substituída.
* O sobrevivente herda o **prazo mais cedo** dos substituídos (a promessa de entregar a primeira
  atualização até T continua valendo, com informação mais nova).
* Histórico preservado: `SUPERSEDED` + `supersededById`.

### Debounce limitado (trailing, bounded)
* Cada intent no buffer tem `flushAt` (fim do debounce) e `hardDeadline` (prazo efetivo ou "pouco antes
  de a janela gratuita fechar"). Um evento novo no mesmo fluxo empurra o flush dos pares até o próprio
  `flushAt`, **nunca** além do `hardDeadline` de nenhum deles.

### Consolidação
* Só junta intents com a mesma `consolidationKey` (mesma categoria de cobrança), cujo template-resumo
  esteja registrado e **aprovado pela Meta**; respeita limites de parâmetros (divide, nunca trunca);
  parâmetros sem quebras de linha (validação da Graph API), unidos por "; ".
* Nunca mistura OTP, atualização de pedido e promoção.

### Agendamento (scheduler)
* Candidatos: agora/`earliestSendAt`, fim do debounce, `preferredSendAt` e "pouco antes de cada janela
  gratuita **já aberta** fechar" (margem de 120 s, pois a Meta cobra na **entrega**).
* Cada candidato é precificado pelo mesmo `CostEngine` da cobrança; escolhe o mais barato dentro do prazo.
* Alternativa "mensagem livre dentro da janela" só para Utility com `allowFreeFormInWindow` — Marketing
  nunca é convertido.
* Envios agendados pelo cliente (`earliestSendAt`/`preferredSendAt` futuros) são respeitados em todos
  os braços (job de envio atrasado).

## Decisão

`decide()` calcula fatos (`duplicate`, `alreadySent`, `superseded`, `bypassBuffer`, `canDelay`,
`canAggregate`, `maxDelayExceeded`, `optedOut`, `noOptIn`, `nonTemplateOutsideWindow`,
`freeEntryPointOpen`, `customerServiceWindowOpen`, …) e roda o `PolicyEngine` (regras declarativas,
primeira que casa decide). Ações: `SEND_NOW`, `DELAY`, `CONSOLIDATE`, `SUPERSEDE`, `SUPPRESS_DUPLICATE`,
`BLOCK`, `CANCEL`. Cada decisão grava motivos (`reasons`), fatos, regra e versão do conjunto de regras.

Regras padrão (editáveis em Admin › Políticas ou `PUT /api/v1/optimization/rules`):

```
optedOut → BLOCK · marketingOptedOut ∧ isMarketing → BLOCK · noOptIn → BLOCK
nonTemplateOutsideWindow → BLOCK · alreadySent → SUPPRESS · duplicate → SUPPRESS
superseded → SUPERSEDE · bypassBuffer → SEND_NOW · maxDelayExceeded → SEND_NOW
canAggregate → CONSOLIDATE · canDelay → DELAY · (default) → SEND_NOW
```

### Invariantes (não configuráveis)

* **Nunca atrasar**: prioridade `CRITICAL`, autenticação/OTP, `mustSendImmediately`,
  `requiresImmediateDelivery` e tipos que casam com `auth|otp|fraud|security|critical|urgent|legal|immediate`.
  Um conjunto de regras do tenant não consegue atrasá-los (testado).
* Opt-out sempre bloqueia; opt-out de marketing bloqueia Marketing.
* Mensagem livre só com janela de atendimento aberta (checada de novo no envio).
* Nada de mensagens extras para alcançar tiers; nada de alterar conteúdo para mudar categoria.

## Políticas padrão por evento

| Evento | Atraso máx. | Debounce | Técnicas | Categoria |
|---|---:|---:|---|---|
| `order.status`, `order.updated` | 60 s | 30 s | supersession + consolidação (`order_update_summary`) | Utility |
| `payment.approved` | 60 s | 30 s | consolidação | Utility |
| `shipment.tracking` | 120 s | 60 s | supersession + consolidação | Utility |
| `stock.update` | 120 s | 60 s | supersession | Marketing |
| `appointment.reminder` | 6 h | — | supersession (reagendamento) | Utility |
| `marketing.campaign` | 24 h | — | dedup 7 dias, janela gratuita | Marketing |
| `cart.reminder` | 12 h | — | supersession | Marketing |
| `support.reply` | 0 | — | mensagem livre na janela | Service |
| `authentication.otp` | **0** | — | nunca atrasa | Authentication |
| `critical.security`, `fraud.alert` | **0** | — | nunca atrasa | Utility |
| `*` (padrão) | 0 | — | só deduplicação | — |

## Exemplo (spec §63)

`ORDER_CREATED 10:00:00 · PAYMENT_APPROVED 10:00:12 · ORDER_PACKED 10:00:25 · ORDER_SHIPPED 10:00:40`
→ 4 intents, 1 mensagem ("ENVIADO"), 3 `SUPERSEDED`, economia estimada = 3 × tarifa Utility do mercado
(menos o custo de infraestrutura). Verificado em teste unitário, no E2E com API + workers e no stack Docker.

## Recomendações e oportunidades

`insights.ts` gera recomendações (ex.: "10,3% dos `marketing.campaign` foram duplicados") e
oportunidades (duplicação, consolidação, FEP, tiers, BSP) com potencial estimado e confiança. São
sempre rotuladas como estimativas. O analisador de categoria é consultivo: "Final category is determined by Meta".
