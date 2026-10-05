# Como testar se a economia funciona

São três perguntas diferentes, e cada uma tem um teste:

| Pergunta | Teste | Precisa de | Prova |
|---|---|---|---|
| 1. O mecanismo funciona? | demo + `pnpm smoke` | nada (modo MOCK) | que o WCO evita as mensagens certas e nunca atrasa as críticas |
| 2. Economiza para **esta** empresa? | histórico real (CSV) | exportação de 1 mês de envios + rate card oficial | quanto o tráfego real dela teria economizado (**estimativa**) |
| 3. Economizou de verdade? | piloto com a Meta | número/WABA reais | custo cobrado pela Meta antes × depois, ou grupo controle |

O teste 1 não diz nada sobre dinheiro; o que decide se o produto vale a pena é o **teste 2**. O teste 3
é a prova final.

O WCO **não reduz o preço** de cada mensagem — esse preço é da Meta. Ele só economiza quando o tráfego tem:
reenvios do mesmo aviso, várias atualizações seguidas do mesmo pedido, conversas que chegam por anúncio
(janelas gratuitas) ou taxa de BSP. Se o histórico da empresa não tem isso, a economia será perto de zero —
e isso também é uma resposta válida.

---

## 1. O mecanismo funciona? (5 minutos)

Com o sistema no ar (Codespaces ou `docker compose up`), no terminal:

```bash
corepack enable && pnpm install   # só na primeira vez (no Codespaces o stack roda no Docker)
pnpm smoke
```

Ele envia eventos pela API e confere: o mesmo evento duas vezes vira **1** mensagem; quatro atualizações do
mesmo pedido em segundos viram **1** (a mais recente); OTP sai na hora; o custo confirmado vem do webhook.
No painel, **Mensagens › (abrir uma)** mostra a decisão e o porquê de cada mensagem.

## 2. Economiza para esta empresa? (o teste que importa)

### 2.1 Conseguir os dados

Peça ao sistema que **dispara** as mensagens (ERP, CRM, plataforma de e-commerce, painel do BSP) uma
exportação das mensagens enviadas em **1 mês**. Precisa ter, por mensagem:

| Coluna | Obrigatória | Conteúdo |
|---|---|---|
| `timestamp` | sim | data/hora do envio, ISO-8601 (`2026-09-01T12:00:00Z`) |
| `customer` | sim | telefone ou um código do cliente (pode ser anonimizado, desde que o mesmo cliente tenha sempre o mesmo código) |
| `eventType` | sim | o que gerou a mensagem: `order.status`, `payment.approved`, `appointment.reminder`… (ver nota abaixo) |
| `category` | sim | `MARKETING`, `UTILITY`, `AUTHENTICATION` ou `SERVICE` (a categoria do template na Meta) |
| `country` | sim | país do destinatário (`BR`, `US`…) |
| `delivered` | sim | `true` se foi entregue |
| `entityId` | **recomendado** | número do pedido / protocolo / consulta |
| `content` | opcional | texto ou variáveis da mensagem (só é usado para comparar; pode ser um hash) |
| `template`, `status`, `source`, `isFEP`, `isServiceWindow` | opcional | template, situação, sistema de origem, conversa iniciada por anúncio, janela de atendimento aberta |

Modelo pronto: [`docs/exemplos/modelo-historico-wco.csv`](exemplos/modelo-historico-wco.csv) (também no
painel, botão **Baixar modelo CSV**).

**Por que `entityId` importa.** O teste é conservador de propósito:

* com `entityId`: o WCO pode bloquear reenvios, substituir atualizações seguidas do mesmo pedido pela
  mais recente e consolidar;
* só com `content`: apenas reenvios idênticos são bloqueados;
* sem nenhum dos dois: a linha é reenviada como está e **não conta economia** — não dá para saber se
  duas mensagens iguais são um reenvio ou dois pedidos diferentes.

Ou seja: sem identificação o resultado subestima a economia, nunca superestima.

**`eventType` e atrasos.** As regras de espera (ex.: `order.status` espera até 30 s por novas
atualizações, no máximo 60 s) vêm das políticas em **Admin › Políticas**. Tipos que não existem lá usam a
política padrão (sem espera: só deduplicação). Use os nomes existentes ou crie a política do tipo antes
de testar.

### 2.2 Usar as tarifas reais

Sem isso os valores em R$ usam o rate card **DEMO** (fictício) — as **contagens** de mensagens evitadas
continuam reais. Baixe o rate card oficial da sua moeda na página de preços da Meta
(<https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/>) e importe em
**Admin › Preços** (ou `pnpm pricing import <arquivo>`). O formato exato do arquivo oficial não pôde ser
verificado neste ambiente (KNOWN-CONFLICTS C6): se a importação recusar o arquivo, `pnpm pricing
export-demo <pasta>` gera o modelo JSON para preencher com os valores da tabela oficial.

### 2.3 Rodar

* **No painel:** **Simular economia › Histórico CSV** → escolher o arquivo → *Calcular baseline e simulação*.
* **No terminal, sem subir o arquivo para servidor nenhum** (bom para dados de cliente em prospecção):

  ```bash
  pnpm historico arquivo.csv --rate-card tarifas-oficiais.json
  ```

### 2.4 Ler o resultado

* **Custo como enviado** deve ficar perto da fatura da Meta do mesmo mês. Se ficar muito diferente, a
  categoria, o país ou o rate card do arquivo estão errados — corrija antes de confiar na economia.
* **Mesmos eventos sem WCO × com WCO**: mensagens e custo; a diferença é a economia estimada.
* **De onde veio a economia**: reenvios bloqueados, atualizações substituídas, consolidadas, janelas
  gratuitas. Se quase tudo vier de um único motivo, confira na origem se aquilo é real (ex.: reenvios
  podem ser um defeito da integração que vale corrigir de qualquer jeito).
* **Vale a pena?** Economia mensal em R$ (com tarifas oficiais) comparada à mensalidade do plano e ao
  atraso aceito (30–120 s em atualizações de pedido). Se a economia não paga a mensalidade, o WCO não
  serve para essa empresa.

Exemplo do modelo (8 mensagens, tarifas DEMO, **não representa** uma empresa real): 3 atualizações do
pedido `PED-1001` em 25 s viram 1 mensagem; o pedido `PED-1002` do mesmo cliente é enviado normalmente;
o pagamento reenviado 4 s depois é bloqueado; OTP e campanha não mudam → 8 → 5 mensagens.

## 3. Economizou de verdade? (piloto)

Antes do piloto, dá para ver o WCO funcionando com o WhatsApp real usando o **número de teste da Meta**
(`pnpm teste-numero`, passo a passo em [SETUP-META.md](SETUP-META.md#teste-com-o-número-de-teste-da-meta-passo-a-passo)):
7 eventos viram 3 mensagens no seu celular. Isso prova a integração, não a economia em escala.

1. Conecte um número real (Admin › Conectar WhatsApp; ver SETUP-META.md) com o rate card oficial.
2. Integre o sistema da empresa à API (`POST /api/v1/messages/intents`, com `entityId`).
3. Rode 2 a 4 semanas. Os custos marcados **REALIZED** vêm do objeto `pricing` dos webhooks da Meta.
4. Compare de um destes jeitos:
   * **antes × depois**: fatura da Meta do mês anterior × mês do piloto, ajustando pelo volume de pedidos;
   * **grupo controle** (mais confiável): o sistema de origem sorteia uma parte dos clientes e envia para
     eles com `"mustSendImmediately": true` e `"optimization": { "allowDeduplication": false,
     "allowAggregation": false, "allowSupersession": false }` — esse grupo é enviado na hora, sem espera,
     bloqueio, substituição ou consolidação. Compare o custo realizado por cliente dos dois grupos no
     mesmo período.

Só o item 3 é economia comprovada; os itens 1 e 2 são estimativas e devem ser apresentados assim.
