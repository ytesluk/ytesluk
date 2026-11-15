# Roteamento de custo

Além de reduzir o número de mensagens (deduplicação, supersession, consolidação), o WCO escolhe **o
caminho mais barato que a Meta permite** para cada mensagem. Tudo aqui usa só a Cloud API oficial e as
regras de cobrança publicadas pela Meta (ver [PRICING.md](PRICING.md) e [META-SOURCES.md](META-SOURCES.md)).
Os valores vêm sempre do `CostEngine` e do rate card em vigor — nada é assumido como "grátis".

Código: `packages/optimization` (`scheduler.ts`, `decision-engine.ts`, `savings.ts`, `category-analyzer.ts`),
`packages/whatsapp` (`payloads.ts`, `errors.ts`, `handoff.ts`), `packages/services` (`dispatcher.ts`,
`routing.ts`, `followups.ts`, `deliverability.ts`, `outbound-webhooks.ts`).

## O que cada recurso faz

| Recurso | Quando age | Economia registrada | Como ligar |
|---|---|---|---|
| Template → mensagem livre | janela de 24 h aberta **e** a mensagem de atendimento sai mais barata que o template | `TEMPLATE_TO_FREEFORM_CSW` (Meta) | política: `allowFreeFormInWindow` (Utility) / `allowMarketingFreeFormInWindow` (Marketing) |
| Follow-up adiado | o cliente responde a um aviso transacional antes do prazo | `UTILITY_SPLIT_DEFERRED` (Meta) | campo `followUp` da intent |
| Prioridade na janela do anúncio (FEP) | abre uma janela grátis de anúncio e há mensagem agendada para depois | `FEP_PRIORITY` (Meta) | automático |
| Cliente escreve primeiro | template pago, sem janela aberta, com alternativa em mensagem livre | `TEMPLATE_TO_FREEFORM_CSW` (Meta), se o cliente escrever | política `inboundFirstGraceMinutes` + webhook `EVENTS` |
| Espelho de webhooks | todo webhook da Meta das WABAs do tenant | — | `POST /webhooks/outbound` (`MIRROR`) |
| Taxa de BSP evitada | tenant saiu de um BSP e envia direto | `BSP_MARKUP_AVOIDED` (BSP) | `legacyBspFeeModel` do tenant |
| Entregabilidade | a Meta respondeu 131026 ou 131049 para o destinatário | `INVALID_RECIPIENT_SUPPRESSED`, `FREQUENCY_CAP_DEFERRED` (infra) | automático |

Meta, BSP e infraestrutura continuam sendo tipos separados de economia, nunca somados em silêncio.
`GET /api/v1/routing` mostra os contadores e `summary.savings.routing` os valores por categoria.

## 1. Template → mensagem livre dentro da janela de 24 h

Com a janela de atendimento aberta, a Meta permite mensagens livres (texto e interativas), cobradas como
**Service**. Desde 01/10/2026 Service é cobrada pela tarifa de Utility do mercado, com 1.000 mensagens
grátis por número por mês; um template de Marketing continua custando a tarifa de Marketing mesmo com a
janela aberta. O agendador precifica as duas formas e só troca quando a mensagem livre sai **estritamente**
mais barata.

* O conteúdo é o do template aprovado, sem mudar uma palavra: cabeçalho de texto, corpo com os
  parâmetros preenchidos, rodapé e botões. Sem botões → `text`; até 3 respostas rápidas →
  `interactive` do tipo `button`; um botão de URL fixa → `interactive` do tipo `cta_url`.
* **Não é convertido** (vai o template): cabeçalho de mídia ou com variável, URL dinâmica, botão de
  telefone/copiar código/OTP/flow/catálogo, carrossel, oferta por tempo limitado, mais de 3 respostas
  rápidas, texto acima dos limites da Cloud API (1.024 no corpo interativo, 20 no título do botão).
* **Autenticação nunca** é convertida. Marketing só com `allowMarketingFreeFormInWindow` na política.
* O consentimento segue o **conteúdo**: uma oferta enviada como Service continua exigindo opt-in e
  respeita o opt-out de marketing (`MessageIntent.contentCategory`), checado de novo no envio.
* Se a janela fechar antes do envio, vai o template aprovado (motivo `template_fallback`).
* Diferença para integrações: a resposta a um botão interativo chega no webhook como
  `interactive.button_reply`, e não como `button` (resposta rápida de template). O `id` do botão é o texto.

## 2. Aviso transacional + oferta em duas etapas

A Meta classifica como Marketing o template que mistura conteúdo transacional e promocional. O caminho
correto é não misturar: o template fica **só** com o aviso, e a oferta vai em outra mensagem.

* **Splitter** (`POST /templates/split`, consultivo): separa as frases promocionais das transacionais.
  Não reescreve nada por regras; frases que misturam as duas coisas são apontadas para revisão manual
  ou para um reescritor opcional (`TEMPLATE_REWRITER_URL`, só com `AI_ASSISTANT_ENABLED=true`), cujo
  resultado é descartado se ainda tiver cara de promoção. Um texto novo é um template novo: a empresa
  envia para a Meta, que decide a categoria.
* **`followUp`** na intent (`{ text, validHours, category }`): guardado cifrado e enviado como mensagem
  de atendimento **somente se o cliente escrever** antes do prazo (padrão 72 h). Exige o consentimento
  do conteúdo (Marketing: opt-in quando o tenant exige, e sem opt-out). Uma resposta de opt-out não
  dispara nada. Se o cliente não escrever, expira e o texto é apagado.
* O WCO **não** acrescenta botões nem manda nada para provocar a resposta do cliente.

## 3. Janela grátis do anúncio, e "cliente escreve primeiro"

* **Prioridade FEP:** o agendador já prefere um horário dentro de uma janela grátis aberta. Agora,
  quando a janela abre (a empresa responde a um lead de anúncio) ou a Meta a confirma, as mensagens
  que já esperavam para depois — e que seriam pagas — são antecipadas, nunca antes do `earliestSendAt`
  do cliente. A fila de envio dá preferência a quem está dentro de uma janela FEP, atrás apenas de
  mensagens críticas e de prioridade alta. Nenhuma mensagem é criada para "aproveitar" a janela.
* **Cliente escreve primeiro** (`inboundFirstGraceMinutes`): antes de um template pago, o WCO emite o
  evento `INBOUND_WAKEUP_REQUESTED` para o endpoint `EVENTS` do tenant, com um link
  `https://wa.me/<número oficial>?text=<texto com referência>`. O tenant convida o cliente por e-mail,
  push, banner ou SMS. Se o cliente escrever dentro do prazo, o mesmo conteúdo vai como mensagem livre;
  se não, o template sai no fim do prazo, como sairia. Nunca passa do prazo da intent e nunca vale
  para mensagens críticas, OTP ou `mustSendImmediately`. Sem endpoint `EVENTS`, fica desligado.

## 4. Conexão direta com espelho de webhooks

Quem sai de um BSP para a Cloud API direta costuma ter um CRM ou helpdesk que recebia os webhooks.
`MIRROR` ("mirrorWebhookUrls") copia para esses sistemas os webhooks da Meta **das WABAs do próprio
tenant** (`messages`, `template_category_update`, `message_template_status_update`, `account_update`,
`user_preferences`), com assinatura HMAC-SHA256 (`X-WCO-Signature-256` e `X-Hub-Signature-256`),
fila própria, novas tentativas com espera exponencial e alerta se o endpoint não responder. Detalhes em
[WEBHOOKS.md](WEBHOOKS.md).

`legacyBspFeeModel` informa as taxas do BSP anterior; cada mensagem registra a taxa que deixou de ser
paga (`BSP_MARKUP_AVOIDED`, estimada, do tipo BSP). A cobrança da Meta é a mesma nos dois caminhos.

## 5. O que a Meta informou sobre o destinatário

| Erro | O que o WCO faz | Espera |
|---|---|---|
| 131026 (não entregável) | não tenta de novo mensagens comuns para esse número | 1 dia, 7 dias, 30 dias (a cada nova ocorrência) |
| 131049 (limite de marketing por usuário) | adia templates de Marketing, até o prazo da intent | 24 h (mínimo pedido pela Meta), 48 h, 72 h |

* Guardado **por tenant** e pelo hash do telefone, com validade — nunca compartilhado entre tenants.
* Uma mensagem do cliente limpa o 131026; um template de Marketing entregue limpa o 131049.
* OTP, mensagens críticas e imediatas são sempre tentadas. Utility e Autenticação não são afetadas
  pelo 131049.
* Como a Meta não cobra mensagem não entregue, isso economiza só chamadas à API (e protege a
  qualidade do número) — nunca aparece como economia Meta.

## O que não foi implementado, e por quê

* **Mensagem de "keep-alive"** para segurar a janela de 24 h aberta. Seria enviar algo sem conteúdo só
  para provocar uma resposta e mudar a cobrança. O painel já mostra quando a janela fecha.
* **"Pool" de templates-espelho** que troca para outra variante quando a Meta reclassifica um template
  de Utility para Marketing. A reclassificação é a decisão da Meta sobre aquele conteúdo; contorná-la
  com variantes leva a restrições na conta. O WCO atualiza a categoria, recalcula o custo e alerta.
* **Envio por gateways que não são a Cloud API oficial.** Outros canais (e-mail, push, SMS) são do
  tenant e recebem só o evento com o link `wa.me`; mensagens de WhatsApp saem apenas pela API oficial.
* **Cache de entregabilidade global** entre tenants: os resultados de um tenant não são usados nem
  visíveis para outro (LGPD e isolamento).
