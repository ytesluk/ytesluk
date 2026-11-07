# Conectar a Meta (WhatsApp Cloud API)

Sem credenciais, o WCO roda em **MOCK** (`MOCK_WHATSAPP=true`): nenhuma mensagem real sai, mas todo o
pipeline (decisão, envio simulado, webhooks assinados, custos) funciona. Este guia descreve a ligação
com a Meta real. Fontes: [META-SOURCES.md](META-SOURCES.md) (S5, S9, S10, S11). Siga sempre a
documentação oficial vigente — passos e telas da Meta mudam.

> **Quer só testar com o número de teste da Meta?** Vá direto para o
> [passo a passo do número de teste](#teste-com-o-número-de-teste-da-meta-passo-a-passo) no fim deste guia.

## 1. Pré-requisitos na Meta

1. Conta no **Meta Business Manager** (portfólio empresarial) verificada.
2. App do tipo **Business** em <https://developers.facebook.com/apps> com o produto **WhatsApp**.
3. Uma **WABA** e um **número de telefone** registrados (pode começar pelo número de teste do app).
4. **Método de pagamento** configurado na WABA (sem ele, mensagens pagas falham — alerta `PAYMENT_METHOD_ISSUE`).
5. **System User** no Business Manager com token permanente e permissões `whatsapp_business_messaging`
   e `whatsapp_business_management`, com acesso à WABA.

## 2. Variáveis de ambiente

```bash
MOCK_WHATSAPP=false
META_GRAPH_API_VERSION=v26.0          # versão vigente na data da consulta (S10); revise periodicamente
META_APP_ID=...
META_APP_SECRET=...                   # valida X-Hub-Signature-256
META_WEBHOOK_VERIFY_TOKEN=...         # string aleatória sua, informada também no painel da Meta
# Conexão da própria empresa (opcional; também pode ser feita no dashboard):
META_ACCESS_TOKEN=...                 # token do System User
META_WABA_ID=...
META_PHONE_NUMBER_ID=...
```

Em produção use `SECRET_PROVIDER=docker` (arquivos em `/run/secrets`) ou um cofre — ver
[DEPLOYMENT.md](DEPLOYMENT.md). O token informado no dashboard é validado na Meta e guardado
**criptografado**.

## 3. Webhook

No painel do app → WhatsApp → Configuration:

* **Callback URL**: `https://<sua-api>/api/v1/webhooks/meta` (HTTPS público; em desenvolvimento use um túnel).
* **Verify token**: o mesmo de `META_WEBHOOK_VERIFY_TOKEN`.
* **Campos** a assinar: `messages` (obrigatório: status com `pricing`, mensagens recebidas, `referral`),
  `message_template_status_update`, `template_category_update`, `account_update`, `user_preferences`.

A conexão manual (dashboard › Conectar WhatsApp › Conexão manual) também inscreve o app na WABA
(`POST /<WABA_ID>/subscribed_apps`).

## 4. Conectar no dashboard

**Admin › Conectar WhatsApp › Conexão manual**: nome da empresa, WABA ID, Phone Number ID, token do
System User e fuso da WABA. O WCO consulta a WABA e o número na Graph API com esse token (o que valida
as permissões), registra número, fuso e moeda, inscreve o webhook e marca as etapas do assistente. Essa
conexão usa o token **da própria empresa** — só alcança as WABAs às quais ele tem acesso.

## 5. Templates e preços

* Cadastre/aprove templates no WhatsApp Manager. O WCO sincroniza status e categoria pelos webhooks;
  a categoria final é sempre a da Meta.
* Para consolidação, crie e aprove um template-resumo (ex.: `order_update_summary` com um parâmetro de
  lista) e configure-o em Plataforma › Políticas.
* Importe o **rate card oficial** da moeda da WABA (`pnpm pricing import` ou Plataforma › Preços). Enquanto só
  houver DEMO, todos os custos aparecem como "TARIFAS DEMO".

## 6. Embedded Signup (SaaS para outras empresas)

Necessário apenas para conectar WABAs **de clientes**:

1. O app precisa ser **Tech Provider** (ou Solution Partner) e ter **acesso avançado** aprovado para
   `whatsapp_business_management` e `whatsapp_business_messaging` (S11).
2. Crie a configuração de Embedded Signup e defina `META_PARTNER_TYPE`, `META_APP_ID`,
   `META_EMBEDDED_SIGNUP_CONFIG_ID` e `META_ADVANCED_ACCESS_CONFIRMED=true`.
3. No app da Meta: *Facebook Login for Business › Settings* com o domínio do dashboard em
   **Allowed domains** e **Valid OAuth redirect URIs** (HTTPS obrigatório; Codespaces/localhost não servem
   para o fluxo real). Crie a configuração a partir do template de Embedded Signup e use o ID em
   `META_EMBEDDED_SIGNUP_CONFIG_ID`.
4. O cliente usa **Conectar WhatsApp › Conectar com o Facebook** (`/admin/providers/embedded-signup`):
   informa um PIN de 6 dígitos, a página carrega o SDK JavaScript da Meta (CSP liberada só nessa rota),
   chama `FB.login` com `config_id` e envia na hora `code` + WABA ID + Phone Number ID + business ID
   para `POST /api/v1/onboarding/embedded-signup` (o código vale ~30 s). O servidor troca o código pelo
   token da empresa (guardado cifrado), inscreve o app nos webhooks da WABA e registra o número.
5. O cliente adiciona a forma de pagamento no WhatsApp Manager — a Meta cobra o cliente diretamente.

Em `APP_MODE=production`, sem essas configurações o onboarding comercial fica **bloqueado** — um token
de desenvolvedor não administra a WABA de qualquer cliente.

## 7. Limites

* Throughput padrão de 80 mensagens/s por número (S9): `DISPATCH_MAX_PER_SECOND`.
* Limite por par (mesmo usuário) e erros de limite → reagendamento com backoff, nunca contorno.
* Qualidade do número e limites de mensagens por dia são da Meta; acompanhe no WhatsApp Manager.

## 8. Checklist de ida para produção

- [ ] `APP_MODE=production`, `MOCK_WHATSAPP=false`, segredos fortes fora do repositório
- [ ] Webhook verificado e recebendo `statuses` com `pricing`
- [ ] Rate card oficial importado para a moeda da WABA; DEMO aposentado
- [ ] Templates aprovados (inclusive os de consolidação)
- [ ] Opt-in registrado conforme a política do tenant; retenção LGPD configurada
- [ ] Monitoração dos alertas (pagamento, restrição de conta, falha de webhook)

## Teste com o número de teste da Meta (passo a passo)

Para ver o WCO decidindo com o WhatsApp de verdade, sem número próprio. Tempo: ~30 minutos.
Fonte: guia "Get Started" da Cloud API (META-SOURCES S12). As telas da Meta mudam; os nomes abaixo são os
da documentação de jun/2026.

**O que este teste prova:** que o WCO envia pela Cloud API, recebe os webhooks e evita as mensagens certas
no seu celular (7 eventos → 3 mensagens), e mostra o que a Meta informa sobre a cobrança de cada mensagem.
**O que não prova:** economia em R$ na escala de uma empresa — o número de teste é para desenvolvimento e
só envia para os destinatários cadastrados na lista dele (até 5). Para dinheiro, veja TESTAR-ECONOMIA.md.

### Jeito rápido: assistente

Faça só a parte da Meta (passos 1 a 3 abaixo; o token pode ser o do botão **Generate access token** da
tela *API Setup*, que expira em algumas horas) e copie também o **App ID** e o **App secret** (passo 5).
Depois, no terminal do Codespaces, na pasta do projeto:

```bash
git pull
node scripts/configurar-teste.mjs
```

Ele pede os valores (segredos aparecem como `****`), grava o `.env`, deixa a porta 4000 pública, reinicia o
sistema, confere se o endereço público responde à verificação da Meta, cria uma conta de teste no WCO,
conecta a conta do WhatsApp (o token é validado na Meta e guardado criptografado), aponta os webhooks de
mensagens para o Codespace (*webhook overrides* da Meta, S13) e roda o teste dos 7 eventos. No fim mostra o
login do painel. Rodar de novo reaproveita a mesma conta (`.wco-teste.json`, fora do Git).

Os passos manuais abaixo fazem o mesmo, um a um.

### Na Meta

1. Em <https://developers.facebook.com/apps> → **Create App** → caso de uso **Connect with customers through
   WhatsApp** → escolha (ou crie) um portfólio empresarial → **Create app**.
2. **Start using the API** (tela *API Setup*): a Meta cria uma conta do WhatsApp Business e um **número de
   teste**. Anote o **WhatsApp Business Account ID** e o **Phone number ID** do número de teste.
3. Ainda em *API Setup*, no campo **To**, adicione o **seu celular** (a Meta manda um código pelo WhatsApp
   para confirmar). Clique em **Send message**: você deve receber o template `hello_world`. Responda
   qualquer coisa.
4. **Token permanente** (o token temporário do painel expira rápido): *Business Settings* → **System users**
   → **Add** → selecione o usuário → **Assign assets**: o app (*Manage app*) e a conta do WhatsApp
   (*Manage WhatsApp Business accounts*) → **Generate token** com as permissões `business_management`,
   `whatsapp_business_messaging` e `whatsapp_business_management`. Guarde o token.
5. Em *App settings › Basic*, copie o **App ID** e o **App secret**.

### No Codespaces

6. Na pasta do projeto, crie o arquivo `.env` (ele não vai para o Git):

   ```bash
   MOCK_WHATSAPP=false
   META_APP_ID=<App ID>
   META_APP_SECRET=<App secret>
   META_WEBHOOK_VERIFY_TOKEN=<invente uma senha longa>
   META_GRAPH_API_VERSION=v26.0
   ```

   e suba de novo: `git pull` e
   `docker compose -f docker-compose.yml -f infra/docker/compose.host-network.yml up -d --build`.
7. Aba **Portas**: clique com o botão direito na porta **4000** → **Visibilidade da porta** → **Pública**
   (a Meta precisa alcançar o webhook). Abra `https://<seu-codespace>-4000.app.github.dev/api/v1/health`:
   deve aparecer `"mockWhatsApp":false`. Ao terminar o teste, volte a porta para **Privada**.

### Webhook

8. No app da Meta → **WhatsApp › Configuration** → *Webhook*:
   * **Callback URL**: `https://<seu-codespace>-4000.app.github.dev/api/v1/webhooks/meta`
   * **Verify token**: o mesmo `META_WEBHOOK_VERIFY_TOKEN` → **Verify and save**
   * Em *Webhook fields*, assine **messages** (e, se quiser, `message_template_status_update` e
     `template_category_update`).

### No painel do WCO

9. Crie uma conta em `/signup` (ou entre com a sua) → **Admin › Conectar WhatsApp › Conexão manual**: nome da
   empresa, WABA ID, Phone number ID e o token do passo 4 → **Validar e conectar**. Os templates da conta
   (inclusive `hello_world`) são importados automaticamente; confira em **Admin › Templates**.
10. **Admin › Tenant e acesso** → crie uma **chave de API** e copie (ela aparece uma vez só).

### Rodar o teste

11. No terminal do Codespaces:

    ```bash
    API_KEY=wco_... node scripts/test-number.mjs --to +5541999999999 --comparar
    ```

    `--to` é o seu celular do passo 3. O script manda 7 eventos duas vezes: sem otimização (7 mensagens) e
    com o WCO (3 mensagens: 4 atualizações do mesmo pedido viram 1, o pagamento repetido é bloqueado, o aviso
    urgente sai na hora). Para cada mensagem enviada ele mostra o que a Meta informou no webhook
    (`cobrável`/`não cobrável`, categoria e tipo). Sem `--comparar`, roda só a parte com o WCO.
    Outro template: `--template nome --lang pt_BR` (precisa estar APPROVED; só variáveis do corpo são
    preenchidas).

### Se algo der errado

| Sintoma | Causa provável |
|---|---|
| "A API está em modo MOCK" | o `.env` não foi lido: confira o nome/local do arquivo e suba o compose de novo |
| Conexão manual recusada com erro 190 | token inválido ou expirado — gere o token do System User (passo 4) |
| Mensagem `falhou` com código 131030 | seu número não está na lista de destinatários do número de teste (passo 3) |
| Mensagens `enviada` mas sem retorno da Meta | webhook não chega: porta 4000 pública? Callback verificado? Campo `messages` assinado? `META_APP_SECRET` correto? (assinatura inválida é recusada) |
| "Template ... não está no WCO" | **Admin › Templates › Sincronizar com a Meta** |
