# Conectar a Meta (WhatsApp Cloud API)

Sem credenciais, o WCO roda em **MOCK** (`MOCK_WHATSAPP=true`): nenhuma mensagem real sai, mas todo o
pipeline (decisão, envio simulado, webhooks assinados, custos) funciona. Este guia descreve a ligação
com a Meta real. Fontes: [META-SOURCES.md](META-SOURCES.md) (S5, S9, S10, S11). Siga sempre a
documentação oficial vigente — passos e telas da Meta mudam.

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
  lista) e configure-o em Admin › Políticas.
* Importe o **rate card oficial** da moeda da WABA (`pnpm pricing import` ou Admin › Preços). Enquanto só
  houver DEMO, todos os custos aparecem como "TARIFAS DEMO".

## 6. Embedded Signup (SaaS para outras empresas)

Necessário apenas para conectar WABAs **de clientes**:

1. O app precisa ser **Tech Provider** (ou Solution Partner) e ter **acesso avançado** aprovado para
   `whatsapp_business_management` e `whatsapp_business_messaging` (S11).
2. Crie a configuração de Embedded Signup e defina `META_PARTNER_TYPE`, `META_APP_ID`,
   `META_EMBEDDED_SIGNUP_CONFIG_ID` e `META_ADVANCED_ACCESS_CONFIRMED=true`.
3. O front-end abre o fluxo com o SDK JavaScript da Meta (`FB.login` com `config_id`) no domínio
   aprovado e envia `code`, WABA ID, Phone Number ID e PIN para `POST /api/v1/onboarding/embedded-signup`;
   o servidor troca o código por token (TTL curto), inscreve o webhook e registra o número.

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
